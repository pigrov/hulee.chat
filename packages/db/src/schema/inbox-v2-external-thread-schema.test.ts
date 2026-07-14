import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  inboxV2ExternalThreadAliases,
  inboxV2ExternalThreadKeyRegistry,
  inboxV2ExternalThreads
} from "./inbox-v2/external-thread";
import {
  inboxV2Conversations,
  sourceAccounts,
  sourceConnections
} from "./tables";

describe("Inbox V2 ExternalThread persistence schema", () => {
  it("separates the shared key registry, canonical thread and direct aliases", () => {
    const registry = getTableConfig(inboxV2ExternalThreadKeyRegistry);
    const thread = getTableConfig(inboxV2ExternalThreads);
    const alias = getTableConfig(inboxV2ExternalThreadAliases);

    expect(registry.name).toBe("inbox_v2_external_thread_key_registry");
    expect(thread.name).toBe("inbox_v2_external_threads");
    expect(alias.name).toBe("inbox_v2_external_thread_aliases");

    expect(primaryKeyColumns(registry)).toEqual([["tenant_id", "id"]]);
    expect(primaryKeyColumns(thread)).toEqual([["tenant_id", "id"]]);
    expect(primaryKeyColumns(alias)).toEqual([["tenant_id", "id"]]);

    expect(registry.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "entry_kind",
        "realm_id",
        "realm_version",
        "canonicalization_version",
        "scope_kind",
        "scope_source_connection_id",
        "scope_source_account_id",
        "scope_owner_key",
        "object_kind_id",
        "canonical_external_subject",
        "key_digest",
        "canonical_thread_id",
        "canonical_conversation_id"
      ])
    );
    expect(thread.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "key_registry_id",
        "key_registry_entry_kind",
        "key_digest",
        "identity_declaration",
        "conversation_id",
        "conversation_transport",
        "conversation_topology",
        "revision",
        "created_at",
        "updated_at"
      ])
    );
    expect(alias.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "alias_key_registry_id",
        "alias_key_digest",
        "canonical_key_registry_id",
        "canonical_key_digest",
        "canonical_thread_id",
        "canonical_conversation_id",
        "expected_canonical_thread_revision",
        "decision_trusted_service_id",
        "decision_policy_id",
        "decision_reason_code_id",
        "decision_authoritative_evidence_token"
      ])
    );
  });

  it("reserves canonical and alias keys in one bounded digest namespace", () => {
    const registry = getTableConfig(inboxV2ExternalThreadKeyRegistry);

    expect(
      uniqueColumns(registry, "inbox_v2_ext_thread_key_digest_unique")
    ).toEqual(["tenant_id", "key_digest"]);

    // No raw provider subject/version tuple is placed in a wide btree key.
    for (const constraint of registry.uniqueConstraints) {
      const names = constraint.columns.map((column) => column.name);
      expect(names).not.toContain("canonical_external_subject");
      expect(names).not.toContain("realm_version");
    }

    const digestSql = generatedColumnSql(registry, "key_digest");
    expect(digestSql).toContain("sha256");
    expect(digestSql).toContain("replace");
    expect(digestSql).toContain("chr");
    expect(digestSql).not.toContain("digest(");
    expect(digestSql).not.toContain("convert_to");
    expect(digestSql).toContain("octet_length");
    expect(digestSql).toContain("-1:");
    expect(digestSql).toContain("external-thread-key:v1|");
    expect(digestSql).toContain('"canonical_external_subject"');
    expect(digestSql).not.toContain('"entry_kind"');

    const digestCheck = checkSql(
      registry,
      "inbox_v2_ext_thread_key_digest_check"
    );
    expect(digestCheck).toContain("^[a-f0-9]{64}$");
  });

  it("generates the same exact-shape digest on canonical and alias snapshots", () => {
    const thread = getTableConfig(inboxV2ExternalThreads);
    const alias = getTableConfig(inboxV2ExternalThreadAliases);

    const canonicalSql = generatedColumnSql(thread, "key_digest");
    const aliasSql = generatedColumnSql(alias, "alias_key_digest");
    const canonicalSnapshotSql = generatedColumnSql(
      alias,
      "canonical_key_digest"
    );

    for (const digestSql of [canonicalSql, aliasSql, canonicalSnapshotSql]) {
      expect(digestSql).toContain("external-thread-key:v1|");
      expect(digestSql).toContain("octet_length");
      expect(digestSql).toContain("sha256");
    }
    expect(aliasSql).toContain('"alias_scope_source_connection_id"');
    expect(canonicalSnapshotSql).toContain(
      '"canonical_scope_source_account_id"'
    );
  });

  it("enforces tenant-safe registry scope owners and Conversation target", () => {
    const registry = getTableConfig(inboxV2ExternalThreadKeyRegistry);

    expectForeignKey(
      registry,
      "inbox_v2_ext_thread_key_connection_fk",
      sourceConnections,
      ["tenant_id", "scope_source_connection_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      registry,
      "inbox_v2_ext_thread_key_account_fk",
      sourceAccounts,
      ["tenant_id", "scope_source_account_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      registry,
      "inbox_v2_ext_thread_key_conversation_fk",
      inboxV2Conversations,
      ["tenant_id", "canonical_conversation_id"],
      ["tenant_id", "id"]
    );

    const canonicalTarget = registry.indexes.find(
      (candidate) =>
        candidate.config.name ===
        "inbox_v2_ext_thread_key_canonical_target_unique"
    );
    expect(canonicalTarget?.config.unique).toBe(true);
    expect(
      canonicalTarget?.config.columns.map((column) => indexColumnName(column))
    ).toEqual(["tenant_id", "canonical_thread_id"]);
    expect(canonicalTarget?.config.where).toBeDefined();
  });

  it("pins one exact canonical key and one external Conversation per thread", () => {
    const thread = getTableConfig(inboxV2ExternalThreads);

    expectForeignKey(
      thread,
      "inbox_v2_external_threads_conversation_fk",
      inboxV2Conversations,
      [
        "tenant_id",
        "conversation_id",
        "conversation_transport",
        "conversation_topology"
      ],
      ["tenant_id", "id", "transport", "topology"]
    );
    expectForeignKey(
      thread,
      "inbox_v2_external_threads_registry_fk",
      inboxV2ExternalThreadKeyRegistry,
      [
        "tenant_id",
        "key_registry_id",
        "key_registry_entry_kind",
        "id",
        "conversation_id",
        "key_digest"
      ],
      [
        "tenant_id",
        "id",
        "entry_kind",
        "canonical_thread_id",
        "canonical_conversation_id",
        "key_digest"
      ]
    );

    expect(
      uniqueColumns(thread, "inbox_v2_external_threads_conversation_unique")
    ).toEqual(["tenant_id", "conversation_id"]);
    expect(
      uniqueColumns(thread, "inbox_v2_external_threads_registry_unique")
    ).toEqual(["tenant_id", "key_registry_id"]);
    expect(
      uniqueColumns(thread, "inbox_v2_external_threads_target_revision_unique")
    ).toEqual(["tenant_id", "id", "conversation_id", "revision"]);
    expect(
      uniqueColumns(
        getTableConfig(inboxV2Conversations),
        "inbox_v2_conversations_tenant_id_shape_unique"
      )
    ).toEqual(["tenant_id", "id", "transport", "topology"]);
    expect(
      checkSql(thread, "inbox_v2_external_threads_registry_kind_check")
    ).toContain("conversation_transport");
  });

  it("forces every alias registry row and key snapshot to one direct canonical target", () => {
    const alias = getTableConfig(inboxV2ExternalThreadAliases);

    expectForeignKey(
      alias,
      "inbox_v2_ext_thread_alias_alias_registry_fk",
      inboxV2ExternalThreadKeyRegistry,
      [
        "tenant_id",
        "alias_key_registry_id",
        "alias_key_registry_entry_kind",
        "canonical_thread_id",
        "canonical_conversation_id",
        "alias_key_digest"
      ],
      [
        "tenant_id",
        "id",
        "entry_kind",
        "canonical_thread_id",
        "canonical_conversation_id",
        "key_digest"
      ]
    );
    expectForeignKey(
      alias,
      "inbox_v2_ext_thread_alias_canonical_registry_fk",
      inboxV2ExternalThreadKeyRegistry,
      [
        "tenant_id",
        "canonical_key_registry_id",
        "canonical_key_registry_entry_kind",
        "canonical_thread_id",
        "canonical_conversation_id",
        "canonical_key_digest"
      ],
      [
        "tenant_id",
        "id",
        "entry_kind",
        "canonical_thread_id",
        "canonical_conversation_id",
        "key_digest"
      ]
    );
    expectForeignKey(
      alias,
      "inbox_v2_ext_thread_alias_direct_target_fk",
      inboxV2ExternalThreads,
      [
        "tenant_id",
        "canonical_thread_id",
        "canonical_conversation_id",
        "expected_canonical_thread_revision"
      ],
      ["tenant_id", "id", "conversation_id", "revision"]
    );

    expect(
      uniqueColumns(alias, "inbox_v2_external_thread_aliases_registry_unique")
    ).toEqual(["tenant_id", "alias_key_registry_id"]);
  });

  it("keeps scope, key and immutable revision checks fail-closed", () => {
    const registry = getTableConfig(inboxV2ExternalThreadKeyRegistry);
    const thread = getTableConfig(inboxV2ExternalThreads);
    const alias = getTableConfig(inboxV2ExternalThreadAliases);

    const registryScope = checkSql(
      registry,
      "inbox_v2_ext_thread_key_scope_check"
    );
    expect(registryScope).toContain("= 'provider'");
    expect(registryScope).toContain("= 'source_connection'");
    expect(registryScope).toContain("= 'source_account'");
    expect(registryScope).toContain('"scope_owner_key"');
    expect(registryScope).toContain('"scope_source_connection_id"');
    expect(registryScope).toContain("is true");

    const subject = checkSql(registry, "inbox_v2_ext_thread_key_subject_check");
    expect(subject).toContain("between 1 and 1024");
    expect(subject).toContain("[:space:]");
    expect(subject).toContain("\\x00-\\x1F\\x7F");

    const objectKind = checkSql(
      registry,
      "inbox_v2_ext_thread_key_object_kind_check"
    );
    expect(objectKind).toContain("split_part");
    expect(objectKind).toContain("not in");
    expect(objectKind).toContain("'core', 'hulee', 'module'");

    const registryImmutable = checkSql(
      registry,
      "inbox_v2_ext_thread_key_immutable_check"
    );
    expect(registryImmutable).toContain('"updated_at"');
    expect(registryImmutable).toContain('"created_at"');
    expect(
      checkSql(thread, "inbox_v2_external_threads_immutable_check")
    ).toContain('"revision" = 1');
    expect(
      checkSql(alias, "inbox_v2_external_thread_aliases_immutable_check")
    ).toContain('"expected_canonical_thread_revision" = 1');
  });

  it("pins adapter declarations to the exact key and creation clock", () => {
    const thread = getTableConfig(inboxV2ExternalThreads);
    const alias = getTableConfig(inboxV2ExternalThreadAliases);

    const threadDeclaration = checkSql(
      thread,
      "inbox_v2_external_threads_declaration_check"
    );
    expect(threadDeclaration).toContain("?& array[");
    expect(threadDeclaration).toContain("'identityKind'");
    expect(threadDeclaration).toContain("= 'external_thread'");
    expect(threadDeclaration).toContain('"realm_id"');
    expect(threadDeclaration).toContain('"canonicalization_version"');
    expect(threadDeclaration).toContain('"object_kind_id"');
    expect(threadDeclaration).toContain('"scope_kind"::text');
    expect(threadDeclaration).toContain("= 'source_account'");
    expect(threadDeclaration).toContain("loadedAt");
    expect(threadDeclaration).toContain("split_part");
    expect(threadDeclaration).toContain("not in");
    expect(threadDeclaration).toContain("::timestamptz <=");
    expect(threadDeclaration).toContain("is true");

    const aliasDeclaration = checkSql(
      alias,
      "inbox_v2_external_thread_aliases_declaration_check"
    );
    expect(aliasDeclaration).toContain("= 'authoritative'");
    expect(aliasDeclaration).toContain("loadedByTrustedServiceId");
    expect(aliasDeclaration).toContain('"decision_trusted_service_id"');
  });

  it("rejects alias self-maps and bounds authoritative decision metadata", () => {
    const alias = getTableConfig(inboxV2ExternalThreadAliases);

    const kind = checkSql(alias, "inbox_v2_external_thread_aliases_kind_check");
    expect(kind).toContain("= 'alias'");
    expect(kind).toContain("= 'canonical'");

    const distinct = checkSql(
      alias,
      "inbox_v2_external_thread_aliases_distinct_key_check"
    );
    expect(distinct).toContain("is distinct from row");
    expect(distinct).toContain('"alias_canonical_external_subject"');
    expect(distinct).toContain('"canonical_external_subject"');

    const decision = checkSql(
      alias,
      "inbox_v2_external_thread_aliases_decision_check"
    );
    expect(decision).toContain("between 8 and 256");
    expect(decision).toContain("^[A-Za-z0-9][A-Za-z0-9._~:-]*$");
    expect(decision).toContain("^v[1-9][0-9]*$");
    expect(decision).toContain('"decision_decided_at"');
    expect(decision).toContain('"created_at"');
    expect(decision).toContain("isfinite");
    expect(decision).toContain("is true");
    expect(decision).toContain("split_part");
    expect(decision).toContain("not in");

    expect(
      getTableConfig(inboxV2ExternalThreads).indexes.map(
        (tableIndex) => tableIndex.config.name
      )
    ).not.toContain("inbox_v2_external_threads_tenant_conversation_idx");
  });

  it("keeps every explicit access index tenant-leading", () => {
    for (const table of [
      inboxV2ExternalThreadKeyRegistry,
      inboxV2ExternalThreads,
      inboxV2ExternalThreadAliases
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
