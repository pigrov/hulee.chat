import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  INBOX_V2_SOURCE_IDENTITY_CLAIM_INTEGRITY_SQL,
  inboxV2SourceExternalIdentities,
  inboxV2SourceIdentityClaimEvidenceReferences,
  inboxV2SourceIdentityClaimHeads,
  inboxV2SourceIdentityClaims,
  inboxV2SourceIdentityClaimTransitions
} from "./inbox-v2/identity-foundation";
import {
  clientContacts,
  employees,
  normalizedInboundEvents,
  rawInboundEvents,
  sourceAccounts,
  sourceConnections
} from "./tables";

describe("Inbox V2 source identity foundation schema", () => {
  it("separates the durable identity base from its one-to-one claim head", () => {
    const identity = getTableConfig(inboxV2SourceExternalIdentities);
    const head = getTableConfig(inboxV2SourceIdentityClaimHeads);

    expect(identity.columns.map((column) => column.name)).toEqual([
      "tenant_id",
      "id",
      "realm_id",
      "realm_version",
      "canonicalization_version",
      "object_kind_id",
      "scope_kind",
      "scope_source_connection_id",
      "scope_source_account_id",
      "identity_declaration",
      "declaration_contract_id",
      "declaration_contract_version",
      "declaration_revision",
      "declaration_surface_id",
      "declaration_loaded_by_trusted_service_id",
      "declaration_loaded_at",
      "materialized_by_trusted_service_id",
      "materialization_authorization_token",
      "materialized_at",
      "canonical_external_subject",
      "stability_kind",
      "ephemeral_raw_inbound_event_id",
      "ephemeral_normalized_inbound_event_id",
      "ephemeral_observation_key",
      "exact_key_digest_sha256",
      "revision",
      "created_at",
      "updated_at"
    ]);
    expect(head.columns.map((column) => column.name)).toEqual([
      "tenant_id",
      "source_external_identity_id",
      "resolution_status",
      "active_claim_id",
      "latest_claim_version"
    ]);

    expect(primaryKeyColumns(identity)).toEqual([["tenant_id", "id"]]);
    expect(primaryKeyColumns(head)).toEqual([
      ["tenant_id", "source_external_identity_id"]
    ]);
  });

  it("enforces same-tenant scope, observation and identity-head relationships", () => {
    const identity = getTableConfig(inboxV2SourceExternalIdentities);
    const head = getTableConfig(inboxV2SourceIdentityClaimHeads);

    expectForeignKey(identity, sourceConnections, [
      "tenant_id",
      "scope_source_connection_id"
    ]);
    expectForeignKey(identity, sourceAccounts, [
      "tenant_id",
      "scope_source_account_id"
    ]);
    expectForeignKey(identity, rawInboundEvents, [
      "tenant_id",
      "ephemeral_raw_inbound_event_id"
    ]);
    expectForeignKey(identity, normalizedInboundEvents, [
      "tenant_id",
      "ephemeral_normalized_inbound_event_id"
    ]);
    expectNamedForeignKey(
      identity,
      "inbox_v2_source_external_identities_raw_event_connection_fk",
      [
        "tenant_id",
        "ephemeral_raw_inbound_event_id",
        "scope_source_connection_id"
      ],
      ["tenant_id", "id", "source_connection_id"]
    );
    expectNamedForeignKey(
      identity,
      "inbox_v2_source_external_identities_raw_event_account_fk",
      [
        "tenant_id",
        "ephemeral_raw_inbound_event_id",
        "scope_source_account_id"
      ],
      ["tenant_id", "id", "source_account_id"]
    );
    expectNamedForeignKey(
      identity,
      "inbox_v2_source_external_identities_normalized_event_connection_fk",
      [
        "tenant_id",
        "ephemeral_normalized_inbound_event_id",
        "scope_source_connection_id"
      ],
      ["tenant_id", "id", "source_connection_id"]
    );
    expectNamedForeignKey(
      identity,
      "inbox_v2_source_external_identities_normalized_event_account_fk",
      [
        "tenant_id",
        "ephemeral_normalized_inbound_event_id",
        "scope_source_account_id"
      ],
      ["tenant_id", "id", "source_account_id"]
    );
    expectForeignKey(head, inboxV2SourceExternalIdentities, [
      "tenant_id",
      "source_external_identity_id"
    ]);

    expectUniqueColumns(
      rawInboundEvents,
      "raw_inbound_events_tenant_id_connection_unique",
      ["tenant_id", "id", "source_connection_id"]
    );
    expectUniqueColumns(
      rawInboundEvents,
      "raw_inbound_events_tenant_id_account_unique",
      ["tenant_id", "id", "source_account_id"]
    );
    expectUniqueColumns(
      rawInboundEvents,
      "raw_inbound_events_tenant_id_account_scope_unique",
      ["tenant_id", "id", "source_account_scope_key"]
    );
    expectUniqueColumns(
      normalizedInboundEvents,
      "normalized_inbound_events_tenant_id_connection_unique",
      ["tenant_id", "id", "source_connection_id"]
    );
    expectUniqueColumns(
      normalizedInboundEvents,
      "normalized_inbound_events_tenant_id_account_unique",
      ["tenant_id", "id", "source_account_id"]
    );
    expectNamedForeignKey(
      getTableConfig(rawInboundEvents),
      "raw_inbound_events_account_connection_fk",
      ["tenant_id", "source_account_id", "source_connection_id"],
      ["tenant_id", "id", "source_connection_id"]
    );
    expectNamedForeignKey(
      getTableConfig(normalizedInboundEvents),
      "normalized_inbound_events_account_connection_fk",
      ["tenant_id", "source_account_id", "source_connection_id"],
      ["tenant_id", "id", "source_connection_id"]
    );
    expectNamedForeignKey(
      getTableConfig(normalizedInboundEvents),
      "normalized_inbound_events_raw_connection_fk",
      ["tenant_id", "raw_event_id", "source_connection_id"],
      ["tenant_id", "id", "source_connection_id"]
    );
    expectNamedForeignKey(
      getTableConfig(normalizedInboundEvents),
      "normalized_inbound_events_raw_account_scope_fk",
      ["tenant_id", "raw_event_id", "source_account_scope_key"],
      ["tenant_id", "id", "source_account_scope_key"]
    );

    for (const table of [rawInboundEvents, normalizedInboundEvents]) {
      const scopeKey = getTableConfig(table).columns.find(
        (column) => column.name === "source_account_scope_key"
      );
      expect(scopeKey?.generated?.type).toBe("always");
      expect(scopeKey?.notNull).toBe(true);
    }

    const normalizedAccountIndex = getTableConfig(
      normalizedInboundEvents
    ).indexes.find(
      (tableIndex) =>
        tableIndex.config.name ===
        "normalized_inbound_events_tenant_account_idx"
    );
    expect(normalizedAccountIndex?.config.columns.map(indexColumnName)).toEqual(
      ["tenant_id", "source_account_id", "created_at"]
    );
  });

  it("uses one bounded digest authority for the exact scoped identity key", () => {
    const identity = getTableConfig(inboxV2SourceExternalIdentities);
    const scopedKey = identity.uniqueConstraints.find(
      (constraint) =>
        constraint.name ===
        "inbox_v2_source_external_identities_scope_key_unique"
    );

    expect(scopedKey?.columns.map((column) => column.name)).toEqual([
      "tenant_id",
      "exact_key_digest_sha256"
    ]);
    expect(scopedKey?.nullsNotDistinct).toBe(false);

    const digestColumn = identity.columns.find(
      (column) => column.name === "exact_key_digest_sha256"
    );
    expect(digestColumn?.generated?.type).toBe("always");
    expect(digestColumn?.generated?.mode).toBe("stored");
    const generatedSql = new PgDialect().sqlToQuery(
      digestColumn?.generated?.as as SQL
    ).sql;
    expect(generatedSql).toContain("object_kind_id");
    expect(generatedSql).not.toContain("identity_declaration");
    expect(
      checkSql(identity, "inbox_v2_source_external_identities_digest_check")
    ).toContain("^[a-f0-9]{64}$");
  });

  it("renders strict scope, opaque value, stability, revision and clock checks", () => {
    const identity = getTableConfig(inboxV2SourceExternalIdentities);

    const idSql = checkSql(
      identity,
      "inbox_v2_source_external_identities_id_format_check"
    );
    expect(idSql).toContain("<= 256");
    expect(idSql).toContain(
      "^source_external_identity:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$"
    );

    const realmSql = checkSql(
      identity,
      "inbox_v2_source_external_identities_realm_id_check"
    );
    expect(realmSql).toContain("split_part");
    expect(realmSql).toContain("module:");

    const versionsSql = checkSql(
      identity,
      "inbox_v2_source_external_identities_versions_check"
    );
    expect(versionsSql).toContain("^v[1-9][0-9]*$");
    expect(versionsSql.match(/\^v\[1-9\]\[0-9\]\*\$/g)).toHaveLength(2);

    const declarationSql = checkSql(
      identity,
      "inbox_v2_source_external_identities_declaration_check"
    );
    expect(declarationSql).toContain("source_external_identity");
    expect(declarationSql).toContain("identity_declaration");
    expect(declarationSql).toContain("declaration_contract_id");
    expect(declarationSql).toContain("declaration_surface_id");
    expect(declarationSql).toContain("decisionStrength");
    expect(declarationSql).toContain("authoritative");
    expect(declarationSql).toContain("source_account");

    const materializationSql = checkSql(
      identity,
      "inbox_v2_source_external_identities_materialization_check"
    );
    expect(materializationSql).toContain("materialized_by_trusted_service_id");
    expect(materializationSql).toContain(
      "declaration_loaded_by_trusted_service_id"
    );
    expect(materializationSql).toContain("materialized_at");
    expect(materializationSql).toContain("created_at");

    const scopeSql = checkSql(
      identity,
      "inbox_v2_source_external_identities_scope_xor_check"
    );
    expect(scopeSql).toContain("= 'provider'");
    expect(scopeSql).toContain("= 'source_connection'");
    expect(scopeSql).toContain("= 'source_account'");

    const subjectSql = checkSql(
      identity,
      "inbox_v2_source_external_identities_subject_check"
    );
    expect(subjectSql).toContain("between 1 and 512");
    expect(subjectSql).toContain("\\x00-\\x1F\\x7F");

    const stabilitySql = checkSql(
      identity,
      "inbox_v2_source_external_identities_stability_xor_check"
    );
    expect(stabilitySql).toContain("= 'stable'");
    expect(stabilitySql).toContain("= 'observation_ephemeral'");
    expect(stabilitySql).toContain("num_nonnulls");
    expect(stabilitySql).toContain("= 1");

    expect(
      checkSql(identity, "inbox_v2_source_external_identities_revision_check")
    ).toContain(">= 1");
    expect(
      checkSql(identity, "inbox_v2_source_external_identities_timestamps_check")
    ).toContain("isfinite");
  });

  it("supports the exact initial, claimed and terminal head shapes", () => {
    const head = getTableConfig(inboxV2SourceIdentityClaimHeads);
    const shapeSql = checkSql(
      head,
      "inbox_v2_source_identity_claim_heads_shape_check"
    );

    expect(shapeSql).toContain("= 'unresolved'");
    expect(shapeSql).toContain("in ('unresolved', 'conflicted')");
    expect(shapeSql).toContain("= 'claimed'");
    expect(shapeSql).toContain('"active_claim_id" is not null');
    expect(shapeSql).toContain('"latest_claim_version" is not null');
    expect(
      checkSql(head, "inbox_v2_source_identity_claim_heads_version_check")
    ).toContain(">= 1");
  });

  it("persists temporal claim episodes with typed targets and decisions", () => {
    const claims = getTableConfig(inboxV2SourceIdentityClaims);

    expect(claims.columns.map((column) => column.name)).toEqual([
      "tenant_id",
      "id",
      "source_external_identity_id",
      "previous_claim_version",
      "claim_version",
      "target_kind",
      "target_employee_id",
      "target_client_contact_id",
      "target_key",
      "status",
      "confidence",
      "policy_id",
      "policy_version",
      "reason_code_id",
      "decision_kind",
      "decision_actor_employee_id",
      "decision_trusted_service_id",
      "policy_family",
      "policy_definition_contract_version",
      "policy_definition_digest_sha256",
      "policy_activation_head_revision",
      "created_at",
      "revoked_at",
      "revision"
    ]);
    expect(primaryKeyColumns(claims)).toEqual([["tenant_id", "id"]]);
    expectUniqueColumns(
      inboxV2SourceIdentityClaims,
      "inbox_v2_identity_claims_exact_contact_target_unique",
      ["tenant_id", "id", "claim_version", "target_client_contact_id"]
    );
    expectNamedForeignKey(
      claims,
      "inbox_v2_identity_claims_identity_fk",
      ["tenant_id", "source_external_identity_id"],
      ["tenant_id", "id"]
    );
    expectNamedForeignKey(
      claims,
      "inbox_v2_identity_claims_employee_fk",
      ["tenant_id", "target_employee_id"],
      ["tenant_id", "id"]
    );
    expectNamedForeignKey(
      claims,
      "inbox_v2_identity_claims_client_contact_fk",
      ["tenant_id", "target_client_contact_id"],
      ["tenant_id", "id"]
    );
    expectNamedForeignKey(
      claims,
      "inbox_v2_identity_claims_actor_employee_fk",
      ["tenant_id", "decision_actor_employee_id"],
      ["tenant_id", "id"]
    );
    expectNamedForeignKey(
      claims,
      "inbox_v2_identity_claims_policy_authority_fk",
      [
        "tenant_id",
        "policy_family",
        "policy_id",
        "policy_activation_head_revision",
        "policy_version",
        "policy_definition_contract_version",
        "policy_definition_digest_sha256",
        "decision_trusted_service_id"
      ],
      [
        "tenant_id",
        "family",
        "policy_id",
        "resulting_head_revision",
        "resulting_policy_version",
        "resulting_definition_contract_version",
        "resulting_definition_digest_sha256",
        "resulting_approved_trusted_service_id"
      ]
    );
    expectForeignKey(claims, inboxV2SourceExternalIdentities, [
      "tenant_id",
      "source_external_identity_id"
    ]);
    expectForeignKey(claims, employees, ["tenant_id", "target_employee_id"]);
    expectForeignKey(claims, clientContacts, [
      "tenant_id",
      "target_client_contact_id"
    ]);

    expect(
      checkSql(claims, "inbox_v2_identity_claims_version_check")
    ).toContain('"previous_claim_version" + 1');
    expect(checkSql(claims, "inbox_v2_identity_claims_target_check")).toContain(
      "= 'client_contact'"
    );
    expect(
      checkSql(claims, "inbox_v2_identity_claims_decision_check")
    ).toContain("in ('automatic_policy', 'migration')");
    const policyAuthoritySql = checkSql(
      claims,
      "inbox_v2_identity_claims_policy_authority_check"
    );
    expect(policyAuthoritySql).toContain("= 'automatic_policy'");
    expect(policyAuthoritySql).toContain("= 'source_identity_claim'");
    expect(policyAuthoritySql).toContain("~ '^v[1-9][0-9]*$'");
    expect(policyAuthoritySql).toContain("~ '^[a-f0-9]{64}$'");
    expect(policyAuthoritySql).toContain(">= 1");
    expect(
      checkSql(claims, "inbox_v2_identity_claims_manual_self_claim_check")
    ).toContain('"decision_actor_employee_id"');
    expect(checkSql(claims, "inbox_v2_identity_claims_state_check")).toContain(
      '"revision" = 2'
    );

    const active = claims.indexes.find(
      (tableIndex) =>
        tableIndex.config.name === "inbox_v2_identity_claims_one_active_unique"
    );
    expect(active?.config.unique).toBe(true);
    expect(active?.config.columns.map(indexColumnName)).toEqual([
      "tenant_id",
      "source_external_identity_id"
    ]);
    expect(indexSql(active?.config.where)).toContain("= 'active'");
  });

  it("owns 1..50 ordered evidence rows across all four exact evidence kinds", () => {
    const evidence = getTableConfig(
      inboxV2SourceIdentityClaimEvidenceReferences
    );

    expect(evidence.columns.map((column) => column.name)).toEqual([
      "tenant_id",
      "claim_id",
      "source_external_identity_id",
      "claim_version",
      "ordinal",
      "evidence_kind",
      "raw_inbound_event_id",
      "normalized_inbound_event_id",
      "source_occurrence_id",
      "provider_roster_evidence_id"
    ]);
    expect(
      evidence.columns.find((column) => column.name === "evidence_kind")
        ?.enumValues
    ).toEqual([
      "raw_inbound_event",
      "normalized_inbound_event",
      "source_occurrence",
      "provider_roster_evidence"
    ]);
    expectNamedForeignKey(
      evidence,
      "inbox_v2_identity_claim_evidence_claim_fk",
      ["tenant_id", "claim_id", "source_external_identity_id", "claim_version"],
      ["tenant_id", "id", "source_external_identity_id", "claim_version"]
    );
    expectForeignKey(evidence, rawInboundEvents, [
      "tenant_id",
      "raw_inbound_event_id"
    ]);
    expectForeignKey(evidence, normalizedInboundEvents, [
      "tenant_id",
      "normalized_inbound_event_id"
    ]);
    expect(
      checkSql(evidence, "inbox_v2_identity_claim_evidence_ordinal_check")
    ).toContain("between 0 and 49");
    expect(
      checkSql(evidence, "inbox_v2_identity_claim_evidence_kind_check")
    ).toContain("= 'provider_roster_evidence'");
  });

  it("stores one-way exact transition references and contiguous CAS", () => {
    const transitions = getTableConfig(inboxV2SourceIdentityClaimTransitions);

    expect(transitions.columns.map((column) => column.name)).toEqual([
      "tenant_id",
      "id",
      "source_external_identity_id",
      "operation_kind",
      "target_kind",
      "target_employee_id",
      "target_client_contact_id",
      "target_key",
      "previous_claim_id",
      "previous_target_kind",
      "previous_target_employee_id",
      "previous_target_client_contact_id",
      "previous_target_key",
      "resulting_claim_id",
      "active_claim_id",
      "decision_kind",
      "decision_actor_employee_id",
      "decision_trusted_service_id",
      "policy_family",
      "policy_definition_contract_version",
      "policy_definition_digest_sha256",
      "policy_activation_head_revision",
      "policy_id",
      "policy_version",
      "reason_code_id",
      "expected_version",
      "current_version",
      "resulting_version",
      "occurred_at"
    ]);
    expectNamedForeignKey(
      transitions,
      "inbox_v2_identity_claim_transition_resulting_claim_fk",
      [
        "tenant_id",
        "resulting_claim_id",
        "source_external_identity_id",
        "resulting_version",
        "target_kind",
        "target_key"
      ],
      [
        "tenant_id",
        "id",
        "source_external_identity_id",
        "claim_version",
        "target_kind",
        "target_key"
      ]
    );
    expectNamedForeignKey(
      transitions,
      "inbox_v2_identity_claim_transition_previous_claim_fk",
      [
        "tenant_id",
        "previous_claim_id",
        "source_external_identity_id",
        "previous_target_kind",
        "previous_target_key"
      ],
      [
        "tenant_id",
        "id",
        "source_external_identity_id",
        "target_kind",
        "target_key"
      ]
    );
    expectNamedForeignKey(
      transitions,
      "inbox_v2_identity_claim_transition_active_claim_fk",
      [
        "tenant_id",
        "active_claim_id",
        "source_external_identity_id",
        "target_kind",
        "target_key"
      ],
      [
        "tenant_id",
        "id",
        "source_external_identity_id",
        "target_kind",
        "target_key"
      ]
    );
    expectNamedForeignKey(
      transitions,
      "inbox_v2_identity_claim_transition_policy_authority_fk",
      [
        "tenant_id",
        "policy_family",
        "policy_id",
        "policy_activation_head_revision",
        "policy_version",
        "policy_definition_contract_version",
        "policy_definition_digest_sha256",
        "decision_trusted_service_id"
      ],
      [
        "tenant_id",
        "family",
        "policy_id",
        "resulting_head_revision",
        "resulting_policy_version",
        "resulting_definition_contract_version",
        "resulting_definition_digest_sha256",
        "resulting_approved_trusted_service_id"
      ]
    );

    const operationSql = checkSql(
      transitions,
      "inbox_v2_identity_claim_transition_operation_check"
    );
    expect(operationSql).toContain("= 'claim_employee'");
    expect(operationSql).toContain("= 'claim_client_contact'");
    expect(operationSql).toContain("= 'revoke'");
    const casSql = checkSql(
      transitions,
      "inbox_v2_identity_claim_transition_cas_check"
    );
    expect(
      checkSql(
        transitions,
        "inbox_v2_identity_claim_transition_policy_authority_check"
      )
    ).toContain("= 'source_identity_claim'");
    expect(casSql).toContain('"resulting_version" = 1');
    expect(casSql).toContain('"current_version" + 1');
  });

  it("adds mandatory bootstrap, immutable history and indexed deferred closure", () => {
    const integritySql = INBOX_V2_SOURCE_IDENTITY_CLAIM_INTEGRITY_SQL;

    expect(integritySql).toContain(
      "insert into public.inbox_v2_source_identity_claim_heads"
    );
    expect(integritySql).toContain(
      "inbox_v2_source_identity_claim_bootstrap_head_trigger"
    );
    expect(integritySql).toContain(
      "inbox_v2.source_identity_claim_revision_conflict"
    );
    expect(integritySql).toContain("identity_revision <> head_version + 1");
    expect(integritySql).toContain(
      "identity_updated_at is distinct from latest_transition_occurred_at"
    );
    expect(integritySql).toContain("evidence_count < 1");
    expect(integritySql).toContain("evidence_count > 50");
    expect(integritySql).toContain(
      "inbox_v2.source_identity_claim_evidence_scope_invalid"
    );
    expect(integritySql).toContain(
      "provider_scope_requires_exact_actor_evidence"
    );
    expect(integritySql).toContain(
      "provider_event_requires_paired_exact_actor_evidence"
    );
    expect(integritySql).toContain("identity_scope_kind = 'provider'");
    expect(integritySql).toContain("evidence_row.claim_id = checked_claim_id");
    expect(integritySql).toContain("raw_event_row.source_connection_id");
    expect(integritySql).toContain("normalized_event_row.source_account_id");
    expect(integritySql).toContain("identity_scope_kind = 'source_connection'");
    expect(integritySql).toContain("identity_scope_kind = 'source_account'");
    expect(integritySql).toContain("creation_count <> 1");
    expect(integritySql).toContain("termination_count <> 1");
    expect(integritySql).toContain(
      "inbox_v2_identity_claim_evidence_occurrence_actor_fk"
    );
    expect(integritySql).toContain(
      "inbox_v2_identity_claim_evidence_roster_member_fk"
    );
    expect(integritySql).toContain(
      "inbox_v2.source_identity_claim_policy_authority_invalid"
    );
    expect(integritySql).toContain("for share of head_row, version_row");
    expect(integritySql).toContain("deferrable initially deferred");
    expect(integritySql).toContain(
      "inbox_v2.source_identity_claim_history_immutable"
    );
    expect(integritySql).toContain("source_occurrence_id");
    expect(integritySql).toContain("provider_roster_evidence_id");
  });

  it("keeps every explicit access index tenant-leading", () => {
    for (const table of [
      inboxV2SourceExternalIdentities,
      inboxV2SourceIdentityClaims,
      inboxV2SourceIdentityClaimEvidenceReferences,
      inboxV2SourceIdentityClaimTransitions,
      inboxV2SourceIdentityClaimHeads
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
  config: ReturnType<typeof getTableConfig>
): string[][] {
  return config.primaryKeys.map((primaryKey) =>
    primaryKey.columns.map((column) => column.name)
  );
}

function expectForeignKey(
  config: ReturnType<typeof getTableConfig>,
  foreignTable: Parameters<typeof getTableConfig>[0],
  expectedColumns: string[]
): void {
  const reference = config.foreignKeys
    .map((foreignKey) => foreignKey.reference())
    .find((candidate) => candidate.foreignTable === foreignTable);

  expect(reference?.columns.map((column) => column.name)).toEqual(
    expectedColumns
  );
  expect(reference?.foreignColumns.map((column) => column.name)).toEqual([
    "tenant_id",
    "id"
  ]);
}

function expectNamedForeignKey(
  config: ReturnType<typeof getTableConfig>,
  name: string,
  expectedColumns: string[],
  expectedForeignColumns: string[]
): void {
  const reference = config.foreignKeys
    .find((foreignKey) => foreignKey.getName() === name)
    ?.reference();

  expect(reference?.columns.map((column) => column.name)).toEqual(
    expectedColumns
  );
  expect(reference?.foreignColumns.map((column) => column.name)).toEqual(
    expectedForeignColumns
  );
}

function expectUniqueColumns(
  table: Parameters<typeof getTableConfig>[0],
  name: string,
  expectedColumns: string[]
): void {
  const uniqueConstraint = getTableConfig(table).uniqueConstraints.find(
    (constraint) => constraint.name === name
  );

  expect(uniqueConstraint?.columns.map((column) => column.name)).toEqual(
    expectedColumns
  );
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

function indexSql(
  value:
    | ReturnType<typeof getTableConfig>["indexes"][number]["config"]["where"]
    | undefined
): string {
  if (!value) {
    throw new Error("Missing expected index predicate.");
  }

  return new PgDialect().sqlToQuery(value).sql;
}
