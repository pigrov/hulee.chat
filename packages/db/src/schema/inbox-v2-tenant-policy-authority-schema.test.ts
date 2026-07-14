import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  INBOX_V2_TENANT_POLICY_AUTHORITY_INTEGRITY_SQL,
  inboxV2TenantPolicyActivationHeads,
  inboxV2TenantPolicyActivationOperation,
  inboxV2TenantPolicyActivationState,
  inboxV2TenantPolicyActivationTransitions,
  inboxV2TenantPolicyFamily,
  inboxV2TenantPolicyVersions
} from "./inbox-v2/tenant-policy-authority";
import { employees } from "./tables";

describe("Inbox V2 tenant policy authority schema", () => {
  it("stores immutable typed versions separately from one mutable activation head", () => {
    expect(getTableConfig(inboxV2TenantPolicyVersions).name).toBe(
      "inbox_v2_tenant_policy_versions"
    );
    expect(getTableConfig(inboxV2TenantPolicyActivationHeads).name).toBe(
      "inbox_v2_tenant_policy_activation_heads"
    );
    expect(getTableConfig(inboxV2TenantPolicyActivationTransitions).name).toBe(
      "inbox_v2_tenant_policy_activation_transitions"
    );
    expect(primaryKeyColumns(inboxV2TenantPolicyVersions)).toEqual([
      ["tenant_id", "family", "policy_id", "policy_version"]
    ]);
    expect(primaryKeyColumns(inboxV2TenantPolicyActivationHeads)).toEqual([
      ["tenant_id", "family", "policy_id"]
    ]);
    expect(primaryKeyColumns(inboxV2TenantPolicyActivationTransitions)).toEqual(
      [["tenant_id", "family", "policy_id", "resulting_head_revision"]]
    );
    expect(inboxV2TenantPolicyFamily.enumValues).toEqual([
      "source_identity_claim",
      "conversation_client_link"
    ]);
    expect(inboxV2TenantPolicyActivationState.enumValues).toEqual([
      "active",
      "revoked"
    ]);
    expect(inboxV2TenantPolicyActivationOperation.enumValues).toEqual([
      "activate",
      "revoke"
    ]);
  });

  it("pins one exact definition digest, contract and trusted service", () => {
    const target = getTableConfig(
      inboxV2TenantPolicyVersions
    ).uniqueConstraints.find(
      (constraint) =>
        constraint.name ===
        "inbox_v2_tenant_policy_versions_exact_target_unique"
    );
    expect(target?.columns.map((column) => column.name)).toEqual([
      "tenant_id",
      "family",
      "policy_id",
      "policy_version",
      "definition_contract_version",
      "definition_digest_sha256",
      "approved_trusted_service_id"
    ]);
    const transitionAnchor = getTableConfig(
      inboxV2TenantPolicyActivationTransitions
    ).uniqueConstraints.find(
      (constraint) =>
        constraint.name ===
        "inbox_v2_tenant_policy_transition_exact_authority_unique"
    );
    expect(transitionAnchor?.columns.map((column) => column.name)).toEqual([
      "tenant_id",
      "family",
      "policy_id",
      "resulting_head_revision",
      "resulting_policy_version",
      "resulting_definition_contract_version",
      "resulting_definition_digest_sha256",
      "resulting_approved_trusted_service_id"
    ]);

    expectForeignKey(
      inboxV2TenantPolicyActivationHeads,
      "inbox_v2_tenant_policy_activation_heads_version_fk",
      inboxV2TenantPolicyVersions,
      [
        "tenant_id",
        "family",
        "policy_id",
        "policy_version",
        "definition_contract_version",
        "definition_digest_sha256",
        "approved_trusted_service_id"
      ],
      [
        "tenant_id",
        "family",
        "policy_id",
        "policy_version",
        "definition_contract_version",
        "definition_digest_sha256",
        "approved_trusted_service_id"
      ]
    );
    const values = checkSql(
      inboxV2TenantPolicyVersions,
      "inbox_v2_tenant_policy_versions_values_check"
    );
    expect(values).toContain("^[a-f0-9]{64}$");
    expect(values).toContain("^v[1-9][0-9]*$");
    expect(values).toContain("approved_trusted_service_id");
    expect(values).toContain("revision");
  });

  it("uses same-tenant Employee foreign keys for every approval and lifecycle actor", () => {
    expectForeignKey(
      inboxV2TenantPolicyVersions,
      "inbox_v2_tenant_policy_versions_approver_fk",
      employees,
      ["tenant_id", "approved_by_employee_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2TenantPolicyActivationHeads,
      "inbox_v2_tenant_policy_activation_heads_activator_fk",
      employees,
      ["tenant_id", "activated_by_employee_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2TenantPolicyActivationHeads,
      "inbox_v2_tenant_policy_activation_heads_revoker_fk",
      employees,
      ["tenant_id", "revoked_by_employee_id"],
      ["tenant_id", "id"]
    );
  });

  it("enforces finite monotonic active/revoked lifecycle timestamps", () => {
    const state = checkSql(
      inboxV2TenantPolicyActivationHeads,
      "inbox_v2_tenant_policy_activation_heads_state_check"
    );
    const timestamps = checkSql(
      inboxV2TenantPolicyActivationHeads,
      "inbox_v2_tenant_policy_activation_heads_timestamps_check"
    );
    expect(state).toContain("state");
    expect(state).toContain("revoked_by_employee_id");
    expect(state).toContain("revoked_at");
    expect(state).toContain("updated_at");
    expect(timestamps).toContain("isfinite");
    expect(timestamps).toContain("created_at");
    expect(timestamps).toContain("activated_at");
  });

  it("guards immutable versions and monotonic activation-head CAS in PostgreSQL", () => {
    const source = INBOX_V2_TENANT_POLICY_AUTHORITY_INTEGRITY_SQL;
    expect(source.match(/create or replace function/gu)).toHaveLength(4);
    expect(
      source.match(/set search_path = pg_catalog, public, pg_temp/gu)
    ).toHaveLength(4);
    expect(source).toContain("tenant_policy_version_immutable");
    expect(source).toContain("tenant_policy_activation_transition_immutable");
    expect(source).toContain("new.revision <> old.revision + 1");
    expect(source).toContain("tenant_policy_activation_cas_conflict");
    expect(source).toContain("transition_row.resulting_state = new.state");
    expect(source).toContain("transition_row.resulting_policy_version");
    expect(source).toContain("transition_row.actor_employee_id");
    expect(source).toContain("transition_row.occurred_at");
    expect(source).toContain("for share");
    expect(source).toContain(
      "create trigger inbox_v2_tenant_policy_versions_guard_trigger"
    );
    expect(source).toContain(
      "create trigger inbox_v2_tenant_policy_activation_heads_guard_trigger"
    );
    expect(source).toContain(
      "create trigger inbox_v2_tenant_policy_activation_transitions_guard_trigger"
    );
    expect(source).toContain(
      "create constraint trigger inbox_v2_tenant_policy_transition_materialized_constraint"
    );
    expect(source).toContain("deferrable initially deferred");
    expect(source).not.toMatch(/\b(?:from|join) inbox_v2_/u);
  });

  it("keeps every explicit access index tenant-leading", () => {
    for (const table of [
      inboxV2TenantPolicyVersions,
      inboxV2TenantPolicyActivationHeads,
      inboxV2TenantPolicyActivationTransitions
    ]) {
      const indexes = getTableConfig(table).indexes;
      expect(indexes.length).toBeGreaterThan(0);
      for (const tableIndex of indexes) {
        const first = tableIndex.config.columns[0];
        expect(first && "name" in first ? first.name : undefined).toBe(
          "tenant_id"
        );
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
