import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  INBOX_V2_SOURCE_REGISTRY_INTEGRITY_SQL,
  inboxV2SourceRegistryArtifactRefs,
  inboxV2SourceRegistryHeads,
  inboxV2SourceRegistryIngressRoutes,
  inboxV2SourceRegistryRelatedAuthorityRefs,
  inboxV2SourceRegistrySecretRefs,
  inboxV2SourceRegistryTransitions,
  inboxV2SourceOnboardingResultSnapshots
} from "./inbox-v2/source-registry";
import {
  channelAuthChallenges,
  channelConnectors,
  channelSessionEvents,
  channelSessions,
  sourceConnections
} from "./tables";

describe("Inbox V2 source registry persistence schema", () => {
  it("hardens every legacy source/channel edge with a tenant composite reference", () => {
    expectForeignKey(
      channelConnectors,
      "channel_connectors_tenant_connection_fk",
      ["tenant_id", "source_connection_id"]
    );
    expectForeignKey(channelSessions, "channel_sessions_tenant_connector_fk", [
      "tenant_id",
      "connector_id"
    ]);
    expectForeignKey(
      channelSessionEvents,
      "channel_session_events_tenant_session_connector_fk",
      ["tenant_id", "session_id", "connector_id"]
    );
    expectForeignKey(
      channelAuthChallenges,
      "channel_auth_challenges_tenant_connector_fk",
      ["tenant_id", "connector_id"]
    );
    expectForeignKey(
      sourceConnections,
      "source_connections_tenant_creator_fk",
      ["tenant_id", "created_by_employee_id"]
    );
  });

  it("separates immutable transition evidence from the exact current head", () => {
    const transitions = getTableConfig(inboxV2SourceRegistryTransitions);
    const heads = getTableConfig(inboxV2SourceRegistryHeads);

    expect(primaryKeyColumns(transitions)).toEqual([
      ["tenant_id", "transition_id"]
    ]);
    expect(primaryKeyColumns(heads)).toEqual([["tenant_id", "authority_id"]]);
    expect(
      transitions.uniqueConstraints
        .find(
          ({ name }) =>
            name ===
            "inbox_v2_source_registry_transitions_authority_revision_unique"
        )
        ?.columns.map(({ name }) => name)
    ).toEqual([
      "tenant_id",
      "transition_id",
      "authority_id",
      "resulting_revision"
    ]);
    expect(
      heads.foreignKeys.find(
        ({ reference }) =>
          reference().name === "inbox_v2_source_registry_heads_transition_fk"
      )
    ).toBeDefined();
    expect(heads.columns.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "account_identity_transition_id",
        "account_identity_revision",
        "account_generation",
        "account_access_resource_head_id",
        "account_resource_access_revision",
        "account_structural_relation_revision",
        "authority_registry_composition_hash",
        "authority_effective_policy_version",
        "authority_effective_rule_revision",
        "authority_legal_hold_set_revision",
        "authority_restriction_set_revision"
      ])
    );
  });

  it("stores only typed payload, secret and opaque route references", () => {
    const artifacts = getTableConfig(inboxV2SourceRegistryArtifactRefs);
    const secrets = getTableConfig(inboxV2SourceRegistrySecretRefs);
    const routes = getTableConfig(inboxV2SourceRegistryIngressRoutes);
    const related = getTableConfig(inboxV2SourceRegistryRelatedAuthorityRefs);

    expect(artifacts.columns.map(({ name }) => name)).not.toContain("payload");
    expect(artifacts.columns.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "payload_record_id",
        "payload_schema_id",
        "payload_schema_version",
        "payload_digest_sha256"
      ])
    );
    expect(artifacts.columns.some(({ dataType }) => dataType === "json")).toBe(
      false
    );
    expect(secrets.columns.map(({ name }) => name)).not.toEqual(
      expect.arrayContaining(["encrypted_value", "secret_payload"])
    );
    expect(routes.columns.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "route_digest_sha256",
        "copy_slot",
        "effective_policy_id",
        "effective_rule_revision"
      ])
    );
    expect(related.columns.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "parent_authority_id",
        "authority_id",
        "authority_revision",
        "child_transition_id",
        "connector_authority_id",
        "session_authority_id"
      ])
    );
  });

  it("keeps onboarding replay in one immutable tenant-scoped result snapshot", () => {
    const results = getTableConfig(inboxV2SourceOnboardingResultSnapshots);

    expect(primaryKeyColumns(results)).toEqual([["tenant_id", "id"]]);
    expect(results.columns.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "command_record_id",
        "mutation_id",
        "stream_commit_id",
        "source_connection_id",
        "source_transition_id",
        "result_digest_sha256",
        "result_canonical_json",
        "state_payload",
        "state_digest_sha256",
        "state_canonical_json",
        "transition_payload",
        "transition_digest_sha256",
        "transition_canonical_json",
        "audit_target_ref",
        "tenant_facet_ref",
        "copy_slot",
        "registry_id",
        "registry_composition_hash",
        "data_class_id",
        "storage_root_id",
        "purpose_id",
        "effective_policy_id",
        "effective_rule_id",
        "policy_activation_id",
        "legal_hold_set_revision",
        "restriction_set_revision"
      ])
    );
    for (const name of [
      "inbox_v2_source_onboarding_results_command_fk",
      "inbox_v2_source_onboarding_results_connection_fk",
      "inbox_v2_source_onboarding_results_transition_fk",
      "inbox_v2_source_onboarding_results_creator_fk",
      "inbox_v2_source_onboarding_results_policy_fk",
      "inbox_v2_source_onboarding_results_rule_fk",
      "inbox_v2_source_onboarding_results_control_set_fk",
      "inbox_v2_source_onboarding_results_lineage_fk"
    ]) {
      expect(
        results.foreignKeys.some(({ reference }) => reference().name === name)
      ).toBe(true);
    }
  });

  it("installs CAS, orphan, lifecycle, fence and invalidation guards", () => {
    const ddl = INBOX_V2_SOURCE_REGISTRY_INTEGRITY_SQL.toLowerCase();

    expect(ddl).toContain("set search_path = pg_catalog, public, pg_temp");
    expect(ddl).toContain("source_registry_head_cas_conflict");
    expect(ddl).toContain("inbox_v2_source_registry_transitions_exact_trigger");
    expect(ddl).toContain("source_registry_lineage_incomplete_or_stale");
    expect(ddl).toContain("source_registry_routable_account_fence_stale");
    expect(ddl).toContain(
      "source_registry_route_invalidation_authority_mismatch"
    );
    expect(ddl).toContain(
      "source_registry_secret_revocation_authority_mismatch"
    );
    expect(ddl).toContain("source_registry_related_authority_stale");

    const secretGuard = functionBody(
      ddl,
      "inbox_v2_source_registry_secret_guard",
      "inbox_v2_source_registry_route_guard"
    );
    expect(secretGuard).toContain("new.authority_id");
    expect(secretGuard).toContain("new.authority_revision");
    expect(secretGuard).toContain("new.transition_id");
    expect(secretGuard).not.toContain("new.route_revision");
    expect(secretGuard).not.toContain("new.parent_authority_id");

    const routeGuard = functionBody(
      ddl,
      "inbox_v2_source_registry_route_guard",
      "inbox_v2_source_registry_head_guard"
    );
    expect(routeGuard).toContain("new.route_revision");
    expect(routeGuard).toContain("new.parent_authority_id");
    expect(routeGuard).toContain("new.parent_authority_revision");
    expect(routeGuard).toContain("new.parent_transition_id");
  });

  it("preflights the real DB003 identity head and only schema-owned types", () => {
    const preflight = readFileSync(
      resolve("scripts/db/inbox-v2-source-registry-preflight.sql"),
      "utf8"
    ).toLowerCase();
    const migration = readFileSync(
      resolve("packages/db/drizzle/0039_inbox_v2_source_registry.sql"),
      "utf8"
    ).toLowerCase();

    expect(preflight).toContain("public.inbox_v2_source_account_identities");
    expect(preflight).not.toContain(
      "public.inbox_v2_source_account_identity_heads"
    );
    expect(preflight).not.toContain(
      "public.inbox_v2_source_registry_secret_kind"
    );
    expect(migration).not.toContain(
      'create type "public"."inbox_v2_source_registry_secret_kind"'
    );
  });
});

function functionBody(ddl: string, name: string, nextName: string): string {
  const start = ddl.indexOf(`function public.${name}()`);
  const end = ddl.indexOf(`function public.${nextName}()`, start + 1);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return ddl.slice(start, end);
}

function primaryKeyColumns(
  table: ReturnType<typeof getTableConfig>
): string[][] {
  return table.primaryKeys.map((key) => key.columns.map(({ name }) => name));
}

function expectForeignKey(
  table: Parameters<typeof getTableConfig>[0],
  name: string,
  columns: readonly string[]
): void {
  const config = getTableConfig(table);
  const foreignKey = config.foreignKeys.find(
    ({ reference }) => reference().name === name
  );
  expect(
    foreignKey?.reference().columns.map(({ name: column }) => column)
  ).toEqual(columns);
}
