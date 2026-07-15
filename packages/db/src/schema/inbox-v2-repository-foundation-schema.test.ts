import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  INBOX_V2_REPOSITORY_FOUNDATION_INTEGRITY_SQL,
  inboxV2OutboxOutcomes,
  inboxV2OutboxWorkItems,
  inboxV2ProjectionCheckpoints,
  inboxV2ProjectionGenerations,
  inboxV2ProjectionHeads,
  inboxV2TenantStreamRetentionAdvances
} from "./inbox-v2/repository-foundation";

const tables = [
  inboxV2ProjectionGenerations,
  inboxV2ProjectionHeads,
  inboxV2ProjectionCheckpoints,
  inboxV2OutboxWorkItems,
  inboxV2OutboxOutcomes,
  inboxV2TenantStreamRetentionAdvances
] as const;

describe("Inbox V2 repository persistence foundation schema", () => {
  it("owns six tenant-prefixed projection, outbox and retention tables", () => {
    expect(tables.map((table) => getTableConfig(table).name)).toEqual([
      "inbox_v2_projection_generations",
      "inbox_v2_projection_heads",
      "inbox_v2_projection_checkpoints",
      "inbox_v2_outbox_work_items",
      "inbox_v2_outbox_outcomes",
      "inbox_v2_tenant_stream_retention_advances"
    ]);
    for (const table of tables) {
      expect(getTableConfig(table).columns[0]?.name).toBe("tenant_id");
      expect(getTableConfig(table).primaryKeys).toHaveLength(1);
      expect(getTableConfig(table).primaryKeys[0]?.columns[0]?.name).toBe(
        "tenant_id"
      );
    }
  });

  it("keeps every child relation composite and same-tenant", () => {
    for (const table of tables) {
      for (const relation of getTableConfig(table).foreignKeys) {
        const reference = relation.reference();
        if (reference.columns.some((column) => column.name !== "tenant_id")) {
          expect(reference.columns[0]?.name).toBe("tenant_id");
          expect(reference.foreignColumns[0]?.name).toBe("tenant_id");
        }
      }
    }
    expect(foreignKeyColumns(inboxV2OutboxWorkItems)).toContainEqual({
      local: ["tenant_id", "intent_id"],
      foreign: ["tenant_id", "id"]
    });
    expect(foreignKeyColumns(inboxV2ProjectionCheckpoints)).toContainEqual({
      local: [
        "tenant_id",
        "projection_id",
        "scope_id",
        "generation",
        "stream_epoch"
      ],
      foreign: [
        "tenant_id",
        "projection_id",
        "scope_id",
        "generation",
        "stream_epoch"
      ]
    });
    expect(foreignKeyColumns(inboxV2ProjectionCheckpoints)).toContainEqual({
      local: ["tenant_id", "last_commit_id", "stream_epoch", "position"],
      foreign: ["tenant_id", "id", "stream_epoch", "position"]
    });
  });

  it("has reviewed worker indexes for catch-up, due, reclaim and dead paths", () => {
    expect(indexNames(inboxV2ProjectionGenerations)).toEqual(
      expect.arrayContaining([
        "inbox_v2_projection_generations_current_unique",
        "inbox_v2_projection_generations_worker_idx"
      ])
    );
    expect(indexNames(inboxV2OutboxWorkItems)).toEqual(
      expect.arrayContaining([
        "inbox_v2_outbox_work_items_due_idx",
        "inbox_v2_outbox_work_items_reclaim_idx",
        "inbox_v2_outbox_work_items_dead_idx",
        "inbox_v2_outbox_work_items_lease_token_unique"
      ])
    );
    expect(
      indexSql(inboxV2OutboxWorkItems, "inbox_v2_outbox_work_items_due_idx")
    ).toMatch(/where .*"state" = 'pending'/u);
    expect(
      indexSql(inboxV2OutboxWorkItems, "inbox_v2_outbox_work_items_reclaim_idx")
    ).toMatch(/where .*"state" = 'leased'/u);
  });

  it("permits a nonzero bootstrap checkpoint without inventing a commit id", () => {
    const valuesCheck = getTableConfig(
      inboxV2ProjectionCheckpoints
    ).checks.find(
      (candidate) =>
        candidate.name === "inbox_v2_projection_checkpoints_values_check"
    );
    if (!valuesCheck)
      throw new Error("Missing projection checkpoint values check.");
    const rendered = new PgDialect()
      .sqlToQuery(valuesCheck.value)
      .sql.replace(/\s+/gu, " ");
    expect(rendered).toContain(
      '"position" > 0 or "inbox_v2_projection_checkpoints"."last_commit_id" is null'
    );
    expect(rendered).not.toContain('"position" > 0 and char_length');
  });

  it("never records a retained prefix beyond the mandatory checkpoint floor", () => {
    const valuesCheck = getTableConfig(
      inboxV2TenantStreamRetentionAdvances
    ).checks.find(
      (candidate) =>
        candidate.name === "inbox_v2_tenant_stream_retention_values_check"
    );
    if (!valuesCheck) throw new Error("Missing stream-retention values check.");
    const rendered = new PgDialect()
      .sqlToQuery(valuesCheck.value)
      .sql.replace(/\s+/gu, " ");
    expect(rendered).toContain(
      '"to_position" <= "inbox_v2_tenant_stream_retention_advances"."mandatory_checkpoint_floor"'
    );
    expect(rendered).not.toContain('"mandatory_checkpoint_floor" +');
  });

  it("separates immutable intent/outcome from mutable fenced work state", () => {
    const workColumns = getTableConfig(inboxV2OutboxWorkItems).columns.map(
      (column) => column.name
    );
    const outcomeColumns = getTableConfig(inboxV2OutboxOutcomes).columns.map(
      (column) => column.name
    );
    expect(workColumns).toEqual(
      expect.arrayContaining([
        "state",
        "attempt_count",
        "lease_owner_id",
        "lease_token_hash",
        "lease_revision",
        "lease_expires_at",
        "revision"
      ])
    );
    expect(outcomeColumns).toEqual(
      expect.arrayContaining([
        "outcome_revision",
        "kind",
        "lease_token_hash",
        "outcome_hash"
      ])
    );
    expect(workColumns).not.toContain("lease_token");
    expect(outcomeColumns).not.toContain("lease_token");
  });

  it("installs contiguous checkpoint and token-fenced work guards", () => {
    expect(INBOX_V2_REPOSITORY_FOUNDATION_INTEGRITY_SQL).toContain(
      "new.last_position = old.last_position"
    );
    expect(INBOX_V2_REPOSITORY_FOUNDATION_INTEGRITY_SQL).toContain(
      "new.min_retained_position > old.min_retained_position"
    );
    expect(INBOX_V2_REPOSITORY_FOUNDATION_INTEGRITY_SQL).toContain(
      "new.position <> old.position + 1"
    );
    expect(INBOX_V2_REPOSITORY_FOUNDATION_INTEGRITY_SQL).toContain(
      "inbox_v2.projection_checkpoint_gap"
    );
    expect(INBOX_V2_REPOSITORY_FOUNDATION_INTEGRITY_SQL).toContain(
      "old.lease_expires_at <= new.updated_at"
    );
    expect(INBOX_V2_REPOSITORY_FOUNDATION_INTEGRITY_SQL).toContain(
      "new.lease_token_hash is distinct from old.lease_token_hash"
    );
    expect(INBOX_V2_REPOSITORY_FOUNDATION_INTEGRITY_SQL).toContain(
      "inbox_v2_tenant_stream_retention_advance_immutable_trigger"
    );
    expect(INBOX_V2_REPOSITORY_FOUNDATION_INTEGRITY_SQL).toContain(
      "inbox_v2_projection_head_generation_coherence_trigger"
    );
    expect(INBOX_V2_REPOSITORY_FOUNDATION_INTEGRITY_SQL).toContain(
      "generation_row.projection_schema_version ="
    );
    expect(INBOX_V2_REPOSITORY_FOUNDATION_INTEGRITY_SQL).toContain(
      "inbox_v2_projection_checkpoint_generation_coherence_trigger"
    );
    expect(INBOX_V2_REPOSITORY_FOUNDATION_INTEGRITY_SQL).toContain(
      "after insert on public.inbox_v2_outbox_intents"
    );
    expect(INBOX_V2_REPOSITORY_FOUNDATION_INTEGRITY_SQL).not.toContain(
      "lease_token text"
    );
    expect(INBOX_V2_REPOSITORY_FOUNDATION_INTEGRITY_SQL).toContain(
      "new.lease_expires_at < old.lease_expires_at"
    );
    expect(INBOX_V2_REPOSITORY_FOUNDATION_INTEGRITY_SQL).not.toContain(
      "new.lease_expires_at <= old.lease_expires_at"
    );
  });

  it("owns the complete tenant-stream prune transition behind one definer", () => {
    const sql = INBOX_V2_REPOSITORY_FOUNDATION_INTEGRITY_SQL;
    const matches = [
      ...sql.matchAll(
        /create or replace function public\.inbox_v2_advance_tenant_stream_retained_prefix_v1\([\s\S]*?as \$function\$([\s\S]*?)\$function\$;/gu
      )
    ];
    expect(matches).toHaveLength(1);
    const functionBody = matches[0]?.[1] ?? "";
    expect(matches[0]?.[0]).toContain("security definer");
    expect(functionBody).toContain("for update;");
    expect(functionBody).toContain("v_commit_count <> v_expected_commit_count");
    expect(functionBody).toContain(
      "v_db_now timestamptz := pg_catalog.clock_timestamp()"
    );
    expect(functionBody).toContain(
      "inbox_v2.retained_prefix_changed_at_future"
    );
    expect(functionBody).toContain("inbox_v2.retained_prefix_changed_at_stale");
    expect(functionBody).toContain("updated_at = checked_changed_at");
    expect(functionBody).toContain(
      "v_deleted_change_count <> v_expected_change_count"
    );
    expect(functionBody).toContain("inbox_v2.retained_prefix_outbox_inflight");
    expect(functionBody).toContain(
      "checked_mandatory_checkpoint_floor > v_persisted_checkpoint_floor"
    );
    expect(functionBody).toContain(
      "delete from public.inbox_v2_outbox_outcomes"
    );
    expect(functionBody).toContain(
      "delete from public.inbox_v2_outbox_work_items"
    );
    expect(functionBody).toContain(
      "delete from public.inbox_v2_outbox_intents"
    );
    expect(functionBody).toContain("delete from public.inbox_v2_domain_events");
    expect(functionBody).toContain(
      "delete from public.inbox_v2_tenant_stream_changes"
    );
    expect(functionBody).not.toContain(
      "delete from public.inbox_v2_tenant_stream_commits"
    );
    expect(functionBody).toContain(
      "update public.inbox_v2_tenant_stream_heads"
    );
    expect(functionBody).toContain(
      "insert into public.inbox_v2_tenant_stream_retention_advances"
    );
  });

  it("isolates prune authority and preserves tenant-cascade cleanup", () => {
    const sql = INBOX_V2_REPOSITORY_FOUNDATION_INTEGRITY_SQL;
    expect(sql).toContain("create role hulee_inbox_v2_retention_owner");
    expect(sql).toContain("owner to hulee_inbox_v2_retention_owner");
    expect(sql).toContain(
      "from public;\n\n" +
        "grant execute on function\n" +
        "  public.inbox_v2_advance_tenant_stream_retained_prefix_v1"
    );
    expect(sql).toContain("to hulee_inbox_v2_runtime;");
    expect(sql).toContain("retention_owner_role_must_not_be_inherited");
    expect(sql).toContain("retention_direct_delete_boundary_invalid");
    expect(sql).toContain(
      "tg_op = 'DELETE' and not exists (\n" +
        "    select 1 from public.tenants tenant_row where tenant_row.id = old.tenant_id"
    );
  });
});

function foreignKeyColumns(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).foreignKeys.map((relation) => {
    const reference = relation.reference();
    return {
      local: reference.columns.map((column) => column.name),
      foreign: reference.foreignColumns.map((column) => column.name)
    };
  });
}

function indexNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table)
    .indexes.map((tableIndex) => tableIndex.config.name)
    .filter((name): name is string => name !== undefined);
}

function indexSql(
  table: Parameters<typeof getTableConfig>[0],
  name: string
): string {
  const tableIndex = getTableConfig(table).indexes.find(
    (candidate) => candidate.config.name === name
  );
  if (tableIndex === undefined) {
    throw new Error(`Missing index ${name}.`);
  }
  const dialect = new PgDialect();
  const where = tableIndex.config.where
    ? ` where ${dialect.sqlToQuery(tableIndex.config.where).sql}`
    : "";
  return where.replace(/\s+/gu, " ").trim();
}
