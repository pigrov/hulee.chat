import type {
  InboxV2BigintCounter,
  InboxV2ConversationId,
  InboxV2ConversationParticipantId,
  InboxV2ParticipantMembershipEpisodeId,
  InboxV2ParticipantMembershipTransitionId,
  InboxV2ProviderRosterEvidenceId,
  InboxV2ProviderRosterMemberEvidenceId,
  InboxV2SourceExternalIdentityId,
  InboxV2SourceThreadBindingId,
  InboxV2TenantId
} from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import type {
  InboxV2ParticipantMembershipTransactionExecutor,
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-inbox-v2-participant-membership-repository";
import {
  buildFindUsedInboxV2ProviderMembershipEvidenceSql,
  buildInsertInboxV2ProviderMembershipEpisodeSql,
  buildInsertInboxV2ProviderMembershipOrderingHeadSql,
  buildInsertInboxV2ProviderMembershipTransitionSql,
  buildLockInboxV2ProviderMembershipOrderingHeadSql,
  buildLockInboxV2ProviderRosterMemberEvidenceSql,
  buildLockInboxV2ProviderRosterOmissionEvidenceSql,
  buildUpdateInboxV2ProviderMembershipEpisodeSql,
  createSqlInboxV2ProviderParticipantMembershipRepository,
  type StartInboxV2ProviderMembershipEpisodeInput,
  type TransitionInboxV2ProviderMembershipEpisodeInput
} from "./sql-inbox-v2-provider-participant-membership-repository";

const tenantId = "tenant:provider-membership" as InboxV2TenantId;
const conversationId =
  "conversation:provider-membership" as InboxV2ConversationId;
const participantId =
  "conversation_participant:provider-member" as InboxV2ConversationParticipantId;
const episodeId =
  "participant_membership_episode:provider-member" as InboxV2ParticipantMembershipEpisodeId;
const initialTransitionId =
  "participant_membership_transition:provider-initial" as InboxV2ParticipantMembershipTransitionId;
const nextTransitionId =
  "participant_membership_transition:provider-next" as InboxV2ParticipantMembershipTransitionId;
const rosterEvidenceId =
  "provider_roster_evidence:provider-1" as InboxV2ProviderRosterEvidenceId;
const nextRosterEvidenceId =
  "provider_roster_evidence:provider-2" as InboxV2ProviderRosterEvidenceId;
const memberEvidenceId =
  "provider_roster_member_evidence:provider-1" as InboxV2ProviderRosterMemberEvidenceId;
const nextMemberEvidenceId =
  "provider_roster_member_evidence:provider-2" as InboxV2ProviderRosterMemberEvidenceId;
const sourceThreadBindingId =
  "source_thread_binding:provider-1" as InboxV2SourceThreadBindingId;
const sourceExternalIdentityId =
  "source_external_identity:provider-1" as InboxV2SourceExternalIdentityId;
const observedAt = "2026-07-14T05:00:00.000Z";
const nextObservedAt = "2026-07-14T05:01:00.000Z";

describe("SQL Inbox V2 provider participant membership repository", () => {
  it("persists exact provider anchors and advances an explicit ordering head", () => {
    const provider = {
      evidenceKind: "member" as const,
      rosterEvidenceId,
      memberEvidenceId,
      sourceThreadBindingId,
      sourceExternalIdentityId,
      ordering: {
        kind: "adapter_monotonic",
        scopeToken: "roster-scope:provider-1",
        comparatorId: "module:synthetic-source:roster-sequence",
        comparatorRevision: 1n,
        position: 7n
      }
    };
    const episode = providerEpisodeRecord();
    const transition = providerInitialTransitionRecord();
    const episodeInsert = renderQuery(
      buildInsertInboxV2ProviderMembershipEpisodeSql({
        episode,
        conversationId,
        provider
      })
    );
    const transitionInsert = renderQuery(
      buildInsertInboxV2ProviderMembershipTransitionSql({
        transition,
        participantId,
        conversationId,
        membershipRevision: "1" as InboxV2BigintCounter,
        provider
      })
    );
    const update = renderQuery(
      buildUpdateInboxV2ProviderMembershipEpisodeSql({
        beforeRevision: "1" as never,
        after: { ...episode, role: "member", revision: "2" as never },
        orderingPosition: 8n
      })
    );
    const orderingHeadInsert = renderQuery(
      buildInsertInboxV2ProviderMembershipOrderingHeadSql({
        tenantId,
        conversationId,
        participantId,
        episodeId,
        transitionId: initialTransitionId,
        membershipRevision: "1" as InboxV2BigintCounter,
        occurredAt: observedAt,
        provider
      })
    );

    expect(normalizeSql(episodeInsert.sql)).toContain(
      "origin_provider_roster_member_evidence_id"
    );
    expect(normalizeSql(episodeInsert.sql)).toContain(
      "origin_source_thread_binding_id"
    );
    expect(normalizeSql(episodeInsert.sql)).toContain(
      "origin_ordering_comparator_revision"
    );
    expect(normalizeSql(episodeInsert.sql)).toContain(
      "provider_ordering_head_position"
    );
    expect(episodeInsert.params).toEqual(
      expect.arrayContaining([
        tenantId,
        rosterEvidenceId,
        memberEvidenceId,
        sourceThreadBindingId,
        sourceExternalIdentityId,
        7n
      ])
    );
    expect(normalizeSql(transitionInsert.sql)).toContain(
      "cause_provider_evidence_kind"
    );
    expect(normalizeSql(transitionInsert.sql)).toContain(
      "cause_ordering_position"
    );
    expect(normalizeSql(update.sql)).toContain(
      "provider_ordering_head_position ="
    );
    expect(update.params).toContain(8n);
    expect(normalizeSql(orderingHeadInsert.sql)).toContain(
      "inbox_v2_provider_membership_ordering_heads"
    );
    expect(normalizeSql(orderingHeadInsert.sql)).toContain("ordering_position");
  });

  it("keeps provider evidence locks tenant-scoped and omission absence explicit", () => {
    const member = renderQuery(
      buildLockInboxV2ProviderRosterMemberEvidenceSql({
        tenantId,
        memberEvidenceId
      })
    );
    const omission = renderQuery(
      buildLockInboxV2ProviderRosterOmissionEvidenceSql({
        tenantId,
        rosterEvidenceId,
        sourceExternalIdentityId
      })
    );
    const usedMember = renderQuery(
      buildFindUsedInboxV2ProviderMembershipEvidenceSql({
        tenantId,
        evidence: {
          kind: "member",
          rosterEvidenceId,
          memberEvidenceId,
          sourceThreadBindingId,
          sourceExternalIdentityId
        }
      })
    );
    const orderingHead = renderQuery(
      buildLockInboxV2ProviderMembershipOrderingHeadSql({
        tenantId,
        participantId,
        sourceThreadBindingId
      })
    );

    expect(normalizeSql(member.sql)).toContain("member_row.tenant_id =");
    expect(member.params).toEqual([tenantId, memberEvidenceId]);
    expect(normalizeSql(omission.sql)).toContain("exists ( select 1");
    expect(normalizeSql(omission.sql)).toContain(
      "present_member.source_external_identity_id ="
    );
    expect(normalizeSql(omission.sql)).toContain(
      "for share of roster_row, binding_row, thread_row, identity_row"
    );
    expect(normalizeSql(usedMember.sql)).toContain(
      "cause_provider_roster_member_evidence_id ="
    );
    expect(normalizeSql(orderingHead.sql)).toContain(
      "where tenant_id = $1 and participant_id = $2 and source_thread_binding_id = $3 for update"
    );
    expect(orderingHead.params).toEqual([
      tenantId,
      participantId,
      sourceThreadBindingId
    ]);
  });

  it("returns advisory evidence as a typed no-op before any side effect", async () => {
    const executor = new ScriptedExecutor([
      [{ membership_revision: "0" }],
      [],
      [participantRow()],
      [providerEvidenceRow({ authority: "advisory" })]
    ]);
    const result =
      await createSqlInboxV2ProviderParticipantMembershipRepository(
        executor
      ).startProviderEpisode(startInput());

    expect(result).toEqual({ kind: "evidence_not_authoritative" });
    expect(executor.normalizedStatements()).toHaveLength(4);
    expect(
      executor.normalizedStatements().every((item) => item.startsWith("select"))
    ).toBe(true);
    expect(
      executor
        .normalizedStatements()
        .some(
          (item) => item.startsWith("insert ") || item.startsWith("update ")
        )
    ).toBe(false);
    expect(executor.normalizedStatements().join(" ")).not.toMatch(
      /work_item|notification|client_link|rbac/u
    );
    executor.expectExhausted();
  });

  it.each([
    ["equal", "1"],
    ["older", "0"]
  ])("returns %s evidence as a typed stale no-op", async (_label, position) => {
    const executor = new ScriptedExecutor([
      [{ membership_revision: "1" }],
      [providerEpisodeRow()],
      [providerOrderingHeadRow()],
      [
        providerEvidenceRow({
          roster_id: nextRosterEvidenceId,
          member_id: nextMemberEvidenceId,
          ordering_position: position,
          observed_at: nextObservedAt,
          normalized_role: "member"
        })
      ]
    ]);
    const result =
      await createSqlInboxV2ProviderParticipantMembershipRepository(
        executor
      ).transitionProviderEpisode(transitionInput());

    expect(result).toEqual({ kind: "evidence_stale" });
    expect(executor.normalizedStatements()).toHaveLength(4);
    expect(
      executor
        .normalizedStatements()
        .some(
          (item) => item.startsWith("insert ") || item.startsWith("update ")
        )
    ).toBe(false);
    executor.expectExhausted();
  });

  it("treats an incomparable comparator as scope conflict, never timestamp order", async () => {
    const executor = new ScriptedExecutor([
      [{ membership_revision: "1" }],
      [providerEpisodeRow()],
      [providerOrderingHeadRow()],
      [
        providerEvidenceRow({
          roster_id: nextRosterEvidenceId,
          member_id: nextMemberEvidenceId,
          ordering_comparator_id: "module:synthetic-source:other-sequence",
          ordering_position: "999",
          observed_at: nextObservedAt,
          normalized_role: "member"
        })
      ]
    ]);
    const result =
      await createSqlInboxV2ProviderParticipantMembershipRepository(
        executor
      ).transitionProviderEpisode(transitionInput());

    expect(result).toEqual({ kind: "evidence_scope_conflict" });
    expect(executor.normalizedStatements()).toHaveLength(4);
    expect(
      executor
        .normalizedStatements()
        .some(
          (item) => item.startsWith("insert ") || item.startsWith("update ")
        )
    ).toBe(false);
  });

  it("returns a typed semantic conflict when ordering advances but the evidence clock regresses", async () => {
    const executor = new ScriptedExecutor([
      [{ membership_revision: "1" }],
      [providerEpisodeRow()],
      [providerOrderingHeadRow()],
      [
        providerEvidenceRow({
          roster_id: nextRosterEvidenceId,
          member_id: nextMemberEvidenceId,
          ordering_position: "2",
          observed_at: "2026-07-14T06:00:00.000+03:00",
          normalized_role: "member"
        })
      ]
    ]);
    const result =
      await createSqlInboxV2ProviderParticipantMembershipRepository(
        executor
      ).transitionProviderEpisode({
        ...transitionInput(),
        occurredAt: "2026-07-14T06:00:00.000+03:00"
      });

    expect(result).toEqual({ kind: "evidence_semantic_conflict" });
    expect(executor.normalizedStatements()).toHaveLength(4);
    expect(
      executor
        .normalizedStatements()
        .some(
          (item) => item.startsWith("insert ") || item.startsWith("update ")
        )
    ).toBe(false);
    executor.expectExhausted();
  });

  it("accepts a strictly newer authoritative member delta and has no unrelated writes", async () => {
    const executor = new ScriptedExecutor([
      [{ membership_revision: "1" }],
      [providerEpisodeRow()],
      [providerOrderingHeadRow()],
      [
        providerEvidenceRow({
          roster_id: nextRosterEvidenceId,
          member_id: nextMemberEvidenceId,
          ordering_position: "2",
          observed_at: nextObservedAt,
          normalized_role: "member"
        })
      ],
      [],
      [{ id: "2" }],
      [{ id: nextTransitionId }],
      [{ id: episodeId }],
      [{ id: nextTransitionId }],
      [{ id: conversationId }]
    ]);
    const result =
      await createSqlInboxV2ProviderParticipantMembershipRepository(
        executor
      ).transitionProviderEpisode({
        ...transitionInput(),
        occurredAt: "2026-07-14T08:01:00.000+03:00"
      });

    expect(result).toMatchObject({
      kind: "updated",
      record: { transition: { occurredAt: nextObservedAt } }
    });
    const statements = executor.normalizedStatements();
    expect(statements.filter((item) => item.startsWith("insert"))).toHaveLength(
      2
    );
    expect(statements.filter((item) => item.startsWith("update"))).toHaveLength(
      3
    );
    expect(statements.join(" ")).not.toMatch(
      /work_item|notification|client_link|rbac|responsib/u
    );
    executor.expectExhausted();
  });

  it("rejects an unused stale rejoin against the durable cross-episode ordering head", async () => {
    const executor = new ScriptedExecutor([
      [{ membership_revision: "2" }],
      [
        providerOrderingHeadRow({
          ordering_position: "10",
          episode_id:
            "participant_membership_episode:provider-closed" as InboxV2ParticipantMembershipEpisodeId,
          transition_id:
            "participant_membership_transition:provider-closed" as InboxV2ParticipantMembershipTransitionId,
          membership_revision: "2",
          revision: "2"
        })
      ],
      [participantRow()],
      [providerEvidenceRow({ ordering_position: "5" })],
      []
    ]);
    const result =
      await createSqlInboxV2ProviderParticipantMembershipRepository(
        executor
      ).startProviderEpisode({
        ...startInput(),
        expectedMembershipRevision: "2" as InboxV2BigintCounter
      });

    expect(result).toEqual({ kind: "evidence_stale" });
    expect(executor.normalizedStatements()).toHaveLength(5);
    expect(
      executor
        .normalizedStatements()
        .some(
          (item) => item.startsWith("insert ") || item.startsWith("update ")
        )
    ).toBe(false);
    executor.expectExhausted();
  });
});

class ScriptedExecutor implements InboxV2ParticipantMembershipTransactionExecutor {
  readonly queries: SQL[] = [];

  constructor(
    private readonly steps: Array<readonly Record<string, unknown>[]>
  ) {}

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(query);
    const rows = this.steps.shift();
    if (!rows) throw new Error(`No response for ${renderQuery(query).sql}`);
    return { rows: rows as readonly Row[] };
  }

  async transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    _config: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult> {
    return work(this);
  }

  normalizedStatements(): string[] {
    return this.queries.map((query) => normalizeSql(renderQuery(query).sql));
  }

  expectExhausted(): void {
    expect(this.steps).toHaveLength(0);
  }
}

function startInput(): StartInboxV2ProviderMembershipEpisodeInput {
  return {
    tenantId,
    conversationId,
    participantId,
    episodeId,
    transitionId: initialTransitionId,
    rosterEvidenceId,
    memberEvidenceId,
    sourceThreadBindingId,
    sourceExternalIdentityId,
    role: "admin",
    reasonCodeId: "core:provider-roster-observed" as never,
    expectedMembershipRevision: "0" as InboxV2BigintCounter,
    occurredAt: observedAt
  };
}

function transitionInput(): TransitionInboxV2ProviderMembershipEpisodeInput {
  return {
    tenantId,
    conversationId,
    episodeId,
    transitionId: nextTransitionId,
    evidence: {
      kind: "member",
      rosterEvidenceId: nextRosterEvidenceId,
      memberEvidenceId: nextMemberEvidenceId,
      sourceThreadBindingId,
      sourceExternalIdentityId
    },
    intent: "change_role",
    nextRole: "member",
    reasonCodeId: "core:provider-roster-observed" as never,
    expectedMembershipRevision: "1" as InboxV2BigintCounter,
    expectedEpisodeRevision: "1" as never,
    occurredAt: nextObservedAt
  };
}

function participantRow(): Record<string, unknown> {
  return {
    conversation_id: conversationId,
    subject_kind: "source_external_identity",
    subject_source_external_identity_id: sourceExternalIdentityId
  };
}

function providerEvidenceRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    roster_id: rosterEvidenceId,
    member_id: memberEvidenceId,
    binding_id: sourceThreadBindingId,
    source_identity_id: sourceExternalIdentityId,
    external_conversation_id: conversationId,
    source_connection_id: "source_connection:provider-1",
    source_account_id: "source_account:provider-1",
    identity_scope_kind: "provider",
    identity_scope_connection_id: null,
    identity_scope_account_id: null,
    identity_declaration_contract_id: "module:synthetic-source:adapter",
    identity_declaration_contract_version: "v1",
    identity_declaration_surface_id: "module:synthetic-source:surface",
    identity_declaration_loaded_by: "module:synthetic-source:worker",
    adapter_contract_id: "module:synthetic-source:adapter",
    adapter_contract_version: "v1",
    adapter_surface_id: "module:synthetic-source:surface",
    adapter_loaded_by: "module:synthetic-source:worker",
    authority: "authoritative",
    completeness: "partial",
    omission_policy: "retain_missing",
    ordering_kind: "adapter_monotonic",
    ordering_scope_token: "roster-scope:provider-1",
    ordering_comparator_id: "module:synthetic-source:roster-sequence",
    ordering_comparator_revision: "1",
    ordering_position: "1",
    observed_at: observedAt,
    member_state: "present",
    normalized_role: "admin",
    identity_present: true,
    ...overrides
  };
}

function providerEpisodeRow(): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    id: episodeId,
    participant_id: participantId,
    conversation_id: conversationId,
    origin_provider_roster_member_evidence_id: memberEvidenceId,
    origin_provider_roster_evidence_id: rosterEvidenceId,
    origin_source_thread_binding_id: sourceThreadBindingId,
    origin_source_external_identity_id: sourceExternalIdentityId,
    origin_ordering_kind: "adapter_monotonic",
    origin_ordering_scope_token: "roster-scope:provider-1",
    origin_ordering_comparator_id: "module:synthetic-source:roster-sequence",
    origin_ordering_comparator_revision: "1",
    origin_ordering_position: "1",
    provider_ordering_head_position: "1",
    state: "active",
    role: "admin",
    evidence_classification: "confirmed",
    valid_from: new Date(observedAt),
    valid_to: null,
    revision: "1"
  };
}

function providerOrderingHeadRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    participant_id: participantId,
    conversation_id: conversationId,
    source_thread_binding_id: sourceThreadBindingId,
    source_external_identity_id: sourceExternalIdentityId,
    ordering_kind: "adapter_monotonic",
    ordering_scope_token: "roster-scope:provider-1",
    ordering_comparator_id: "module:synthetic-source:roster-sequence",
    ordering_comparator_revision: "1",
    ordering_position: "1",
    episode_id: episodeId,
    transition_id: initialTransitionId,
    membership_revision: "1",
    revision: "1",
    created_at: new Date(observedAt),
    updated_at: new Date(observedAt),
    ...overrides
  };
}

function providerEpisodeRecord() {
  return {
    tenantId,
    id: episodeId,
    participant: {
      tenantId,
      kind: "conversation_participant" as const,
      id: participantId
    },
    origin: {
      kind: "provider_roster" as const,
      memberEvidence: {
        tenantId,
        kind: "provider_roster_member_evidence" as const,
        id: memberEvidenceId
      }
    },
    state: "active" as const,
    role: "admin" as const,
    evidenceClassification: "confirmed" as const,
    validFrom: observedAt,
    validTo: null,
    revision: "1" as never
  };
}

function providerInitialTransitionRecord() {
  return {
    tenantId,
    id: initialTransitionId,
    episode: {
      tenantId,
      kind: "participant_membership_episode" as const,
      id: episodeId
    },
    intent: "initial_active" as const,
    fromState: null,
    toState: "active" as const,
    fromRole: null,
    toRole: "admin" as const,
    cause: {
      kind: "provider_roster" as const,
      evidence: {
        kind: "provider_roster_member" as const,
        reference: {
          tenantId,
          kind: "provider_roster_member_evidence" as const,
          id: memberEvidenceId
        }
      }
    },
    reasonCodeId: "core:provider-roster-observed" as never,
    expectedRevision: null,
    currentRevision: null,
    resultingRevision: "1" as never,
    occurredAt: observedAt
  };
}

function renderQuery(query: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(query);
}

function normalizeSql(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}
