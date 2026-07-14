import {
  inboxV2BigintCounterSchema,
  inboxV2ConversationIdSchema,
  inboxV2ConversationParticipantIdSchema,
  inboxV2ConversationPurposeIdSchema,
  inboxV2EmployeeIdSchema,
  inboxV2EntityRevisionSchema,
  inboxV2LegacyParticipantProvenanceIdSchema,
  inboxV2ParticipantMembershipEpisodeIdSchema,
  inboxV2ParticipantMembershipReasonIdSchema,
  inboxV2ParticipantMembershipTransitionIdSchema,
  inboxV2TenantIdSchema,
  inboxV2TrustedServiceIdSchema,
  type InboxV2BigintCounter,
  type InboxV2ConversationId,
  type InboxV2ConversationParticipantId,
  type InboxV2EmployeeId,
  type InboxV2EntityRevision,
  type InboxV2ParticipantMembershipEpisodeId,
  type InboxV2ParticipantMembershipTransitionId,
  type InboxV2TenantId
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import { createSqlInboxV2ConversationRepository } from "./sql-inbox-v2-conversation-repository";
import {
  createSqlInboxV2ParticipantMembershipRepository,
  type InboxV2ParticipantMembershipTransactionExecutor,
  type RawSqlExecutor,
  type RawSqlQueryResult,
  type StartInboxV2ParticipantMembershipEpisodeInput,
  type TransitionInboxV2ParticipantMembershipEpisodeInput
} from "./sql-inbox-v2-participant-membership-repository";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const tenantId = inboxV2TenantIdSchema.parse(`tenant:db002-members-${runId}`);
const t0 = "2026-07-14T09:00:00.000Z";
const t1 = "2026-07-14T09:01:00.000Z";
const t1Half = "2026-07-14T09:01:30.000Z";
const t2 = "2026-07-14T09:02:00.000Z";
const t3 = "2026-07-14T09:03:00.000Z";
const migrationProvenanceA = inboxV2LegacyParticipantProvenanceIdSchema.parse(
  "core:legacy-v1-import-a"
);
const migrationProvenanceB = inboxV2LegacyParticipantProvenanceIdSchema.parse(
  "core:legacy-v1-import-b"
);
const migrationServiceId = inboxV2TrustedServiceIdSchema.parse(
  "core:migration-runner"
);

type ParticipantFixture = Readonly<{
  conversationId: InboxV2ConversationId;
  employeeId: InboxV2EmployeeId;
  participantId: InboxV2ConversationParticipantId;
}>;

describePostgres(
  "SQL Inbox V2 participant membership repository (PostgreSQL)",
  () => {
    let db: HuleeDatabase;
    let tenantSeeded = false;

    beforeAll(async () => {
      db = createHuleeDatabase();
      const readiness = await db.execute<{
        episodes: string | null;
        membershipHeads: string | null;
        transitions: string | null;
      }>(sql`
        select
          to_regclass(
            'public.inbox_v2_participant_membership_episodes'
          )::text as episodes,
          to_regclass(
            'public.inbox_v2_conversation_membership_heads'
          )::text as "membershipHeads",
          to_regclass(
            'public.inbox_v2_participant_membership_transitions'
          )::text as transitions
      `);
      const row = readiness.rows[0];
      if (
        row?.episodes === null ||
        row?.membershipHeads === null ||
        row?.transitions === null ||
        row === undefined
      ) {
        throw new Error(
          "Inbox V2 participant membership PostgreSQL tables are not migrated."
        );
      }

      await db.execute(sql`
        insert into tenants (id, slug, display_name, deployment_type)
        values (
          ${tenantId},
          ${`db002-members-${runId}`},
          'DB002 participant membership tenant',
          'saas_shared'
        )
      `);
      tenantSeeded = true;
    });

    afterAll(async () => {
      if (!db) return;

      try {
        if (tenantSeeded) {
          await deleteTestTenantGraph(db, tenantId);
        }
      } finally {
        await closeHuleeDatabase(db);
      }
    });

    it("starts and leaves one valid internal membership episode", async () => {
      const fixture = await seedInternalParticipant(db, "valid-leave");
      const repository = createSqlInboxV2ParticipantMembershipRepository(db);
      const episodeId = episode("valid-leave");

      const started = await repository.startEpisode(
        internalStartInput(fixture, episodeId, transition("valid-start"), t1)
      );
      expect(started).toMatchObject({
        kind: "created",
        record: {
          conversationMembershipRevision: "1",
          episode: {
            state: "active",
            role: "member",
            revision: "1",
            validTo: null
          }
        }
      });

      const left = await repository.transitionEpisode(
        internalTransitionInput(
          fixture,
          episodeId,
          transition("valid-leave"),
          "leave",
          null,
          counter("1"),
          revision("1"),
          t2
        )
      );
      expect(left).toMatchObject({
        kind: "updated",
        record: {
          conversationMembershipRevision: "2",
          episode: {
            state: "left",
            role: "member",
            validTo: t2,
            revision: "2"
          },
          transition: { intent: "leave", occurredAt: t2 }
        }
      });

      expect(await loadMembershipSnapshot(db, fixture.conversationId)).toEqual({
        commits: "2",
        currentEpisodes: "0",
        episodes: "1",
        membershipRevision: "2",
        transitions: "2"
      });
    });

    it("serializes concurrent same-origin starts to one CAS winner", async () => {
      const fixture = await seedInternalParticipant(db, "start-race");
      const repository = createSqlInboxV2ParticipantMembershipRepository(db);

      const results = await Promise.all([
        repository.startEpisode(
          internalStartInput(
            fixture,
            episode("start-race-a"),
            transition("start-race-a"),
            t1
          )
        ),
        repository.startEpisode(
          internalStartInput(
            fixture,
            episode("start-race-b"),
            transition("start-race-b"),
            t1
          )
        )
      ]);

      expect(results.map((result) => result.kind).sort()).toEqual([
        "created",
        "membership_revision_conflict"
      ]);
      const stale = results.find(
        (result) => result.kind === "membership_revision_conflict"
      );
      expect(stale).toMatchObject({ currentMembershipRevision: "1" });
      expect(await loadMembershipSnapshot(db, fixture.conversationId)).toEqual({
        commits: "1",
        currentEpisodes: "1",
        episodes: "1",
        membershipRevision: "1",
        transitions: "1"
      });
    });

    it("serializes concurrent role-change versus leave without a split projection", async () => {
      const fixture = await seedInternalParticipant(db, "transition-race");
      const repository = createSqlInboxV2ParticipantMembershipRepository(db);
      const episodeId = episode("transition-race");
      const started = await repository.startEpisode(
        internalStartInput(
          fixture,
          episodeId,
          transition("transition-race-start"),
          t1
        )
      );
      expect(started.kind).toBe("created");

      const [roleResult, leaveResult] = await Promise.all([
        repository.transitionEpisode(
          internalTransitionInput(
            fixture,
            episodeId,
            transition("transition-race-role"),
            "change_role",
            "admin",
            counter("1"),
            revision("1"),
            t2
          )
        ),
        repository.transitionEpisode(
          internalTransitionInput(
            fixture,
            episodeId,
            transition("transition-race-leave"),
            "leave",
            null,
            counter("1"),
            revision("1"),
            t2
          )
        )
      ]);

      expect([roleResult.kind, leaveResult.kind].sort()).toEqual([
        "membership_revision_conflict",
        "updated"
      ]);
      const finalEpisode = await repository.findEpisodeById({
        tenantId,
        episodeId
      });
      expect(finalEpisode?.revision).toBe("2");
      if (roleResult.kind === "updated") {
        expect(finalEpisode).toMatchObject({
          role: "admin",
          state: "active",
          validTo: null
        });
      } else {
        expect(leaveResult.kind).toBe("updated");
        expect(finalEpisode).toMatchObject({
          role: "member",
          state: "left",
          validTo: t2
        });
      }
      expect(await loadMembershipSnapshot(db, fixture.conversationId)).toEqual({
        commits: "2",
        currentEpisodes: roleResult.kind === "updated" ? "1" : "0",
        episodes: "1",
        membershipRevision: "2",
        transitions: "2"
      });
    });

    it("avoids a cross-Conversation cycle when internal transitions swap cause actors", async () => {
      const fixtureA = await seedInternalParticipant(db, "cross-cycle-a");
      const fixtureB = await seedInternalParticipant(db, "cross-cycle-b");
      const setupRepository =
        createSqlInboxV2ParticipantMembershipRepository(db);
      const episodeA = episode("cross-cycle-a");
      const episodeB = episode("cross-cycle-b");
      expect(
        (
          await setupRepository.startEpisode(
            internalStartInput(
              fixtureA,
              episodeA,
              transition("cross-cycle-start-a"),
              t1
            )
          )
        ).kind
      ).toBe("created");
      expect(
        (
          await setupRepository.startEpisode(
            internalStartInput(
              fixtureB,
              episodeB,
              transition("cross-cycle-start-b"),
              t1
            )
          )
        ).kind
      ).toBe("created");

      const barrierExecutor = new EmployeeLockBarrierExecutor(db, 2);
      const racingRepository =
        createSqlInboxV2ParticipantMembershipRepository(barrierExecutor);
      const [resultA, resultB] = await Promise.all([
        racingRepository.transitionEpisode(
          internalTransitionInput(
            fixtureA,
            episodeA,
            transition("cross-cycle-role-a"),
            "change_role",
            "admin",
            counter("1"),
            revision("1"),
            t2,
            fixtureB.employeeId
          )
        ),
        racingRepository.transitionEpisode(
          internalTransitionInput(
            fixtureB,
            episodeB,
            transition("cross-cycle-role-b"),
            "change_role",
            "admin",
            counter("1"),
            revision("1"),
            t2,
            fixtureA.employeeId
          )
        )
      ]);

      expect([resultA.kind, resultB.kind]).toEqual(["updated", "updated"]);
      await expect(
        setupRepository.findEpisodeById({ tenantId, episodeId: episodeA })
      ).resolves.toMatchObject({
        state: "active",
        role: "admin",
        revision: "2"
      });
      await expect(
        setupRepository.findEpisodeById({ tenantId, episodeId: episodeB })
      ).resolves.toMatchObject({
        state: "active",
        role: "admin",
        revision: "2"
      });
      expect(await loadMembershipSnapshot(db, fixtureA.conversationId)).toEqual(
        {
          commits: "2",
          currentEpisodes: "1",
          episodes: "1",
          membershipRevision: "2",
          transitions: "2"
        }
      );
      expect(await loadMembershipSnapshot(db, fixtureB.conversationId)).toEqual(
        {
          commits: "2",
          currentEpisodes: "1",
          episodes: "1",
          membershipRevision: "2",
          transitions: "2"
        }
      );
    });

    it("lets a waiting start observe committed deactivation and create no membership", async () => {
      const fixture = await seedInternalParticipant(db, "deactivate-wait");
      const repository = createSqlInboxV2ParticipantMembershipRepository(db);
      let markDeactivationLocked = (): void => undefined;
      let releaseDeactivation = (): void => undefined;
      const deactivationLocked = new Promise<void>((resolve) => {
        markDeactivationLocked = resolve;
      });
      const deactivationRelease = new Promise<void>((resolve) => {
        releaseDeactivation = resolve;
      });

      const deactivation = db.transaction(async (transactionExecutor) => {
        await transactionExecutor.execute(sql`
          update employees
          set deactivated_at = ${t2}, updated_at = ${t2}
          where tenant_id = ${tenantId}
            and id = ${fixture.employeeId}
        `);
        markDeactivationLocked();
        await deactivationRelease;
      });
      await deactivationLocked;

      let startSettled = false;
      const start = repository
        .startEpisode(
          internalStartInput(
            fixture,
            episode("deactivate-wait"),
            transition("deactivate-wait"),
            t3
          )
        )
        .finally(() => {
          startSettled = true;
        });

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(startSettled).toBe(false);
      releaseDeactivation();

      const [, startResult] = await Promise.all([deactivation, start]);
      expect(startResult).toEqual({ kind: "participant_not_found" });
      expect(await loadMembershipSnapshot(db, fixture.conversationId)).toEqual({
        commits: "0",
        currentEpisodes: "0",
        episodes: "0",
        membershipRevision: "0",
        transitions: "0"
      });
      const employee = await db.execute<{ deactivatedAt: unknown }>(sql`
        select deactivated_at as "deactivatedAt"
        from employees
        where tenant_id = ${tenantId}
          and id = ${fixture.employeeId}
      `);
      expect(databaseTimestamp(employee.rows[0]?.deactivatedAt)).toBe(t2);
    });

    it("rejects a raw mutation of immutable Conversation transport", async () => {
      const conversationId = await seedConversation(
        db,
        "transport",
        "internal"
      );

      await expectPostgresError(
        db.execute(sql`
          update inbox_v2_conversations
          set transport = 'external', updated_at = ${t1}
          where tenant_id = ${tenantId}
            and id = ${conversationId}
        `),
        /inbox_v2\.conversation_transport_immutable/u
      );

      const persisted = await db.execute<{ transport: string }>(sql`
        select transport
        from inbox_v2_conversations
        where tenant_id = ${tenantId}
          and id = ${conversationId}
      `);
      expect(persisted.rows).toEqual([{ transport: "internal" }]);
    });

    it("rejects a backdated rejoin after a terminal episode and accepts the exact boundary retry", async () => {
      const fixture = await seedInternalParticipant(db, "rejoin-boundary");
      const repository = createSqlInboxV2ParticipantMembershipRepository(db);
      const firstEpisodeId = episode("rejoin-first");
      const started = await repository.startEpisode(
        migrationStartInput(
          fixture,
          firstEpisodeId,
          transition("rejoin-first"),
          counter("0"),
          t1
        )
      );
      expect(started.kind).toBe("created");
      const left = await repository.transitionEpisode(
        migrationTransitionInput(
          fixture,
          firstEpisodeId,
          transition("rejoin-left"),
          counter("1"),
          revision("1"),
          t2
        )
      );
      expect(left.kind).toBe("updated");

      await expectPostgresError(
        repository.startEpisode(
          migrationStartInput(
            fixture,
            episode("rejoin-backdated"),
            transition("rejoin-backdated"),
            counter("2"),
            t1Half
          )
        ),
        /inbox_v2\.(conversation_membership_commit_time_invalid|membership_episode_history_overlap)/u
      );
      expect(await loadMembershipSnapshot(db, fixture.conversationId)).toEqual({
        commits: "2",
        currentEpisodes: "0",
        episodes: "1",
        membershipRevision: "2",
        transitions: "2"
      });

      const boundaryRetry = await repository.startEpisode(
        migrationStartInput(
          fixture,
          episode("rejoin-boundary"),
          transition("rejoin-boundary"),
          counter("2"),
          t2
        )
      );
      expect(boundaryRetry).toMatchObject({
        kind: "created",
        record: {
          conversationMembershipRevision: "3",
          episode: { state: "active", validFrom: t2 }
        }
      });
      expect(await loadMembershipSnapshot(db, fixture.conversationId)).toEqual({
        commits: "3",
        currentEpisodes: "1",
        episodes: "2",
        membershipRevision: "3",
        transitions: "3"
      });
    });

    it("rejects raw migration origin provenance A with transition cause provenance B", async () => {
      const fixture = await seedInternalParticipant(db, "raw-provenance");
      const episodeId = episode("raw-provenance");
      const transitionId = transition("raw-provenance");

      await expectPostgresError(
        db.transaction(async (transactionExecutor) => {
          await insertRawMigrationCommit(
            transactionExecutor,
            fixture.conversationId,
            counter("0"),
            counter("1"),
            t1
          );
          await insertRawMigrationEpisode(
            transactionExecutor,
            fixture,
            episodeId,
            migrationProvenanceA,
            t1
          );
          await insertRawInitialMigrationTransition(
            transactionExecutor,
            fixture,
            episodeId,
            transitionId,
            migrationProvenanceB,
            t1
          );
          await advanceRawMembershipHead(
            transactionExecutor,
            fixture.conversationId,
            counter("0"),
            counter("1"),
            t1
          );
        }),
        /inbox_v2\.membership_transition_origin_evidence_mismatch/u
      );

      expect(await loadMembershipSnapshot(db, fixture.conversationId)).toEqual({
        commits: "0",
        currentEpisodes: "0",
        episodes: "0",
        membershipRevision: "0",
        transitions: "0"
      });
    });

    it("rejects commit, transition and head timestamp mismatch and rolls the raw bundle back", async () => {
      const fixture = await seedInternalParticipant(db, "raw-time-mismatch");
      const episodeId = episode("raw-time-mismatch");
      const transitionId = transition("raw-time-mismatch");

      await expectPostgresError(
        db.transaction(async (transactionExecutor) => {
          await insertRawMigrationCommit(
            transactionExecutor,
            fixture.conversationId,
            counter("0"),
            counter("1"),
            t1
          );
          await insertRawMigrationEpisode(
            transactionExecutor,
            fixture,
            episodeId,
            migrationProvenanceA,
            t1
          );
          await insertRawInitialMigrationTransition(
            transactionExecutor,
            fixture,
            episodeId,
            transitionId,
            migrationProvenanceA,
            t2
          );
          await advanceRawMembershipHead(
            transactionExecutor,
            fixture.conversationId,
            counter("0"),
            counter("1"),
            t3
          );
        }),
        /inbox_v2\.(conversation_membership_commit_uninduced|conversation_membership_head_projection_invalid|participant_membership_episode_projection_invalid)/u
      );

      expect(await loadMembershipSnapshot(db, fixture.conversationId)).toEqual({
        commits: "0",
        currentEpisodes: "0",
        episodes: "0",
        membershipRevision: "0",
        transitions: "0"
      });
    });
  }
);

async function seedInternalParticipant(
  db: HuleeDatabase,
  suffix: string
): Promise<ParticipantFixture> {
  const conversationId = await seedConversation(db, suffix, "internal");
  const employeeId = employee(suffix);
  const participantId = participant(suffix);
  await db.execute(sql`
    insert into employees (
      id,
      tenant_id,
      email,
      display_name,
      profile,
      created_at,
      updated_at
    ) values (
      ${employeeId},
      ${tenantId},
      ${`db002-${suffix}-${runId}@example.test`},
      ${`DB002 ${suffix}`},
      '{}'::jsonb,
      ${t0},
      ${t0}
    )
  `);

  const created = await createSqlInboxV2ParticipantMembershipRepository(
    db
  ).createParticipant({
    tenantId,
    id: participantId,
    conversationId,
    subject: {
      kind: "employee",
      employee: { tenantId, kind: "employee", id: employeeId }
    },
    createdAt: t0
  });
  if (created.kind !== "created") {
    throw new Error(`Expected seeded participant, got ${created.kind}.`);
  }

  return { conversationId, employeeId, participantId };
}

async function seedConversation(
  db: HuleeDatabase,
  suffix: string,
  transport: "internal" | "external"
): Promise<InboxV2ConversationId> {
  const conversationId = conversation(suffix);
  const created = await createSqlInboxV2ConversationRepository(db).create({
    tenantId,
    conversationId,
    topology: "group",
    transport,
    purposeId: inboxV2ConversationPurposeIdSchema.parse("core:chat"),
    lifecycle: "active",
    streamPosition: counter("1"),
    createdAt: t0
  });
  if (created.kind !== "created") {
    throw new Error(`Expected seeded Conversation, got ${created.kind}.`);
  }
  return conversationId;
}

function internalStartInput(
  fixture: ParticipantFixture,
  episodeId: InboxV2ParticipantMembershipEpisodeId,
  transitionId: InboxV2ParticipantMembershipTransitionId,
  occurredAt: string
): StartInboxV2ParticipantMembershipEpisodeInput {
  return {
    tenantId,
    conversationId: fixture.conversationId,
    participantId: fixture.participantId,
    episodeId,
    transitionId,
    origin: { kind: "hulee_internal_command" },
    initialState: "active",
    role: "member",
    evidenceClassification: "confirmed",
    cause: {
      kind: "hulee_internal_command",
      actorEmployee: {
        tenantId,
        kind: "employee",
        id: fixture.employeeId
      }
    },
    reasonCodeId: inboxV2ParticipantMembershipReasonIdSchema.parse(
      "core:conversation-created"
    ),
    expectedMembershipRevision: counter("0"),
    occurredAt
  };
}

function internalTransitionInput(
  fixture: ParticipantFixture,
  episodeId: InboxV2ParticipantMembershipEpisodeId,
  transitionId: InboxV2ParticipantMembershipTransitionId,
  intent: "change_role" | "leave",
  nextRole: "admin" | null,
  expectedMembershipRevision: InboxV2BigintCounter,
  expectedEpisodeRevision: InboxV2EntityRevision,
  occurredAt: string,
  causeActorEmployeeId: InboxV2EmployeeId = fixture.employeeId
): TransitionInboxV2ParticipantMembershipEpisodeInput {
  return {
    tenantId,
    conversationId: fixture.conversationId,
    episodeId,
    transitionId,
    intent,
    nextRole,
    cause: {
      kind: "hulee_internal_command",
      actorEmployee: {
        tenantId,
        kind: "employee",
        id: causeActorEmployeeId
      }
    },
    reasonCodeId: inboxV2ParticipantMembershipReasonIdSchema.parse(
      intent === "leave"
        ? "core:membership-left"
        : "core:membership-role-changed"
    ),
    expectedMembershipRevision,
    expectedEpisodeRevision,
    occurredAt
  };
}

function migrationStartInput(
  fixture: ParticipantFixture,
  episodeId: InboxV2ParticipantMembershipEpisodeId,
  transitionId: InboxV2ParticipantMembershipTransitionId,
  expectedMembershipRevision: InboxV2BigintCounter,
  occurredAt: string
): StartInboxV2ParticipantMembershipEpisodeInput {
  return {
    tenantId,
    conversationId: fixture.conversationId,
    participantId: fixture.participantId,
    episodeId,
    transitionId,
    origin: { kind: "migration", provenanceId: migrationProvenanceA },
    initialState: "active",
    role: "member",
    evidenceClassification: "imported",
    cause: {
      kind: "migration",
      trustedServiceId: migrationServiceId,
      provenanceId: migrationProvenanceA
    },
    reasonCodeId: inboxV2ParticipantMembershipReasonIdSchema.parse(
      "core:migration-import"
    ),
    expectedMembershipRevision,
    occurredAt
  };
}

function migrationTransitionInput(
  fixture: ParticipantFixture,
  episodeId: InboxV2ParticipantMembershipEpisodeId,
  transitionId: InboxV2ParticipantMembershipTransitionId,
  expectedMembershipRevision: InboxV2BigintCounter,
  expectedEpisodeRevision: InboxV2EntityRevision,
  occurredAt: string
): TransitionInboxV2ParticipantMembershipEpisodeInput {
  return {
    tenantId,
    conversationId: fixture.conversationId,
    episodeId,
    transitionId,
    intent: "leave",
    nextRole: null,
    cause: {
      kind: "migration",
      trustedServiceId: migrationServiceId,
      provenanceId: migrationProvenanceA
    },
    reasonCodeId: inboxV2ParticipantMembershipReasonIdSchema.parse(
      "core:membership-left"
    ),
    expectedMembershipRevision,
    expectedEpisodeRevision,
    occurredAt
  };
}

type SqlExecutor = Pick<HuleeDatabase, "execute">;

async function insertRawMigrationCommit(
  executor: SqlExecutor,
  conversationId: InboxV2ConversationId,
  expectedMembershipRevision: InboxV2BigintCounter,
  resultingMembershipRevision: InboxV2BigintCounter,
  occurredAt: string
): Promise<void> {
  await executor.execute(sql`
    insert into inbox_v2_conversation_membership_commits (
      tenant_id,
      conversation_id,
      expected_membership_revision,
      resulting_membership_revision,
      occurred_at
    ) values (
      ${tenantId},
      ${conversationId},
      ${expectedMembershipRevision},
      ${resultingMembershipRevision},
      ${occurredAt}
    )
  `);
}

async function insertRawMigrationEpisode(
  executor: SqlExecutor,
  fixture: ParticipantFixture,
  episodeId: InboxV2ParticipantMembershipEpisodeId,
  provenanceId: typeof migrationProvenanceA,
  validFrom: string
): Promise<void> {
  await executor.execute(sql`
    insert into inbox_v2_participant_membership_episodes (
      tenant_id,
      id,
      participant_id,
      conversation_id,
      origin_kind,
      origin_migration_provenance_id,
      origin_system_policy_id,
      state,
      role,
      evidence_classification,
      valid_from,
      valid_to,
      revision
    ) values (
      ${tenantId},
      ${episodeId},
      ${fixture.participantId},
      ${fixture.conversationId},
      'migration',
      ${provenanceId},
      null,
      'active',
      'member',
      'imported',
      ${validFrom},
      null,
      1
    )
  `);
}

async function insertRawInitialMigrationTransition(
  executor: SqlExecutor,
  fixture: ParticipantFixture,
  episodeId: InboxV2ParticipantMembershipEpisodeId,
  transitionId: InboxV2ParticipantMembershipTransitionId,
  causeProvenanceId: typeof migrationProvenanceA,
  occurredAt: string
): Promise<void> {
  await executor.execute(sql`
    insert into inbox_v2_participant_membership_transitions (
      tenant_id,
      id,
      episode_id,
      participant_id,
      conversation_id,
      membership_revision,
      intent,
      from_state,
      to_state,
      from_role,
      to_role,
      cause_kind,
      cause_actor_employee_id,
      cause_trusted_service_id,
      cause_migration_provenance_id,
      cause_system_policy_id,
      reason_code_id,
      expected_revision,
      current_revision,
      resulting_revision,
      occurred_at
    ) values (
      ${tenantId},
      ${transitionId},
      ${episodeId},
      ${fixture.participantId},
      ${fixture.conversationId},
      1,
      'initial_active',
      null,
      'active',
      null,
      'member',
      'migration',
      null,
      ${migrationServiceId},
      ${causeProvenanceId},
      null,
      'core:migration-import',
      null,
      null,
      1,
      ${occurredAt}
    )
  `);
}

async function advanceRawMembershipHead(
  executor: SqlExecutor,
  conversationId: InboxV2ConversationId,
  expectedMembershipRevision: InboxV2BigintCounter,
  resultingMembershipRevision: InboxV2BigintCounter,
  changedAt: string
): Promise<void> {
  await executor.execute(sql`
    update inbox_v2_conversation_membership_heads
    set membership_revision = ${resultingMembershipRevision},
        updated_at = ${changedAt}
    where tenant_id = ${tenantId}
      and conversation_id = ${conversationId}
      and membership_revision = ${expectedMembershipRevision}
  `);
}

async function loadMembershipSnapshot(
  db: HuleeDatabase,
  conversationId: InboxV2ConversationId
): Promise<{
  commits: string;
  currentEpisodes: string;
  episodes: string;
  membershipRevision: string;
  transitions: string;
}> {
  const result = await db.execute<{
    commits: string;
    currentEpisodes: string;
    episodes: string;
    membershipRevision: string;
    transitions: string;
  }>(sql`
    select
      (
        select membership_revision::text
        from inbox_v2_conversation_membership_heads
        where tenant_id = ${tenantId}
          and conversation_id = ${conversationId}
      ) as "membershipRevision",
      (
        select count(*)::text
        from inbox_v2_conversation_membership_commits
        where tenant_id = ${tenantId}
          and conversation_id = ${conversationId}
      ) as commits,
      (
        select count(*)::text
        from inbox_v2_participant_membership_episodes
        where tenant_id = ${tenantId}
          and conversation_id = ${conversationId}
      ) as episodes,
      (
        select count(*)::text
        from inbox_v2_participant_membership_episodes
        where tenant_id = ${tenantId}
          and conversation_id = ${conversationId}
          and state in ('pending', 'active')
      ) as "currentEpisodes",
      (
        select count(*)::text
        from inbox_v2_participant_membership_transitions
        where tenant_id = ${tenantId}
          and conversation_id = ${conversationId}
      ) as transitions
  `);
  const row = result.rows[0];
  if (!row) throw new Error("Expected participant membership snapshot row.");
  return row;
}

async function deleteTestTenantGraph(
  db: HuleeDatabase,
  checkedTenantId: InboxV2TenantId
): Promise<void> {
  await db.transaction(async (transactionExecutor) => {
    await transactionExecutor.execute(
      sql`set local session_replication_role = 'replica'`
    );
    await transactionExecutor.execute(sql`
      delete from inbox_v2_participant_membership_transitions
      where tenant_id = ${checkedTenantId}
    `);
    await transactionExecutor.execute(sql`
      delete from inbox_v2_participant_membership_episodes
      where tenant_id = ${checkedTenantId}
    `);
    await transactionExecutor.execute(sql`
      delete from inbox_v2_conversation_membership_commits
      where tenant_id = ${checkedTenantId}
    `);
    await transactionExecutor.execute(sql`
      delete from inbox_v2_conversation_participants
      where tenant_id = ${checkedTenantId}
    `);
    await transactionExecutor.execute(sql`
      delete from inbox_v2_conversation_membership_heads
      where tenant_id = ${checkedTenantId}
    `);
    await transactionExecutor.execute(sql`
      delete from inbox_v2_conversation_heads
      where tenant_id = ${checkedTenantId}
    `);
    await transactionExecutor.execute(sql`
      delete from inbox_v2_conversations
      where tenant_id = ${checkedTenantId}
    `);
    await transactionExecutor.execute(sql`
      delete from employees
      where tenant_id = ${checkedTenantId}
    `);
    await transactionExecutor.execute(sql`
      delete from tenants
      where id = ${checkedTenantId}
    `);
  });
}

function conversation(suffix: string): InboxV2ConversationId {
  return inboxV2ConversationIdSchema.parse(
    `conversation:db002-members-${suffix}-${runId}`
  );
}

function employee(suffix: string): InboxV2EmployeeId {
  return inboxV2EmployeeIdSchema.parse(`employee:db002-${suffix}-${runId}`);
}

function participant(suffix: string): InboxV2ConversationParticipantId {
  return inboxV2ConversationParticipantIdSchema.parse(
    `conversation_participant:db002-${suffix}-${runId}`
  );
}

function episode(suffix: string): InboxV2ParticipantMembershipEpisodeId {
  return inboxV2ParticipantMembershipEpisodeIdSchema.parse(
    `participant_membership_episode:db002-${suffix}-${runId}`
  );
}

function transition(suffix: string): InboxV2ParticipantMembershipTransitionId {
  return inboxV2ParticipantMembershipTransitionIdSchema.parse(
    `participant_membership_transition:db002-${suffix}-${runId}`
  );
}

function counter(value: string): InboxV2BigintCounter {
  return inboxV2BigintCounterSchema.parse(value);
}

function revision(value: string): InboxV2EntityRevision {
  return inboxV2EntityRevisionSchema.parse(value);
}

class EmployeeLockBarrierExecutor implements InboxV2ParticipantMembershipTransactionExecutor {
  private readonly barrier: AsyncBarrier;

  constructor(
    private readonly db: HuleeDatabase,
    parties: number
  ) {
    this.barrier = new AsyncBarrier(parties);
  }

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    const result = await this.db.execute<Row>(query);
    return { rows: result.rows as readonly Row[] };
  }

  async transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>
  ): Promise<TResult> {
    return this.db.transaction(async (transactionExecutor) =>
      work({
        execute: async <Row extends Record<string, unknown>>(
          query: SQL
        ): Promise<RawSqlQueryResult<Row>> => {
          const result = await transactionExecutor.execute<Row>(query);
          if (isInternalEmployeeNoKeyUpdateLock(query)) {
            await this.barrier.arrive();
          }
          return { rows: result.rows as readonly Row[] };
        }
      })
    );
  }
}

class AsyncBarrier {
  private arrived = 0;
  private readonly opened: Promise<void>;
  private open = (): void => undefined;

  constructor(private readonly parties: number) {
    this.opened = new Promise<void>((resolve) => {
      this.open = resolve;
    });
  }

  async arrive(): Promise<void> {
    this.arrived += 1;
    if (this.arrived === this.parties) this.open();

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for Employee lock barrier.")),
        5_000
      );
      this.opened.then(
        () => {
          clearTimeout(timeout);
          resolve();
        },
        (error: unknown) => {
          clearTimeout(timeout);
          reject(error);
        }
      );
    });
  }
}

function isInternalEmployeeNoKeyUpdateLock(query: SQL): boolean {
  const rendered = new PgDialect()
    .sqlToQuery(query)
    .sql.trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
  return rendered.includes("for no key update of employee_row");
}

async function expectPostgresError(
  operation: Promise<unknown>,
  expected: RegExp
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(errorChainMessages(error)).toMatch(expected);
    return;
  }
  throw new Error(`Expected PostgreSQL operation to fail with ${expected}.`);
}

function errorChainMessages(error: unknown): string {
  const messages: string[] = [];
  const visited = new Set<object>();
  let current: unknown = error;

  while (typeof current === "object" && current !== null) {
    if (visited.has(current)) break;
    visited.add(current);
    if ("message" in current && typeof current.message === "string") {
      messages.push(current.message);
    }
    current = "cause" in current ? current.cause : undefined;
  }

  return messages.join("\n");
}

function databaseTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const timestamp = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("Expected a PostgreSQL timestamp value.");
  }
  return timestamp.toISOString();
}
