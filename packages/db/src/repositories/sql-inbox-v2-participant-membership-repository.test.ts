import type {
  InboxV2BigintCounter,
  InboxV2ConversationId,
  InboxV2ConversationParticipant,
  InboxV2ConversationParticipantId,
  InboxV2ConversationParticipantSubject,
  InboxV2EmployeeId,
  InboxV2ParticipantMembershipEpisode,
  InboxV2ParticipantMembershipEpisodeId,
  InboxV2ParticipantMembershipTransition,
  InboxV2ParticipantMembershipTransitionId,
  InboxV2TenantId
} from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { InboxV2PersistenceInvariantError } from "./sql-inbox-v2-conversation-repository";
import { buildApplyInboxV2ParticipantMembershipMutationSql } from "./sql-inbox-v2-membership-mutation-entrypoint";
import {
  buildFindCurrentInboxV2ParticipantMembershipEpisodeSql,
  buildFindInboxV2ConversationParticipantByIdSql,
  buildFindInboxV2ConversationParticipantBySubjectSql,
  buildFindInboxV2ParticipantMembershipEpisodeByIdSql,
  buildInsertInboxV2ConversationParticipantSql,
  buildLockInboxV2ConversationMembershipHeadSql,
  createSqlInboxV2ParticipantMembershipRepository,
  type CreateInboxV2ConversationParticipantInput,
  type InboxV2ParticipantMembershipTransactionExecutor,
  type RawSqlExecutor,
  type RawSqlQueryResult,
  type StartInboxV2ParticipantMembershipEpisodeInput,
  type TransitionInboxV2ParticipantMembershipEpisodeInput
} from "./sql-inbox-v2-participant-membership-repository";

const tenantId = "tenant:db-002-membership" as InboxV2TenantId;
const conversationId = "conversation:membership-1" as InboxV2ConversationId;
const participantId =
  "conversation_participant:operator-1" as InboxV2ConversationParticipantId;
const employeeId = "employee:operator-1" as InboxV2EmployeeId;
const episodeId =
  "participant_membership_episode:episode-1" as InboxV2ParticipantMembershipEpisodeId;
const transitionId =
  "participant_membership_transition:transition-1" as InboxV2ParticipantMembershipTransitionId;
const occurredAt = "2026-07-13T17:00:00.000Z";
const laterAt = "2026-07-13T17:05:00.000Z";
const bigintMax = "9223372036854775807" as InboxV2BigintCounter;

describe("SQL Inbox V2 participant membership repository", () => {
  it("keeps every lookup, lock and CAS update tenant-scoped", () => {
    const participant = participantRecord();
    const episode = episodeRecord();
    const transition = initialTransitionRecord();

    const readsAndUpdates = [
      buildFindInboxV2ConversationParticipantByIdSql({
        tenantId,
        participantId
      }),
      buildFindInboxV2ConversationParticipantBySubjectSql(participant),
      buildFindInboxV2ParticipantMembershipEpisodeByIdSql({
        tenantId,
        episodeId,
        conversationId
      }),
      buildFindCurrentInboxV2ParticipantMembershipEpisodeSql(episode)
    ];

    for (const query of readsAndUpdates) {
      const rendered = renderQuery(query);
      expect(normalizeSql(rendered.sql)).toContain("where tenant_id =");
      expect(rendered.params).toContain(tenantId);
    }

    const inserts = [buildInsertInboxV2ConversationParticipantSql(participant)];

    for (const query of inserts) {
      const rendered = renderQuery(query);
      expect(normalizeSql(rendered.sql)).toContain("tenant_id");
      expect(rendered.params[0]).toBe(tenantId);
    }

    const mutation = renderQuery(
      buildApplyInboxV2ParticipantMembershipMutationSql({
        operation: "start",
        conversationId,
        participantId,
        expectedMembershipRevision: "0" as never,
        resultingMembershipRevision: "1" as never,
        episode,
        transition,
        episodeOriginProvider: null,
        provider: null
      })
    );
    expect(normalizeSql(mutation.sql)).toContain(
      "public.inbox_v2_apply_participant_membership_mutation_v1"
    );
    expect(mutation.params).toHaveLength(1);
    expect(String(mutation.params[0])).toContain(tenantId);
    expect(normalizeSql(mutation.sql)).not.toMatch(
      /(?:insert|update|delete) inbox_v2_(?:conversation_membership|participant_membership)/u
    );

    expect(
      normalizeSql(
        renderQuery(
          buildLockInboxV2ConversationMembershipHeadSql({
            tenantId,
            conversationId
          })
        ).sql
      )
    ).toContain("inbox_v2_lock_conversation_membership_head_v1");
  });

  it("maps every typed participant subject without crossing identity namespaces", async () => {
    const subjects: InboxV2ConversationParticipantSubject[] = [
      employeeSubject(),
      {
        kind: "source_external_identity",
        sourceExternalIdentity: {
          tenantId,
          kind: "source_external_identity",
          id: "source_external_identity:customer-1" as never
        }
      },
      {
        kind: "client_contact",
        clientContact: {
          tenantId,
          kind: "client_contact",
          id: "client_contact:contact-1" as never
        }
      },
      {
        kind: "bot",
        bot: {
          tenantId,
          kind: "bot_identity",
          id: "bot_identity:bot-1" as never
        }
      },
      { kind: "system", systemActorId: "core:source-system" as never },
      {
        kind: "legacy_unknown",
        provenanceCodeId: "core:legacy-v1-author-unknown" as never
      }
    ];

    for (const subject of subjects) {
      const participant = participantRecord({ subject });
      const executor = new ScriptedMembershipExecutor([
        [participantRow(participant)]
      ]);
      const repository =
        createSqlInboxV2ParticipantMembershipRepository(executor);

      await expect(
        repository.findParticipantById({ tenantId, participantId })
      ).resolves.toEqual(participant);
      executor.expectExhausted();
    }
  });

  it("distinguishes idempotent participant, ID conflict and exact-subject conflict", async () => {
    const input = participantInput();
    const participant = participantRecord();
    const idempotentExecutor = new ScriptedMembershipExecutor([
      [],
      [participantRow(participant)]
    ]);
    const identityConflictExecutor = new ScriptedMembershipExecutor([
      [],
      [
        participantRow(
          participantRecord({
            subject: {
              kind: "system",
              systemActorId: "core:source-system" as never
            }
          })
        )
      ]
    ]);
    const subjectWinner = participantRecord({
      id: "conversation_participant:operator-existing" as never
    });
    const subjectConflictExecutor = new ScriptedMembershipExecutor([
      [],
      [],
      [participantRow(subjectWinner)]
    ]);

    await expect(
      createSqlInboxV2ParticipantMembershipRepository(
        idempotentExecutor
      ).createParticipant(input)
    ).resolves.toMatchObject({ kind: "already_exists", record: participant });
    await expect(
      createSqlInboxV2ParticipantMembershipRepository(
        identityConflictExecutor
      ).createParticipant(input)
    ).resolves.toMatchObject({ kind: "identity_conflict" });
    await expect(
      createSqlInboxV2ParticipantMembershipRepository(
        subjectConflictExecutor
      ).createParticipant(input)
    ).resolves.toMatchObject({
      kind: "subject_conflict",
      record: subjectWinner
    });
  });

  it("rejects extra command fields and provider membership before any write", async () => {
    const strictExecutor = new ScriptedMembershipExecutor([]);
    const strictRepository =
      createSqlInboxV2ParticipantMembershipRepository(strictExecutor);
    const strictInput = {
      ...participantInput(),
      providerRoute: "forbidden"
    } as unknown as CreateInboxV2ConversationParticipantInput;

    await expect(
      strictRepository.createParticipant(strictInput)
    ).rejects.toMatchObject({ code: "validation.failed" });
    expect(strictExecutor.queries).toHaveLength(0);
    expect(strictExecutor.transactionCount).toBe(0);

    const providerExecutor = new ScriptedMembershipExecutor([
      [{ membership_revision: "0" }],
      [participantRow(participantRecord())],
      []
    ]);
    const rosterMember = {
      tenantId,
      kind: "provider_roster_member_evidence",
      id: "provider_roster_member_evidence:member-1"
    } as const;
    const providerInput = {
      ...startInput(),
      origin: { kind: "provider_roster", memberEvidence: rosterMember },
      cause: {
        kind: "provider_roster",
        evidence: { kind: "provider_roster_member", reference: rosterMember }
      }
    } as unknown as StartInboxV2ParticipantMembershipEpisodeInput;

    await expect(
      createSqlInboxV2ParticipantMembershipRepository(
        providerExecutor
      ).startEpisode(providerInput)
    ).rejects.toMatchObject({ code: "validation.failed" });
    expect(writeStatements(providerExecutor)).toEqual([]);
  });

  it("creates the initial revision 0 to 1 episode bundle in canonical order", async () => {
    const executor = successfulStartExecutor();
    const repository =
      createSqlInboxV2ParticipantMembershipRepository(executor);

    const result = await repository.startEpisode(startInput());

    expect(result).toMatchObject({
      kind: "created",
      record: {
        conversationMembershipRevision: "1",
        episode: { state: "active", role: "member", revision: "1" },
        transition: {
          intent: "initial_active",
          expectedRevision: null,
          currentRevision: null,
          resultingRevision: "1"
        }
      }
    });
    expect(executor.normalizedStatements().map(statementKind)).toEqual([
      "lock_head",
      "find_participant",
      "find_episode",
      "find_current_origin",
      "apply_mutation"
    ]);
    expect(executor.commitCount).toBe(1);
    expect(executor.transactionIsolationLevels).toEqual(["read committed"]);
    expect(result).not.toHaveProperty("result");
    executor.expectExhausted();
  });

  it("commits start and transition callbacks with their mutation records", async () => {
    const startExecutor = successfulStartExecutor();
    const startRepository =
      createSqlInboxV2ParticipantMembershipRepository(startExecutor);

    const started = await startRepository.withStartEpisode(
      startInput(),
      async ({ executor, record }) => {
        expect(executor).toBe(startExecutor);
        expect(record).toMatchObject({
          conversationMembershipRevision: "1",
          transition: { intent: "initial_active" }
        });
        return { outboxId: "outbox:start" } as const;
      }
    );

    expect(started).toMatchObject({
      kind: "created",
      record: { conversationMembershipRevision: "1" },
      result: { outboxId: "outbox:start" }
    });
    expect(startExecutor.transactionCount).toBe(1);
    expect(startExecutor.commitCount).toBe(1);
    expect(startExecutor.rollbackCount).toBe(0);
    startExecutor.expectExhausted();

    const transitionExecutor = successfulTransitionExecutor(
      "1",
      episodeRecord(),
      true
    );
    const transitionRepository =
      createSqlInboxV2ParticipantMembershipRepository(transitionExecutor);

    const transitioned = await transitionRepository.withTransitionEpisode(
      transitionInput(),
      async ({ executor, record }) => {
        expect(executor).toBe(transitionExecutor);
        expect(record).toMatchObject({
          conversationMembershipRevision: "2",
          episode: { role: "admin" },
          transition: { intent: "change_role" }
        });
        return "outbox:transition" as const;
      }
    );

    expect(transitioned).toMatchObject({
      kind: "updated",
      record: { conversationMembershipRevision: "2" },
      result: "outbox:transition"
    });
    expect(transitionExecutor.transactionCount).toBe(1);
    expect(transitionExecutor.commitCount).toBe(1);
    expect(transitionExecutor.rollbackCount).toBe(0);
    transitionExecutor.expectExhausted();
  });

  it("rolls back a callback failure and never retries the callback", async () => {
    const retryableCallbackError = Object.assign(
      new Error("callback serialization failure"),
      { code: "40001" }
    );
    const executor = successfulStartExecutor();
    const repository =
      createSqlInboxV2ParticipantMembershipRepository(executor);
    let callbackCalls = 0;

    await expect(
      repository.withStartEpisode(startInput(), async () => {
        callbackCalls += 1;
        throw retryableCallbackError;
      })
    ).rejects.toBe(retryableCallbackError);

    expect(callbackCalls).toBe(1);
    expect(executor.transactionCount).toBe(1);
    expect(executor.commitCount).toBe(0);
    expect(executor.rollbackCount).toBe(1);
    executor.expectExhausted();
  });

  it("retries only whole retryable PostgreSQL transactions with a bounded attempt count", async () => {
    const retryExecutor = successfulStartExecutor().failNextTransactions(
      Object.assign(new Error("wrapped deadlock"), {
        cause: Object.assign(new Error("deadlock"), { code: "40P01" })
      }),
      Object.assign(new Error("serialization failure"), { code: "40001" })
    );

    await expect(
      createSqlInboxV2ParticipantMembershipRepository(
        retryExecutor
      ).startEpisode(startInput())
    ).resolves.toMatchObject({ kind: "created" });
    expect(retryExecutor.transactionCount).toBe(3);
    expect(retryExecutor.rollbackCount).toBe(2);
    expect(retryExecutor.commitCount).toBe(1);
    expect(retryExecutor.transactionIsolationLevels).toEqual([
      "read committed",
      "read committed",
      "read committed"
    ]);
    retryExecutor.expectExhausted();

    const terminalError = Object.assign(new Error("still deadlocked"), {
      code: "40P01"
    });
    const exhaustedExecutor = new ScriptedMembershipExecutor(
      []
    ).failNextTransactions(terminalError, terminalError, terminalError);
    await expect(
      createSqlInboxV2ParticipantMembershipRepository(
        exhaustedExecutor
      ).startEpisode(startInput())
    ).rejects.toBe(terminalError);
    expect(exhaustedExecutor.transactionCount).toBe(3);
    expect(exhaustedExecutor.rollbackCount).toBe(3);
    expect(exhaustedExecutor.queries).toHaveLength(0);
  });

  it("returns stale membership-head conflict without attempting a write", async () => {
    const executor = new ScriptedMembershipExecutor([
      [{ membership_revision: "7" }]
    ]);
    const repository =
      createSqlInboxV2ParticipantMembershipRepository(executor);

    await expect(repository.startEpisode(startInput())).resolves.toEqual({
      kind: "membership_revision_conflict",
      currentMembershipRevision: "7"
    });
    expect(writeStatements(executor)).toEqual([]);
    executor.expectExhausted();
  });

  it("returns the current-origin winner without appending a partial bundle", async () => {
    const winner = episodeRecord({
      id: "participant_membership_episode:existing" as never
    });
    const executor = new ScriptedMembershipExecutor([
      [{ membership_revision: "0" }],
      [participantRow(participantRecord())],
      [],
      [episodeRow(winner)]
    ]);
    const repository =
      createSqlInboxV2ParticipantMembershipRepository(executor);

    await expect(repository.startEpisode(startInput())).resolves.toEqual({
      kind: "current_origin_conflict",
      currentEpisode: winner
    });
    expect(writeStatements(executor)).toEqual([]);
    executor.expectExhausted();
  });

  it("applies activate, role and leave transitions with a canonical head-first lock", async () => {
    const pendingEpisode = episodeRecord({ state: "pending" });
    const activateExecutor = successfulTransitionExecutor(
      "1",
      pendingEpisode,
      true
    );
    const activateRepository =
      createSqlInboxV2ParticipantMembershipRepository(activateExecutor);
    const activateResult = await activateRepository.transitionEpisode(
      transitionInput({
        intent: "activate",
        nextRole: null,
        expectedMembershipRevision: "1" as never,
        expectedEpisodeRevision: "1" as never
      })
    );

    expect(activateResult).toMatchObject({
      kind: "updated",
      record: {
        conversationMembershipRevision: "2",
        episode: { state: "active", role: "member", revision: "2" },
        transition: { intent: "activate", resultingRevision: "2" }
      }
    });
    expect(activateExecutor.normalizedStatements().map(statementKind)).toEqual([
      "lock_head",
      "find_episode",
      "apply_mutation"
    ]);

    const roleExecutor = successfulTransitionExecutor(
      "1",
      episodeRecord(),
      true
    );
    const roleRepository =
      createSqlInboxV2ParticipantMembershipRepository(roleExecutor);
    const roleResult = await roleRepository.transitionEpisode(
      transitionInput({
        intent: "change_role",
        nextRole: "admin",
        expectedMembershipRevision: "1" as never,
        expectedEpisodeRevision: "1" as never
      })
    );

    expect(roleResult).toMatchObject({
      kind: "updated",
      record: {
        conversationMembershipRevision: "2",
        episode: { state: "active", role: "admin", revision: "2" },
        transition: {
          fromState: "active",
          toState: "active",
          fromRole: "member",
          toRole: "admin",
          resultingRevision: "2"
        }
      }
    });
    expect(roleExecutor.normalizedStatements().map(statementKind)).toEqual([
      "lock_head",
      "find_episode",
      "apply_mutation"
    ]);

    const afterRole = episodeRecord({ role: "admin", revision: "2" as never });
    const leaveExecutor = successfulTransitionExecutor("2", afterRole, false);
    const leaveRepository =
      createSqlInboxV2ParticipantMembershipRepository(leaveExecutor);
    const leaveResult = await leaveRepository.transitionEpisode(
      transitionInput({
        transitionId:
          "participant_membership_transition:transition-leave" as never,
        intent: "leave",
        nextRole: null,
        expectedMembershipRevision: "2" as never,
        expectedEpisodeRevision: "2" as never,
        occurredAt: laterAt
      })
    );

    expect(leaveResult).toMatchObject({
      kind: "updated",
      record: {
        conversationMembershipRevision: "3",
        episode: {
          state: "left",
          role: "admin",
          validTo: laterAt,
          revision: "3"
        },
        transition: { intent: "leave", resultingRevision: "3" }
      }
    });
    expect(leaveExecutor.normalizedStatements().map(statementKind)).toEqual([
      "lock_head",
      "find_episode",
      "apply_mutation"
    ]);
  });

  it("returns episode revision conflict before creating a commit", async () => {
    const current = episodeRecord({ revision: "3" as never });
    const executor = new ScriptedMembershipExecutor([
      [{ membership_revision: "1" }],
      [episodeRow(current)]
    ]);
    const repository =
      createSqlInboxV2ParticipantMembershipRepository(executor);

    await expect(
      repository.transitionEpisode(transitionInput())
    ).resolves.toEqual({
      kind: "episode_revision_conflict",
      currentEpisode: current
    });
    expect(writeStatements(executor)).toEqual([]);
    executor.expectExhausted();
  });

  it("rolls back when the canonical mutation entrypoint fails or returns no row", async () => {
    const missingResultExecutor = new ScriptedMembershipExecutor([
      [{ membership_revision: "1" }],
      [episodeRow(episodeRecord())],
      []
    ]);

    await expect(
      createSqlInboxV2ParticipantMembershipRepository(
        missingResultExecutor
      ).transitionEpisode(transitionInput())
    ).rejects.toBeInstanceOf(InboxV2PersistenceInvariantError);
    expect(missingResultExecutor.rollbackCount).toBe(1);

    const databaseError = Object.assign(new Error("head CAS lost"), {
      code: "23514"
    });
    const failingExecutor = new ScriptedMembershipExecutor([
      [{ membership_revision: "1" }],
      [episodeRow(episodeRecord())],
      [{ __throw: databaseError }]
    ]);
    await expect(
      createSqlInboxV2ParticipantMembershipRepository(
        failingExecutor
      ).transitionEpisode(transitionInput())
    ).rejects.toBe(databaseError);
    expect(failingExecutor.rollbackCount).toBe(1);
  });

  it("maps only the exact inactive-Employee entrypoint rejection after rollback", async () => {
    const databaseError = Object.assign(
      new Error("inbox_v2.internal_membership_subject_or_employee_invalid"),
      { code: "23514" }
    );
    const wrappedError = Object.assign(new Error("Failed query"), {
      cause: databaseError
    });
    const executor = new ScriptedMembershipExecutor([
      [{ membership_revision: "0" }],
      [participantRow(participantRecord())],
      [],
      [],
      [{ __throw: wrappedError }]
    ]);

    await expect(
      createSqlInboxV2ParticipantMembershipRepository(executor).startEpisode(
        startInput()
      )
    ).resolves.toEqual({ kind: "participant_not_found" });
    expect(executor.commitCount).toBe(0);
    expect(executor.rollbackCount).toBe(1);

    const differentError = Object.assign(
      new Error("inbox_v2.membership_episode_revision_conflict"),
      { code: "23514" }
    );
    const failClosed = new ScriptedMembershipExecutor([
      [{ membership_revision: "0" }],
      [participantRow(participantRecord())],
      [],
      [],
      [{ __throw: differentError }]
    ]);
    await expect(
      createSqlInboxV2ParticipantMembershipRepository(failClosed).startEpisode(
        startInput()
      )
    ).rejects.toBe(differentError);

    const callbackError = Object.assign(
      new Error("inbox_v2.internal_membership_subject_or_employee_invalid"),
      { code: "23514" }
    );
    const callbackExecutor = successfulStartExecutor();
    await expect(
      createSqlInboxV2ParticipantMembershipRepository(
        callbackExecutor
      ).withStartEpisode(startInput(), async () => {
        throw callbackError;
      })
    ).rejects.toBe(callbackError);
    expect(callbackExecutor.commitCount).toBe(0);
    expect(callbackExecutor.rollbackCount).toBe(1);
  });

  it("rejects membership and episode bigint overflow before any durable write", async () => {
    const startExecutor = new ScriptedMembershipExecutor([]);
    await expect(
      createSqlInboxV2ParticipantMembershipRepository(
        startExecutor
      ).startEpisode(startInput({ expectedMembershipRevision: bigintMax }))
    ).rejects.toMatchObject({ code: "validation.failed" });
    expect(startExecutor.queries).toHaveLength(0);

    const transitionExecutor = new ScriptedMembershipExecutor([
      [{ membership_revision: bigintMax }],
      [episodeRow(episodeRecord())]
    ]);
    await expect(
      createSqlInboxV2ParticipantMembershipRepository(
        transitionExecutor
      ).transitionEpisode(
        transitionInput({ expectedMembershipRevision: bigintMax })
      )
    ).rejects.toMatchObject({ code: "validation.failed" });
    expect(writeStatements(transitionExecutor)).toEqual([]);
  });

  it("does not attach a same-tenant episode from another Conversation", async () => {
    const executor = new ScriptedMembershipExecutor([
      [{ membership_revision: "1" }],
      []
    ]);
    const repository =
      createSqlInboxV2ParticipantMembershipRepository(executor);

    await expect(
      repository.transitionEpisode(transitionInput())
    ).resolves.toEqual({ kind: "episode_not_found" });
    expect(writeStatements(executor)).toEqual([]);
    executor.expectExhausted();
  });

  it("fails closed on lossy counters and malformed typed participant rows", async () => {
    const lossyHead = new ScriptedMembershipExecutor([
      [{ membership_revision: 1 }]
    ]);
    await expect(
      createSqlInboxV2ParticipantMembershipRepository(lossyHead).startEpisode(
        startInput()
      )
    ).rejects.toBeInstanceOf(InboxV2PersistenceInvariantError);

    const malformedParticipant = new ScriptedMembershipExecutor([
      [
        participantRow(participantRecord(), {
          subject_bot_identity_id: "bot_identity:should-not-coexist"
        })
      ]
    ]);
    await expect(
      createSqlInboxV2ParticipantMembershipRepository(
        malformedParticipant
      ).findParticipantById({ tenantId, participantId })
    ).rejects.toBeInstanceOf(InboxV2PersistenceInvariantError);
  });

  it("fails closed on malformed episode origin and revision rows", async () => {
    const malformedOrigin = new ScriptedMembershipExecutor([
      [
        episodeRow(episodeRecord(), {
          origin_system_policy_id: "core:unexpected-policy"
        })
      ]
    ]);
    await expect(
      createSqlInboxV2ParticipantMembershipRepository(
        malformedOrigin
      ).findEpisodeById({ tenantId, episodeId })
    ).rejects.toBeInstanceOf(InboxV2PersistenceInvariantError);

    const malformedRevision = new ScriptedMembershipExecutor([
      [episodeRow(episodeRecord(), { revision: 1 })]
    ]);
    await expect(
      createSqlInboxV2ParticipantMembershipRepository(
        malformedRevision
      ).findEpisodeById({ tenantId, episodeId })
    ).rejects.toBeInstanceOf(InboxV2PersistenceInvariantError);
  });
});

class ScriptedMembershipExecutor implements InboxV2ParticipantMembershipTransactionExecutor {
  readonly queries: SQL[] = [];
  readonly transactionIsolationLevels: string[] = [];
  private readonly transactionFailures: unknown[] = [];
  transactionCount = 0;
  commitCount = 0;
  rollbackCount = 0;

  constructor(
    private readonly steps: Array<readonly Record<string, unknown>[]>
  ) {}

  failNextTransactions(...errors: unknown[]): this {
    this.transactionFailures.push(...errors);
    return this;
  }

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(query);
    const rows = this.steps.shift();
    if (!rows) {
      throw new Error(
        `Scripted executor has no response for: ${renderQuery(query).sql}`
      );
    }
    const scriptedError = rows[0]?.__throw;
    if (scriptedError !== undefined) throw scriptedError;
    return { rows: rows as readonly Row[] };
  }

  async transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult> {
    this.transactionCount += 1;
    this.transactionIsolationLevels.push(config.isolationLevel);
    if (this.transactionFailures.length > 0) {
      this.rollbackCount += 1;
      throw this.transactionFailures.shift();
    }
    try {
      const result = await work(this);
      this.commitCount += 1;
      return result;
    } catch (error) {
      this.rollbackCount += 1;
      throw error;
    }
  }

  normalizedStatements(): string[] {
    return this.queries.map((query) => normalizeSql(renderQuery(query).sql));
  }

  expectExhausted(): void {
    expect(this.steps).toHaveLength(0);
  }
}

function participantInput(
  overrides: Partial<CreateInboxV2ConversationParticipantInput> = {}
): CreateInboxV2ConversationParticipantInput {
  return {
    tenantId,
    id: participantId,
    conversationId,
    subject: employeeSubject(),
    createdAt: occurredAt,
    ...overrides
  };
}

function startInput(
  overrides: Partial<StartInboxV2ParticipantMembershipEpisodeInput> = {}
): StartInboxV2ParticipantMembershipEpisodeInput {
  return {
    tenantId,
    conversationId,
    participantId,
    episodeId,
    transitionId,
    origin: { kind: "hulee_internal_command" },
    initialState: "active",
    role: "member",
    evidenceClassification: "confirmed",
    cause: {
      kind: "hulee_internal_command",
      actorEmployee: { tenantId, kind: "employee", id: employeeId }
    },
    reasonCodeId: "core:conversation-created" as never,
    expectedMembershipRevision: "0" as never,
    occurredAt,
    ...overrides
  };
}

function transitionInput(
  overrides: Partial<TransitionInboxV2ParticipantMembershipEpisodeInput> = {}
): TransitionInboxV2ParticipantMembershipEpisodeInput {
  return {
    tenantId,
    conversationId,
    episodeId,
    transitionId,
    intent: "change_role",
    nextRole: "admin",
    cause: {
      kind: "hulee_internal_command",
      actorEmployee: { tenantId, kind: "employee", id: employeeId }
    },
    reasonCodeId: "core:membership-role-changed" as never,
    expectedMembershipRevision: "1" as never,
    expectedEpisodeRevision: "1" as never,
    occurredAt: laterAt,
    ...overrides
  };
}

function participantRecord(
  overrides: Partial<InboxV2ConversationParticipant> = {}
): InboxV2ConversationParticipant {
  return {
    tenantId,
    id: participantId,
    conversation: { tenantId, kind: "conversation", id: conversationId },
    subject: employeeSubject(),
    revision: "1" as never,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    ...overrides
  };
}

function employeeSubject(): InboxV2ConversationParticipantSubject {
  return {
    kind: "employee",
    employee: { tenantId, kind: "employee", id: employeeId }
  };
}

function episodeRecord(
  overrides: Partial<InboxV2ParticipantMembershipEpisode> = {}
): InboxV2ParticipantMembershipEpisode {
  return {
    tenantId,
    id: episodeId,
    participant: {
      tenantId,
      kind: "conversation_participant",
      id: participantId
    },
    origin: { kind: "hulee_internal_command" },
    state: "active",
    role: "member",
    evidenceClassification: "confirmed",
    validFrom: occurredAt,
    validTo: null,
    revision: "1" as never,
    ...overrides
  };
}

function initialTransitionRecord(): InboxV2ParticipantMembershipTransition {
  return {
    tenantId,
    id: transitionId,
    episode: {
      tenantId,
      kind: "participant_membership_episode",
      id: episodeId
    },
    intent: "initial_active",
    fromState: null,
    toState: "active",
    fromRole: null,
    toRole: "member",
    cause: {
      kind: "hulee_internal_command",
      actorEmployee: { tenantId, kind: "employee", id: employeeId }
    },
    reasonCodeId: "core:conversation-created" as never,
    expectedRevision: null,
    currentRevision: null,
    resultingRevision: "1" as never,
    occurredAt
  };
}

function participantRow(
  participant: InboxV2ConversationParticipant,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const subjectColumns = participantSubjectRowColumns(participant.subject);
  return {
    tenant_id: participant.tenantId,
    id: participant.id,
    conversation_id: participant.conversation.id,
    ...subjectColumns,
    revision: participant.revision,
    created_at: participant.createdAt,
    updated_at: participant.updatedAt,
    ...overrides
  };
}

function participantSubjectRowColumns(
  subject: InboxV2ConversationParticipantSubject
): Record<string, unknown> {
  return {
    subject_kind: subject.kind,
    subject_employee_id:
      subject.kind === "employee" ? subject.employee.id : null,
    subject_source_external_identity_id:
      subject.kind === "source_external_identity"
        ? subject.sourceExternalIdentity.id
        : null,
    subject_client_contact_id:
      subject.kind === "client_contact" ? subject.clientContact.id : null,
    subject_bot_identity_id: subject.kind === "bot" ? subject.bot.id : null,
    subject_system_actor_id:
      subject.kind === "system" ? subject.systemActorId : null,
    subject_legacy_provenance_id:
      subject.kind === "legacy_unknown" ? subject.provenanceCodeId : null
  };
}

function episodeRow(
  episode: InboxV2ParticipantMembershipEpisode,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    tenant_id: episode.tenantId,
    id: episode.id,
    participant_id: episode.participant.id,
    conversation_id: conversationId,
    origin_kind: episode.origin.kind,
    origin_migration_provenance_id:
      episode.origin.kind === "migration" ? episode.origin.provenanceId : null,
    origin_system_policy_id:
      episode.origin.kind === "system_policy" ? episode.origin.policyId : null,
    state: episode.state,
    role: episode.role,
    evidence_classification: episode.evidenceClassification,
    valid_from: episode.validFrom,
    valid_to: episode.validTo,
    revision: episode.revision,
    ...overrides
  };
}

function successfulStartExecutor(): ScriptedMembershipExecutor {
  return new ScriptedMembershipExecutor([
    [{ membership_revision: "0" }],
    [participantRow(participantRecord())],
    [],
    [],
    [{ resulting_membership_revision: "1" }]
  ]);
}

function successfulTransitionExecutor(
  membershipRevision: string,
  episode: InboxV2ParticipantMembershipEpisode,
  _lockEmployee: boolean
): ScriptedMembershipExecutor {
  const steps: Array<readonly Record<string, unknown>[]> = [
    [{ membership_revision: membershipRevision }],
    [episodeRow(episode)],
    [
      {
        resulting_membership_revision: String(BigInt(membershipRevision) + 1n)
      }
    ]
  ];
  return new ScriptedMembershipExecutor(steps);
}

function writeStatements(executor: ScriptedMembershipExecutor): string[] {
  return executor
    .normalizedStatements()
    .filter(
      (statement) =>
        statement.startsWith("insert ") || statement.startsWith("update ")
    );
}

function statementKind(statement: string): string {
  if (
    statement.includes(
      "public.inbox_v2_apply_participant_membership_mutation_v1"
    )
  ) {
    return "apply_mutation";
  }
  if (statement.includes("inbox_v2_lock_conversation_membership_head_v1")) {
    return "lock_head";
  }
  if (statement.includes("from inbox_v2_conversation_participants")) {
    return "find_participant";
  }
  if (
    statement.includes("from inbox_v2_participant_membership_episodes") &&
    statement.includes("and id =")
  ) {
    return "find_episode";
  }
  if (statement.includes("from inbox_v2_participant_membership_episodes")) {
    return "find_current_origin";
  }
  return "unknown";
}

function renderQuery(query: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(query);
}

function normalizeSql(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}
