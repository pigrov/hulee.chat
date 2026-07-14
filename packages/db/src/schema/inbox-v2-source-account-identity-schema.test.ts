import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  INBOX_V2_SOURCE_ACCOUNT_IDENTITY_INVARIANTS_SQL,
  inboxV2SourceAccountIdentities,
  inboxV2SourceAccountIdentityAliases,
  inboxV2SourceAccountIdentityConflictCandidates,
  inboxV2SourceAccountIdentityConflicts,
  inboxV2SourceAccountIdentityTransitions,
  inboxV2SourceAccountIdentityVerifiedSnapshots,
  inboxV2SourceAccountProvisionalIdentityKeys
} from "./inbox-v2/source-account-identity";
import { sourceAccounts, sourceConnections } from "./tables";

describe("Inbox V2 SourceAccount identity persistence schema", () => {
  it("separates the current fence from immutable transition, alias and conflict evidence", () => {
    const identity = getTableConfig(inboxV2SourceAccountIdentities);
    const transition = getTableConfig(inboxV2SourceAccountIdentityTransitions);
    const snapshot = getTableConfig(
      inboxV2SourceAccountIdentityVerifiedSnapshots
    );
    const alias = getTableConfig(inboxV2SourceAccountIdentityAliases);
    const conflict = getTableConfig(inboxV2SourceAccountIdentityConflicts);
    const candidate = getTableConfig(
      inboxV2SourceAccountIdentityConflictCandidates
    );

    expect(identity.name).toBe("inbox_v2_source_account_identities");
    expect(transition.name).toBe(
      "inbox_v2_source_account_identity_transitions"
    );
    expect(snapshot.name).toBe(
      "inbox_v2_source_account_identity_verified_snapshots"
    );
    expect(alias.name).toBe("inbox_v2_source_account_identity_aliases");
    expect(conflict.name).toBe("inbox_v2_source_account_identity_conflicts");
    expect(candidate.name).toBe(
      "inbox_v2_source_account_identity_conflict_candidates"
    );

    expect(primaryKeyColumns(identity)).toEqual([
      ["tenant_id", "source_account_id"]
    ]);
    expect(primaryKeyColumns(transition)).toEqual([["tenant_id", "id"]]);
    expect(primaryKeyColumns(snapshot)).toEqual([
      ["tenant_id", "source_account_id", "identity_revision"]
    ]);
    expect(primaryKeyColumns(alias)).toEqual([["tenant_id", "id"]]);
    expect(primaryKeyColumns(conflict)).toEqual([
      ["tenant_id", "source_account_id", "identity_revision"]
    ]);
    expect(primaryKeyColumns(candidate)).toEqual([
      ["tenant_id", "source_account_id", "identity_revision", "ordinal"]
    ]);

    expect(transition.columns.map((column) => column.name)).not.toContain(
      "updated_at"
    );
    expect(snapshot.columns.map((column) => column.name)).not.toContain(
      "updated_at"
    );
    expect(alias.columns.map((column) => column.name)).not.toContain(
      "updated_at"
    );
    expect(conflict.columns.map((column) => column.name)).not.toContain(
      "updated_at"
    );
  });

  it("owns every provisional fingerprint in one registry shared by current identities, conflicts, transitions and aliases", () => {
    const registry = getTableConfig(
      inboxV2SourceAccountProvisionalIdentityKeys
    );
    const identity = getTableConfig(inboxV2SourceAccountIdentities);
    const conflict = getTableConfig(inboxV2SourceAccountIdentityConflicts);
    const transition = getTableConfig(inboxV2SourceAccountIdentityTransitions);
    const alias = getTableConfig(inboxV2SourceAccountIdentityAliases);

    expect(registry.name).toBe("inbox_v2_source_account_provisional_keys");
    expect(primaryKeyColumns(registry)).toEqual([
      ["tenant_id", "provisional_key_digest_sha256"]
    ]);
    expect(
      uniqueColumns(registry, "inbox_v2_account_provisional_keys_owner_unique")
    ).toEqual([
      "tenant_id",
      "provisional_key_digest_sha256",
      "source_account_id",
      "source_connection_id",
      "provisional_observed_at"
    ]);
    expect(
      uniqueColumns(
        registry,
        "inbox_v2_account_provisional_keys_transition_unique"
      )
    ).toEqual([
      "tenant_id",
      "provisional_key_digest_sha256",
      "source_account_id",
      "provisional_observed_at"
    ]);
    expect(
      generatedColumnSql(registry, "provisional_key_digest_sha256")
    ).toContain("source-account-provisional-key:v1|");
    expectForeignKey(
      registry,
      "inbox_v2_account_provisional_keys_account_edge_fk",
      sourceAccounts,
      ["tenant_id", "source_account_id", "source_connection_id"],
      ["tenant_id", "id", "source_connection_id"]
    );
    expectForeignKey(
      identity,
      "inbox_v2_source_account_identities_provisional_key_fk",
      inboxV2SourceAccountProvisionalIdentityKeys,
      [
        "tenant_id",
        "provisional_key_digest_sha256",
        "source_account_id",
        "source_connection_id",
        "provisional_observed_at"
      ],
      [
        "tenant_id",
        "provisional_key_digest_sha256",
        "source_account_id",
        "source_connection_id",
        "provisional_observed_at"
      ]
    );
    expectForeignKey(
      conflict,
      "inbox_v2_account_identity_conflicts_provisional_key_fk",
      inboxV2SourceAccountProvisionalIdentityKeys,
      [
        "tenant_id",
        "provisional_key_digest_sha256",
        "source_account_id",
        "source_connection_id",
        "provisional_observed_at"
      ],
      [
        "tenant_id",
        "provisional_key_digest_sha256",
        "source_account_id",
        "source_connection_id",
        "provisional_observed_at"
      ]
    );
    expectForeignKey(
      transition,
      "inbox_v2_account_identity_transitions_provisional_key_fk",
      inboxV2SourceAccountProvisionalIdentityKeys,
      [
        "tenant_id",
        "provisional_key_digest_sha256",
        "source_account_id",
        "provisional_observed_at"
      ],
      [
        "tenant_id",
        "provisional_key_digest_sha256",
        "source_account_id",
        "provisional_observed_at"
      ]
    );
    expectForeignKey(
      alias,
      "inbox_v2_account_identity_aliases_provisional_key_fk",
      inboxV2SourceAccountProvisionalIdentityKeys,
      [
        "tenant_id",
        "provisional_key_digest_sha256",
        "canonical_source_account_id",
        "provisional_source_connection_id",
        "provisional_observed_at"
      ],
      [
        "tenant_id",
        "provisional_key_digest_sha256",
        "source_account_id",
        "source_connection_id",
        "provisional_observed_at"
      ]
    );
  });

  it("exports deferred exact transition and conflict graph invariants for the final migration", () => {
    const invariantSql = INBOX_V2_SOURCE_ACCOUNT_IDENTITY_INVARIANTS_SQL;

    expect(invariantSql).toContain(
      "create constraint trigger inbox_v2_account_identity_head_exact_trigger"
    );
    expect(invariantSql).toContain(
      "create constraint trigger inbox_v2_account_identity_transition_exact_trigger"
    );
    expect(invariantSql).toContain(
      "predecessor_row.resulting_account_generation"
    );
    expect(invariantSql).toContain(
      "predecessor_row.to_state is distinct from transition_row.from_state"
    );
    expect(invariantSql).toContain(
      "predecessor_row.provisional_key_digest_sha256"
    );
    expect(invariantSql).toContain(
      "transition_row.intent <> 'reauthenticate_verified'"
    );
    expect(invariantSql).toContain(
      "reauthentication changed the canonical account history anchor"
    );
    expect(invariantSql).toContain(
      "current verified identity differs from append-only generation authority"
    );
    expect(invariantSql).toContain(
      "account alias does not match its exact verified transition"
    );
    expect(invariantSql).toContain(
      "identity transition has no exact current result"
    );
    expect(invariantSql).toContain(
      "conflict_row.provisional_key_digest_sha256"
    );
    expect(invariantSql).toContain(
      "conflict_row.detected_at is distinct from identity_row.updated_at"
    );
    expect(invariantSql).toContain(
      "source account identity conflict evidence has no exact current result"
    );
    expect(invariantSql).toContain(
      "source account identity conflict evidence has no exact inducing transition"
    );
    expect(invariantSql).toContain("and intent = 'mark_conflicted'");
    expect(invariantSql).toContain(
      "candidate_stats.actual_count <> conflict_row.candidate_count"
    );
    expect(invariantSql).toContain("candidate_stats.minimum_ordinal <> 1");
    expect(invariantSql).toContain(
      "candidate.scope_kind = conflict_row.declaration_scope_kind"
    );
    expect(invariantSql).toContain(
      "provisional key registry does not match the exact raw fingerprint"
    );
    expect(invariantSql).toContain(
      "transition_row.provisional_observed_at = new.provisional_observed_at"
    );
    expect(invariantSql).toContain(
      "create constraint trigger inbox_v2_account_provisional_key_induction_trigger"
    );
    expect(invariantSql).toContain(
      "provisional account identity key has no exact inducing transition"
    );
    expect(invariantSql).toContain(
      "transition_row.intent in (\n       'create_provisional', 'reauthenticate_verified'\n     )"
    );
    expect(invariantSql).toContain(
      "account_row.source_connection_id = new.source_connection_id"
    );
    expect(invariantSql).toContain(
      "new.created_at <= transition_row.occurred_at"
    );
    expect(invariantSql).toContain(
      "create trigger inbox_v2_account_identity_transitions_immutable_trigger"
    );
    expect(invariantSql).toContain(
      "create trigger inbox_v2_account_identity_candidates_immutable_trigger"
    );
    expect(invariantSql).toContain(
      "create trigger inbox_v2_account_identity_verified_snapshots_immutable_trigger"
    );
    expect(invariantSql).toContain(
      "create trigger inbox_v2_account_identity_stable_edge_trigger"
    );
    expect(invariantSql.match(/deferrable initially deferred/g)).toHaveLength(
      7
    );
    expect(
      invariantSql.match(/set search_path = pg_catalog, public, pg_temp/g)
    ).toHaveLength(12);
    expect(
      invariantSql.match(/create or replace function public\./g)
    ).toHaveLength(12);
    expect(invariantSql).not.toMatch(
      /\b(?:from|join|on)\s+(?:inbox_v2_|source_accounts\b)/
    );
    expect(invariantSql).not.toMatch(/\bperform\s+inbox_v2_/);
    expect(invariantSql).not.toMatch(/\bexecute function\s+inbox_v2_/);
  });

  it("pins the current identity and conflict evidence to an exact tenant/account/connection edge", () => {
    const identity = getTableConfig(inboxV2SourceAccountIdentities);
    const conflict = getTableConfig(inboxV2SourceAccountIdentityConflicts);

    expectForeignKey(
      identity,
      "inbox_v2_source_account_identities_account_edge_fk",
      sourceAccounts,
      ["tenant_id", "source_account_id", "source_connection_id"],
      ["tenant_id", "id", "source_connection_id"]
    );
    expectForeignKey(
      conflict,
      "inbox_v2_account_identity_conflicts_account_edge_fk",
      sourceAccounts,
      ["tenant_id", "source_account_id", "source_connection_id"],
      ["tenant_id", "id", "source_connection_id"]
    );
    expectForeignKey(
      identity,
      "inbox_v2_source_account_identities_expected_scope_fk",
      sourceConnections,
      ["tenant_id", "expected_scope_source_connection_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      identity,
      "inbox_v2_source_account_identities_canonical_scope_fk",
      sourceConnections,
      ["tenant_id", "canonical_scope_source_connection_id"],
      ["tenant_id", "id"]
    );

    const scopeSql = checkSql(
      identity,
      "inbox_v2_source_account_identities_scope_check"
    );
    expect(scopeSql).toContain("= 'provider'");
    expect(scopeSql).toContain("= 'source_connection'");
    expect(scopeSql).toContain("= 'provider'");
    expect(scopeSql).toContain('"source_connection_id"');
  });

  it("computes bounded exact-key digests inside PostgreSQL before enforcing uniqueness", () => {
    const identity = getTableConfig(inboxV2SourceAccountIdentities);
    const alias = getTableConfig(inboxV2SourceAccountIdentityAliases);
    const conflict = getTableConfig(inboxV2SourceAccountIdentityConflicts);
    const candidate = getTableConfig(
      inboxV2SourceAccountIdentityConflictCandidates
    );

    const generatedDigests = [
      generatedColumnSql(identity, "provisional_key_digest_sha256"),
      generatedColumnSql(identity, "canonical_key_digest_sha256"),
      generatedColumnSql(alias, "provisional_key_digest_sha256"),
      generatedColumnSql(alias, "canonical_key_digest_sha256"),
      generatedColumnSql(conflict, "provisional_key_digest_sha256"),
      generatedColumnSql(candidate, "canonical_key_digest_sha256")
    ];

    for (const digestSql of generatedDigests) {
      expect(digestSql).toContain("sha256");
      expect(digestSql).toContain("octet_length");
      expect(digestSql).toContain("replace");
      expect(digestSql).toContain("chr");
      expect(digestSql).not.toContain("digest(");
      expect(digestSql).not.toContain("convert_to");
    }
    expect(generatedDigests[0]).toContain("source-account-provisional-key:v1|");
    expect(generatedDigests[1]).toContain("source-account-canonical-key:v1|");
    expect(generatedDigests[1]).toContain("-1:");

    const verifiedKey = identity.indexes.find(
      (tableIndex) =>
        tableIndex.config.name ===
        "inbox_v2_source_account_identities_verified_key_unique"
    );
    expect(verifiedKey?.config.unique).toBe(true);
    expect(indexColumns(verifiedKey)).toEqual([
      "tenant_id",
      "canonical_key_digest_sha256"
    ]);
    expect(indexWhereSql(verifiedKey)).toContain("= 'verified'");

    expect(
      uniqueColumns(
        alias,
        "inbox_v2_account_identity_aliases_provisional_key_unique"
      )
    ).toEqual(["tenant_id", "provisional_key_digest_sha256"]);

    for (const constraint of [
      ...identity.uniqueConstraints,
      ...alias.uniqueConstraints
    ]) {
      const names = constraint.columns.map((column) => column.name);
      expect(names).not.toContain("canonical_external_subject");
      expect(names).not.toContain("provisional_connector_session_subject");
    }
  });

  it("enforces the provisional, verified and conflicted state XOR and exact declaration parity", () => {
    const identity = getTableConfig(inboxV2SourceAccountIdentities);
    const columns = identity.columns.map((column) => column.name);

    expect(columns).toEqual(
      expect.arrayContaining([
        "state",
        "identity_declaration",
        "expected_scope_kind",
        "provisional_connector_session_subject",
        "canonical_realm_id",
        "canonical_external_subject",
        "active_conflict_revision",
        "account_generation",
        "revision",
        "created_at",
        "updated_at"
      ])
    );

    const stateSql = checkSql(
      identity,
      "inbox_v2_source_account_identities_state_xor_check"
    );
    expect(stateSql).toContain("= 'provisional'");
    expect(stateSql).toContain("= 'verified'");
    expect(stateSql).toContain("= 'conflicted'");
    expect(stateSql).toContain("num_nonnulls");
    expect(stateSql).toContain(
      '"active_conflict_revision" = "inbox_v2_source_account_identities"."revision"'
    );

    const declarationSql = checkSql(
      identity,
      "inbox_v2_source_account_identities_declaration_check"
    );
    expect(declarationSql).toContain("jsonb_build_object");
    expect(declarationSql).toContain("pg_column_size");
    expect(declarationSql).toContain("'identityKind', 'source_account'");
    expect(declarationSql).toContain("'decisionStrength', 'authoritative'");
    expect(declarationSql).toContain("declarationRevision");
    expect(declarationSql).toContain("loadedByTrustedServiceId");

    const paritySql = checkSql(
      identity,
      "inbox_v2_source_account_identities_key_parity_check"
    );
    expect(paritySql).toContain(
      '"declaration_realm_id" = "inbox_v2_source_account_identities"."canonical_realm_id"'
    );
    expect(paritySql).toContain(
      '"declaration_scope_kind" = "inbox_v2_source_account_identities"."canonical_scope_kind"'
    );
  });

  it("stores append-only kind-specific CAS transitions with exact +1 fences", () => {
    const transition = getTableConfig(inboxV2SourceAccountIdentityTransitions);
    const casSql = checkSql(
      transition,
      "inbox_v2_account_identity_transitions_kind_cas_check"
    );

    expect(casSql).toContain("= 'create_provisional'");
    expect(casSql).toContain("= 'promote_verified'");
    expect(casSql).toContain("= 'reauthenticate_verified'");
    expect(casSql).toContain("= 'mark_conflicted'");
    expect(casSql).toContain("= 'resolve_conflict'");
    expect(casSql).toContain('"resulting_revision" = 1');
    expect(casSql).toContain('"resulting_account_generation" = 1');
    expect(casSql).toContain('"current_revision" + 1');
    expect(casSql).toContain('"current_account_generation" + 1');
    expect(casSql).toContain(
      '"expected_revision" = "inbox_v2_source_account_identity_transitions"."current_revision"'
    );

    expect(
      uniqueColumns(
        transition,
        "inbox_v2_account_identity_transitions_revision_unique"
      )
    ).toEqual(["tenant_id", "source_account_id", "resulting_revision"]);
    expect(
      uniqueColumns(
        transition,
        "inbox_v2_account_identity_transitions_result_edge_unique"
      )
    ).toEqual([
      "tenant_id",
      "id",
      "source_account_id",
      "resulting_revision",
      "resulting_account_generation"
    ]);
    expectForeignKey(
      transition,
      "inbox_v2_account_identity_transitions_actor_fence_fk",
      inboxV2SourceAccountIdentities,
      [
        "tenant_id",
        "source_account_id",
        "pinned_declaration_trusted_service_id"
      ],
      [
        "tenant_id",
        "source_account_id",
        "declaration_loaded_by_trusted_service_id"
      ]
    );

    const decisionSql = checkSql(
      transition,
      "inbox_v2_account_identity_transitions_decision_check"
    );
    expect(decisionSql).toContain(
      '"decision_actor_trusted_service_id" = "inbox_v2_source_account_identity_transitions"."pinned_declaration_trusted_service_id"'
    );
    expect(decisionSql).toContain(
      '"decision_decided_at" = "inbox_v2_source_account_identity_transitions"."occurred_at"'
    );
  });

  it("makes aliases immutable direct snapshots of a verified canonical account", () => {
    const snapshot = getTableConfig(
      inboxV2SourceAccountIdentityVerifiedSnapshots
    );
    const alias = getTableConfig(inboxV2SourceAccountIdentityAliases);

    expect(
      uniqueColumns(
        snapshot,
        "inbox_v2_account_identity_verified_snapshots_surface_unique"
      )
    ).toEqual([
      "tenant_id",
      "source_account_id",
      "identity_revision",
      "account_generation",
      "state",
      "canonical_key_digest_sha256",
      "declaration_loaded_by_trusted_service_id",
      "verified_decision_decided_at"
    ]);

    expectForeignKey(
      alias,
      "inbox_v2_account_identity_aliases_target_snapshot_fk",
      inboxV2SourceAccountIdentityVerifiedSnapshots,
      [
        "tenant_id",
        "canonical_source_account_id",
        "expected_account_identity_revision",
        "expected_account_generation",
        "target_identity_state",
        "canonical_key_digest_sha256"
      ],
      [
        "tenant_id",
        "source_account_id",
        "identity_revision",
        "account_generation",
        "state",
        "canonical_key_digest_sha256"
      ]
    );

    const fenceSql = checkSql(
      alias,
      "inbox_v2_account_identity_aliases_fence_check"
    );
    expect(fenceSql).toContain("= 'verified'");
    expect(fenceSql).toContain('"revision" = 1');
    expect(fenceSql).toContain(
      '"expected_account_generation" = "inbox_v2_source_account_identity_aliases"."expected_account_identity_revision"'
    );
    expect(
      uniqueColumns(
        alias,
        "inbox_v2_account_identity_aliases_target_edge_unique"
      )
    ).toEqual([
      "tenant_id",
      "id",
      "canonical_source_account_id",
      "expected_account_identity_revision",
      "expected_account_generation",
      "target_identity_state",
      "canonical_key_digest_sha256"
    ]);

    const decisionSql = checkSql(
      alias,
      "inbox_v2_account_identity_aliases_decision_check"
    );
    expect(decisionSql).toContain(
      '"decision_actor_trusted_service_id" = "inbox_v2_source_account_identity_aliases"."declaration_loaded_by_trusted_service_id"'
    );
    expect(decisionSql).toContain(
      '"decision_decided_at" = "inbox_v2_source_account_identity_aliases"."created_at"'
    );
  });

  it("normalizes conflict details and bounded canonical candidates", () => {
    const identity = getTableConfig(inboxV2SourceAccountIdentities);
    const conflict = getTableConfig(inboxV2SourceAccountIdentityConflicts);
    const candidate = getTableConfig(
      inboxV2SourceAccountIdentityConflictCandidates
    );

    expectForeignKey(
      identity,
      "inbox_v2_source_account_identities_active_conflict_fk",
      inboxV2SourceAccountIdentityConflicts,
      ["tenant_id", "source_account_id", "active_conflict_revision"],
      ["tenant_id", "source_account_id", "identity_revision"]
    );
    expectForeignKey(
      candidate,
      "inbox_v2_account_identity_conflict_candidates_parent_fk",
      inboxV2SourceAccountIdentityConflicts,
      [
        "tenant_id",
        "source_account_id",
        "identity_revision",
        "source_connection_id"
      ],
      [
        "tenant_id",
        "source_account_id",
        "identity_revision",
        "source_connection_id"
      ]
    );

    const conflictColumns = conflict.columns.map((column) => column.name);
    expect(conflictColumns).toEqual(
      expect.arrayContaining([
        "candidate_count",
        "diagnostic_code_id",
        "diagnostic_retryable",
        "diagnostic_correlation_token",
        "decision_actor_trusted_service_id",
        "decision_verification_evidence_token",
        "detected_at"
      ])
    );
    const candidateColumns = candidate.columns.map((column) => column.name);
    expect(candidateColumns).toEqual(
      expect.arrayContaining([
        "ordinal",
        "source_connection_id",
        "realm_id",
        "realm_version",
        "canonicalization_version",
        "object_kind_id",
        "scope_kind",
        "scope_source_connection_id",
        "canonical_external_subject"
      ])
    );
    expect(candidateColumns).not.toContain("candidate_reference");

    expect(
      checkSql(
        conflict,
        "inbox_v2_account_identity_conflicts_candidate_count_check"
      )
    ).toContain("between 1 and 16");
    expect(
      checkSql(
        candidate,
        "inbox_v2_account_identity_conflict_candidates_ordinal_check"
      )
    ).toContain("between 1 and 16");
    expect(
      uniqueColumns(
        candidate,
        "inbox_v2_account_identity_conflict_candidate_digest_unique"
      )
    ).toEqual([
      "tenant_id",
      "source_account_id",
      "identity_revision",
      "canonical_key_digest_sha256"
    ]);
  });

  it("uses finite millisecond clocks and tenant-leading access indexes", () => {
    const configs = [
      getTableConfig(inboxV2SourceAccountIdentities),
      getTableConfig(inboxV2SourceAccountIdentityTransitions),
      getTableConfig(inboxV2SourceAccountIdentityVerifiedSnapshots),
      getTableConfig(inboxV2SourceAccountIdentityAliases),
      getTableConfig(inboxV2SourceAccountIdentityConflicts),
      getTableConfig(inboxV2SourceAccountIdentityConflictCandidates),
      getTableConfig(inboxV2SourceAccountProvisionalIdentityKeys)
    ];

    for (const config of configs) {
      expect(config.indexes.length).toBeGreaterThan(0);
      for (const tableIndex of config.indexes) {
        expect(indexColumnName(tableIndex.config.columns[0])).toBe("tenant_id");
      }
      for (const timestampColumn of config.columns.filter((column) =>
        column.getSQLType().startsWith("timestamp")
      )) {
        expect(timestampColumn.getSQLType()).toContain("(3)");
      }
    }

    expect(
      checkSql(
        configs[0],
        "inbox_v2_source_account_identities_timestamps_check"
      )
    ).toContain("isfinite");
    expect(
      checkSql(
        configs[1],
        "inbox_v2_account_identity_transitions_timestamps_check"
      )
    ).toContain("isfinite");
    expect(
      checkSql(
        configs[2],
        "inbox_v2_account_identity_verified_snapshots_timestamps_check"
      )
    ).toContain("isfinite");
    expect(
      checkSql(configs[3], "inbox_v2_account_identity_aliases_timestamps_check")
    ).toContain("isfinite");

    for (const config of configs) {
      for (const name of [
        ...config.checks.map((constraint) => constraint.name),
        ...config.foreignKeys.map((foreignKey) => foreignKey.getName()),
        ...config.uniqueConstraints.map((constraint) => constraint.name),
        ...config.indexes.map((tableIndex) => tableIndex.config.name)
      ]) {
        expect(name?.length).toBeLessThanOrEqual(63);
      }
    }
  });
});

function primaryKeyColumns(
  config: ReturnType<typeof getTableConfig>
): string[][] {
  return config.primaryKeys.map((primaryKey) =>
    primaryKey.columns.map((column) => column.name)
  );
}

function expectForeignKey(
  config: ReturnType<typeof getTableConfig>,
  name: string,
  foreignTable: Parameters<typeof getTableConfig>[0],
  columns: string[],
  foreignColumns: string[]
): void {
  const foreignKey = config.foreignKeys.find(
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

function uniqueColumns(
  config: ReturnType<typeof getTableConfig>,
  name: string
): string[] {
  const constraint = config.uniqueConstraints.find(
    (candidate) => candidate.name === name
  );

  if (!constraint) {
    throw new Error(`Missing expected unique constraint: ${name}`);
  }

  return constraint.columns.map((column) => column.name);
}

function generatedColumnSql(
  config: ReturnType<typeof getTableConfig>,
  columnName: string
): string {
  const column = config.columns.find(
    (candidate) => candidate.name === columnName
  );
  const generated = column?.generated;

  if (!generated || typeof generated.as !== "function") {
    throw new Error(`Missing generated expression for column: ${columnName}`);
  }

  return new PgDialect().sqlToQuery(generated.as()).sql;
}

function checkSql(
  config: ReturnType<typeof getTableConfig>,
  name: string
): string {
  const constraint = config.checks.find((candidate) => candidate.name === name);

  if (!constraint) {
    throw new Error(`Missing expected check constraint: ${name}`);
  }

  return new PgDialect().sqlToQuery(constraint.value).sql;
}

function indexColumns(
  tableIndex: ReturnType<typeof getTableConfig>["indexes"][number] | undefined
): (string | undefined)[] {
  return tableIndex?.config.columns.map(indexColumnName) ?? [];
}

function indexWhereSql(
  tableIndex: ReturnType<typeof getTableConfig>["indexes"][number] | undefined
): string {
  if (!tableIndex?.config.where) {
    throw new Error("Missing expected partial-index predicate.");
  }

  return new PgDialect().sqlToQuery(tableIndex.config.where).sql;
}

function indexColumnName(
  column: ReturnType<
    typeof getTableConfig
  >["indexes"][number]["config"]["columns"][number]
): string | undefined {
  if ("name" in column && typeof column.name === "string") {
    return column.name;
  }

  return undefined;
}
