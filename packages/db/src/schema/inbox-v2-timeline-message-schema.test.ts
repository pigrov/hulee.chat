import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  INBOX_V2_TIMELINE_MESSAGE_INVARIANTS_SQL,
  inboxV2ActionAttributions,
  inboxV2MessageAttachmentAnchors,
  inboxV2MessageDeliveryObservations,
  inboxV2MessageTransportFactCommits,
  inboxV2MessageProviderLifecycleOperations,
  inboxV2MessageProviderLifecycleTransitions,
  inboxV2MessageProviderReactionObservations,
  inboxV2MessageReactionSlotHeads,
  inboxV2MessageReactions,
  inboxV2MessageReactionTransitions,
  inboxV2MessageReferenceCanonicalTargets,
  inboxV2MessageReferenceContexts,
  inboxV2MessageReferenceExternalTargets,
  inboxV2MessageReferenceUnresolvedCandidates,
  inboxV2MessageReferenceUnresolvedTargets,
  inboxV2MessageRevisions,
  inboxV2Messages,
  inboxV2MessageTransportLinkHeads,
  inboxV2MessageTransportOccurrenceLinks,
  inboxV2OutboundRouteConsumptions,
  inboxV2ProviderReceiptObservations,
  inboxV2ProviderReceiptOpaquePayloads,
  inboxV2StaffNoteRevisions,
  inboxV2StaffNotes,
  inboxV2TimelineContentContactValues,
  inboxV2TimelineContentPayloads,
  inboxV2TimelineContentRevisions,
  inboxV2TimelineContents,
  inboxV2TimelineItems,
  inboxV2TimelineSubjectDetails
} from "./inbox-v2/timeline-message";
import { inboxV2ExternalMessageReferences } from "./inbox-v2/outbound-transport";
import {
  INBOX_V2_PROVIDER_SEMANTIC_ORDERING_INVARIANTS_SQL,
  inboxV2ProviderSemanticOrderingHeads
} from "./inbox-v2/provider-semantic-ordering";
import { inboxV2SourceThreadBindings } from "./inbox-v2/source-thread-binding";
import { initialTables } from "./metadata";
import { normalizedInboundEvents, sourceAccounts } from "./tables";

describe("Inbox V2 timeline and Message schema", () => {
  it("registers all 31 tenant-scoped DB005 relations", () => {
    expect(
      timelineMessageTables.map((table) => getTableConfig(table).name)
    ).toEqual(expectedTableNames);

    const metadata = new Map<string, (typeof initialTables)[number]>(
      initialTables.map((definition) => [definition.name, definition])
    );
    for (const table of timelineMessageTables) {
      const config = getTableConfig(table);
      expect(primaryKeyColumns(table)[0]?.[0]).toBe("tenant_id");
      expect(metadata.get(config.name)).toMatchObject({
        scope: "tenant",
        requiresTenantId: true
      });
      expect(config.indexes.length).toBeGreaterThan(0);
      for (const tableIndex of config.indexes) {
        expect(indexColumnName(tableIndex.config.columns[0])).toBe("tenant_id");
      }
      for (const foreignKey of config.foreignKeys) {
        const reference = foreignKey.reference();
        expect(reference.columns[0]?.name).toBe("tenant_id");
        expect(reference.foreignColumns[0]?.name).toBe(
          getTableConfig(reference.foreignTable).name === "tenants"
            ? "id"
            : "tenant_id"
        );
      }
    }
  });

  it("indexes only retention-eligible content by tenant, class and anchor", () => {
    const tableIndex = getTableConfig(inboxV2TimelineContents).indexes.find(
      (candidate) =>
        candidate.config.name ===
        "inbox_v2_timeline_contents_retention_eligible_idx"
    );
    expect(tableIndex?.config.columns.map(indexColumnName)).toEqual([
      "tenant_id",
      "data_class_id",
      "retention_anchor_at",
      "id"
    ]);
    if (!tableIndex?.config.where) {
      throw new Error("Missing retention-eligible index predicate.");
    }
    expect(new PgDialect().sqlToQuery(tableIndex.config.where).sql).toContain(
      `"state" = 'available'`
    );
  });

  it("indexes the latest eligible Conversation activity without scanning non-activity tails", () => {
    const tableIndex = getTableConfig(inboxV2TimelineItems).indexes.find(
      (candidate) =>
        candidate.config.name ===
        "inbox_v2_timeline_items_eligible_activity_tail_idx"
    );
    expect(tableIndex?.config.columns.map(indexColumnName)).toEqual([
      "tenant_id",
      "conversation_id",
      "timeline_sequence",
      "id",
      "occurred_at"
    ]);
    if (!tableIndex?.config.where) {
      throw new Error("Missing eligible-activity index predicate.");
    }
    expect(new PgDialect().sqlToQuery(tableIndex.config.where).sql).toContain(
      `"activity_kind" = 'eligible'`
    );
  });

  it("keeps ordered TimelineItem and immutable Message authorship canonical", () => {
    expect(
      uniqueColumns(
        inboxV2TimelineItems,
        "inbox_v2_timeline_items_sequence_unique"
      )
    ).toEqual(["tenant_id", "conversation_id", "timeline_sequence"]);
    expectForeignKey(
      inboxV2Messages,
      "inbox_v2_messages_timeline_fk",
      inboxV2TimelineItems,
      ["tenant_id", "timeline_item_id", "conversation_id"],
      ["tenant_id", "id", "conversation_id"]
    );
    expectForeignKey(
      inboxV2Messages,
      "inbox_v2_messages_content_fk",
      inboxV2TimelineContents,
      ["tenant_id", "content_id", "content_revision", "content_state"],
      ["tenant_id", "id", "revision", "state"]
    );
    expectForeignKey(
      inboxV2Messages,
      "inbox_v2_messages_attribution_fk",
      inboxV2ActionAttributions,
      ["tenant_id", "creation_attribution_id", "conversation_id"],
      ["tenant_id", "id", "conversation_id"]
    );

    const messageColumns = columnNames(inboxV2Messages);
    expect(messageColumns).toContain("author_participant_id");
    expect(messageColumns).toContain("creation_attribution_id");
    expect(messageColumns).toContain("origin_kind");
    expect(messageColumns).not.toContain("snapshot");
  });

  it("separates purgeable content and receipt opaque values from durable facts", () => {
    for (const table of genericFactAndRevisionTables) {
      expect(jsonColumnNames(table)).toEqual([]);
    }
    expect(columnNames(inboxV2TimelineContentRevisions)).not.toContain(
      "content_digest_sha256"
    );
    expect(columnNames(inboxV2TimelineContentPayloads)).toEqual(
      expect.arrayContaining([
        "text_value",
        "attachment_file_id",
        "latitude",
        "unsupported_source_occurrence_id"
      ])
    );
    expect(columnNames(inboxV2TimelineContentContactValues)).toEqual(
      expect.arrayContaining(["kind", "value", "label"])
    );

    const receiptColumns = getTableConfig(
      inboxV2ProviderReceiptObservations
    ).columns;
    expect(
      receiptColumns.find((column) => column.name === "opaque_payload_id")
        ?.notNull
    ).toBe(false);
    expect(
      receiptColumns.find((column) => column.name === "opaque_data_class_id")
        ?.notNull
    ).toBe(false);
    expect(columnNames(inboxV2ProviderReceiptObservations)).not.toContain(
      "provider_watermark"
    );
    expect(columnNames(inboxV2ProviderReceiptOpaquePayloads)).toEqual(
      expect.arrayContaining(["provider_watermark", "reader_aggregate_key"])
    );

    const receiptShape = checkSql(
      inboxV2ProviderReceiptObservations,
      "inbox_v2_provider_receipt_observations_clock_check"
    );
    expect(receiptShape).toContain("provider_receipt_opaque_payload:");
    expect(receiptShape).toContain(
      "core:source_occurrence_and_external_reference"
    );
    expect(receiptShape).toContain("opaque_payload_id");
  });

  it("persists a single-use route ledger and lossless lifecycle induction proof", () => {
    expect(
      uniqueColumns(
        inboxV2OutboundRouteConsumptions,
        "inbox_v2_outbound_route_consumptions_route_unique"
      )
    ).toEqual(["tenant_id", "outbound_route_id"]);
    expect(
      uniqueColumns(
        inboxV2OutboundRouteConsumptions,
        "inbox_v2_outbound_route_consumptions_consumer_unique"
      )
    ).toEqual(["tenant_id", "consumer_kind", "consumer_id"]);
    const routeShape = checkSql(
      inboxV2OutboundRouteConsumptions,
      "inbox_v2_outbound_route_consumptions_shape_check"
    );
    expect(routeShape).toContain("outbound_route_consumption:");
    expect(routeShape).toContain("message_provider_lifecycle_operation:");
    expect(routeShape).toContain("message_reaction_transition:");
    expect(routeShape).toContain("commit_digest_sha256");

    expect(jsonColumnNames(inboxV2MessageProviderLifecycleOperations)).toEqual([
      "provider_semantic_proof_detail",
      "semantic_ordering_commit_detail"
    ]);
    const initialState = checkSql(
      inboxV2MessageProviderLifecycleOperations,
      "inbox_v2_provider_lifecycle_initial_state_check"
    );
    expect(initialState).toContain("initial_outcome");
    expect(initialState).toContain("revision");
    expect(initialState).toContain("is not distinct from");

    const semanticProof = checkSql(
      inboxV2MessageProviderLifecycleOperations,
      "inbox_v2_provider_lifecycle_semantic_proof_check"
    );
    expect(semanticProof).toContain("normalizedInboundEvent");
    expect(semanticProof).toContain("monotonic_exact");
    expect(semanticProof).toContain("core:message.lifecycle");
    expect(semanticProof).toContain("pg_column_size");
    expect(semanticProof).toContain("semantic_ordering_commit_digest_sha256");
  });

  it("materializes one typed provider semantic ordering head shared by consumers", () => {
    expect(primaryKeyColumns(inboxV2ProviderSemanticOrderingHeads)).toEqual([
      ["tenant_id", "external_message_reference_id", "semantic_family_id"]
    ]);
    expectForeignKey(
      inboxV2ProviderSemanticOrderingHeads,
      "inbox_v2_provider_semantic_ordering_heads_reference_fk",
      inboxV2ExternalMessageReferences,
      ["tenant_id", "external_message_reference_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2ProviderSemanticOrderingHeads,
      "inbox_v2_provider_semantic_ordering_heads_account_fk",
      sourceAccounts,
      ["tenant_id", "source_account_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2ProviderSemanticOrderingHeads,
      "inbox_v2_provider_semantic_ordering_heads_binding_fk",
      inboxV2SourceThreadBindings,
      ["tenant_id", "source_thread_binding_id", "source_account_id"],
      ["tenant_id", "id", "source_account_id"]
    );
    expectForeignKey(
      inboxV2ProviderSemanticOrderingHeads,
      "inbox_v2_provider_semantic_ordering_heads_event_fk",
      normalizedInboundEvents,
      ["tenant_id", "normalized_inbound_event_id"],
      ["tenant_id", "id"]
    );
    expect(columnNames(inboxV2ProviderSemanticOrderingHeads)).toEqual(
      expect.arrayContaining([
        "position",
        "head_detail",
        "head_detail_digest_sha256",
        "last_changed_stream_position"
      ])
    );
    expect(
      checkSql(
        inboxV2ProviderSemanticOrderingHeads,
        "inbox_v2_provider_semantic_ordering_heads_detail_check"
      )
    ).toContain("externalMessageReference");

    const guard = sqlFunctionSource(
      INBOX_V2_PROVIDER_SEMANTIC_ORDERING_INVARIANTS_SQL,
      "inbox_v2_tm_provider_semantic_head_guard"
    );
    expect(guard).toContain("new.revision <> old.revision + 1");
    expect(guard).toContain(
      "new.last_changed_stream_position <= old.last_changed_stream_position"
    );
    expect(guard).toContain("char_length(new.position)");
    expect(guard).toContain(
      'new.position collate "C" <= old.position collate "C"'
    );
    expect(
      indexColumns(
        inboxV2MessageProviderLifecycleOperations,
        "inbox_v2_provider_lifecycle_semantic_consumer_idx"
      )
    ).toEqual([
      "tenant_id",
      "external_message_reference_id",
      "provider_semantic_normalized_inbound_event_id",
      "provider_semantic_ordering_position",
      "provider_semantic_proof_token"
    ]);
    expect(
      indexColumns(
        inboxV2MessageProviderReactionObservations,
        "inbox_v2_provider_reaction_semantic_consumer_idx"
      )
    ).toEqual([
      "tenant_id",
      "normalized_inbound_event_id",
      "ordering_position",
      "transition_id"
    ]);
    for (const mutableProvenanceColumn of [
      "source_account_id",
      "source_thread_binding_id",
      "binding_generation"
    ]) {
      expect(guard).not.toContain(`new.${mutableProvenanceColumn}`);
      expect(guard).not.toContain(`old.${mutableProvenanceColumn}`);
    }
    for (const immutableColumn of [
      "scope_token",
      "comparator_id",
      "comparator_revision"
    ]) {
      expect(guard).toContain(`new.${immutableColumn}`);
      expect(guard).toContain(`old.${immutableColumn}`);
    }
  });

  it("serializes delivery and receipt idempotency through one physical ledger", () => {
    expect(
      uniqueColumns(
        inboxV2MessageReactions,
        "inbox_v2_message_reactions_transition_target_unique"
      )
    ).toEqual(["tenant_id", "id", "semantic_slot_key"]);
    expect(primaryKeyColumns(inboxV2MessageTransportFactCommits)).toEqual([
      ["tenant_id", "commit_token"]
    ]);
    expect(
      uniqueColumns(
        inboxV2MessageTransportFactCommits,
        "inbox_v2_message_transport_fact_commits_observation_unique"
      )
    ).toEqual(["tenant_id", "observation_id"]);
    expectForeignKey(
      inboxV2MessageDeliveryObservations,
      "inbox_v2_message_delivery_observations_commit_fk",
      inboxV2MessageTransportFactCommits,
      ["tenant_id", "commit_token"],
      ["tenant_id", "commit_token"]
    );
    expectForeignKey(
      inboxV2ProviderReceiptObservations,
      "inbox_v2_provider_receipt_observations_commit_fk",
      inboxV2MessageTransportFactCommits,
      ["tenant_id", "commit_token"],
      ["tenant_id", "commit_token"]
    );

    const ledgerShape = checkSql(
      inboxV2MessageTransportFactCommits,
      "inbox_v2_message_transport_fact_commits_shape_check"
    );
    expect(ledgerShape).toContain("message_delivery_observation:");
    expect(ledgerShape).toContain("provider_receipt_observation:");
    expect(ledgerShape).toContain("recorded_stream_position");
    expect(
      indexColumns(
        inboxV2MessageTransportFactCommits,
        "inbox_v2_message_transport_fact_commits_message_page_idx"
      )
    ).toEqual([
      "tenant_id",
      "message_id",
      "recorded_at",
      "fact_kind",
      "observation_id"
    ]);
    expect(
      indexColumns(
        inboxV2MessageReactionTransitions,
        "inbox_v2_message_reaction_transitions_snapshot_idx"
      )
    ).toEqual([
      "tenant_id",
      "reaction_id",
      "recorded_stream_position",
      "resulting_revision"
    ]);
  });

  it("closes every retained JSON family recursively without content-shaped scalars", () => {
    const invariantSql = INBOX_V2_TIMELINE_MESSAGE_INVARIANTS_SQL;
    const exactKeys = sqlFunctionSource(
      invariantSql,
      "inbox_v2_tm_json_exact_keys"
    );
    const stringFields = sqlFunctionSource(
      invariantSql,
      "inbox_v2_tm_json_string_fields"
    );
    const family = sqlFunctionSource(
      invariantSql,
      "inbox_v2_tm_json_family_valid"
    );
    const guard = sqlFunctionSource(invariantSql, "inbox_v2_tm_json_guard");

    expect(exactKeys).toContain("document - allowed_keys = '{}'::jsonb");
    expect(stringFields).toContain(
      "jsonb_typeof(document->field_name) is distinct from 'string'"
    );
    expect(family).toContain("document->'adapterContract'");
    expect(family).toContain("document->'ordering'");
    expect(family).toContain("document->'desired'");
    expect(family).toContain("document->'capabilityFence'");
    expect(family).toContain("inbox_v2_tm_json_string_fields");
    expect(family).not.toContain("messageText");

    for (const column of retainedJsonColumns) {
      expect(guard).toContain(`new.${column}`);
    }
    expect(guard.match(/new\.semantic_proof_detail/gu)).toHaveLength(4);
    for (const trigger of jsonGuardTriggers) {
      expect(
        `${invariantSql}\n${INBOX_V2_PROVIDER_SEMANTIC_ORDERING_INVARIANTS_SQL}`
      ).toContain(`create trigger ${trigger}`);
    }
  });

  it("rejects malformed direct-write identifiers at every DB005 ID boundary", () => {
    for (const boundary of directIdBoundaries) {
      const sql = checkSql(boundary.table, boundary.checkName);
      expect(sql).toContain(`^${boundary.prefix}:`);
      expect(sql).toContain("char_length");
    }
  });

  it("keeps row-local constraints query-free and PostgreSQL identifiers bounded", () => {
    const dialect = new PgDialect();
    for (const table of timelineMessageTables) {
      const config = getTableConfig(table);
      for (const constraint of config.checks) {
        expect(dialect.sqlToQuery(constraint.value).sql).not.toMatch(
          /\bselect\b/iu
        );
      }
      for (const name of schemaObjectNames(table)) {
        expect(name.length, name).toBeLessThanOrEqual(63);
      }
    }

    for (const name of [
      ...sqlFunctionNames(INBOX_V2_TIMELINE_MESSAGE_INVARIANTS_SQL),
      ...sqlTriggerNames(INBOX_V2_TIMELINE_MESSAGE_INVARIANTS_SQL),
      ...sqlFunctionNames(INBOX_V2_PROVIDER_SEMANTIC_ORDERING_INVARIANTS_SQL),
      ...sqlTriggerNames(INBOX_V2_PROVIDER_SEMANTIC_ORDERING_INVARIANTS_SQL)
    ]) {
      expect(name.length, name).toBeLessThanOrEqual(63);
    }
  });

  it("targets a real PostgreSQL candidate key from every DB005 foreign key", () => {
    const invalidTargets = timelineMessageTables.flatMap((table) =>
      getTableConfig(table).foreignKeys.flatMap((foreignKey) => {
        const reference = foreignKey.reference();
        const targetColumns = reference.foreignColumns.map(
          (column) => column.name
        );
        const hasCandidateKey = candidateKeyColumns(
          reference.foreignTable
        ).some(
          (columns) =>
            columns.length === targetColumns.length &&
            columns.every((column, index) => column === targetColumns[index])
        );
        return hasCandidateKey
          ? []
          : [
              `${foreignKey.getName()} -> ${getTableConfig(reference.foreignTable).name}(${targetColumns.join(",")})`
            ];
      })
    );

    expect(invalidTargets).toEqual([]);
  });

  it("installs unique, ordered and cascade-safe deferred invariants", () => {
    const invariantSql = INBOX_V2_TIMELINE_MESSAGE_INVARIANTS_SQL;
    const providerInvariantSql =
      INBOX_V2_PROVIDER_SEMANTIC_ORDERING_INVARIANTS_SQL;
    const combinedInvariantSql = `${invariantSql}\n${providerInvariantSql}`;
    const functionNames = sqlFunctionNames(combinedInvariantSql);
    const triggerNames = sqlTriggerNames(combinedInvariantSql);

    expect(functionNames).toEqual([
      "inbox_v2_tm_append_only_guard",
      "inbox_v2_tm_json_string_fields",
      "inbox_v2_tm_json_exact_keys",
      "inbox_v2_tm_json_family_valid",
      "inbox_v2_tm_reaction_value_flat_valid",
      "inbox_v2_tm_reaction_transition_state_valid",
      "inbox_v2_tm_reaction_attribution_row_valid",
      "inbox_v2_tm_reaction_authority_flat_valid",
      "inbox_v2_tm_outbound_route_action_valid",
      "inbox_v2_tm_json_guard",
      "inbox_v2_tm_provider_lifecycle_history_valid",
      "inbox_v2_tm_transport_occurrence_link_valid",
      "inbox_v2_tm_provider_fact_semantic_proof_valid",
      "inbox_v2_tm_action_attribution_valid",
      "inbox_v2_tm_content_history_valid",
      "inbox_v2_tm_message_history_valid",
      "inbox_v2_tm_staff_note_history_valid",
      "inbox_v2_tm_aux_coherence",
      "inbox_v2_tm_payload_guard",
      "inbox_v2_tm_head_guard",
      "inbox_v2_tm_assert_reference_context",
      "inbox_v2_tm_core_coherence",
      "inbox_v2_tm_provider_semantic_head_guard",
      "inbox_v2_tm_provider_semantic_proof_scope_valid",
      "inbox_v2_tm_provider_semantic_consumer_count",
      "inbox_v2_tm_provider_semantic_head_consumer_guard",
      "inbox_v2_tm_provider_semantic_consumer_head_guard"
    ]);
    expect(new Set(functionNames).size).toBe(functionNames.length);
    expect(new Set(triggerNames).size).toBe(triggerNames.length);
    expect(
      sqlFunctionSource(invariantSql, "inbox_v2_tm_staff_note_history_valid")
    ).toContain(
      "content_revision_row.occurred_at =\n                        history_row.recorded_at"
    );
    expect(
      sqlFunctionSource(invariantSql, "inbox_v2_tm_content_history_valid")
    ).toContain(
      "when latest_row.transition_kind in (\n           'privacy_erasure', 'retention_purge'\n         ) then latest_row.event_id"
    );
    expect(
      combinedInvariantSql.match(
        /set search_path = pg_catalog, public, pg_temp/gu
      )
    ).toHaveLength(27);
    for (const block of [invariantSql, providerInvariantSql]) {
      expect(block.lastIndexOf("create or replace function")).toBeLessThan(
        block.indexOf("create trigger")
      );
    }
    expect(invariantSql).toContain("to_jsonb(old)");
    expect(invariantSql).toContain("pg_trigger_depth() > 1");
    expect(invariantSql).toContain("tg_nargs % 3 = 0");
    expect(invariantSql).toContain("parent_key is not null");
    expect(invariantSql).toContain("select 1 from public.tenants tenant_row");
    expect(invariantSql).toContain("deferrable initially deferred");
    expect(invariantSql).toContain(
      "alter constraint inbox_v2_messages_content_fk"
    );
    expect(invariantSql).toContain(
      "alter constraint inbox_v2_staff_notes_content_fk"
    );
    expect(invariantSql).toContain(
      "inbox_v2.outbound_route_consumption_coherence"
    );
    expect(invariantSql).toContain(
      "inbox_v2.message_route_consumption_missing"
    );
    expect(invariantSql).toContain(
      "inbox_v2.reaction_route_consumption_missing"
    );
    expect(invariantSql).toContain(
      "create trigger inbox_v2_tm_route_consumption_append_guard"
    );
    expect(invariantSql).toContain(
      "create constraint trigger inbox_v2_tm_receipt_payload_coherence"
    );
    expect(invariantSql).toContain(
      "create trigger inbox_v2_tm_transport_fact_commit_append_guard"
    );
    expect(invariantSql).toContain(
      "'public.inbox_v2_messages', 'id', 'target_message_id'"
    );
    expect(invariantSql).toContain(
      "'public.inbox_v2_message_transport_fact_commits', 'commit_token', 'commit_token'"
    );
    expect(invariantSql).toContain(
      "create constraint trigger inbox_v2_tm_transport_fact_commit_coherence"
    );
    expect(invariantSql).toContain(
      "inbox_v2.message_transport_fact_commit_coherence"
    );
    expect(invariantSql).toContain(
      "from public.inbox_v2_outbound_dispatch_attempts attempt_row"
    );
    expect(providerInvariantSql).toContain("matching_consumer_count <> 1");
    expect(providerInvariantSql).toContain("matching_head_count <> 1");
    expect(providerInvariantSql).toContain(
      "operation_row.created_stream_position ="
    );
    expect(providerInvariantSql).toContain(
      "transition_row.recorded_stream_position ="
    );
    expect(providerInvariantSql).toContain(
      "operation_row.semantic_ordering_commit_detail -> 'after' ="
    );
    expect(providerInvariantSql).toContain(
      "observation_row.ordering_commit_detail -> 'after' ="
    );
    expect(providerInvariantSql).toContain(
      "inbox_v2_tm_provider_semantic_proof_scope_valid"
    );
    expect(providerInvariantSql).toContain(
      "reference_row.message_id = reaction_row.message_id"
    );
    expect(providerInvariantSql).toContain(
      "transition_row.mode = 'provider_observed'"
    );
    expect(providerInvariantSql).toContain(
      "semantic_family_id = 'core:message.reaction'"
    );
    expect(providerInvariantSql).toContain(
      "transition_row.after_state_detail #>> '{kind}'"
    );
    expect(providerInvariantSql).toContain(
      "participant_row.subject_source_external_identity_id"
    );
    expect(providerInvariantSql).toContain(
      "transition_row.external_authority_detail -> 'adapterContract'"
    );
    expect(providerInvariantSql).toContain(
      "reaction_row.capability_detail #>> '{cardinality}'"
    );
    expect(providerInvariantSql).toContain(
      "semantic_proof_detail #>> '{revision}' = '1'"
    );
    expect(providerInvariantSql).toContain("'^[1-9][0-9]*$'");
    expect(providerInvariantSql).toContain(
      "occurrence_actor_row.provider_actor_source_external_identity_id"
    );
    expect(
      checkSql(
        inboxV2MessageReactions,
        "inbox_v2_message_reactions_capability_check"
      )
    ).toContain('"capability_id" ~ \'^core:');
    expect(
      checkSql(
        inboxV2MessageReactions,
        "inbox_v2_message_reactions_value_check"
      )
    ).toContain('"provider_reaction_kind_id" ~ \'^core:');
    expect(invariantSql).toContain(
      "transition_row.value_kind = reaction_row.value_kind"
    );
    expect(invariantSql).toContain(
      "transition_row.unicode_value is not distinct from"
    );
    expect(invariantSql).toContain("inbox_v2_tm_reaction_value_flat_valid");
    expect(invariantSql).toContain(
      "inbox_v2_tm_reaction_transition_state_valid"
    );
    expect(invariantSql).toContain(
      "inbox_v2_tm_reaction_attribution_row_valid"
    );
    expect(invariantSql).toContain("inbox_v2_tm_reaction_authority_flat_valid");
    expect(invariantSql).toContain("inbox_v2_tm_outbound_route_action_valid");
    expect(invariantSql).toContain(
      "inbox_v2_tm_provider_lifecycle_history_valid"
    );
    expect(invariantSql).toContain(
      "'core:message.reaction.' || new.operation::text || '_external'"
    );
    expect(invariantSql).toContain(
      "when 'forward_provider_native' then\n               'core:message.forward_provider_native_external'"
    );
    expect(invariantSql).toContain(
      "expected_capability_id is null\n         or capability_row.capability_id = expected_capability_id"
    );
    const reactionTransitionClockCheck = checkSql(
      inboxV2MessageReactionTransitions,
      "inbox_v2_message_reaction_transitions_clock_check"
    );
    expect(reactionTransitionClockCheck).toContain(
      "\"mode\" = 'provider_result'"
    );
    expect(reactionTransitionClockCheck).toContain(
      "\"mode\" <> 'provider_result'"
    );
    expect(invariantSql).toContain(
      "new.capability_detail #>> '{cardinality}' = new.cardinality::text"
    );
    expect(invariantSql).toContain("reaction_row.request_attribution_id =");
    expect(invariantSql).toContain(
      "reaction_row.state_detail #>> '{resultDigestSha256}'"
    );
    expect(invariantSql).toContain("predecessor_row.after_state_detail =");
    expect(invariantSql).toContain(
      "chain_row.resulting_revision > op_row.revision"
    );
    expect(invariantSql).toContain("chain_row.expected_revision > 1");
    expect(invariantSql).toContain(
      "transition_row.recorded_stream_position <=\n           predecessor_row.recorded_stream_position"
    );
    expect(invariantSql).toContain(
      "predecessor_row.recorded_at <= chain_row.recorded_at"
    );
    expect(invariantSql).toContain(
      "route_row.created_at = message_row.created_at"
    );
    expect(invariantSql).toContain("inbox_v2.message_reference_self_target");
    expect(invariantSql).toContain(
      "inbox_v2.message_reply_target_conversation_mismatch"
    );
    expect(invariantSql).toContain(
      "reference_row.message_id = canonical_row.target_message_id"
    );
    expect(invariantSql).toContain(
      "inbox_v2.message_creation_dispatch_mismatch"
    );
    expect(invariantSql).toContain("inbox_v2.message_dispatch_coherence");
    expect(invariantSql).toContain(
      "create constraint trigger inbox_v2_tm_outbound_dispatch_coherence"
    );
    expect(invariantSql).toContain(
      "attribution_row.action_participant_id =\n           message_row.author_participant_id"
    );
    expect(invariantSql).toContain(
      "author_row.subject_source_external_identity_id =\n               origin_occurrence_row.provider_actor_source_external_identity_id"
    );
    expect(invariantSql).toContain(
      "author_row.subject_employee_id =\n                   attribution_row.app_actor_employee_id"
    );
    expect(invariantSql).toContain(
      "author_row.subject_kind in ('legacy_unknown', 'system')"
    );
    expect(invariantSql).toContain(
      "'core:message.reaction.' || new.operation::text || '.result'"
    );
    expect(invariantSql).toContain(
      "occurrence_row.adapter_contract_id = op_row.adapter_contract_id"
    );
    expect(providerInvariantSql).toContain(
      "create constraint trigger inbox_v2_tm_provider_semantic_head_consumer_constraint"
    );
    expect(providerInvariantSql).toContain(
      "create constraint trigger inbox_v2_tm_provider_semantic_lifecycle_consumer_constraint\nafter insert on"
    );
    expect(providerInvariantSql).not.toContain(
      "inbox_v2_tm_provider_semantic_lifecycle_consumer_constraint\nafter insert or update"
    );
    expect(providerInvariantSql).toContain(
      "create constraint trigger inbox_v2_tm_provider_semantic_reaction_consumer_constraint"
    );
    expect(providerInvariantSql).toContain("deferrable initially deferred");
    expect(invariantSql).not.toMatch(/\b(?:from|join) inbox_v2_/u);
    expect(invariantSql).not.toMatch(/execute function inbox_v2_/u);
  });
});

const timelineMessageTables = [
  inboxV2ActionAttributions,
  inboxV2MessageAttachmentAnchors,
  inboxV2TimelineContents,
  inboxV2TimelineContentRevisions,
  inboxV2TimelineContentPayloads,
  inboxV2TimelineContentContactValues,
  inboxV2TimelineItems,
  inboxV2TimelineSubjectDetails,
  inboxV2Messages,
  inboxV2MessageRevisions,
  inboxV2MessageReferenceContexts,
  inboxV2MessageReferenceCanonicalTargets,
  inboxV2MessageReferenceExternalTargets,
  inboxV2MessageReferenceUnresolvedTargets,
  inboxV2MessageReferenceUnresolvedCandidates,
  inboxV2StaffNotes,
  inboxV2StaffNoteRevisions,
  inboxV2MessageTransportOccurrenceLinks,
  inboxV2MessageTransportLinkHeads,
  inboxV2OutboundRouteConsumptions,
  inboxV2MessageProviderLifecycleOperations,
  inboxV2MessageProviderLifecycleTransitions,
  inboxV2MessageReactions,
  inboxV2MessageReactionTransitions,
  inboxV2MessageReactionSlotHeads,
  inboxV2MessageProviderReactionObservations,
  inboxV2ProviderSemanticOrderingHeads,
  inboxV2MessageTransportFactCommits,
  inboxV2MessageDeliveryObservations,
  inboxV2ProviderReceiptObservations,
  inboxV2ProviderReceiptOpaquePayloads
] as const;

const expectedTableNames = [
  "inbox_v2_action_attributions",
  "inbox_v2_message_attachment_anchors",
  "inbox_v2_timeline_contents",
  "inbox_v2_timeline_content_revisions",
  "inbox_v2_timeline_content_payloads",
  "inbox_v2_timeline_content_contact_values",
  "inbox_v2_timeline_items",
  "inbox_v2_timeline_subject_details",
  "inbox_v2_messages",
  "inbox_v2_message_revisions",
  "inbox_v2_message_reference_contexts",
  "inbox_v2_message_reference_canonical_targets",
  "inbox_v2_message_reference_external_targets",
  "inbox_v2_message_reference_unresolved_targets",
  "inbox_v2_message_reference_unresolved_candidates",
  "inbox_v2_staff_notes",
  "inbox_v2_staff_note_revisions",
  "inbox_v2_message_transport_links",
  "inbox_v2_message_transport_link_heads",
  "inbox_v2_outbound_route_consumptions",
  "inbox_v2_message_provider_lifecycle_operations",
  "inbox_v2_message_provider_lifecycle_transitions",
  "inbox_v2_message_reactions",
  "inbox_v2_message_reaction_transitions",
  "inbox_v2_message_reaction_slot_heads",
  "inbox_v2_message_provider_reaction_observations",
  "inbox_v2_provider_semantic_ordering_heads",
  "inbox_v2_message_transport_fact_commits",
  "inbox_v2_message_delivery_observations",
  "inbox_v2_provider_receipt_observations",
  "inbox_v2_provider_receipt_opaque_payloads"
] as const;

const genericFactAndRevisionTables = [
  inboxV2TimelineItems,
  inboxV2TimelineContents,
  inboxV2TimelineContentRevisions,
  inboxV2Messages,
  inboxV2MessageRevisions,
  inboxV2StaffNotes,
  inboxV2StaffNoteRevisions,
  inboxV2MessageTransportFactCommits
] as const;

const retainedJsonColumns = [
  "provider_semantic_proof_detail",
  "semantic_ordering_commit_detail",
  "result_proof_adapter_contract_detail",
  "capability_detail",
  "state_detail",
  "before_state_detail",
  "after_state_detail",
  "external_authority_detail",
  "provider_result_proof_detail",
  "semantic_proof_detail",
  "ordering_commit_detail",
  "head_detail"
] as const;

const jsonGuardTriggers = [
  "inbox_v2_tm_provider_op_json_guard",
  "inbox_v2_tm_provider_transition_json_guard",
  "inbox_v2_tm_reaction_json_guard",
  "inbox_v2_tm_reaction_transition_json_guard",
  "inbox_v2_tm_reaction_observation_json_guard",
  "inbox_v2_tm_provider_semantic_json_guard",
  "inbox_v2_tm_delivery_json_guard",
  "inbox_v2_tm_receipt_json_guard"
] as const;

const directIdBoundaries = [
  [
    inboxV2ActionAttributions,
    "inbox_v2_action_attributions_timestamp_check",
    "action_attribution"
  ],
  [
    inboxV2MessageAttachmentAnchors,
    "inbox_v2_message_attachment_anchors_revision_check",
    "message_attachment"
  ],
  [
    inboxV2TimelineContents,
    "inbox_v2_timeline_contents_clock_check",
    "timeline_content"
  ],
  [
    inboxV2TimelineItems,
    "inbox_v2_timeline_items_clock_check",
    "timeline_item"
  ],
  [inboxV2Messages, "inbox_v2_messages_clock_check", "message"],
  [
    inboxV2MessageRevisions,
    "inbox_v2_message_revisions_clock_check",
    "message_revision"
  ],
  [inboxV2StaffNotes, "inbox_v2_staff_notes_clock_check", "staff_note"],
  [
    inboxV2StaffNoteRevisions,
    "inbox_v2_staff_note_revisions_clock_check",
    "staff_note_revision"
  ],
  [
    inboxV2MessageTransportOccurrenceLinks,
    "inbox_v2_message_transport_links_record_check",
    "message_transport_occurrence_link"
  ],
  [
    inboxV2OutboundRouteConsumptions,
    "inbox_v2_outbound_route_consumptions_shape_check",
    "outbound_route_consumption"
  ],
  [
    inboxV2MessageProviderLifecycleOperations,
    "inbox_v2_message_provider_lifecycle_operations_clock_check",
    "message_provider_lifecycle_operation"
  ],
  [
    inboxV2MessageProviderLifecycleTransitions,
    "inbox_v2_message_provider_lifecycle_transitions_chain_check",
    "message_provider_lifecycle_transition"
  ],
  [
    inboxV2MessageReactions,
    "inbox_v2_message_reactions_clock_check",
    "message_reaction"
  ],
  [
    inboxV2MessageReactionTransitions,
    "inbox_v2_message_reaction_transitions_clock_check",
    "message_reaction_transition"
  ],
  [
    inboxV2MessageProviderReactionObservations,
    "inbox_v2_message_provider_reaction_observations_clock_check",
    "provider_reaction_observation"
  ],
  [
    inboxV2MessageDeliveryObservations,
    "inbox_v2_message_delivery_observations_clock_check",
    "message_delivery_observation"
  ],
  [
    inboxV2ProviderReceiptObservations,
    "inbox_v2_provider_receipt_observations_clock_check",
    "provider_receipt_observation"
  ],
  [
    inboxV2ProviderReceiptOpaquePayloads,
    "inbox_v2_provider_receipt_opaque_payloads_shape_check",
    "provider_receipt_opaque_payload"
  ]
].map(([table, checkName, prefix]) => ({
  table: table as Parameters<typeof getTableConfig>[0],
  checkName: checkName as string,
  prefix: prefix as string
}));

function primaryKeyColumns(
  table: Parameters<typeof getTableConfig>[0]
): string[][] {
  return getTableConfig(table).primaryKeys.map((primaryKey) =>
    primaryKey.columns.map((column) => column.name)
  );
}

function candidateKeyColumns(
  table: Parameters<typeof getTableConfig>[0]
): string[][] {
  const config = getTableConfig(table);
  const inlinePrimaryKey = config.columns
    .filter((column) => column.primary)
    .map((column) => column.name);
  return [
    ...(inlinePrimaryKey.length === 0 ? [] : [inlinePrimaryKey]),
    ...config.primaryKeys.map((primaryKey) =>
      primaryKey.columns.map((column) => column.name)
    ),
    ...config.uniqueConstraints.map((constraint) =>
      constraint.columns.map((column) => column.name)
    ),
    ...config.indexes
      .filter(
        (tableIndex) => tableIndex.config.unique && !tableIndex.config.where
      )
      .map((tableIndex) =>
        tableIndex.config.columns
          .map(indexColumnName)
          .filter((column): column is string => column !== undefined)
      )
  ];
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

function columnNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).columns.map((column) => column.name);
}

function jsonColumnNames(
  table: Parameters<typeof getTableConfig>[0]
): string[] {
  return getTableConfig(table)
    .columns.filter((column) => column.getSQLType() === "jsonb")
    .map((column) => column.name);
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

function indexColumns(
  table: Parameters<typeof getTableConfig>[0],
  name: string
): string[] {
  const tableIndex = getTableConfig(table).indexes.find(
    (candidate) => candidate.config.name === name
  );
  if (!tableIndex) throw new Error(`Missing index: ${name}`);
  return tableIndex.config.columns
    .map(indexColumnName)
    .filter((column): column is string => column !== undefined);
}

function schemaObjectNames(
  table: Parameters<typeof getTableConfig>[0]
): string[] {
  const config = getTableConfig(table);
  return [
    ...config.primaryKeys.map((primaryKey) => primaryKey.getName()),
    ...config.foreignKeys.map((foreignKey) => foreignKey.getName()),
    ...config.uniqueConstraints.map((constraint) => constraint.name),
    ...config.checks.map((constraint) => constraint.name),
    ...config.indexes.map((tableIndex) => tableIndex.config.name)
  ].filter((name): name is string => typeof name === "string");
}

function sqlFunctionNames(source: string): string[] {
  return Array.from(
    source.matchAll(/create or replace function public\.([a-z0-9_]+)\(/gu),
    (match) => match[1] ?? ""
  );
}

function sqlFunctionSource(source: string, name: string): string {
  const startMarker = `create or replace function public.${name}(`;
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`Missing SQL function: ${name}`);
  const endMarker = "$function$;";
  const end = source.indexOf(endMarker, start);
  if (end < 0) throw new Error(`Unterminated SQL function: ${name}`);
  return source.slice(start, end + endMarker.length);
}

function sqlTriggerNames(source: string): string[] {
  return Array.from(
    source.matchAll(/create (?:constraint )?trigger ([a-z0-9_]+)/gu),
    (match) => match[1] ?? ""
  );
}
