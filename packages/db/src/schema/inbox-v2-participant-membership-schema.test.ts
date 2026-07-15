import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { inboxV2SourceExternalIdentities } from "./inbox-v2/identity-foundation";
import {
  INBOX_V2_PARTICIPANT_MEMBERSHIP_INTEGRITY_SQL,
  inboxV2BotIdentities,
  inboxV2ConversationMembershipCommits,
  inboxV2ConversationMembershipHeads,
  inboxV2ConversationParticipants,
  inboxV2ParticipantMembershipEpisodes,
  inboxV2ParticipantMembershipTransitions,
  inboxV2ProviderMembershipOrderingHeads
} from "./inbox-v2/participant-membership";
import { clientContacts, employees, inboxV2Conversations } from "./tables";

describe("Inbox V2 participant membership schema", () => {
  it("separates immutable actor anchors, conversation-local participants and membership history", () => {
    expect(getTableConfig(inboxV2BotIdentities).name).toBe(
      "inbox_v2_bot_identities"
    );
    expect(getTableConfig(inboxV2ConversationParticipants).name).toBe(
      "inbox_v2_conversation_participants"
    );
    expect(getTableConfig(inboxV2ConversationMembershipHeads).name).toBe(
      "inbox_v2_conversation_membership_heads"
    );
    expect(getTableConfig(inboxV2ConversationMembershipCommits).name).toBe(
      "inbox_v2_conversation_membership_commits"
    );
    expect(getTableConfig(inboxV2ParticipantMembershipEpisodes).name).toBe(
      "inbox_v2_participant_membership_episodes"
    );
    expect(getTableConfig(inboxV2ParticipantMembershipTransitions).name).toBe(
      "inbox_v2_participant_membership_transitions"
    );
    expect(getTableConfig(inboxV2ProviderMembershipOrderingHeads).name).toBe(
      "inbox_v2_provider_membership_ordering_heads"
    );

    expect(primaryKeyColumns(inboxV2BotIdentities)).toEqual([
      ["tenant_id", "id"]
    ]);
    expect(primaryKeyColumns(inboxV2ConversationParticipants)).toEqual([
      ["tenant_id", "id"]
    ]);
    expect(primaryKeyColumns(inboxV2ConversationMembershipHeads)).toEqual([
      ["tenant_id", "conversation_id"]
    ]);
    expect(primaryKeyColumns(inboxV2ConversationMembershipCommits)).toEqual([
      ["tenant_id", "conversation_id", "resulting_membership_revision"]
    ]);
    expect(primaryKeyColumns(inboxV2ParticipantMembershipEpisodes)).toEqual([
      ["tenant_id", "id"]
    ]);
    expect(primaryKeyColumns(inboxV2ParticipantMembershipTransitions)).toEqual([
      ["tenant_id", "id"]
    ]);
    expect(primaryKeyColumns(inboxV2ProviderMembershipOrderingHeads)).toEqual([
      ["tenant_id", "participant_id", "source_thread_binding_id"]
    ]);
  });

  it("pins bot and participant anchors to tenant-owned parents", () => {
    expectForeignKey(
      inboxV2ConversationParticipants,
      "inbox_v2_conversation_participants_conversation_fk",
      inboxV2Conversations,
      ["tenant_id", "conversation_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2ConversationParticipants,
      "inbox_v2_conversation_participants_employee_fk",
      employees,
      ["tenant_id", "subject_employee_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2ConversationParticipants,
      "inbox_v2_conversation_participants_source_identity_fk",
      inboxV2SourceExternalIdentities,
      ["tenant_id", "subject_source_external_identity_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2ConversationParticipants,
      "inbox_v2_conversation_participants_client_contact_fk",
      clientContacts,
      ["tenant_id", "subject_client_contact_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2ConversationParticipants,
      "inbox_v2_conversation_participants_bot_fk",
      inboxV2BotIdentities,
      ["tenant_id", "subject_bot_identity_id"],
      ["tenant_id", "id"]
    );

    expect(
      uniqueColumns(
        inboxV2ConversationParticipants,
        "inbox_v2_conversation_participants_exact_edge_unique"
      )
    ).toEqual(["tenant_id", "id", "conversation_id"]);
  });

  it("stores exactly one typed participant subject without a generic polymorphic ID", () => {
    const participant = getTableConfig(inboxV2ConversationParticipants);

    expect(participant.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "subject_kind",
        "subject_employee_id",
        "subject_source_external_identity_id",
        "subject_client_contact_id",
        "subject_bot_identity_id",
        "subject_system_actor_id",
        "subject_legacy_provenance_id"
      ])
    );
    expect(participant.columns.map((column) => column.name)).not.toContain(
      "subject_id"
    );
    expect(participant.columns.map((column) => column.name)).not.toContain(
      "subject_payload"
    );

    const xor = checkSql(
      inboxV2ConversationParticipants,
      "inbox_v2_conversation_participants_subject_xor_check"
    );
    expect(xor).toContain("num_nonnulls");
    expect(xor).toContain("= 1");
    for (const kind of [
      "employee",
      "source_external_identity",
      "client_contact",
      "bot",
      "system",
      "legacy_unknown"
    ]) {
      expect(xor).toContain(`= '${kind}'`);
    }
  });

  it("allows only one exact typed subject anchor per Conversation", () => {
    const branches = [
      ["employee", "subject_employee_id"],
      ["source_identity", "subject_source_external_identity_id"],
      ["client_contact", "subject_client_contact_id"],
      ["bot", "subject_bot_identity_id"],
      ["system", "subject_system_actor_id"],
      ["legacy", "subject_legacy_provenance_id"]
    ] as const;

    for (const [branch, subjectColumn] of branches) {
      const tableIndex = indexByName(
        inboxV2ConversationParticipants,
        `inbox_v2_conversation_participants_${branch}_unique`
      );

      expect(tableIndex.config.unique).toBe(true);
      expect(tableIndex.config.columns.map(indexColumnName)).toEqual([
        "tenant_id",
        "conversation_id",
        subjectColumn
      ]);
      expect(indexSql(tableIndex.config.where)).toContain("subject_kind");
      expect(indexSql(tableIndex.config.where)).toContain("is not null");
    }
  });

  it("uses a zero-based Conversation membership head and contiguous immutable commits", () => {
    expectForeignKey(
      inboxV2ConversationMembershipHeads,
      "inbox_v2_conversation_membership_heads_conversation_fk",
      inboxV2Conversations,
      ["tenant_id", "conversation_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2ConversationMembershipCommits,
      "inbox_v2_conversation_membership_commits_conversation_fk",
      inboxV2Conversations,
      ["tenant_id", "conversation_id"],
      ["tenant_id", "id"]
    );

    expect(
      getTableConfig(inboxV2ConversationMembershipHeads).columns.find(
        (column) => column.name === "membership_revision"
      )?.default
    ).toBeDefined();
    expect(
      checkSql(
        inboxV2ConversationMembershipHeads,
        "inbox_v2_conversation_membership_heads_revision_check"
      )
    ).toContain(">= 0");

    const commitRevision = checkSql(
      inboxV2ConversationMembershipCommits,
      "inbox_v2_conversation_membership_commits_revision_check"
    );
    expect(commitRevision).toContain(">= 0");
    expect(commitRevision).toContain("=\n");
    expect(commitRevision).toContain("+ 1");
  });

  it("links every non-initial membership commit to its exact predecessor", () => {
    const predecessor = generatedColumnSql(
      inboxV2ConversationMembershipCommits,
      "predecessor_membership_revision"
    );
    expect(predecessor).toContain("nullif");
    expect(predecessor).toContain("expected_membership_revision");
    expect(predecessor).toContain("0");

    expectForeignKey(
      inboxV2ConversationMembershipCommits,
      "inbox_v2_conversation_membership_commits_predecessor_fk",
      inboxV2ConversationMembershipCommits,
      ["tenant_id", "conversation_id", "predecessor_membership_revision"],
      ["tenant_id", "conversation_id", "resulting_membership_revision"]
    );
  });

  it("pins every membership episode to one exact conversation participant edge", () => {
    expectForeignKey(
      inboxV2ParticipantMembershipEpisodes,
      "inbox_v2_participant_membership_episodes_participant_fk",
      inboxV2ConversationParticipants,
      ["tenant_id", "participant_id", "conversation_id"],
      ["tenant_id", "id", "conversation_id"]
    );
    expect(
      uniqueColumns(
        inboxV2ParticipantMembershipEpisodes,
        "inbox_v2_participant_membership_episodes_exact_edge_unique"
      )
    ).toEqual([
      "tenant_id",
      "id",
      "participant_id",
      "conversation_id",
      "origin_kind"
    ]);
  });

  it("normalizes every origin identity into one generated current-scope key", () => {
    const originScope = generatedColumnSql(
      inboxV2ParticipantMembershipEpisodes,
      "origin_scope_key"
    );
    expect(originScope).toContain("origin_kind");
    expect(originScope).toContain("origin_migration_provenance_id");
    expect(originScope).toContain("origin_system_policy_id");
    expect(originScope).toContain("origin_source_thread_binding_id");

    const origin = checkSql(
      inboxV2ParticipantMembershipEpisodes,
      "inbox_v2_participant_membership_episodes_origin_xor_check"
    );
    expect(origin).toContain("= 'hulee_internal_command'");
    expect(origin).toContain("= 'migration'");
    expect(origin).toContain("= 'system_policy'");
    expect(origin).toContain("= 'provider_roster'");
    expect(origin).toContain("origin_provider_roster_member_evidence_id");
    expect(origin).toContain("origin_provider_roster_evidence_id");
    expect(origin).toContain("origin_source_thread_binding_id");
    expect(origin).toContain("origin_source_external_identity_id");
    expect(origin).toContain("provider_ordering_head_position");

    const evidence = checkSql(
      inboxV2ParticipantMembershipEpisodes,
      "inbox_v2_participant_membership_episodes_evidence_check"
    );
    expect(evidence).toContain("= 'confirmed'");
    expect(evidence).toContain("= 'imported'");
    expect(evidence).not.toContain("'advisory'");

    const providerOrdering = checkSql(
      inboxV2ParticipantMembershipEpisodes,
      "inbox_v2_participant_membership_episodes_provider_ordering_check"
    );
    expect(providerOrdering).toContain("= 'adapter_monotonic'");
    expect(providerOrdering).toContain("origin_ordering_position");
    expect(providerOrdering).toContain("provider_ordering_head_position");
  });

  it("prevents two current episodes for the same participant and origin scope", () => {
    const currentOrigin = indexByName(
      inboxV2ParticipantMembershipEpisodes,
      "inbox_v2_participant_membership_episodes_current_origin_unique"
    );

    expect(currentOrigin.config.unique).toBe(true);
    expect(currentOrigin.config.columns.map(indexColumnName)).toEqual([
      "tenant_id",
      "participant_id",
      "origin_scope_key"
    ]);
    const predicate = indexSql(currentOrigin.config.where);
    expect(predicate).toContain("state");
    expect(predicate).toContain("'pending'");
    expect(predicate).toContain("'active'");

    expect(
      indexByName(
        inboxV2ParticipantMembershipEpisodes,
        "inbox_v2_participant_membership_episodes_tenant_origin_history_idx"
      ).config.columns.map(indexColumnName)
    ).toEqual([
      "tenant_id",
      "participant_id",
      "origin_scope_key",
      "valid_from",
      "id"
    ]);
  });

  it("indexes active internal membership from the actor before conversation lookup", () => {
    const internalActor = indexByName(
      inboxV2ParticipantMembershipEpisodes,
      "inbox_v2_participant_membership_internal_actor_idx"
    );

    expect(internalActor.config.unique).toBe(false);
    expect(internalActor.config.columns.map(indexColumnName)).toEqual([
      "tenant_id",
      "participant_id",
      "conversation_id",
      "id"
    ]);
    const predicate = indexSql(internalActor.config.where);
    expect(predicate).toContain(`"origin_kind" = 'hulee_internal_command'`);
    expect(predicate).toContain(`"state" = 'active'`);
  });

  it("links each transition to one exact episode edge and aggregate commit", () => {
    expectForeignKey(
      inboxV2ParticipantMembershipTransitions,
      "inbox_v2_participant_membership_transitions_episode_fk",
      inboxV2ParticipantMembershipEpisodes,
      [
        "tenant_id",
        "episode_id",
        "participant_id",
        "conversation_id",
        "cause_kind"
      ],
      ["tenant_id", "id", "participant_id", "conversation_id", "origin_kind"]
    );
    expectForeignKey(
      inboxV2ParticipantMembershipTransitions,
      "inbox_v2_participant_membership_transitions_commit_fk",
      inboxV2ConversationMembershipCommits,
      ["tenant_id", "conversation_id", "membership_revision"],
      ["tenant_id", "conversation_id", "resulting_membership_revision"]
    );
    expectForeignKey(
      inboxV2ParticipantMembershipTransitions,
      "inbox_v2_participant_membership_transitions_actor_fk",
      employees,
      ["tenant_id", "cause_actor_employee_id"],
      ["tenant_id", "id"]
    );
    expect(
      uniqueColumns(
        inboxV2ParticipantMembershipTransitions,
        "inbox_v2_participant_membership_transitions_episode_revision_unique"
      )
    ).toEqual(["tenant_id", "episode_id", "resulting_revision"]);
  });

  it("persists one tenant-scoped provider ordering fence across episode boundaries", () => {
    expectForeignKey(
      inboxV2ProviderMembershipOrderingHeads,
      "inbox_v2_provider_membership_ordering_heads_participant_fk",
      inboxV2ConversationParticipants,
      ["tenant_id", "participant_id", "conversation_id"],
      ["tenant_id", "id", "conversation_id"]
    );
    expectForeignKey(
      inboxV2ProviderMembershipOrderingHeads,
      "inbox_v2_provider_membership_ordering_heads_episode_fk",
      inboxV2ParticipantMembershipEpisodes,
      ["tenant_id", "episode_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2ProviderMembershipOrderingHeads,
      "inbox_v2_provider_membership_ordering_heads_transition_fk",
      inboxV2ParticipantMembershipTransitions,
      ["tenant_id", "transition_id"],
      ["tenant_id", "id"]
    );
    const values = checkSql(
      inboxV2ProviderMembershipOrderingHeads,
      "inbox_v2_provider_membership_ordering_heads_values_check"
    );
    expect(values).toContain("= 'adapter_monotonic'");
    expect(values).toContain("ordering_position");
    expect(values).toContain("membership_revision");
    expect(values).toContain("revision");
  });

  it("makes transition cause and episode CAS shapes fail closed", () => {
    const cause = checkSql(
      inboxV2ParticipantMembershipTransitions,
      "inbox_v2_participant_membership_transitions_cause_xor_check"
    );
    expect(cause).toContain("= 'hulee_internal_command'");
    expect(cause).toContain("= 'migration'");
    expect(cause).toContain("= 'system_policy'");
    expect(cause).toContain("cause_actor_employee_id");
    expect(cause).toContain("cause_trusted_service_id");
    expect(cause).toContain("= 'provider_roster'");
    expect(cause).toContain("cause_provider_roster_member_evidence_id");
    expect(cause).toContain("cause_provider_roster_evidence_id");
    expect(cause).toContain("= 'member'");
    expect(cause).toContain("= 'roster_omission'");

    const providerOrdering = checkSql(
      inboxV2ParticipantMembershipTransitions,
      "inbox_v2_participant_membership_transitions_provider_ordering_check"
    );
    expect(providerOrdering).toContain("= 'adapter_monotonic'");
    expect(providerOrdering).toContain("cause_ordering_position");

    const revision = checkSql(
      inboxV2ParticipantMembershipTransitions,
      "inbox_v2_participant_membership_transitions_revision_check"
    );
    expect(revision).toContain("expected_revision");
    expect(revision).toContain("current_revision");
    expect(revision).toContain("resulting_revision");
    expect(revision).toContain("+ 1");

    const shape = checkSql(
      inboxV2ParticipantMembershipTransitions,
      "inbox_v2_participant_membership_transitions_shape_check"
    );
    for (const intent of [
      "initial_pending",
      "initial_active",
      "activate",
      "change_role",
      "leave",
      "remove"
    ]) {
      expect(shape).toContain(`= '${intent}'`);
    }
  });

  it("bounds canonical IDs, states, revisions and temporal intervals", () => {
    expect(
      checkSql(inboxV2BotIdentities, "inbox_v2_bot_identities_id_format_check")
    ).toContain("^bot_identity:");
    expect(
      checkSql(
        inboxV2ConversationParticipants,
        "inbox_v2_conversation_participants_id_format_check"
      )
    ).toContain("^conversation_participant:");
    expect(
      checkSql(
        inboxV2ParticipantMembershipEpisodes,
        "inbox_v2_participant_membership_episodes_id_format_check"
      )
    ).toContain("^participant_membership_episode:");
    expect(
      checkSql(
        inboxV2ParticipantMembershipTransitions,
        "inbox_v2_participant_membership_transitions_id_format_check"
      )
    ).toContain("^participant_membership_transition:");

    const interval = checkSql(
      inboxV2ParticipantMembershipEpisodes,
      "inbox_v2_participant_membership_episodes_state_interval_check"
    );
    expect(interval).toContain("'pending'");
    expect(interval).toContain("'active'");
    expect(interval).toContain("'left'");
    expect(interval).toContain("'removed'");
    expect(interval).toContain("valid_to");
    expect(interval).toContain("isfinite");

    for (const [table, name, lowerBound] of [
      [inboxV2BotIdentities, "inbox_v2_bot_identities_revision_check", ">= 1"],
      [
        inboxV2ConversationParticipants,
        "inbox_v2_conversation_participants_revision_check",
        ">= 1"
      ],
      [
        inboxV2ParticipantMembershipEpisodes,
        "inbox_v2_participant_membership_episodes_revision_check",
        ">= 1"
      ]
    ] as const) {
      expect(checkSql(table, name)).toContain(lowerBound);
    }
  });

  it("requires finite ordered clocks on every mutable head and history row", () => {
    for (const [table, name] of [
      [inboxV2BotIdentities, "inbox_v2_bot_identities_timestamps_check"],
      [
        inboxV2ConversationParticipants,
        "inbox_v2_conversation_participants_timestamps_check"
      ],
      [
        inboxV2ConversationMembershipHeads,
        "inbox_v2_conversation_membership_heads_timestamps_check"
      ],
      [
        inboxV2ConversationMembershipCommits,
        "inbox_v2_conversation_membership_commits_timestamp_check"
      ],
      [
        inboxV2ParticipantMembershipTransitions,
        "inbox_v2_participant_membership_transitions_timestamp_check"
      ]
    ] as const) {
      expect(checkSql(table, name)).toContain("isfinite");
    }
  });

  it("exports schema-qualified deferred aggregate induction and projection guards", () => {
    const invariantSql = INBOX_V2_PARTICIPANT_MEMBERSHIP_INTEGRITY_SQL;
    const functions = invariantSql.match(
      /create or replace function public\./g
    );
    const safeSearchPaths = invariantSql.match(
      /set search_path = pg_catalog, public, pg_temp/g
    );

    expect(functions?.length).toBeGreaterThanOrEqual(5);
    expect(safeSearchPaths).toHaveLength(functions?.length ?? 0);
    expect(
      invariantSql.match(/create constraint trigger/g)?.length
    ).toBeGreaterThanOrEqual(4);
    expect(
      invariantSql.match(/deferrable initially deferred/g)?.length
    ).toBeGreaterThanOrEqual(4);

    expect(invariantSql).toMatch(
      /conversation_membership_head[^;]*(?:commit|revision)/s
    );
    expect(invariantSql).toMatch(
      /conversation_membership_commit[^;]*participant_membership_transition/s
    );
    expect(invariantSql).toContain(
      "inbox_v2_assert_participant_membership_episode"
    );
    expect(invariantSql).toContain(
      "public.inbox_v2_participant_membership_episodes"
    );
    expect(invariantSql).toContain(
      "public.inbox_v2_participant_membership_transitions"
    );
    expect(invariantSql).toContain("membership_revision");
    expect(invariantSql).toContain("resulting_membership_revision");
    expect(invariantSql).toContain("resulting_revision");
    expect(invariantSql).toContain(
      "public.inbox_v2_provider_membership_ordering_heads"
    );
    expect(invariantSql).toContain(
      "inbox_v2.provider_membership_ordering_stale"
    );
    expect(invariantSql).toContain(
      "inbox_v2.provider_membership_ordering_head_target_invalid"
    );

    expect(invariantSql).not.toMatch(
      /\b(?:from|join|update|insert into|delete from)\s+inbox_v2_/
    );
    expect(invariantSql).not.toMatch(/\bperform\s+inbox_v2_/);
    expect(invariantSql).not.toMatch(/\bexecute function\s+inbox_v2_/);
    for (const rowTypeReference of invariantSql.matchAll(
      /([a-z0-9_.]+)%rowtype/g
    )) {
      expect(rowTypeReference[1]).toMatch(/^public\./);
    }
  });

  it("makes immutable facts immutable and restricts episode updates to projected state", () => {
    const invariantSql = INBOX_V2_PARTICIPANT_MEMBERSHIP_INTEGRITY_SQL;

    for (const tableToken of [
      "bot_identities",
      "conversation_participants",
      "conversation_membership_commits",
      "participant_membership_transitions"
    ]) {
      expect(invariantSql).toMatch(
        new RegExp(`create trigger [^;]*${tableToken}[^;]*immutable`, "s")
      );
    }
    expect(invariantSql).toMatch(
      /create trigger [^;]*participant_membership_episodes[^;]*(?:stable|guard)/s
    );
    expect(invariantSql).toMatch(
      /create trigger inbox_v2_provider_membership_ordering_heads_guard_trigger\s+before insert or update or delete\s+on public\.inbox_v2_provider_membership_ordering_heads/s
    );
    expect(invariantSql).not.toContain("old.origin_scope_key");
    expect(invariantSql).not.toContain("new.origin_scope_key");
    expect(invariantSql).toContain("old.participant_id");
    expect(invariantSql).toContain("new.participant_id");
  });

  it("wires immediate race guards and exact membership clocks into PostgreSQL", () => {
    const invariantSql = INBOX_V2_PARTICIPANT_MEMBERSHIP_INTEGRITY_SQL;

    expect(invariantSql).toMatch(
      /create trigger inbox_v2_conversations_transport_immutable_trigger\s+before update of transport/s
    );
    expect(invariantSql).toMatch(
      /create trigger inbox_v2_participant_membership_episodes_insert_guard_trigger\s+before insert/s
    );
    expect(invariantSql).toMatch(
      /inbox_v2_assert_current_internal_membership_authority[\s\S]*?for no key update of employee_row/s
    );
    expect(invariantSql).toContain(
      "inbox_v2.membership_episode_history_overlap"
    );
    expect(invariantSql).toContain(
      "inbox_v2.membership_transition_origin_evidence_mismatch"
    );
    expect(invariantSql).toContain(
      "inbox_v2.conversation_membership_commit_time_invalid"
    );
    expect(invariantSql).toMatch(
      /transition_row\.occurred_at is distinct from\s+commit_row\.occurred_at/s
    );
    expect(invariantSql).toMatch(
      /head_updated_at is distinct from matching_commit_occurred_at/s
    );
    expect(invariantSql).toContain(
      "transition_row.occurred_at = new.updated_at"
    );
    expect(invariantSql).toMatch(
      /ordering_head\.ordering_position >\s+episode_row\.provider_ordering_head_position/s
    );
    expect(invariantSql).toMatch(
      /ordering_head\.membership_revision >\s+latest_transition\.membership_revision/s
    );
  });

  it("keeps every explicit access index tenant-leading", () => {
    for (const table of [
      inboxV2BotIdentities,
      inboxV2ConversationParticipants,
      inboxV2ConversationMembershipHeads,
      inboxV2ConversationMembershipCommits,
      inboxV2ParticipantMembershipEpisodes,
      inboxV2ParticipantMembershipTransitions,
      inboxV2ProviderMembershipOrderingHeads
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

  if (!constraint) {
    throw new Error(`Missing expected unique constraint: ${name}`);
  }

  return constraint.columns.map((column) => column.name);
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
  const check = getTableConfig(table).checks.find(
    (candidate) => candidate.name === name
  );

  if (!check) {
    throw new Error(`Missing expected check constraint: ${name}`);
  }

  return new PgDialect().sqlToQuery(check.value).sql;
}

function generatedColumnSql(
  table: Parameters<typeof getTableConfig>[0],
  columnName: string
): string {
  const column = getTableConfig(table).columns.find(
    (candidate) => candidate.name === columnName
  );
  const generated = column?.generated;

  if (!generated) {
    throw new Error(`Missing generated expression: ${columnName}`);
  }

  const expression =
    typeof generated.as === "function" ? generated.as() : generated.as;

  return new PgDialect().sqlToQuery(expression).sql;
}

function indexByName(
  table: Parameters<typeof getTableConfig>[0],
  name: string
): ReturnType<typeof getTableConfig>["indexes"][number] {
  const tableIndex = getTableConfig(table).indexes.find(
    (candidate) => candidate.config.name === name
  );

  if (!tableIndex) {
    throw new Error(`Missing expected index: ${name}`);
  }

  return tableIndex;
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

function indexSql(value: unknown): string {
  if (!value) return "";
  return new PgDialect().sqlToQuery(value as never).sql;
}
