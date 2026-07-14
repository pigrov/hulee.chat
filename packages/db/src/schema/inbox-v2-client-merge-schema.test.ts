import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  INBOX_V2_CLIENT_MERGE_INTEGRITY_SQL,
  inboxV2ClientMergeGraphHeads,
  inboxV2ClientMergeNodeStates,
  inboxV2ClientMergeRedirects
} from "./inbox-v2/client-merge";
import { clients, employees, tenants } from "./tables";

describe("Inbox V2 Client merge schema", () => {
  it("separates the nullable tenant head, mandatory current nodes and immutable history", () => {
    expect(getTableConfig(inboxV2ClientMergeGraphHeads).name).toBe(
      "inbox_v2_client_merge_graph_heads"
    );
    expect(getTableConfig(inboxV2ClientMergeNodeStates).name).toBe(
      "inbox_v2_client_merge_node_states"
    );
    expect(getTableConfig(inboxV2ClientMergeRedirects).name).toBe(
      "inbox_v2_client_merge_redirects"
    );

    expect(primaryKeyColumns(inboxV2ClientMergeGraphHeads)).toEqual([
      ["tenant_id"]
    ]);
    expect(primaryKeyColumns(inboxV2ClientMergeNodeStates)).toEqual([
      ["tenant_id", "client_id"]
    ]);
    expect(primaryKeyColumns(inboxV2ClientMergeRedirects)).toEqual([
      ["tenant_id", "id"]
    ]);
  });

  it("pins every Client, redirect edge and Employee actor to the same tenant", () => {
    expectForeignKey(
      inboxV2ClientMergeGraphHeads,
      "inbox_v2_client_merge_graph_heads_tenant_id_tenants_id_fk",
      tenants,
      ["tenant_id"],
      ["id"],
      "cascade"
    );
    expectForeignKey(
      inboxV2ClientMergeNodeStates,
      "inbox_v2_client_merge_node_states_tenant_id_tenants_id_fk",
      tenants,
      ["tenant_id"],
      ["id"],
      "cascade"
    );
    expectForeignKey(
      inboxV2ClientMergeRedirects,
      "inbox_v2_client_merge_redirects_tenant_id_tenants_id_fk",
      tenants,
      ["tenant_id"],
      ["id"],
      "cascade"
    );
    expectForeignKey(
      inboxV2ClientMergeNodeStates,
      "inbox_v2_client_merge_node_states_client_fk",
      clients,
      ["tenant_id", "client_id"],
      ["tenant_id", "id"],
      "cascade"
    );
    expectForeignKey(
      inboxV2ClientMergeNodeStates,
      "inbox_v2_client_merge_node_states_next_client_fk",
      clients,
      ["tenant_id", "next_client_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2ClientMergeNodeStates,
      "inbox_v2_client_merge_node_states_redirect_fk",
      inboxV2ClientMergeRedirects,
      ["tenant_id", "redirect_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2ClientMergeRedirects,
      "inbox_v2_client_merge_redirects_source_client_fk",
      clients,
      ["tenant_id", "source_root_client_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2ClientMergeRedirects,
      "inbox_v2_client_merge_redirects_target_client_fk",
      clients,
      ["tenant_id", "target_root_client_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2ClientMergeRedirects,
      "inbox_v2_client_merge_redirects_actor_employee_fk",
      employees,
      ["tenant_id", "decision_actor_employee_id"],
      ["tenant_id", "id"]
    );
  });

  it("keeps the contract nullable head as one lockable storage row", () => {
    const check = checkSql(
      inboxV2ClientMergeGraphHeads,
      "inbox_v2_client_merge_graph_heads_nullable_state_check"
    );

    expect(check).toContain("revision");
    expect(check).toContain("is null");
    expect(check).toContain(">= 1");
    expect(check).toContain("latest_redirect_id");
    expect(check).toContain("isfinite");
  });

  it("makes one current node represent either an initial root or an exact redirect", () => {
    const shape = checkSql(
      inboxV2ClientMergeNodeStates,
      "inbox_v2_client_merge_node_states_shape_check"
    );
    const lifecycle = checkSql(
      inboxV2ClientMergeNodeStates,
      "inbox_v2_client_merge_node_states_initial_or_mutated_check"
    );

    expect(shape).toContain("canonical_root");
    expect(shape).toContain("redirected");
    expect(shape).toContain("next_client_id");
    expect(shape).toContain("redirect_id");
    expect(shape).toContain("< 64");
    expect(lifecycle).toContain("last_graph_revision");
    expect(lifecycle).toContain("revision");
    expect(lifecycle).toContain("maximum_inbound_depth");
  });

  it("persists every exact deterministic merge before and after field without JSON authority", () => {
    const columns = getTableConfig(inboxV2ClientMergeRedirects).columns.map(
      (column) => column.name
    );

    for (const prefix of [
      "source_before",
      "target_before",
      "source_after",
      "target_after"
    ]) {
      for (const suffix of [
        "state",
        "next_client_id",
        "redirect_id",
        "maximum_inbound_depth",
        "revision",
        "last_graph_revision",
        "updated_at"
      ]) {
        expect(columns).toContain(`${prefix}_${suffix}`);
      }
    }
    expect(columns).toEqual(
      expect.arrayContaining([
        "expected_graph_revision",
        "current_graph_revision",
        "resulting_graph_revision",
        "head_before_updated_at",
        "head_after_updated_at",
        "resolver_trusted_service_id",
        "resolved_at"
      ])
    );
    expect(columns.some((column) => column.includes("json"))).toBe(false);
    expect(columns).not.toContain("payload");
  });

  it("enforces exact head CAS, root-to-root depth induction and actor provenance", () => {
    const cas = checkSql(
      inboxV2ClientMergeRedirects,
      "inbox_v2_client_merge_redirects_graph_cas_check"
    );
    const depth = checkSql(
      inboxV2ClientMergeRedirects,
      "inbox_v2_client_merge_redirects_depth_check"
    );
    const actor = checkSql(
      inboxV2ClientMergeRedirects,
      "inbox_v2_client_merge_redirects_actor_xor_check"
    );
    const catalogs = checkSql(
      inboxV2ClientMergeRedirects,
      "inbox_v2_client_merge_redirects_catalog_ids_check"
    );
    const after = checkSql(
      inboxV2ClientMergeRedirects,
      "inbox_v2_client_merge_redirects_after_shape_check"
    );

    expect(cas).toContain("is not distinct from");
    expect(cas).toContain("+ 1");
    expect(depth).toContain("greatest");
    expect(depth).toContain("between 0 and 63");
    expect(depth).toContain("between 1 and 64");
    expect(actor).toContain("trusted_service");
    expect(actor).toContain("migration_service");
    expect(actor).toContain("resolver_trusted_service_id");
    expect(catalogs).toContain("char_length");
    expect(catalogs).toContain("<= 256");
    expect(catalogs).toContain("<= 80");
    expect(catalogs).toContain("<= 160");
    expect(catalogs).toContain("not in");
    expect(catalogs).toContain("platform");
    expect(after).toContain("source_after_redirect_id");
    expect(after).toContain("target_after_last_graph_revision");
  });

  it("keeps graph revisions and redirected sources unique and all access indexes tenant-leading", () => {
    expect(
      uniqueColumns(
        inboxV2ClientMergeRedirects,
        "inbox_v2_client_merge_redirects_graph_revision_unique"
      )
    ).toEqual(["tenant_id", "resulting_graph_revision"]);
    expect(
      uniqueColumns(
        inboxV2ClientMergeRedirects,
        "inbox_v2_client_merge_redirects_source_root_unique"
      )
    ).toEqual(["tenant_id", "source_root_client_id"]);

    for (const table of [
      inboxV2ClientMergeGraphHeads,
      inboxV2ClientMergeNodeStates,
      inboxV2ClientMergeRedirects
    ]) {
      const indexes = getTableConfig(table).indexes;
      expect(indexes.length).toBeGreaterThan(0);
      for (const tableIndex of indexes) {
        expect(indexColumnName(tableIndex.config.columns[0])).toBe("tenant_id");
      }
    }
  });

  it("exports safe backfill, head-first locks and deferred exact commit coherence", () => {
    const invariantSql = INBOX_V2_CLIENT_MERGE_INTEGRITY_SQL;
    const functions = invariantSql.match(
      /create or replace function public\./g
    );
    const safeSearchPaths = invariantSql.match(
      /set search_path = pg_catalog, public, pg_temp/g
    );

    expect(invariantSql).toContain(
      "insert into public.inbox_v2_client_merge_graph_heads"
    );
    expect(invariantSql).toContain(
      "insert into public.inbox_v2_client_merge_node_states"
    );
    expect(invariantSql).toMatch(
      /client_merge_guard_redirect_insert[\s\S]*?client_merge_graph_heads[\s\S]*?for update[\s\S]*?order by node_row\.client_id collate "C"[\s\S]*?for update/s
    );
    expect(invariantSql).toContain("inbox_v2_assert_client_merge_commit");
    expect(invariantSql).toContain("inbox_v2.client_merge_node_missing");
    expect(invariantSql).toContain("inbox_v2.client_merge_head_missing");
    expect(invariantSql).toMatch(
      /create trigger inbox_v2_tenants_client_merge_head_bootstrap_trigger\s+after insert on public\.tenants/s
    );
    expect(invariantSql).toMatch(
      /create trigger inbox_v2_clients_merge_node_bootstrap_trigger\s+after insert on public\.clients/s
    );
    expect(invariantSql).toContain(
      "public.inbox_v2_client_merge_bootstrap_tenant_head"
    );
    expect(invariantSql).toContain(
      "public.inbox_v2_client_merge_bootstrap_client_node"
    );
    expect(invariantSql).toMatch(
      /create trigger inbox_v2_client_merge_redirects_immutable_trigger\s+before update or delete/s
    );
    expect(invariantSql).toMatch(
      /tg_op = 'DELETE'[\s\S]*?tg_table_name = 'inbox_v2_client_merge_redirects'[\s\S]*?not exists \([\s\S]*?from public\.tenants/s
    );
    expect(invariantSql).not.toContain(
      "inbox_v2_client_merge_node_states_delete_guard_trigger"
    );
    expect(invariantSql).toMatch(
      /create constraint trigger inbox_v2_client_merge_node_states_constraint_trigger\s+after insert or update or delete on public\.inbox_v2_client_merge_node_states\s+deferrable initially deferred/s
    );
    expect(invariantSql).not.toMatch(
      /create trigger inbox_v2_client_merge_node_states[^\n]*delete[^\n]*\s+before delete/s
    );
    expect(invariantSql).not.toContain(
      "inbox_v2_client_merge_graph_heads_delete_guard_trigger"
    );
    expect(functions?.length).toBeGreaterThanOrEqual(8);
    expect(safeSearchPaths).toHaveLength(functions?.length ?? 0);
    expect(
      invariantSql.match(/create constraint trigger/g)?.length
    ).toBeGreaterThanOrEqual(5);
    expect(
      invariantSql.match(/deferrable initially deferred/g)?.length
    ).toBeGreaterThanOrEqual(5);
    expect(invariantSql).not.toMatch(
      /\b(?:from|join|update|insert into|delete from)\s+inbox_v2_/
    );
    expect(invariantSql).not.toMatch(/\bperform\s+inbox_v2_/);
    expect(invariantSql).not.toMatch(/\bexecute function\s+inbox_v2_/);
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
  if (!constraint) throw new Error(`Missing expected unique: ${name}`);
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
  const constraint = getTableConfig(table).checks.find(
    (candidate) => candidate.name === name
  );
  if (!constraint) throw new Error(`Missing expected check: ${name}`);
  return new PgDialect().sqlToQuery(constraint.value).sql;
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
