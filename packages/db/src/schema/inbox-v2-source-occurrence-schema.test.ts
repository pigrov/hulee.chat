import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { inboxV2ExternalThreads } from "./inbox-v2/external-thread";
import { inboxV2SourceExternalIdentities } from "./inbox-v2/identity-foundation";
import {
  INBOX_V2_SOURCE_OCCURRENCE_INTEGRITY_SQL,
  inboxV2SourceOccurrenceOriginKind,
  inboxV2SourceOccurrenceProviderReferences,
  inboxV2SourceOccurrenceProviderTimestamps,
  inboxV2SourceOccurrences
} from "./inbox-v2/source-occurrence";
import {
  inboxV2SourceThreadBindingSnapshots,
  inboxV2SourceThreadBindings
} from "./inbox-v2/source-thread-binding";
import {
  inboxV2Conversations,
  normalizedInboundEvents,
  rawInboundEvents,
  sourceAccounts
} from "./tables";

describe("Inbox V2 SourceOccurrence foundation schema", () => {
  it("persists one immutable occurrence and two bounded child collections", () => {
    expect(getTableConfig(inboxV2SourceOccurrences).name).toBe(
      "inbox_v2_source_occurrences"
    );
    expect(getTableConfig(inboxV2SourceOccurrenceProviderReferences).name).toBe(
      "inbox_v2_source_occurrence_provider_references"
    );
    expect(getTableConfig(inboxV2SourceOccurrenceProviderTimestamps).name).toBe(
      "inbox_v2_source_occurrence_provider_timestamps"
    );

    expect(primaryKeyColumns(inboxV2SourceOccurrences)).toEqual([
      ["tenant_id", "id"]
    ]);
    expect(
      primaryKeyColumns(inboxV2SourceOccurrenceProviderReferences)
    ).toEqual([["tenant_id", "source_occurrence_id", "ordinal"]]);
    expect(
      primaryKeyColumns(inboxV2SourceOccurrenceProviderTimestamps)
    ).toEqual([["tenant_id", "source_occurrence_id", "ordinal"]]);
  });

  it("separates event-backed echoes from exact provider-response attempts", () => {
    expect(inboxV2SourceOccurrenceOriginKind.enumValues).toEqual([
      "webhook",
      "stream",
      "poll",
      "history",
      "provider_echo",
      "provider_response"
    ]);

    const origin = checkSql(
      inboxV2SourceOccurrences,
      "inbox_v2_source_occurrences_origin_check"
    );
    expect(origin).toContain("provider_echo");
    expect(origin).toContain("provider_response");
    expect(origin).toContain("outbound_dispatch_attempt_id");
    expect(origin).toContain("direction");

    const resolution = checkSql(
      inboxV2SourceOccurrences,
      "inbox_v2_source_occurrences_resolution_check"
    );
    expect(resolution).toContain("= 'pending'");
    expect(resolution).toContain("= 'resolved'");
    expect(resolution).toContain("= 'conflicted'");
    expect(resolution).toContain("resolution_candidate_count");
    expect(resolution).toContain("between 2 and 100");
    expect(resolution).toContain("coalesce");
  });

  it("pins exact mapping, binding snapshot, event pair and provider actor", () => {
    expect(
      uniqueColumns(
        inboxV2SourceOccurrences,
        "inbox_v2_source_occurrences_actor_evidence_unique"
      )
    ).toEqual([
      "tenant_id",
      "id",
      "provider_actor_source_external_identity_id"
    ]);
    expectForeignKey(
      inboxV2SourceOccurrences,
      "inbox_v2_source_occurrences_thread_mapping_fk",
      inboxV2ExternalThreads,
      [
        "tenant_id",
        "external_thread_id",
        "conversation_id",
        "external_thread_revision"
      ],
      ["tenant_id", "id", "conversation_id", "revision"]
    );
    expectForeignKey(
      inboxV2SourceOccurrences,
      "inbox_v2_source_occurrences_conversation_fk",
      inboxV2Conversations,
      ["tenant_id", "conversation_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2SourceOccurrences,
      "inbox_v2_source_occurrences_binding_edge_fk",
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
      inboxV2SourceOccurrences,
      "inbox_v2_source_occurrences_binding_snapshot_fk",
      inboxV2SourceThreadBindingSnapshots,
      ["tenant_id", "source_thread_binding_id", "binding_revision"],
      ["tenant_id", "binding_id", "revision"]
    );
    expectForeignKey(
      inboxV2SourceOccurrences,
      "inbox_v2_source_occurrences_account_edge_fk",
      sourceAccounts,
      ["tenant_id", "source_account_id", "source_connection_id"],
      ["tenant_id", "id", "source_connection_id"]
    );
    expectForeignKey(
      inboxV2SourceOccurrences,
      "inbox_v2_source_occurrences_raw_connection_fk",
      rawInboundEvents,
      ["tenant_id", "raw_inbound_event_id", "source_connection_id"],
      ["tenant_id", "id", "source_connection_id"]
    );
    expectForeignKey(
      inboxV2SourceOccurrences,
      "inbox_v2_source_occurrences_raw_account_fk",
      rawInboundEvents,
      ["tenant_id", "raw_inbound_event_id", "source_account_id"],
      ["tenant_id", "id", "source_account_id"]
    );
    expectForeignKey(
      inboxV2SourceOccurrences,
      "inbox_v2_source_occurrences_normalized_connection_fk",
      normalizedInboundEvents,
      ["tenant_id", "normalized_inbound_event_id", "source_connection_id"],
      ["tenant_id", "id", "source_connection_id"]
    );
    expectForeignKey(
      inboxV2SourceOccurrences,
      "inbox_v2_source_occurrences_normalized_account_fk",
      normalizedInboundEvents,
      ["tenant_id", "normalized_inbound_event_id", "source_account_id"],
      ["tenant_id", "id", "source_account_id"]
    );
    expectForeignKey(
      inboxV2SourceOccurrences,
      "inbox_v2_source_occurrences_provider_identity_fk",
      inboxV2SourceExternalIdentities,
      ["tenant_id", "provider_actor_source_external_identity_id"],
      ["tenant_id", "id"]
    );
  });

  it("computes the canonical message key digest in PostgreSQL without deduping occurrences", () => {
    const digest = generatedColumnSql(
      inboxV2SourceOccurrences,
      "message_key_digest_sha256"
    );
    expect(digest).toContain("sha256");
    expect(digest).toContain("external-message-key:v1");
    expect(digest).toContain("octet_length");
    expect(digest).toContain("canonical_external_subject");
    expect(digest).toContain("replace");
    expect(digest).toContain("chr(92)");
    expect(digest).toContain("::bytea");
    expect(digest).not.toContain("convert_to");

    expect(
      getTableConfig(inboxV2SourceOccurrences).uniqueConstraints.some(
        (constraint) =>
          constraint.columns.some(
            (column) => column.name === "message_key_digest_sha256"
          )
      )
    ).toBe(false);
  });

  it("normalizes strict message scope, actor, adapter and materialization proofs", () => {
    const scope = checkSql(
      inboxV2SourceOccurrences,
      "inbox_v2_source_occurrences_message_scope_check"
    );
    expect(scope).toContain("provider_thread");
    expect(scope).toContain("source_account");
    expect(scope).toContain("source_thread_binding");
    expect(scope).toContain("authoritative");

    const actor = checkSql(
      inboxV2SourceOccurrences,
      "inbox_v2_source_occurrences_provider_actor_check"
    );
    expect(actor).toContain("source_external_identity");
    expect(actor).toContain("provider_system");
    expect(actor).toContain("direction");
    expect(actor).toContain("coalesce");

    expect(
      checkSql(
        inboxV2SourceOccurrences,
        "inbox_v2_source_occurrences_message_scope_check"
      )
    ).toContain("is true");

    const materialization = checkSql(
      inboxV2SourceOccurrences,
      "inbox_v2_source_occurrences_materialization_check"
    );
    expect(materialization).toContain("materialized_by_trusted_service_id");
    expect(materialization).toContain("adapter_loaded_by_trusted_service_id");
    expect(materialization).toContain("materialization_authorization_token");

    const declaration = checkSql(
      inboxV2SourceOccurrences,
      "inbox_v2_source_occurrences_message_declaration_check"
    );
    expect(declaration).toContain("canonical_external_subject");
    expect(declaration).toContain("between 1 and 1024");
    expect(declaration).toContain("x00");
  });

  it("enforces unique typed child facts and deferred contiguous cardinality", () => {
    expect(
      uniqueColumns(
        inboxV2SourceOccurrenceProviderReferences,
        "inbox_v2_occurrence_provider_references_kind_unique"
      )
    ).toEqual(["tenant_id", "source_occurrence_id", "kind_id"]);
    expect(
      uniqueColumns(
        inboxV2SourceOccurrenceProviderTimestamps,
        "inbox_v2_occurrence_provider_timestamps_kind_unique"
      )
    ).toEqual(["tenant_id", "source_occurrence_id", "kind_id"]);

    const invariantSql = INBOX_V2_SOURCE_OCCURRENCE_INTEGRITY_SQL;
    expect(invariantSql).toContain(
      "create or replace function public.inbox_v2_assert_source_occurrence_children("
    );
    expect(invariantSql).toContain("expected_reference_count - 1");
    expect(invariantSql).toContain("expected_timestamp_count = 0");
    expect(invariantSql).toContain("deferrable initially deferred");
    expect(invariantSql).toContain(
      "create constraint trigger inbox_v2_source_occurrences_children_constraint"
    );
    expect(invariantSql).toContain(
      "inbox_v2.source_occurrence_initial_commit_required"
    );
  });

  it("guards current fences, actor scope and direct mutation in database SQL", () => {
    const invariantSql = INBOX_V2_SOURCE_OCCURRENCE_INTEGRITY_SQL;
    expect(invariantSql.match(/create or replace function/g)).toHaveLength(5);
    expect(
      invariantSql.match(/set search_path = pg_catalog, public, pg_temp/g)
    ).toHaveLength(5);
    expect(invariantSql).not.toMatch(/\b(?:from|join) inbox_v2_/);
    expect(invariantSql).not.toMatch(/execute function inbox_v2_/);

    const guard = functionSql(
      invariantSql,
      "inbox_v2_source_occurrence_guard_insert"
    );
    expect(guard).toContain("from public.inbox_v2_source_thread_binding_heads");
    expect(guard).toContain(
      "from public.inbox_v2_source_thread_binding_snapshots"
    );
    expect(guard).toContain("for share");
    expect(guard).toContain("source_occurrence_initial_resolution_invalid");
    expect(guard).toContain("new.resolution_state <> 'pending'");
    expect(guard).toContain("new.revision <> 1");
    expect(guard).toContain("binding_fence_conflict");
    expect(guard).toContain("account_identity_fence_conflict");
    expect(guard).toContain("source_occurrence_event_pair_mismatch");
    expect(guard).toContain(
      "source_occurrence_provider_response_chain_mismatch"
    );
    expect(guard).toContain("dispatch_row.last_attempt_id = attempt_row.id");
    expect(guard).toContain(
      "route_row.account_generation = head_row.account_generation"
    );
    expect(guard).toContain(
      "route_row.binding_generation = head_row.binding_generation"
    );
    expect(guard).toContain(
      "route_row.remote_access_revision = head_row.remote_access_revision"
    );
    expect(guard).toContain("route_row.administrative_revision =");
    expect(guard).toContain(
      "route_row.capability_revision = head_row.capability_revision"
    );
    expect(guard).toContain("route_row.route_descriptor_revision =");
    expect(guard).toContain("route_row.created_at <= attempt_row.opened_at");
    expect(guard).toContain("attempt_row.opened_at <= new.observed_at");
    expect(guard).toContain("actor_scope_kind = 'provider'");
    expect(guard).toContain("actor_declaration_contract_id");
    expect(guard).toContain("new.adapter_contract_id");
    expect(guard).toContain("actor_declaration_contract_version");
    expect(guard).toContain("new.adapter_contract_version");
    expect(guard).toContain("actor_declaration_surface_id");
    expect(guard).toContain("new.adapter_surface_id");
    expect(guard).toContain("actor_declaration_loaded_by_trusted_service_id");
    expect(guard).toContain("new.adapter_loaded_by_trusted_service_id");
    expect(guard).toContain("actor_declaration_loaded_at > new.recorded_at");
    expect(guard).toContain("actor_materialized_at > new.recorded_at");
    expect(guard).toContain("and not (");
    expect(guard).toContain("actor_stability_kind = 'observation_ephemeral'");
    expect(guard).toContain("actor_ephemeral_raw_event_id");
    expect(guard).toContain("actor_ephemeral_normalized_event_id");
    expect(guard).toContain("head_row.created_at > new.recorded_at");
    expect(guard).toContain("snapshot_row.updated_at > new.recorded_at");
    expect(guard).not.toContain("snapshot_row.capability_declaration_revision");
    expect(guard).not.toContain("{adapterContract,declarationRevision}");

    expect(invariantSql).toContain(
      "create trigger inbox_v2_source_occurrences_immutable_trigger"
    );
    expect(invariantSql).toContain(
      "create trigger inbox_v2_source_occurrences_resolution_update_guard_trigger"
    );
    expect(invariantSql).toContain(
      "inbox_v2.source_occurrence_resolution_cas_conflict"
    );
    const resolutionGuard = functionSql(
      invariantSql,
      "inbox_v2_source_occurrence_guard_resolution_update"
    );
    expect(resolutionGuard.match(/'message_scope_owner_key'/gu)).toHaveLength(
      2
    );
    expect(resolutionGuard.match(/'message_key_digest_sha256'/gu)).toHaveLength(
      2
    );
    expect(invariantSql).toContain(
      "create trigger inbox_v2_occurrence_provider_references_immutable_trigger"
    );
    expect(invariantSql).toContain(
      "create trigger inbox_v2_occurrence_provider_timestamps_immutable_trigger"
    );
  });

  it("keeps every explicit access index tenant-leading", () => {
    for (const table of [
      inboxV2SourceOccurrences,
      inboxV2SourceOccurrenceProviderReferences,
      inboxV2SourceOccurrenceProviderTimestamps
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
