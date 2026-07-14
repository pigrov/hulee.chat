import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  inboxV2SourceAccountIdentityAliases,
  inboxV2SourceAccountIdentityTransitions,
  inboxV2SourceAccountIdentityVerifiedSnapshots
} from "./inbox-v2/source-account-identity";
import {
  INBOX_V2_SOURCE_THREAD_BINDING_AGGREGATE_INTEGRITY_SQL,
  INBOX_V2_SOURCE_THREAD_BINDING_EVIDENCE_INTEGRITY_SQL,
  inboxV2SourceThreadBindingCapabilityEntries,
  inboxV2SourceThreadBindingCapabilityRequiredRoles,
  inboxV2SourceThreadBindingEvidenceReferences,
  inboxV2SourceThreadBindingEvidenceSets,
  inboxV2SourceThreadBindingHeads,
  inboxV2SourceThreadBindingProviderRoles,
  inboxV2SourceThreadBindingRemoteAccessEpisodes,
  inboxV2SourceThreadBindingRouteAttributes,
  inboxV2SourceThreadBindingSnapshots,
  inboxV2SourceThreadBindings,
  inboxV2SourceThreadBindingTransitionMatchedPermissions,
  inboxV2SourceThreadBindingTransitions
} from "./inbox-v2/source-thread-binding";
import {
  employees,
  normalizedInboundEvents,
  rawInboundEvents,
  sourceAccounts
} from "./tables";
import { inboxV2ExternalThreads } from "./inbox-v2/external-thread";

describe("Inbox V2 SourceThreadBinding persistence schema", () => {
  it("separates the immutable anchor, current head and temporal children", () => {
    expect(getTableConfig(inboxV2SourceThreadBindings).name).toBe(
      "inbox_v2_source_thread_bindings"
    );
    expect(getTableConfig(inboxV2SourceThreadBindingHeads).name).toBe(
      "inbox_v2_source_thread_binding_heads"
    );
    expect(getTableConfig(inboxV2SourceThreadBindingSnapshots).name).toBe(
      "inbox_v2_source_thread_binding_snapshots"
    );
    expect(
      getTableConfig(inboxV2SourceThreadBindingRemoteAccessEpisodes).name
    ).toBe("inbox_v2_source_thread_binding_remote_access_episodes");
    expect(getTableConfig(inboxV2SourceThreadBindingTransitions).name).toBe(
      "inbox_v2_source_thread_binding_transitions"
    );

    expect(primaryKeyColumns(inboxV2SourceThreadBindings)).toEqual([
      ["tenant_id", "id"]
    ]);
    expect(primaryKeyColumns(inboxV2SourceThreadBindingHeads)).toEqual([
      ["tenant_id", "binding_id"]
    ]);
    expect(primaryKeyColumns(inboxV2SourceThreadBindingSnapshots)).toEqual([
      ["tenant_id", "binding_id", "revision"]
    ]);
    expect(
      uniqueColumns(
        inboxV2SourceThreadBindings,
        "inbox_v2_source_thread_bindings_thread_account_unique"
      )
    ).toEqual(["tenant_id", "external_thread_id", "source_account_id"]);
    expect(
      uniqueColumns(
        inboxV2SourceThreadBindings,
        "inbox_v2_source_thread_bindings_owner_account_unique"
      )
    ).toEqual(["tenant_id", "id", "source_account_id"]);
  });

  it("proves the exact binding -> thread -> account -> connection induction", () => {
    expectForeignKey(
      inboxV2SourceThreadBindings,
      "inbox_v2_source_thread_bindings_thread_fk",
      inboxV2ExternalThreads,
      ["tenant_id", "external_thread_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2SourceThreadBindings,
      "inbox_v2_source_thread_bindings_account_edge_fk",
      sourceAccounts,
      ["tenant_id", "source_account_id", "source_connection_id"],
      ["tenant_id", "id", "source_connection_id"]
    );
    expectForeignKey(
      inboxV2SourceThreadBindingHeads,
      "inbox_v2_source_thread_binding_heads_binding_fk",
      inboxV2SourceThreadBindings,
      [
        "tenant_id",
        "binding_id",
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
  });

  it("fences the head and every revision to one immutable verified identity", () => {
    expectForeignKey(
      inboxV2SourceThreadBindingHeads,
      "inbox_v2_source_thread_binding_heads_account_snapshot_fk",
      inboxV2SourceAccountIdentityVerifiedSnapshots,
      [
        "tenant_id",
        "source_account_id",
        "account_identity_revision",
        "account_generation",
        "account_identity_state",
        "account_canonical_key_digest_sha256",
        "account_identity_trusted_service_id",
        "account_verified_at"
      ],
      [
        "tenant_id",
        "source_account_id",
        "identity_revision",
        "account_generation",
        "state",
        "canonical_key_digest_sha256",
        "declaration_loaded_by_trusted_service_id",
        "verified_decision_decided_at"
      ]
    );

    const check = checkSql(
      inboxV2SourceThreadBindingHeads,
      "inbox_v2_source_thread_binding_heads_account_snapshot_check"
    );
    expect(check).toContain("= 'verified'");
    expect(check).toContain("^[a-f0-9]{64}$");
    expect(check).toContain("account_identity_trusted_service_id");

    expectForeignKey(
      inboxV2SourceThreadBindingSnapshots,
      "inbox_v2_source_thread_binding_snapshots_account_snapshot_fk",
      inboxV2SourceAccountIdentityVerifiedSnapshots,
      [
        "tenant_id",
        "source_account_id",
        "account_identity_revision",
        "account_generation",
        "account_identity_state",
        "account_canonical_key_digest_sha256",
        "account_identity_trusted_service_id",
        "account_verified_at"
      ],
      [
        "tenant_id",
        "source_account_id",
        "identity_revision",
        "account_generation",
        "state",
        "canonical_key_digest_sha256",
        "declaration_loaded_by_trusted_service_id",
        "verified_decision_decided_at"
      ]
    );

    const marker = checkSql(
      inboxV2SourceThreadBindingSnapshots,
      "inbox_v2_source_thread_binding_snapshots_marker_check"
    );
    expect(marker).toMatch(/"revision" = 1/);
    expect(marker).toMatch(/"transition_id" is null/);
    expect(marker).toMatch(
      /"expected_binding_revision" = [^\n]+\."revision" - 1/
    );
  });

  it("uses binding-owned evidence sets and typed exact reference FKs", () => {
    expectForeignKey(
      inboxV2SourceThreadBindingEvidenceSets,
      "inbox_v2_binding_evidence_sets_owner_fk",
      inboxV2SourceThreadBindings,
      [
        "tenant_id",
        "binding_id",
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
      inboxV2SourceThreadBindingEvidenceReferences,
      "inbox_v2_binding_evidence_references_set_fk",
      inboxV2SourceThreadBindingEvidenceSets,
      [
        "tenant_id",
        "evidence_set_id",
        "binding_id",
        "source_connection_id",
        "source_account_id"
      ],
      [
        "tenant_id",
        "id",
        "binding_id",
        "source_connection_id",
        "source_account_id"
      ]
    );
    expectForeignKey(
      inboxV2SourceThreadBindingEvidenceReferences,
      "inbox_v2_binding_evidence_references_raw_connection_fk",
      rawInboundEvents,
      ["tenant_id", "raw_inbound_event_id", "source_connection_id"],
      ["tenant_id", "id", "source_connection_id"]
    );
    expectForeignKey(
      inboxV2SourceThreadBindingEvidenceReferences,
      "inbox_v2_binding_evidence_references_raw_account_fk",
      rawInboundEvents,
      ["tenant_id", "raw_inbound_event_id", "source_account_id"],
      ["tenant_id", "id", "source_account_id"]
    );
    expectForeignKey(
      inboxV2SourceThreadBindingEvidenceReferences,
      "inbox_v2_binding_evidence_references_normalized_connection_fk",
      normalizedInboundEvents,
      ["tenant_id", "normalized_inbound_event_id", "source_connection_id"],
      ["tenant_id", "id", "source_connection_id"]
    );
    expectForeignKey(
      inboxV2SourceThreadBindingEvidenceReferences,
      "inbox_v2_binding_evidence_references_identity_transition_fk",
      inboxV2SourceAccountIdentityTransitions,
      [
        "tenant_id",
        "source_account_identity_transition_id",
        "source_account_id",
        "source_account_identity_transition_resulting_revision",
        "source_account_identity_transition_resulting_generation"
      ],
      [
        "tenant_id",
        "id",
        "source_account_id",
        "resulting_revision",
        "resulting_account_generation"
      ]
    );
    expectForeignKey(
      inboxV2SourceThreadBindingEvidenceReferences,
      "inbox_v2_binding_evidence_references_identity_alias_fk",
      inboxV2SourceAccountIdentityAliases,
      [
        "tenant_id",
        "source_account_identity_alias_id",
        "source_account_id",
        "source_account_identity_alias_expected_revision",
        "source_account_identity_alias_expected_generation",
        "source_account_identity_alias_target_state",
        "source_account_identity_alias_canonical_key_digest_sha256"
      ],
      [
        "tenant_id",
        "id",
        "canonical_source_account_id",
        "expected_account_identity_revision",
        "expected_account_generation",
        "target_identity_state",
        "canonical_key_digest_sha256"
      ]
    );

    const referenceDigest = generatedColumnSql(
      inboxV2SourceThreadBindingEvidenceReferences,
      "reference_key_digest_sha256"
    );
    expect(referenceDigest).toContain("sha256");
    expect(referenceDigest).toContain("case");
    expect(referenceDigest).toContain("provider_roster_evidence");
    expect(referenceDigest).toContain("provider_roster_member_evidence");
    expect(referenceDigest).not.toContain('"kind"::text');
    expect(
      uniqueColumns(
        inboxV2SourceThreadBindingEvidenceReferences,
        "inbox_v2_binding_evidence_references_value_unique"
      )
    ).toEqual(["tenant_id", "evidence_set_id", "reference_key_digest_sha256"]);

    const xor = checkSql(
      inboxV2SourceThreadBindingEvidenceReferences,
      "inbox_v2_binding_evidence_references_kind_xor_check"
    );
    expect(xor).toContain("source_account_identity_transition");
    expect(xor).toContain("source_account_identity_alias");
    expect(xor).toContain("provider_roster_evidence");
    expect(xor).toContain("provider_roster_member_evidence");
    expect(xor).toContain("num_nonnulls");
  });

  it("keeps exactly one open episode and pins the head to its state/revision", () => {
    const episode = getTableConfig(
      inboxV2SourceThreadBindingRemoteAccessEpisodes
    );
    const open = episode.indexes.find(
      (candidate) =>
        candidate.config.name ===
        "inbox_v2_binding_remote_access_episodes_one_open_unique"
    );
    expect(open?.config.unique).toBe(true);
    expect(open?.config.where).toBeDefined();
    expect(indexSql(open?.config.where)).toContain("ended_at");

    expectForeignKey(
      inboxV2SourceThreadBindingHeads,
      "inbox_v2_source_thread_binding_heads_current_episode_fk",
      inboxV2SourceThreadBindingRemoteAccessEpisodes,
      [
        "tenant_id",
        "binding_id",
        "current_remote_access_episode_id",
        "remote_access_state",
        "remote_access_since",
        "current_remote_access_episode_revision"
      ],
      ["tenant_id", "binding_id", "id", "state", "started_at", "revision"]
    );
    expect(
      checkSql(
        inboxV2SourceThreadBindingHeads,
        "inbox_v2_source_thread_binding_heads_revisions_check"
      )
    ).toContain("current_remote_access_episode_revision");
  });

  it("normalizes bounded provider roles, capability roles and route attributes", () => {
    expectForeignKey(
      inboxV2SourceThreadBindingProviderRoles,
      "inbox_v2_binding_provider_roles_snapshot_fk",
      inboxV2SourceThreadBindingSnapshots,
      [
        "tenant_id",
        "binding_id",
        "materialized_by_binding_revision",
        "provider_access_revision"
      ],
      ["tenant_id", "binding_id", "revision", "provider_access_revision"]
    );
    expectForeignKey(
      inboxV2SourceThreadBindingCapabilityEntries,
      "inbox_v2_binding_capability_entries_snapshot_fk",
      inboxV2SourceThreadBindingSnapshots,
      [
        "tenant_id",
        "binding_id",
        "materialized_by_binding_revision",
        "capability_revision"
      ],
      ["tenant_id", "binding_id", "revision", "capability_revision"]
    );
    expectForeignKey(
      inboxV2SourceThreadBindingRouteAttributes,
      "inbox_v2_binding_route_attributes_snapshot_fk",
      inboxV2SourceThreadBindingSnapshots,
      [
        "tenant_id",
        "binding_id",
        "materialized_by_binding_revision",
        "route_descriptor_revision"
      ],
      ["tenant_id", "binding_id", "revision", "route_descriptor_revision"]
    );

    expect(primaryKeyColumns(inboxV2SourceThreadBindingProviderRoles)).toEqual([
      ["tenant_id", "binding_id", "provider_access_revision", "ordinal"]
    ]);
    expect(
      primaryKeyColumns(inboxV2SourceThreadBindingCapabilityEntries)
    ).toEqual([["tenant_id", "binding_id", "capability_revision", "ordinal"]]);
    expect(
      primaryKeyColumns(inboxV2SourceThreadBindingCapabilityRequiredRoles)
    ).toEqual([
      [
        "tenant_id",
        "binding_id",
        "capability_revision",
        "capability_ordinal",
        "ordinal"
      ]
    ]);
    expect(
      primaryKeyColumns(inboxV2SourceThreadBindingRouteAttributes)
    ).toEqual([
      ["tenant_id", "binding_id", "route_descriptor_revision", "ordinal"]
    ]);

    expect(
      checkSql(
        inboxV2SourceThreadBindingCapabilityEntries,
        "inbox_v2_binding_capability_entries_values_check"
      )
    ).toContain("between 0 and 255");
    expect(
      checkSql(
        inboxV2SourceThreadBindingCapabilityRequiredRoles,
        "inbox_v2_binding_capability_required_roles_values_check"
      )
    ).toContain("between 0 and 15");
    expect(
      checkSql(
        inboxV2SourceThreadBindingRouteAttributes,
        "inbox_v2_binding_route_attributes_values_check"
      )
    ).toContain("between 0 and 63");
  });

  it("persists typed transition CAS, actor XOR and exact episode references", () => {
    expectForeignKey(
      inboxV2SourceThreadBindingTransitions,
      "inbox_v2_source_thread_binding_transitions_admin_target_fk",
      inboxV2SourceThreadBindings,
      [
        "tenant_id",
        "administrative_target_binding_id",
        "administrative_target_external_thread_id",
        "administrative_target_source_connection_id",
        "administrative_target_source_account_id"
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
      inboxV2SourceThreadBindingTransitions,
      "inbox_v2_source_thread_binding_transitions_employee_fk",
      employees,
      ["tenant_id", "actor_employee_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2SourceThreadBindingTransitions,
      "inbox_v2_source_thread_binding_transitions_closed_episode_fk",
      inboxV2SourceThreadBindingRemoteAccessEpisodes,
      ["tenant_id", "closed_remote_access_episode_id"],
      ["tenant_id", "id"]
    );
    expect(
      uniqueColumns(
        inboxV2SourceThreadBindingTransitions,
        "inbox_v2_source_thread_binding_transitions_revision_unique"
      )
    ).toEqual(["tenant_id", "binding_id", "resulting_binding_revision"]);

    const common = checkSql(
      inboxV2SourceThreadBindingTransitions,
      "inbox_v2_source_thread_binding_transitions_common_cas_check"
    );
    expect(common).toContain("expected_binding_revision");
    expect(common).toContain("+ 1");

    const kinds = checkSql(
      inboxV2SourceThreadBindingTransitions,
      "inbox_v2_source_thread_binding_transitions_kind_xor_cas_check"
    );
    for (const kind of [
      "remote_access",
      "administrative",
      "runtime_health",
      "history_sync",
      "capabilities",
      "route_descriptor",
      "account_generation",
      "provider_access"
    ]) {
      expect(kinds).toContain(`= '${kind}'`);
    }
    expect(kinds).toContain("num_nonnulls");
    expect(kinds).toContain("resulting_binding_generation");
    expect(kinds).toMatch(/"administrative_authorization_effect" = 'allow'/);
    expect(kinds).toMatch(
      /"administrative_target_binding_id" = [^\n]+\."binding_id"/
    );
    expect(kinds).not.toContain("not in ()");
    expect(kinds).not.toContain("$1");
    expect(kinds.match(/and \(\(/g)?.length).toBeGreaterThanOrEqual(3);
    for (const [table, name] of [
      [
        inboxV2SourceThreadBindingHeads,
        "inbox_v2_source_thread_binding_heads_runtime_diagnostic_check"
      ],
      [
        inboxV2SourceThreadBindingHeads,
        "inbox_v2_source_thread_binding_heads_history_check"
      ],
      [
        inboxV2SourceThreadBindingCapabilityEntries,
        "inbox_v2_binding_capability_entries_state_check"
      ]
    ] as const) {
      const rendered = checkSql(table, name);
      expect(rendered).not.toContain("$1");
      if (name === "inbox_v2_binding_capability_entries_state_check") {
        expect(rendered).toContain(") and ((");
      }
    }
  });

  it("provides executable deferred and immutable integrity guards", () => {
    const invariantSql = [
      INBOX_V2_SOURCE_THREAD_BINDING_EVIDENCE_INTEGRITY_SQL,
      INBOX_V2_SOURCE_THREAD_BINDING_AGGREGATE_INTEGRITY_SQL
    ].join("\n");
    expect(invariantSql.match(/create or replace function/g)).toHaveLength(9);
    expect(
      invariantSql.match(/set search_path = pg_catalog, public, pg_temp/g)
    ).toHaveLength(9);
    expect(invariantSql).not.toMatch(/\b(?:from|join) inbox_v2_/);
    expect(invariantSql).not.toMatch(/\bperform inbox_v2_/);
    expect(invariantSql).not.toMatch(/execute function inbox_v2_/);
    for (const rowTypeReference of invariantSql.matchAll(
      /([a-z0-9_.]+)%rowtype/g
    )) {
      expect(rowTypeReference[1]).toMatch(/^public\./);
    }

    expect(INBOX_V2_SOURCE_THREAD_BINDING_EVIDENCE_INTEGRITY_SQL).toContain(
      "deferrable initially deferred"
    );
    expect(INBOX_V2_SOURCE_THREAD_BINDING_EVIDENCE_INTEGRITY_SQL).toContain(
      "v_actual_count <> v_expected_count"
    );
    expect(INBOX_V2_SOURCE_THREAD_BINDING_EVIDENCE_INTEGRITY_SQL).toContain(
      "v_max_ordinal <> v_expected_count - 1"
    );
    expect(INBOX_V2_SOURCE_THREAD_BINDING_AGGREGATE_INTEGRITY_SQL).toContain(
      "requires a persisted typed transition"
    );
    expect(INBOX_V2_SOURCE_THREAD_BINDING_AGGREGATE_INTEGRITY_SQL).toContain(
      "account_snapshot_fk\n  deferrable initially deferred"
    );
    expect(INBOX_V2_SOURCE_THREAD_BINDING_AGGREGATE_INTEGRITY_SQL).toContain(
      "current_episode_fk\n  deferrable initially deferred"
    );
    expect(INBOX_V2_SOURCE_THREAD_BINDING_AGGREGATE_INTEGRITY_SQL).toContain(
      "binding anchor requires one current head and open episode"
    );
    expect(INBOX_V2_SOURCE_THREAD_BINDING_AGGREGATE_INTEGRITY_SQL).toContain(
      "inbox_v2_guard_binding_head_update"
    );
    expect(INBOX_V2_SOURCE_THREAD_BINDING_AGGREGATE_INTEGRITY_SQL).toContain(
      "changed fields owned by another axis"
    );
    expect(INBOX_V2_SOURCE_THREAD_BINDING_AGGREGATE_INTEGRITY_SQL).toContain(
      "episode only permits an exact revision-1 to revision-2 close"
    );
    expect(INBOX_V2_SOURCE_THREAD_BINDING_AGGREGATE_INTEGRITY_SQL).toContain(
      "provider-role snapshot count, ordinals or digest mismatch"
    );
    expect(INBOX_V2_SOURCE_THREAD_BINDING_AGGREGATE_INTEGRITY_SQL).toContain(
      "capability snapshot count, ordinals or digest mismatch"
    );
    expect(INBOX_V2_SOURCE_THREAD_BINDING_AGGREGATE_INTEGRITY_SQL).toContain(
      "route-attribute snapshot count, ordinals or digest mismatch"
    );
    expect(INBOX_V2_SOURCE_THREAD_BINDING_AGGREGATE_INTEGRITY_SQL).toContain(
      "route descriptor canonical digest mismatch"
    );
    expect(INBOX_V2_SOURCE_THREAD_BINDING_AGGREGATE_INTEGRITY_SQL).toContain(
      "extract(epoch from e.valid_until)"
    );
    expect(INBOX_V2_SOURCE_THREAD_BINDING_AGGREGATE_INTEGRITY_SQL).toContain(
      "inbox_v2_source_account_identity_verified_snapshots"
    );
    expect(INBOX_V2_SOURCE_THREAD_BINDING_AGGREGATE_INTEGRITY_SQL).toContain(
      "create or replace function public.inbox_v2_guard_binding_collection_insert()"
    );
    expect(INBOX_V2_SOURCE_THREAD_BINDING_AGGREGATE_INTEGRITY_SQL).toContain(
      "create constraint trigger inbox_v2_binding_snapshots_integrity"
    );
    expect(INBOX_V2_SOURCE_THREAD_BINDING_AGGREGATE_INTEGRITY_SQL).toContain(
      "inbox_v2_check_source_thread_binding_edge_integrity"
    );
    expect(INBOX_V2_SOURCE_THREAD_BINDING_AGGREGATE_INTEGRITY_SQL).toContain(
      "binding revision snapshot diverges from current head"
    );
    expect(
      INBOX_V2_SOURCE_THREAD_BINDING_AGGREGATE_INTEGRITY_SQL
    ).not.toContain(
      "create constraint trigger inbox_v2_binding_capability_entries_integrity"
    );
    expect(
      INBOX_V2_SOURCE_THREAD_BINDING_AGGREGATE_INTEGRITY_SQL
    ).not.toContain(
      "create constraint trigger inbox_v2_binding_capability_required_roles_integrity"
    );
    expect(
      INBOX_V2_SOURCE_THREAD_BINDING_AGGREGATE_INTEGRITY_SQL
    ).not.toContain("binding transition revisions are not contiguous");
    expect(
      INBOX_V2_SOURCE_THREAD_BINDING_AGGREGATE_INTEGRITY_SQL
    ).not.toContain("left join inbox_v2_source_thread_binding_snapshots sx");

    expect(
      primaryKeyColumns(inboxV2SourceThreadBindingTransitionMatchedPermissions)
    ).toEqual([["tenant_id", "transition_id", "ordinal"]]);
  });

  it("keeps every explicit access index tenant-leading", () => {
    for (const table of [
      inboxV2SourceThreadBindings,
      inboxV2SourceThreadBindingHeads,
      inboxV2SourceThreadBindingSnapshots,
      inboxV2SourceThreadBindingEvidenceSets,
      inboxV2SourceThreadBindingEvidenceReferences,
      inboxV2SourceThreadBindingRemoteAccessEpisodes,
      inboxV2SourceThreadBindingProviderRoles,
      inboxV2SourceThreadBindingCapabilityEntries,
      inboxV2SourceThreadBindingCapabilityRequiredRoles,
      inboxV2SourceThreadBindingRouteAttributes,
      inboxV2SourceThreadBindingTransitions,
      inboxV2SourceThreadBindingTransitionMatchedPermissions
    ]) {
      const config = getTableConfig(table);
      expect(config.indexes.length).toBeGreaterThan(0);
      for (const tableIndex of config.indexes) {
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

function uniqueColumns(
  table: Parameters<typeof getTableConfig>[0],
  name: string
): string[] {
  const constraint = getTableConfig(table).uniqueConstraints.find(
    (candidate) => candidate.name === name
  );
  if (!constraint) {
    throw new Error(`Missing expected unique constraint: ${name}`);
  }
  return constraint.columns.map((column) => column.name);
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
  const check = getTableConfig(table).checks.find(
    (candidate) => candidate.name === name
  );
  if (!check) {
    throw new Error(`Missing expected check constraint: ${name}`);
  }
  return new PgDialect().sqlToQuery(check.value).sql;
}

function generatedColumnSql(
  table: Parameters<typeof getTableConfig>[0],
  columnName: string
): string {
  const column = getTableConfig(table).columns.find(
    (candidate) => candidate.name === columnName
  );
  const generated = column?.generated;
  if (!generated || typeof generated.as !== "function") {
    throw new Error(`Missing generated expression: ${columnName}`);
  }
  return new PgDialect().sqlToQuery(generated.as()).sql;
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

function indexSql(value: unknown): string {
  if (!value) return "";
  return new PgDialect().sqlToQuery(value as never).sql;
}
