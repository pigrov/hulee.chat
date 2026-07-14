import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  INBOX_V2_CONVERSATION_CLIENT_LINK_INTEGRITY_SQL,
  inboxV2ConversationClientLinkActorKind,
  inboxV2ConversationClientLinkEvidenceReferences,
  inboxV2ConversationClientLinkHeads,
  inboxV2ConversationClientLinkProvenanceKind,
  inboxV2ConversationClientLinkRoles,
  inboxV2ConversationClientLinks,
  inboxV2ConversationClientLinkTransitionOperations,
  inboxV2ConversationClientLinkTransitions
} from "./inbox-v2/conversation-client-link";
import { inboxV2SourceIdentityClaims } from "./inbox-v2/identity-foundation";
import { inboxV2TenantPolicyActivationTransitions } from "./inbox-v2/tenant-policy-authority";
import {
  clientContacts,
  clients,
  employees,
  inboxV2Conversations,
  tenants
} from "./tables";

describe("Inbox V2 ConversationClientLink foundation schema", () => {
  it("uses six tenant-owned relational tables", () => {
    expect(getTableConfig(inboxV2ConversationClientLinkHeads).name).toBe(
      "inbox_v2_conversation_client_link_heads"
    );
    expect(getTableConfig(inboxV2ConversationClientLinks).name).toBe(
      "inbox_v2_conversation_client_links"
    );
    expect(getTableConfig(inboxV2ConversationClientLinkRoles).name).toBe(
      "inbox_v2_conversation_client_link_roles"
    );
    expect(getTableConfig(inboxV2ConversationClientLinkTransitions).name).toBe(
      "inbox_v2_conversation_client_link_transitions"
    );
    expect(
      getTableConfig(inboxV2ConversationClientLinkTransitionOperations).name
    ).toBe("inbox_v2_conversation_client_link_transition_operations");
    expect(
      getTableConfig(inboxV2ConversationClientLinkEvidenceReferences).name
    ).toBe("inbox_v2_conversation_client_link_evidence_references");

    expect(primaryKeyColumns(inboxV2ConversationClientLinkHeads)).toEqual([
      ["tenant_id", "conversation_id"]
    ]);
    expect(primaryKeyColumns(inboxV2ConversationClientLinks)).toEqual([
      ["tenant_id", "id"]
    ]);
    expect(primaryKeyColumns(inboxV2ConversationClientLinkTransitions)).toEqual(
      [["tenant_id", "id"]]
    );
    expect(
      primaryKeyColumns(inboxV2ConversationClientLinkEvidenceReferences)
    ).toEqual([["tenant_id", "link_id", "purpose", "ordinal"]]);
  });

  it("pins links and decision Employees to exact same-tenant parents", () => {
    expectForeignKey(
      inboxV2ConversationClientLinks,
      "inbox_v2_conversation_client_links_conversation_fk",
      inboxV2Conversations,
      ["tenant_id", "conversation_id"],
      ["tenant_id", "id"],
      "cascade"
    );
    expectForeignKey(
      inboxV2ConversationClientLinks,
      "inbox_v2_conversation_client_links_client_fk",
      clients,
      ["tenant_id", "client_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2ConversationClientLinks,
      "inbox_v2_conversation_client_links_linked_employee_fk",
      employees,
      ["tenant_id", "linked_actor_employee_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2ConversationClientLinkTransitions,
      "inbox_v2_conversation_client_link_transitions_employee_fk",
      employees,
      ["tenant_id", "actor_employee_id"],
      ["tenant_id", "id"]
    );
  });

  it("cascades tenant/Conversation ownership while preserving direct-delete immutability", () => {
    const tables = [
      inboxV2ConversationClientLinkHeads,
      inboxV2ConversationClientLinks,
      inboxV2ConversationClientLinkRoles,
      inboxV2ConversationClientLinkTransitions,
      inboxV2ConversationClientLinkTransitionOperations,
      inboxV2ConversationClientLinkEvidenceReferences
    ];
    for (const table of tables) {
      const tenantForeignKey = getTableConfig(table).foreignKeys.find(
        (candidate) => candidate.reference().foreignTable === tenants
      );
      expect(tenantForeignKey?.onDelete).toBe("cascade");
    }

    expectForeignKey(
      inboxV2ConversationClientLinkHeads,
      "inbox_v2_conversation_client_link_heads_conversation_fk",
      inboxV2Conversations,
      ["tenant_id", "conversation_id"],
      ["tenant_id", "id"],
      "cascade"
    );
    expectForeignKey(
      inboxV2ConversationClientLinkTransitions,
      "inbox_v2_conversation_client_link_transitions_conversation_fk",
      inboxV2Conversations,
      ["tenant_id", "conversation_id"],
      ["tenant_id", "id"],
      "cascade"
    );
    expectForeignKey(
      inboxV2ConversationClientLinkRoles,
      "inbox_v2_conversation_client_link_roles_link_fk",
      inboxV2ConversationClientLinks,
      ["tenant_id", "link_id", "conversation_id"],
      ["tenant_id", "id", "conversation_id"],
      "cascade"
    );
    expectForeignKey(
      inboxV2ConversationClientLinkTransitionOperations,
      "inbox_v2_conversation_client_link_transition_operations_transition_fk",
      inboxV2ConversationClientLinkTransitions,
      ["tenant_id", "transition_id", "conversation_id", "resulting_revision"],
      ["tenant_id", "id", "conversation_id", "resulting_revision"],
      "cascade"
    );

    const invariantSql = INBOX_V2_CONVERSATION_CLIENT_LINK_INTEGRITY_SQL;
    expect(invariantSql).toContain("from public.tenants tenant_row");
    expect(invariantSql).toContain(
      "from public.inbox_v2_conversations conversation_row"
    );
    expect(invariantSql).toContain("return old");
    expect(invariantSql).toContain("conversation_client_link_immutable");
  });

  it("keeps the head absent until the first null-to-one transition", () => {
    const headRevision = getTableConfig(
      inboxV2ConversationClientLinkHeads
    ).columns.find((column) => column.name === "revision");

    expect(headRevision?.default).toBeUndefined();
    expect(
      checkSql(
        inboxV2ConversationClientLinkHeads,
        "inbox_v2_conversation_client_link_heads_revision_check"
      )
    ).toContain(">= 1");
    expect(INBOX_V2_CONVERSATION_CLIENT_LINK_INTEGRITY_SQL).not.toMatch(
      /insert into public\.inbox_v2_conversation_client_link_heads/i
    );
    expect(INBOX_V2_CONVERSATION_CLIENT_LINK_INTEGRITY_SQL).toContain(
      "head_invalid_initial"
    );
  });

  it("supports trusted policy/service and exact verification authority", () => {
    expect(inboxV2ConversationClientLinkProvenanceKind.enumValues).toEqual([
      "manual",
      "migration",
      "source_identity_claim",
      "trusted_policy"
    ]);
    expect(inboxV2ConversationClientLinkActorKind.enumValues).toEqual([
      "employee",
      "trusted_service",
      "migration_service"
    ]);
    const provenance = checkSql(
      inboxV2ConversationClientLinks,
      "inbox_v2_conversation_client_links_provenance_check"
    );

    expect(provenance).toContain("= 'manual'");
    expect(provenance).toContain("= 'migration'");
    expect(provenance).toContain("= 'source_identity_claim'");
    expect(provenance).toContain("\"association_confidence\" = 'confirmed'");
    expect(provenance).toContain("\"valid_from_basis\" = 'known_effective'");
    expect(provenance).toContain("trusted_service");
    expect(provenance).toContain("trusted_policy");
    expect(
      getTableConfig(inboxV2ConversationClientLinks).columns.map(
        (column) => column.name
      )
    ).toEqual(
      expect.arrayContaining([
        "provenance_claim_id",
        "provenance_claim_version",
        "provenance_claim_target_client_contact_id",
        "provenance_verification_service_id",
        "provenance_verification_policy_id",
        "provenance_verification_policy_family",
        "provenance_verification_definition_digest_sha256",
        "provenance_verification_activation_head_revision",
        "provenance_verification_verified_at"
      ])
    );
    expectForeignKey(
      inboxV2ConversationClientLinks,
      "inbox_v2_client_links_linked_policy_authority_fk",
      inboxV2TenantPolicyActivationTransitions,
      [
        "tenant_id",
        "linked_policy_family",
        "linked_policy_id",
        "linked_policy_activation_head_revision",
        "linked_policy_version",
        "linked_policy_definition_contract_version",
        "linked_policy_definition_digest_sha256",
        "linked_actor_service_id"
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
  });

  it("pins the immutable claim version and ClientContact target without a reverse cycle", () => {
    expectForeignKey(
      inboxV2ConversationClientLinks,
      "inbox_v2_conversation_client_links_claim_fk",
      inboxV2SourceIdentityClaims,
      [
        "tenant_id",
        "provenance_claim_id",
        "provenance_claim_version",
        "provenance_claim_target_client_contact_id"
      ],
      ["tenant_id", "id", "claim_version", "target_client_contact_id"]
    );
    expectForeignKey(
      inboxV2ConversationClientLinks,
      "inbox_v2_conversation_client_links_claim_contact_fk",
      clientContacts,
      ["tenant_id", "provenance_claim_target_client_contact_id"],
      ["tenant_id", "id"]
    );
    expect(
      getTableConfig(inboxV2SourceIdentityClaims).foreignKeys.some(
        (foreignKey) =>
          foreignKey.reference().foreignTable === inboxV2ConversationClientLinks
      )
    ).toBe(false);

    const claimIndex = indexByName(
      inboxV2ConversationClientLinks,
      "inbox_v2_conversation_client_links_tenant_claim_idx"
    );
    expect(claimIndex.config.columns.map(indexColumnName)).toEqual([
      "tenant_id",
      "provenance_claim_id",
      "valid_from",
      "id"
    ]);
  });

  it("permits only one current episode for a Conversation and Client", () => {
    const current = indexByName(
      inboxV2ConversationClientLinks,
      "inbox_v2_conversation_client_links_current_client_unique"
    );

    expect(current.config.unique).toBe(true);
    expect(current.config.columns.map(indexColumnName)).toEqual([
      "tenant_id",
      "conversation_id",
      "client_id"
    ]);
    expect(indexSql(current.config.where)).toContain("state");
    expect(indexSql(current.config.where)).toContain("= 'active'");
    expect(INBOX_V2_CONVERSATION_CLIENT_LINK_INTEGRITY_SQL).toContain(
      "conversation_client_link_history_overlap"
    );
    expect(INBOX_V2_CONVERSATION_CLIENT_LINK_INTEGRITY_SQL).toContain(
      "tstzrange"
    );

    const reverse = indexByName(
      inboxV2ConversationClientLinks,
      "inbox_v2_conversation_client_links_tenant_client_idx"
    );
    expect(reverse.config.columns.map(indexColumnName)).toEqual([
      "tenant_id",
      "client_id",
      "conversation_id",
      "id"
    ]);
  });

  it("owns role and operation children from exact transition/link edges", () => {
    expectForeignKey(
      inboxV2ConversationClientLinkRoles,
      "inbox_v2_conversation_client_link_roles_transition_fk",
      inboxV2ConversationClientLinkTransitions,
      [
        "tenant_id",
        "creation_transition_id",
        "conversation_id",
        "creation_revision"
      ],
      ["tenant_id", "id", "conversation_id", "resulting_revision"]
    );
    expectForeignKey(
      inboxV2ConversationClientLinkTransitionOperations,
      "inbox_v2_conversation_client_link_transition_operations_link_fk",
      inboxV2ConversationClientLinks,
      ["tenant_id", "link_id", "conversation_id"],
      ["tenant_id", "id", "conversation_id"]
    );
    expect(
      primaryKeyColumns(inboxV2ConversationClientLinkTransitionOperations)
    ).toEqual([["tenant_id", "transition_id", "link_id"]]);
  });

  it("stores contiguous nullable-first transition CAS", () => {
    const cas = checkSql(
      inboxV2ConversationClientLinkTransitions,
      "inbox_v2_conversation_client_link_transitions_cas_check"
    );

    expect(cas).toContain("expected_revision");
    expect(cas).toContain("is not distinct from");
    expect(cas).toContain("current_revision");
    expect(cas).toContain("resulting_revision");
    expect(cas).toContain("= 1");
    expect(cas).toContain("+ 1");
    expect(
      uniqueColumns(
        inboxV2ConversationClientLinkTransitions,
        "inbox_v2_conversation_client_link_transitions_revision_unique"
      )
    ).toEqual(["tenant_id", "conversation_id", "resulting_revision"]);
  });

  it("guards first-write serialization and immutable append history", () => {
    const invariantSql = INBOX_V2_CONVERSATION_CLIENT_LINK_INTEGRITY_SQL;

    expect(invariantSql).toMatch(
      /guard_transition_insert[\s\S]*?from public\.inbox_v2_conversations[\s\S]*?for no key update/s
    );
    expect(invariantSql).toContain(
      "inbox_v2.conversation_client_link_revision_conflict"
    );
    expect(invariantSql).toContain(
      "inbox_v2_conversation_client_link_assert_open_transition"
    );
    for (const tableToken of ["transitions", "roles", "operations"]) {
      expect(invariantSql).toMatch(
        new RegExp(`create trigger [^;]*${tableToken}[^;]*immutable`, "s")
      );
    }
    expect(invariantSql).toMatch(
      /create trigger inbox_v2_conversation_client_links_update_guard_trigger\s+before update/s
    );
    for (const column of [
      "provenance_claim_id",
      "provenance_claim_version",
      "provenance_claim_target_client_contact_id",
      "provenance_verification_service_id",
      "provenance_verification_verified_at"
    ]) {
      expect(invariantSql).toContain(
        `new.${column} is distinct from old.${column}`
      );
    }
  });

  it("uses exact temporal claim evidence and preserves historical intervals", () => {
    const invariantSql = INBOX_V2_CONVERSATION_CLIENT_LINK_INTEGRITY_SQL;
    const insertGuard = functionSql(
      invariantSql,
      "inbox_v2_conversation_client_link_guard_episode_insert"
    );
    const episodeAssertion = functionSql(
      invariantSql,
      "inbox_v2_assert_conversation_client_link_episode"
    );
    const revocationGuard = functionSql(
      invariantSql,
      "inbox_v2_conversation_client_link_deferred_claim_revocation"
    );

    expect(insertGuard).toContain(
      "from public.inbox_v2_source_external_identities"
    );
    expect(insertGuard).toContain("for share");
    expect(insertGuard).toContain("contact_row.client_id = new.client_id");
    expect(insertGuard).toContain(
      "claim_created_at > new.provenance_verification_verified_at"
    );

    expect(episodeAssertion).toContain(
      "link_row.valid_from > claim_revoked_at"
    );
    expect(episodeAssertion).not.toContain("head_resolution_status");
    expect(episodeAssertion).not.toContain("claim_status <> 'active'");
    expect(revocationGuard).toContain("link_row.valid_from > new.revoked_at");
    expect(invariantSql).toMatch(
      /create constraint trigger inbox_v2_conversation_client_link_claim_revocation_constraint_trigger[\s\S]*?after update on public\.inbox_v2_source_identity_claims[\s\S]*?deferrable initially deferred/s
    );
  });

  it("seals ordered verification/audit evidence and current trusted policy use", () => {
    const invariantSql = INBOX_V2_CONVERSATION_CLIENT_LINK_INTEGRITY_SQL;
    expect(invariantSql).toContain(
      "inbox_v2_assert_conversation_client_link_evidence"
    );
    expect(invariantSql).toContain("evidence_cardinality_invalid");
    expect(invariantSql).toContain("evidence_duplicate");
    expect(invariantSql).toContain("verification_graph_invalid");
    expect(invariantSql).toContain("claim_evidence_missing");
    expect(invariantSql).toContain("evidence_closed");
    expect(invariantSql).toMatch(
      /evidence_immutable_trigger\s+before update or delete/s
    );
    expect(invariantSql).toContain(
      "inbox_v2_conversation_client_link_assert_current_policy"
    );
    expect(invariantSql).toContain("head_row.state <> 'active'");
    expect(invariantSql).toContain("for share");
  });

  it("validates exact decision/time, bounded roles and legal primary state at commit", () => {
    const invariantSql = INBOX_V2_CONVERSATION_CLIENT_LINK_INTEGRITY_SQL;

    expect(invariantSql).toContain(
      "inbox_v2_assert_conversation_client_link_episode"
    );
    expect(invariantSql).toContain(
      "inbox_v2_assert_conversation_client_link_transition"
    );
    expect(invariantSql).toContain("role_count < 1 or role_count > 16");
    expect(invariantSql).toContain("core:legacy-unspecified");
    expect(invariantSql).toContain("core:legacy-v1");
    expect(invariantSql).toContain("primary_confidence <> 'confirmed'");
    expect(invariantSql).toContain("primary_provenance = 'migration'");
    expect(invariantSql).toContain(
      "transition_row.occurred_at = link_row.valid_from"
    );
    expect(invariantSql).toContain("head_updated_at <> latest_occurred_at");
  });

  it("keeps every explicit access index tenant-leading", () => {
    for (const table of [
      inboxV2ConversationClientLinkHeads,
      inboxV2ConversationClientLinks,
      inboxV2ConversationClientLinkRoles,
      inboxV2ConversationClientLinkTransitions,
      inboxV2ConversationClientLinkTransitionOperations,
      inboxV2ConversationClientLinkEvidenceReferences
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

function expectForeignKey(
  table: Parameters<typeof getTableConfig>[0],
  name: string,
  foreignTable: Parameters<typeof getTableConfig>[0],
  columns: string[],
  foreignColumns: string[],
  onDelete?: string
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
  if (onDelete !== undefined) expect(foreignKey?.onDelete).toBe(onDelete);
}

function checkSql(
  table: Parameters<typeof getTableConfig>[0],
  name: string
): string {
  const check = getTableConfig(table).checks.find(
    (candidate) => candidate.name === name
  );
  if (!check) throw new Error(`Missing check constraint: ${name}`);
  return new PgDialect().sqlToQuery(check.value).sql;
}

function indexByName(
  table: Parameters<typeof getTableConfig>[0],
  name: string
): ReturnType<typeof getTableConfig>["indexes"][number] {
  const tableIndex = getTableConfig(table).indexes.find(
    (candidate) => candidate.config.name === name
  );
  if (!tableIndex) throw new Error(`Missing index: ${name}`);
  return tableIndex;
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
  return value ? new PgDialect().sqlToQuery(value as never).sql : "";
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
