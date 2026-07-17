import { createHash } from "node:crypto";

import {
  INBOX_V2_INITIAL_SCHEMA_VERSION,
  INBOX_V2_TENANT_STREAM_SCHEMA_VERSION,
  calculateInboxV2CanonicalSha256,
  inboxV2ApplyProjectionContiguousInputSchema,
  inboxV2CompareAndSetRetainedPrefixInputSchema,
  inboxV2OutboxIntentIdSchema,
  inboxV2OutboxWorkerIdSchema,
  inboxV2ProjectionCheckpointSchema,
  inboxV2ProjectionIdSchema,
  inboxV2RecipientScopeIdSchema,
  inboxV2SchemaVersionTokenSchema,
  inboxV2Sha256DigestSchema,
  inboxV2StreamEpochSchema,
  inboxV2SyncGenerationSchema,
  inboxV2TenantIdSchema,
  inboxV2TenantStreamCommitIdSchema,
  inboxV2TenantStreamCommitPositionSchema,
  inboxV2TenantStreamPositionSchema
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import {
  createSqlInboxV2RepositoryOutbox,
  type InboxV2RepositoryOutboxTransactionExecutor
} from "./sql-inbox-v2-repository-outbox";
import {
  createSqlInboxV2RepositoryProjection,
  createSqlInboxV2RepositoryRetainedPrefix,
  type InboxV2RepositoryProjectionTransactionExecutor
} from "./sql-inbox-v2-repository-projection";
import {
  createSqlInboxV2TenantStreamRepository,
  type InboxV2TenantStreamTransactionExecutor
} from "./sql-inbox-v2-repository-stream";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const projectionId = inboxV2ProjectionIdSchema.parse(
  "core:db007.repository-probe"
);
const projectionScopeId = inboxV2RecipientScopeIdSchema.parse(
  `employee-inbox:db007-${runId}`
);
const generation = inboxV2SyncGenerationSchema.parse("1");
const initialSchemaVersion = inboxV2SchemaVersionTokenSchema.parse(
  INBOX_V2_INITIAL_SCHEMA_VERSION
);
const tenantStreamSchemaVersion = inboxV2SchemaVersionTokenSchema.parse(
  INBOX_V2_TENANT_STREAM_SCHEMA_VERSION
);
const workerA = inboxV2OutboxWorkerIdSchema.parse("core:db007.worker-a");
const workerB = inboxV2OutboxWorkerIdSchema.parse("core:db007.worker-b");
const leaseTokenA = `db007-token-a-${"a".repeat(48)}`;
const leaseTokenB = `db007-token-b-${"b".repeat(48)}`;

type FoundationExecutor = InboxV2RepositoryProjectionTransactionExecutor &
  InboxV2RepositoryOutboxTransactionExecutor &
  InboxV2TenantStreamTransactionExecutor;

type StreamFixture = Readonly<{
  tenantId: ReturnType<typeof inboxV2TenantIdSchema.parse>;
  streamEpoch: ReturnType<typeof inboxV2StreamEpochSchema.parse>;
  label: string;
}>;

type SeededCommit = Readonly<{
  commitId: ReturnType<typeof inboxV2TenantStreamCommitIdSchema.parse>;
  intentId: ReturnType<typeof inboxV2OutboxIntentIdSchema.parse> | null;
}>;

describePostgres("SQL Inbox V2 repository foundation (live PostgreSQL)", () => {
  let db: HuleeDatabase;

  beforeAll(async () => {
    db = createHuleeDatabase({ poolConfig: { max: 4 } });
    const readiness = await db.execute<{
      projections: string | null;
      outboxWork: string | null;
      retentionAudit: string | null;
      controlledAdvance: string | null;
    }>(sql`
        select
          to_regclass('public.inbox_v2_projection_generations')::text
            as projections,
          to_regclass('public.inbox_v2_outbox_work_items')::text
            as "outboxWork",
          to_regclass('public.inbox_v2_tenant_stream_retention_advances')::text
            as "retentionAudit",
          to_regprocedure(
            'public.inbox_v2_advance_tenant_stream_retained_prefix_v1(text,text,bigint,bigint,bigint,bigint,text,text,timestamptz)'
          )::text as "controlledAdvance"
      `);
    const row = readiness.rows[0];
    if (
      row === undefined ||
      Object.values(row).some((value) => value === null)
    ) {
      throw new Error(
        "Inbox V2 repository migration 0036 with atomic retained-prefix advance is not applied."
      );
    }
  }, 30_000);

  afterAll(async () => {
    if (db) await closeHuleeDatabase(db);
  });

  it("bootstraps a nonzero projection and atomically applies only contiguous relevant input", async () => {
    await withRolledBackFixture(db, async (executor) => {
      const fixture = await createStreamFixture(executor, "projection");
      const commits = new Map<number, SeededCommit>();
      for (let position = 1; position <= 8; position += 1) {
        commits.set(
          position,
          await seedStreamCommit(executor, fixture, position, false)
        );
      }
      await executor.execute(sql`
          create temporary table db007_projection_apply_probe (
            tenant_id text not null,
            stream_position bigint not null,
            commit_id text not null,
            primary key (tenant_id, stream_position)
          ) on commit drop
        `);

      const failedCommitId = requiredCommit(commits, 7).commitId;
      let callbackCount = 0;
      const repository = createSqlInboxV2RepositoryProjection(executor, {
        applyProjectionRows: async ({ executor: transaction, transition }) => {
          callbackCount += 1;
          await transaction.execute(sql`
              insert into db007_projection_apply_probe (
                tenant_id, stream_position, commit_id
              ) values (
                ${fixture.tenantId},
                ${transition.input.streamPosition},
                ${transition.input.commitId}
              )
            `);
          if (transition.input.commitId === failedCommitId) {
            throw new Error("forced DB-007 projection callback rollback");
          }
        }
      });
      const initializedAt = await databaseTimestamp(executor);
      const initialized = await repository.initializeGeneration({
        context: { tenantId: fixture.tenantId },
        projectionId,
        scopeId: projectionScopeId,
        streamEpoch: fixture.streamEpoch,
        syncGeneration: generation,
        projectionSchemaVersion: initialSchemaVersion,
        initialPosition: checkpoint("5"),
        minRetainedPosition: checkpoint("0"),
        initialState: "active",
        initializedAt
      });
      expect(initialized).toMatchObject({
        outcome: "initialized",
        snapshot: {
          generation: { state: "active", minRetainedPosition: "0" },
          checkpoint: { position: "5" }
        }
      });
      await executor.execute(sql`set constraints all immediate`);

      const appliedInput = projectionApplyInput(
        fixture,
        requiredCommit(commits, 6).commitId,
        6,
        "5"
      );
      await expect(
        repository.applyContiguous(appliedInput)
      ).resolves.toMatchObject({
        outcome: "applied",
        transition: {
          before: { position: "5" },
          after: { position: "6" },
          disposition: "applied"
        }
      });
      expect(callbackCount).toBe(1);

      await expect(
        repository.applyContiguous(appliedInput)
      ).resolves.toMatchObject({
        outcome: "duplicate",
        currentCheckpoint: "6",
        receivedPosition: "6"
      });
      await expect(
        repository.applyContiguous(
          projectionApplyInput(
            fixture,
            requiredCommit(commits, 8).commitId,
            8,
            "6"
          )
        )
      ).resolves.toMatchObject({
        outcome: "gap_detected",
        currentCheckpoint: "6",
        expectedPosition: "7",
        observedPosition: "8"
      });
      expect(callbackCount).toBe(1);

      const inventedCommitId = inboxV2TenantStreamCommitIdSchema.parse(
        `commit:db007:invented:7:${runId}`
      );
      await expectDatabaseFailure(
        repository.applyContiguous(
          projectionApplyInput(fixture, inventedCommitId, 7, "6")
        ),
        "23503",
        "inbox_v2_projection_checkpoints_commit_fk"
      );
      expect(callbackCount).toBe(2);
      await expect(
        repository.loadGeneration({
          context: { tenantId: fixture.tenantId },
          projectionId,
          scopeId: projectionScopeId,
          syncGeneration: generation
        })
      ).resolves.toMatchObject({
        outcome: "found",
        snapshot: { checkpoint: { position: "6" } }
      });
      const probeAfterInventedCommit = await executor.execute<{
        stream_position: string;
        commit_id: string;
      }>(sql`
        select stream_position::text, commit_id
          from db007_projection_apply_probe
         where tenant_id = ${fixture.tenantId}
         order by stream_position
      `);
      expect(probeAfterInventedCommit.rows).toEqual([
        {
          stream_position: "6",
          commit_id: requiredCommit(commits, 6).commitId
        }
      ]);

      await expect(
        repository.applyContiguous(
          projectionApplyInput(fixture, failedCommitId, 7, "6")
        )
      ).rejects.toThrow("forced DB-007 projection callback rollback");
      expect(callbackCount).toBe(3);
      await expect(
        repository.loadGeneration({
          context: { tenantId: fixture.tenantId },
          projectionId,
          scopeId: projectionScopeId,
          syncGeneration: generation
        })
      ).resolves.toMatchObject({
        outcome: "found",
        snapshot: { checkpoint: { position: "6" } }
      });
      const probe = await executor.execute<{
        stream_position: string;
        commit_id: string;
      }>(sql`
          select stream_position::text, commit_id
            from db007_projection_apply_probe
           where tenant_id = ${fixture.tenantId}
           order by stream_position
        `);
      expect(probe.rows).toEqual([
        {
          stream_position: "6",
          commit_id: requiredCommit(commits, 6).commitId
        }
      ]);
    });
  }, 30_000);

  it("cannot advertise position 2 past an in-flight position 1 and replays both contiguously", async () => {
    const fixtureTenant = fixtureTenantId("stream-snapshot");
    const firstWriterDb = createHuleeDatabase({ poolConfig: { max: 1 } });
    const secondWriterDb = createHuleeDatabase({ poolConfig: { max: 1 } });
    const readerDb = createHuleeDatabase({ poolConfig: { max: 1 } });
    let releaseFirstWriter = (): void => undefined;
    let firstWriterPromise: Promise<void> | null = null;
    let secondWriterPromise: Promise<void> | null = null;
    try {
      const fixture = await createStreamFixture(
        db as unknown as FoundationExecutor,
        "stream-snapshot"
      );
      let markWriterReady!: () => void;
      const writerReady = new Promise<void>((resolve) => {
        markWriterReady = resolve;
      });
      const firstWriterRelease = new Promise<void>((resolve) => {
        releaseFirstWriter = resolve;
      });
      let firstWriterError: unknown = null;
      firstWriterPromise = firstWriterDb.transaction(async (transaction) => {
        await transaction.execute(sql`
          select tenant_id
            from inbox_v2_tenant_stream_heads
           where tenant_id = ${fixture.tenantId}
           for update
        `);
        await seedStreamCommit(
          transaction as unknown as FoundationExecutor,
          fixture,
          1,
          false
        );
        markWriterReady();
        await firstWriterRelease;
      });
      void firstWriterPromise.catch((error: unknown) => {
        firstWriterError = error;
        markWriterReady();
      });
      await writerReady;
      if (firstWriterError !== null) throw firstWriterError;

      const secondWriterSession = await secondWriterDb.execute<{
        backend_pid: number;
      }>(sql`select pg_backend_pid()::int as backend_pid`);
      const secondWriterPid = secondWriterSession.rows[0]!.backend_pid;
      let markSecondWriterAttempt!: () => void;
      const secondWriterAttempt = new Promise<void>((resolve) => {
        markSecondWriterAttempt = resolve;
      });
      let secondWriterError: unknown = null;
      secondWriterPromise = secondWriterDb.transaction(async (transaction) => {
        markSecondWriterAttempt();
        await transaction.execute(sql`
          select tenant_id
            from inbox_v2_tenant_stream_heads
           where tenant_id = ${fixture.tenantId}
           for update
        `);
        await seedStreamCommit(
          transaction as unknown as FoundationExecutor,
          fixture,
          2,
          false
        );
      });
      void secondWriterPromise.catch((error: unknown) => {
        secondWriterError = error;
        markSecondWriterAttempt();
      });
      await secondWriterAttempt;
      if (secondWriterError !== null) throw secondWriterError;
      await expectBackendWaitingOnHeadLock(
        db as unknown as FoundationExecutor,
        secondWriterPid
      );

      const observedTransactions: Array<{
        isolation: string;
        read_only: string;
      }> = [];
      const readerExecutor: InboxV2TenantStreamTransactionExecutor = {
        async execute<Row extends Record<string, unknown>>(
          query: SQL
        ): Promise<RawSqlQueryResult<Row>> {
          return readerDb.execute(query) as unknown as Promise<
            RawSqlQueryResult<Row>
          >;
        },
        async transaction<TResult>(
          work: (transaction: RawSqlExecutor) => Promise<TResult>,
          config: Readonly<{
            isolationLevel: "repeatable read";
            accessMode: "read only";
          }>
        ): Promise<TResult> {
          return readerDb.transaction(async (transaction) => {
            const setting = await transaction.execute<{
              isolation: string;
              read_only: string;
            }>(sql`
              select current_setting('transaction_isolation') as isolation,
                     current_setting('transaction_read_only') as read_only
            `);
            observedTransactions.push(setting.rows[0]!);
            return work(transaction as unknown as RawSqlExecutor);
          }, config);
        }
      };
      const streamRepository =
        createSqlInboxV2TenantStreamRepository(readerExecutor);
      const replayInput = {
        context: { tenantId: fixture.tenantId },
        streamEpoch: fixture.streamEpoch,
        afterPosition: streamPosition("0"),
        throughPosition: streamPosition("2"),
        limit: 10
      };

      await expect(
        streamRepository.replayBounded(replayInput)
      ).resolves.toEqual({
        outcome: "page",
        page: {
          tenantId: fixture.tenantId,
          streamEpoch: fixture.streamEpoch,
          snapshotPosition: "0",
          minRetainedPosition: "0",
          fromExclusive: "0",
          throughInclusive: "0",
          scannedThrough: "0",
          limit: 10,
          commits: [],
          hasMore: false,
          nextAfterPosition: null
        }
      });
      expect(observedTransactions).toEqual([
        { isolation: "repeatable read", read_only: "on" }
      ]);

      releaseFirstWriter();
      await firstWriterPromise;
      firstWriterPromise = null;
      await secondWriterPromise;
      secondWriterPromise = null;

      await expect(
        streamRepository.replayBounded(replayInput)
      ).resolves.toMatchObject({
        outcome: "page",
        page: {
          snapshotPosition: "2",
          fromExclusive: "0",
          throughInclusive: "2",
          scannedThrough: "2",
          commits: [
            { commit: { position: "1" } },
            { commit: { position: "2" } }
          ],
          hasMore: false,
          nextAfterPosition: null
        }
      });
      expect(observedTransactions).toEqual([
        { isolation: "repeatable read", read_only: "on" },
        { isolation: "repeatable read", read_only: "on" }
      ]);
    } finally {
      releaseFirstWriter();
      if (firstWriterPromise !== null) {
        await firstWriterPromise.catch(() => undefined);
      }
      if (secondWriterPromise !== null) {
        await secondWriterPromise.catch(() => undefined);
      }
      await Promise.all([
        closeHuleeDatabase(firstWriterDb),
        closeHuleeDatabase(secondWriterDb),
        closeHuleeDatabase(readerDb)
      ]);
      await deleteFixtureTenant(db, fixtureTenant);
    }
  }, 30_000);

  it("uses independent workers with SKIP LOCKED, then fences reclaim and finalization", async () => {
    const executor = db as unknown as FoundationExecutor;
    const fixtureATenantId = fixtureTenantId("outbox-a");
    const fixtureBTenantId = fixtureTenantId("outbox-b");
    const fixtureCTenantId = fixtureTenantId("outbox-concurrent");
    const firstWorkerDb = createHuleeDatabase({ poolConfig: { max: 1 } });
    const secondWorkerDb = createHuleeDatabase({ poolConfig: { max: 1 } });
    try {
      const fixtureA = await createStreamFixture(executor, "outbox-a");
      const fixtureB = await createStreamFixture(executor, "outbox-b");
      const fixtureC = await createStreamFixture(executor, "outbox-concurrent");
      const seededA = await seedStreamCommit(executor, fixtureA, 1, true);
      const seededB = await seedStreamCommit(executor, fixtureB, 1, true);
      await seedStreamCommit(executor, fixtureC, 1, true);
      const intentA = requiredIntent(seededA);
      const intentB = requiredIntent(seededB);

      const pending = await executor.execute<{
        tenant_id: string;
        intent_id: string;
        state: string;
        attempt_count: string;
      }>(sql`
          select tenant_id, intent_id, state::text,
                 attempt_count::text as attempt_count
            from inbox_v2_outbox_work_items
           where (tenant_id, intent_id) in (
             (${fixtureA.tenantId}, ${intentA}),
             (${fixtureB.tenantId}, ${intentB})
           )
           order by tenant_id
        `);
      expect(pending.rows).toEqual([
        {
          tenant_id: fixtureA.tenantId,
          intent_id: intentA,
          state: "pending",
          attempt_count: "0"
        },
        {
          tenant_id: fixtureB.tenantId,
          intent_id: intentB,
          state: "pending",
          attempt_count: "0"
        }
      ]);

      const firstWorker = firstWorkerDb as unknown as FoundationExecutor;
      const secondWorker = secondWorkerDb as unknown as FoundationExecutor;
      const workerSessions = await Promise.all([
        firstWorker.execute<{ backend_pid: number }>(sql`
          select pg_backend_pid()::int as backend_pid
        `),
        secondWorker.execute<{ backend_pid: number }>(sql`
          select pg_backend_pid()::int as backend_pid
        `)
      ]);
      expect(workerSessions[0].rows[0]?.backend_pid).not.toBe(
        workerSessions[1].rows[0]?.backend_pid
      );

      const firstRepository = createSqlInboxV2RepositoryOutbox(firstWorker, {
        tokenSource: (count) => exactTokenBatch(count, leaseTokenA)
      });
      const secondRepository = createSqlInboxV2RepositoryOutbox(secondWorker, {
        tokenSource: (count) => exactTokenBatch(count, leaseTokenB)
      });
      const concurrentClaims = await Promise.all([
        firstRepository.claimAvailable({
          context: { tenantId: fixtureC.tenantId },
          workerId: workerA,
          leaseDurationSeconds: 30,
          batchSize: 1
        }),
        secondRepository.claimAvailable({
          context: { tenantId: fixtureC.tenantId },
          workerId: workerB,
          leaseDurationSeconds: 30,
          batchSize: 1
        })
      ]);
      expect(concurrentClaims.map(({ outcome }) => outcome).sort()).toEqual([
        "claimed",
        "empty"
      ]);

      const firstClaim = await firstRepository.claimAvailable({
        context: { tenantId: fixtureA.tenantId },
        workerId: workerA,
        leaseDurationSeconds: 1,
        batchSize: 1
      });
      expect(firstClaim.outcome).toBe("claimed");
      if (firstClaim.outcome !== "claimed") {
        throw new Error(
          "DB-007 initial outbox claim unexpectedly returned empty."
        );
      }
      expect(firstClaim.claims[0]).toMatchObject({
        claimKind: "initial",
        leaseToken: leaseTokenA,
        work: {
          tenantId: fixtureA.tenantId,
          intentId: intentA,
          state: "leased",
          attemptCount: "1",
          lease: { workerId: workerA, leaseRevision: "1" }
        }
      });

      await executor.execute(sql`select pg_sleep(1.1)`);
      const reclaimed = await secondRepository.claimAvailable({
        context: { tenantId: fixtureA.tenantId },
        workerId: workerB,
        leaseDurationSeconds: 30,
        batchSize: 1
      });
      expect(reclaimed.outcome).toBe("claimed");
      if (reclaimed.outcome !== "claimed") {
        throw new Error("DB-007 expired outbox lease was not reclaimable.");
      }
      const secondClaim = reclaimed.claims[0];
      expect(secondClaim).toMatchObject({
        claimKind: "reclaimed",
        leaseToken: leaseTokenB,
        work: {
          tenantId: fixtureA.tenantId,
          intentId: intentA,
          state: "leased",
          attemptCount: "2",
          lease: { workerId: workerB, leaseRevision: "2" }
        }
      });
      if (secondClaim?.work.lease === null || secondClaim === undefined) {
        throw new Error("DB-007 reclaimed work is missing its lease.");
      }

      await expect(
        firstRepository.renewLease({
          context: { tenantId: fixtureA.tenantId },
          intentId: intentA,
          workerId: workerA,
          leaseToken: leaseTokenA,
          expectedLeaseRevision:
            firstClaim.claims[0]!.work.lease!.leaseRevision,
          leaseDurationSeconds: 30
        })
      ).resolves.toMatchObject({ outcome: "stale_token" });
      await expect(
        firstRepository.finalize({
          context: { tenantId: fixtureA.tenantId },
          intentId: intentA,
          workerId: workerA,
          leaseToken: leaseTokenA,
          expectedLeaseRevision:
            firstClaim.claims[0]!.work.lease!.leaseRevision,
          instruction: {
            kind: "processed",
            resultHash: digest("stale-finalize"),
            resultReference: null
          }
        })
      ).resolves.toMatchObject({ outcome: "stale_token" });

      const renewedOnce = await secondRepository.renewLease({
        context: { tenantId: fixtureA.tenantId },
        intentId: intentA,
        workerId: workerB,
        leaseToken: leaseTokenB,
        expectedLeaseRevision: secondClaim.work.lease.leaseRevision,
        leaseDurationSeconds: 30
      });
      expect(renewedOnce.outcome).toBe("renewed");
      if (
        renewedOnce.outcome !== "renewed" ||
        renewedOnce.work.lease === null
      ) {
        throw new Error("DB-007 first early renewal did not retain its lease.");
      }
      const renewedTwice = await secondRepository.renewLease({
        context: { tenantId: fixtureA.tenantId },
        intentId: intentA,
        workerId: workerB,
        leaseToken: leaseTokenB,
        expectedLeaseRevision: renewedOnce.work.lease.leaseRevision,
        leaseDurationSeconds: 30
      });
      expect(renewedTwice.outcome).toBe("renewed");
      if (
        renewedTwice.outcome !== "renewed" ||
        renewedTwice.work.lease === null
      ) {
        throw new Error(
          "DB-007 second early renewal did not retain its lease."
        );
      }
      const renewalClock = await executor.execute<{
        db_now: Date | string;
      }>(sql`select clock_timestamp() as db_now`);
      const renewedExpiry = Date.parse(renewedTwice.work.lease.expiresAt);
      const reclaimExpiry = Date.parse(secondClaim.work.lease.expiresAt);
      const remainingLeaseMs =
        renewedExpiry - Date.parse(timestampText(renewalClock.rows[0]!.db_now));
      expect(remainingLeaseMs).toBeGreaterThan(0);
      expect(remainingLeaseMs).toBeLessThanOrEqual(30_000);
      expect(renewedExpiry - reclaimExpiry).toBeLessThan(5_000);

      await expect(
        secondRepository.renewLease({
          context: { tenantId: fixtureA.tenantId },
          intentId: intentB,
          workerId: workerB,
          leaseToken: leaseTokenB,
          expectedLeaseRevision: renewedTwice.work.lease.leaseRevision,
          leaseDurationSeconds: 30
        })
      ).resolves.toEqual({
        outcome: "not_found",
        tenantId: fixtureA.tenantId,
        intentId: intentB
      });

      const resultHash = digest("terminal-result");
      await expect(
        secondRepository.finalize({
          context: { tenantId: fixtureA.tenantId },
          intentId: intentA,
          workerId: workerB,
          leaseToken: leaseTokenB,
          expectedLeaseRevision: renewedTwice.work.lease.leaseRevision,
          instruction: {
            kind: "processed",
            resultHash,
            resultReference: null
          }
        })
      ).resolves.toMatchObject({
        outcome: "processed",
        work: {
          tenantId: fixtureA.tenantId,
          intentId: intentA,
          state: "processed",
          attemptCount: "2",
          terminalResult: { kind: "processed", resultHash }
        }
      });

      await expect(
        secondRepository.finalize({
          context: { tenantId: fixtureA.tenantId },
          intentId: intentA,
          workerId: workerB,
          leaseToken: leaseTokenB,
          expectedLeaseRevision: renewedTwice.work.lease.leaseRevision,
          instruction: {
            kind: "processed",
            resultHash,
            resultReference: null
          }
        })
      ).resolves.toMatchObject({
        outcome: "already_finalized",
        work: {
          tenantId: fixtureA.tenantId,
          intentId: intentA,
          state: "processed",
          terminalResult: { kind: "processed", resultHash }
        }
      });

      await expect(
        firstRepository.finalize({
          context: { tenantId: fixtureA.tenantId },
          intentId: intentA,
          workerId: workerA,
          leaseToken: leaseTokenA,
          expectedLeaseRevision:
            firstClaim.claims[0]!.work.lease!.leaseRevision,
          instruction: {
            kind: "processed",
            resultHash: digest("wrong-terminal-replay"),
            resultReference: null
          }
        })
      ).resolves.toMatchObject({
        outcome: "not_leased",
        currentState: "processed"
      });

      const terminal = await executor.execute<{
        state: string;
        revision: string;
        updated_at: Date | string;
        kind: string;
        outcome_revision: string;
        lease_token_hash: string;
        occurred_at: Date | string;
      }>(sql`
          select work.state::text,
                 work.revision::text as revision,
                 work.updated_at,
                 outcome.kind::text,
                 outcome.outcome_revision::text as outcome_revision,
                 outcome.lease_token_hash,
                 outcome.occurred_at
            from inbox_v2_outbox_work_items work
            join inbox_v2_outbox_outcomes outcome
              on outcome.tenant_id = work.tenant_id
             and outcome.intent_id = work.intent_id
             and outcome.outcome_revision = work.revision
           where work.tenant_id = ${fixtureA.tenantId}
             and work.intent_id = ${intentA}
        `);
      expect(terminal.rows).toHaveLength(1);
      expect(terminal.rows[0]).toMatchObject({
        state: "processed",
        revision: "6",
        kind: "processed",
        outcome_revision: "6"
      });
      expect(timestampText(terminal.rows[0]!.occurred_at)).toBe(
        timestampText(terminal.rows[0]!.updated_at)
      );
      const terminalOutcomeCount = await executor.execute<{
        outcome_count: number;
      }>(sql`
          select count(*)::int as outcome_count
            from inbox_v2_outbox_outcomes
           where tenant_id = ${fixtureA.tenantId}
             and intent_id = ${intentA}
        `);
      expect(terminalOutcomeCount.rows).toEqual([{ outcome_count: 1 }]);

      const otherTenant = await executor.execute<{
        state: string;
        attempt_count: string;
        outcome_count: number;
      }>(sql`
          select work.state::text,
                 work.attempt_count::text as attempt_count,
                 count(outcome.intent_id)::int as outcome_count
            from inbox_v2_outbox_work_items work
            left join inbox_v2_outbox_outcomes outcome
              on outcome.tenant_id = work.tenant_id
             and outcome.intent_id = work.intent_id
           where work.tenant_id = ${fixtureB.tenantId}
             and work.intent_id = ${intentB}
           group by work.state, work.attempt_count
        `);
      expect(otherTenant.rows).toEqual([
        { state: "pending", attempt_count: "0", outcome_count: 0 }
      ]);
    } finally {
      await Promise.all([
        closeHuleeDatabase(firstWorkerDb),
        closeHuleeDatabase(secondWorkerDb)
      ]);
      await Promise.all([
        deleteFixtureTenant(db, fixtureATenantId),
        deleteFixtureTenant(db, fixtureBTenantId),
        deleteFixtureTenant(db, fixtureCTenantId)
      ]);
    }
  }, 30_000);

  it("atomically prunes exact replay children, advances the retained prefix and keeps its audit immutable", async () => {
    const executor = db as unknown as FoundationExecutor;
    const retentionTenantId = fixtureTenantId("retention");
    try {
      const fixture = await createStreamFixture(executor, "retention");
      let prefixIntent: ReturnType<
        typeof inboxV2OutboxIntentIdSchema.parse
      > | null = null;
      for (let position = 1; position <= 4; position += 1) {
        const seeded = await seedStreamCommit(
          executor,
          fixture,
          position,
          position === 2
        );
        if (position === 2) prefixIntent = requiredIntent(seeded);
      }
      if (prefixIntent === null) {
        throw new Error("DB-007 retention fixture lost its prefix intent.");
      }
      const checkpointProjection = createSqlInboxV2RepositoryProjection(
        executor,
        { applyProjectionRows: async () => undefined }
      );
      await expect(
        checkpointProjection.initializeGeneration({
          context: { tenantId: fixture.tenantId },
          projectionId,
          scopeId: projectionScopeId,
          streamEpoch: fixture.streamEpoch,
          syncGeneration: generation,
          projectionSchemaVersion: initialSchemaVersion,
          initialPosition: checkpoint("4"),
          minRetainedPosition: checkpoint("0"),
          initialState: "active",
          initializedAt: await databaseTimestamp(executor)
        })
      ).resolves.toMatchObject({
        outcome: "initialized",
        snapshot: { checkpoint: { position: "4" } }
      });

      await expect(streamReplayArtifacts(executor, fixture)).resolves.toEqual([
        { position: "1", change_count: 1, event_count: 1, intent_count: 0 },
        { position: "2", change_count: 1, event_count: 1, intent_count: 1 },
        { position: "3", change_count: 1, event_count: 1, intent_count: 0 },
        { position: "4", change_count: 1, event_count: 1, intent_count: 0 }
      ]);
      const commandClock = await databaseTimestamp(executor);
      const futureChangedAt = new Date(
        Date.parse(commandClock) + 5 * 60_000
      ).toISOString();
      const input = inboxV2CompareAndSetRetainedPrefixInputSchema.parse({
        context: { tenantId: fixture.tenantId },
        owner: {
          kind: "tenant_stream" as const,
          streamEpoch: fixture.streamEpoch
        },
        expectedRevision: "5",
        expectedMinRetainedPosition: "0",
        nextMinRetainedPosition: "4",
        mandatoryCheckpointFloor: "4",
        changedAt: futureChangedAt
      });

      const repository = createSqlInboxV2RepositoryRetainedPrefix(executor, {
        tenantStreamRetentionReasonId: "core:db007.retention-probe"
      });
      await expectDatabaseFailure(
        executor.execute(sql`
          select *
            from public.inbox_v2_advance_tenant_stream_retained_prefix_v1(
              ${fixture.tenantId},
              ${fixture.streamEpoch},
              0,
              4,
              5,
              4,
              'core:db007.retention-probe',
              ${digest("retention-future-clock-probe")},
              ${futureChangedAt}::timestamptz
            )
        `),
        "22023",
        "inbox_v2.retained_prefix_changed_at_future"
      );
      await expect(streamHead(executor, fixture)).resolves.toEqual({
        min_retained_position: "0",
        revision: "5"
      });
      const auditBeforeAdvance = await executor.execute<{ count: number }>(sql`
        select count(*)::int as count
          from inbox_v2_tenant_stream_retention_advances
         where tenant_id = ${fixture.tenantId}
           and stream_epoch = ${fixture.streamEpoch}
      `);
      expect(auditBeforeAdvance.rows).toEqual([{ count: 0 }]);
      await expectDatabaseFailure(
        repository.compareAndSetRetainedPrefix(input),
        "55000",
        "inbox_v2.retained_prefix_outbox_inflight"
      );
      await expect(streamHead(executor, fixture)).resolves.toEqual({
        min_retained_position: "0",
        revision: "5"
      });
      await expect(streamReplayArtifacts(executor, fixture)).resolves.toEqual([
        { position: "1", change_count: 1, event_count: 1, intent_count: 0 },
        { position: "2", change_count: 1, event_count: 1, intent_count: 1 },
        { position: "3", change_count: 1, event_count: 1, intent_count: 0 },
        { position: "4", change_count: 1, event_count: 1, intent_count: 0 }
      ]);

      const outbox = createSqlInboxV2RepositoryOutbox(executor, {
        tokenSource: (count) => exactTokenBatch(count, leaseTokenA)
      });
      const claimed = await outbox.claimAvailable({
        context: { tenantId: fixture.tenantId },
        workerId: workerA,
        leaseDurationSeconds: 30,
        batchSize: 1
      });
      expect(claimed.outcome).toBe("claimed");
      if (
        claimed.outcome !== "claimed" ||
        claimed.claims[0] === undefined ||
        claimed.claims[0].work.lease === null
      ) {
        throw new Error("DB-007 retention outbox intent was not claimable.");
      }
      const claim = claimed.claims[0];
      await expect(
        outbox.finalize({
          context: { tenantId: fixture.tenantId },
          intentId: prefixIntent,
          workerId: workerA,
          leaseToken: claim.leaseToken,
          expectedLeaseRevision: claim.work.lease!.leaseRevision,
          instruction: {
            kind: "processed",
            resultHash: digest("retention-prefix-terminal"),
            resultReference: null
          }
        })
      ).resolves.toMatchObject({ outcome: "processed" });

      const retentionPrivileges = await executor.execute<{
        runtime_child_delete_denied: boolean;
        owner_child_delete_allowed: boolean;
      }>(sql`
        select
          not pg_catalog.has_table_privilege(
            'hulee_inbox_v2_runtime',
            'public.inbox_v2_outbox_work_items',
            'DELETE'
          ) and not pg_catalog.has_table_privilege(
            'hulee_inbox_v2_runtime',
            'public.inbox_v2_outbox_outcomes',
            'DELETE'
          ) as runtime_child_delete_denied,
          pg_catalog.has_table_privilege(
            'hulee_inbox_v2_retention_owner',
            'public.inbox_v2_outbox_work_items',
            'SELECT,DELETE'
          ) and pg_catalog.has_table_privilege(
            'hulee_inbox_v2_retention_owner',
            'public.inbox_v2_outbox_outcomes',
            'SELECT,DELETE'
          ) as owner_child_delete_allowed
      `);
      expect(retentionPrivileges.rows).toEqual([
        {
          runtime_child_delete_denied: true,
          owner_child_delete_allowed: true
        }
      ]);

      await expectDatabaseFailure(
        executor.transaction((transaction) =>
          transaction.execute(sql`
            delete from inbox_v2_outbox_outcomes
             where tenant_id = ${fixture.tenantId}
               and intent_id = ${prefixIntent}
          `)
        ),
        "23514",
        "inbox_v2.outbox_outcome_immutable"
      );

      await expect(
        repository.compareAndSetRetainedPrefix(input)
      ).resolves.toMatchObject({
        outcome: "advanced",
        current: {
          tenantId: fixture.tenantId,
          minRetainedPosition: "4",
          headPosition: "4",
          revision: "6"
        }
      });
      await expect(streamReplayArtifacts(executor, fixture)).resolves.toEqual([
        { position: "1", change_count: 0, event_count: 0, intent_count: 0 },
        { position: "2", change_count: 0, event_count: 0, intent_count: 0 },
        { position: "3", change_count: 0, event_count: 0, intent_count: 0 },
        { position: "4", change_count: 1, event_count: 1, intent_count: 0 }
      ]);
      await expect(streamHead(executor, fixture)).resolves.toEqual({
        min_retained_position: "4",
        revision: "6"
      });
      const streamRepository = createSqlInboxV2TenantStreamRepository(executor);
      await expect(
        streamRepository.replayBounded({
          context: { tenantId: fixture.tenantId },
          streamEpoch: fixture.streamEpoch,
          afterPosition: streamPosition("2"),
          throughPosition: streamPosition("4"),
          limit: 10
        })
      ).resolves.toEqual({
        outcome: "cursor_expired",
        tenantId: fixture.tenantId,
        minRetainedPosition: "4"
      });
      await expect(
        streamRepository.replayBounded({
          context: { tenantId: fixture.tenantId },
          streamEpoch: fixture.streamEpoch,
          afterPosition: streamPosition("3"),
          throughPosition: streamPosition("4"),
          limit: 10
        })
      ).resolves.toMatchObject({
        outcome: "page",
        page: {
          minRetainedPosition: "4",
          fromExclusive: "3",
          throughInclusive: "4",
          scannedThrough: "4",
          commits: [
            {
              commit: { position: "4" },
              changes: [{ reference: { streamPosition: "4" } }]
            }
          ],
          hasMore: false,
          nextAfterPosition: null
        }
      });
      const prunedOutbox = await executor.execute<{
        intent_count: number;
        work_count: number;
        outcome_count: number;
      }>(sql`
        select
          (select count(*)::int from inbox_v2_outbox_intents
            where tenant_id = ${fixture.tenantId}) as intent_count,
          (select count(*)::int from inbox_v2_outbox_work_items
            where tenant_id = ${fixture.tenantId}) as work_count,
          (select count(*)::int from inbox_v2_outbox_outcomes
            where tenant_id = ${fixture.tenantId}) as outcome_count
      `);
      expect(prunedOutbox.rows).toEqual([
        { intent_count: 0, work_count: 0, outcome_count: 0 }
      ]);
      const audit = await executor.execute<{
        from_position: string;
        to_position: string;
        pruned_commit_count: string;
        expected_head_revision: string;
        resulting_head_revision: string;
        occurred_at: Date | string;
        created_at: Date | string;
        head_updated_at: Date | string;
        db_now: Date | string;
        advance_hash: string;
      }>(sql`
          select from_position::text,
                 to_position::text,
                 pruned_commit_count::text,
                 expected_head_revision::text,
                 resulting_head_revision::text,
                 advance_hash,
                 occurred_at,
                 created_at,
                 (
                   select head_row.updated_at
                     from inbox_v2_tenant_stream_heads head_row
                    where head_row.tenant_id = ${fixture.tenantId}
                      and head_row.stream_epoch = ${fixture.streamEpoch}
                 ) as head_updated_at,
                 clock_timestamp() as db_now
            from inbox_v2_tenant_stream_retention_advances
           where tenant_id = ${fixture.tenantId}
             and stream_epoch = ${fixture.streamEpoch}
        `);
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]).toMatchObject({
        from_position: "0",
        to_position: "4",
        pruned_commit_count: "3",
        expected_head_revision: "5",
        resulting_head_revision: "6"
      });
      const storedRetentionClock = Date.parse(
        timestampText(audit.rows[0]!.occurred_at)
      );
      expect(timestampText(audit.rows[0]!.created_at)).toBe(
        timestampText(audit.rows[0]!.occurred_at)
      );
      expect(timestampText(audit.rows[0]!.head_updated_at)).toBe(
        timestampText(audit.rows[0]!.occurred_at)
      );
      expect(
        Math.abs(
          Date.parse(timestampText(audit.rows[0]!.db_now)) -
            storedRetentionClock
        )
      ).toBeLessThan(5_000);
      expect(
        Date.parse(futureChangedAt) - storedRetentionClock
      ).toBeGreaterThan(4 * 60_000);
      expect(audit.rows[0]!.advance_hash).toBe(
        calculateInboxV2CanonicalSha256({
          domain: "core:inbox-v2.tenant-stream-retention-advance",
          hashVersion: "v1",
          tenantId: fixture.tenantId,
          streamEpoch: fixture.streamEpoch,
          fromPosition: "0",
          toPosition: "4",
          expectedHeadRevision: "5",
          resultingHeadRevision: "6",
          mandatoryCheckpointFloor: "4",
          prunedCommitCount: "3",
          reasonId: "core:db007.retention-probe",
          occurredAt: timestampText(audit.rows[0]!.occurred_at)
        })
      );

      await expectDatabaseFailure(
        executor.transaction((transaction) =>
          transaction.execute(sql`
              update inbox_v2_tenant_stream_retention_advances
                 set reason_id = 'core:db007.illegal-update'
               where tenant_id = ${fixture.tenantId}
                 and stream_epoch = ${fixture.streamEpoch}
            `)
        ),
        "23514",
        "inbox_v2.tenant_stream_retention_advance_immutable"
      );
      await expectDatabaseFailure(
        executor.transaction((transaction) =>
          transaction.execute(sql`
              delete from inbox_v2_tenant_stream_retention_advances
               where tenant_id = ${fixture.tenantId}
                 and stream_epoch = ${fixture.streamEpoch}
            `)
        ),
        "23514",
        "inbox_v2.tenant_stream_retention_advance_immutable"
      );
    } finally {
      await deleteFixtureTenant(db, retentionTenantId);
    }
  }, 30_000);
});

async function withRolledBackFixture(
  db: HuleeDatabase,
  work: (executor: FoundationExecutor) => Promise<void>
): Promise<void> {
  const rollback = new Error(`rollback DB-007 fixture ${runId}`);
  try {
    await db.transaction(async (transaction) => {
      await work(transaction as unknown as FoundationExecutor);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

async function createStreamFixture(
  executor: FoundationExecutor,
  label: string
): Promise<StreamFixture> {
  const tenantId = fixtureTenantId(label);
  const streamEpoch = inboxV2StreamEpochSchema.parse(
    `epoch:db007:${label}:${runId}`
  );
  await executor.execute(sql`
    insert into tenants (id, slug, display_name, deployment_type)
    values (
      ${tenantId},
      ${`db007-${label}-${runId}`},
      ${`DB-007 ${label} fixture`},
      'saas_shared'
    )
  `);
  await executor.execute(sql`
    with db_clock as materialized (
      select clock_timestamp() as db_now
    )
    insert into inbox_v2_tenant_stream_heads (
      tenant_id, stream_epoch, last_position, min_retained_position,
      revision, created_at, updated_at
    )
    select ${tenantId}, ${streamEpoch}, 0, 0, 1,
           db_clock.db_now, db_clock.db_now
      from db_clock
  `);
  return { tenantId, streamEpoch, label };
}

async function deleteFixtureTenant(
  db: HuleeDatabase,
  tenantId: ReturnType<typeof inboxV2TenantIdSchema.parse>
): Promise<void> {
  await db.execute(sql`delete from tenants where id = ${tenantId}`);
  const remaining = await db.execute<{ count: number }>(sql`
    select count(*)::int as count from tenants where id = ${tenantId}
  `);
  expect(remaining.rows).toEqual([{ count: 0 }]);
}

async function seedStreamCommit(
  executor: FoundationExecutor,
  fixture: StreamFixture,
  position: number,
  withOutbox: boolean
): Promise<SeededCommit> {
  const previous = position - 1;
  const commitId = inboxV2TenantStreamCommitIdSchema.parse(
    `commit:db007:${fixture.label}:${position}:${runId}`
  );
  const mutationId = `mutation:db007:${fixture.label}:${position}:${runId}`;
  const changeId = `change:db007:${fixture.label}:${position}:${runId}`;
  const eventId = `event:db007:${fixture.label}:${position}:${runId}`;
  const intentId = withOutbox
    ? inboxV2OutboxIntentIdSchema.parse(
        `intent:db007:${fixture.label}:${position}:${runId}`
      )
    : null;
  const correlationId = `correlation:db007:${fixture.label}:${position}:${runId}`;
  const committedAt = await databaseTimestamp(executor);
  const stateSchemaId = "core:db007.fixture-change";
  const stateHash = digest(`state:${fixture.label}:${position}`);
  const eventHash = digest(`event:${fixture.label}:${position}`);
  const intentHash =
    intentId === null ? null : digest(`intent:${fixture.label}:${position}`);
  const manifestDigest = digest(
    [
      `change:${stateHash}`,
      `event:${eventHash}`,
      ...(intentHash === null ? [] : [`intent:${intentHash}`])
    ].join("\n")
  );
  const stateReference = JSON.stringify({
    tenantId: fixture.tenantId,
    recordId: `payload:db007:${fixture.label}:${position}:${runId}`,
    schemaId: stateSchemaId,
    schemaVersion: initialSchemaVersion,
    digest: digest(`payload:${fixture.label}:${position}`)
  });
  const changeIds = JSON.stringify([changeId]);
  const eventIds = JSON.stringify([eventId]);
  const outboxIntentIds = JSON.stringify(intentId === null ? [] : [intentId]);

  await executor.execute(sql`
    insert into inbox_v2_tenant_stream_commits (
      tenant_id, id, mutation_id, stream_epoch, position, previous_position,
      schema_version, correlation_id, command_ids, client_mutation_ids,
      authorization_decision_refs, change_ids, event_ids, outbox_intent_ids,
      audience_impact_kind, audience_impact_manifest, change_count,
      event_count, outbox_intent_count, manifest_digest_sha256, commit_hash,
      committed_at, created_at
    ) values (
      ${fixture.tenantId}, ${commitId}, ${mutationId}, ${fixture.streamEpoch},
      ${position}, ${previous}, ${tenantStreamSchemaVersion},
      ${correlationId}, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      ${changeIds}::jsonb, ${eventIds}::jsonb, ${outboxIntentIds}::jsonb,
      'none', '{"kind":"none"}'::jsonb, 1, 1,
      ${intentId === null ? 0 : 1}, ${manifestDigest},
      ${digest(`commit:${fixture.label}:${position}`)}, ${committedAt},
      ${committedAt}
    )
  `);
  await executor.execute(sql`
    insert into inbox_v2_tenant_stream_changes (
      tenant_id, id, mutation_id, stream_commit_id, stream_position,
      ordinal, entity_type_id, entity_id, resulting_revision, timeline,
      audience, state_kind, state_schema_id, state_schema_version,
      state_reason_id, state_hash, payload_reference,
      domain_commit_reference, created_at
    ) values (
      ${fixture.tenantId}, ${changeId}, ${mutationId}, ${commitId},
      ${position}, 1, 'core:db007_fixture',
      ${`entity:db007:${fixture.label}:${position}:${runId}`}, 1, null,
      'workforce_metadata', 'upsert', ${stateSchemaId},
      ${initialSchemaVersion}, null,
      ${stateHash},
      ${stateReference}::jsonb, ${stateReference}::jsonb, ${committedAt}
    )
  `);
  await executor.execute(sql`
    insert into inbox_v2_domain_events (
      tenant_id, id, mutation_id, stream_commit_id, stream_position,
      ordinal, type_id, payload_schema_id, payload_schema_version,
      change_ids, subjects, payload_reference, correlation_id, command_ids,
      client_mutation_ids, authorization_decision_refs, access_effect,
      access_effect_causes, event_hash, occurred_at, recorded_at
    ) values (
      ${fixture.tenantId}, ${eventId}, ${mutationId}, ${commitId},
      ${position}, 1, 'core:db007.fixture-event',
      'core:db007.fixture-event', ${initialSchemaVersion},
      ${changeIds}::jsonb,
      ${JSON.stringify([
        {
          tenantId: fixture.tenantId,
          entityTypeId: "core:db007_fixture",
          entityId: `entity:db007:${fixture.label}:${position}:${runId}`
        }
      ])}::jsonb,
      null, ${correlationId}, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      'none', '[]'::jsonb, ${eventHash},
      ${committedAt}, ${committedAt}
    )
  `);
  if (intentId !== null) {
    await executor.execute(sql`
      insert into inbox_v2_outbox_intents (
        tenant_id, id, mutation_id, stream_commit_id, stream_position,
        ordinal, type_id, handler_id, effect_class, event_id,
        consumer_dedupe_key, change_ids, payload_reference, correlation_id,
        intent_hash, available_at, created_at
      ) values (
        ${fixture.tenantId}, ${intentId}, ${mutationId}, ${commitId},
        ${position}, 1, 'core:db007.fixture-dispatch',
        'core:db007.fixture-handler', 'workflow', ${eventId},
        ${digest(`dedupe:${fixture.label}:${position}`)}, ${changeIds}::jsonb,
        null, ${correlationId}, ${intentHash},
        ${committedAt}, ${committedAt}
      )
    `);
  }
  await executor.execute(sql`
    update inbox_v2_tenant_stream_heads
       set last_position = ${position},
           revision = revision + 1,
           updated_at = ${committedAt}
     where tenant_id = ${fixture.tenantId}
       and stream_epoch = ${fixture.streamEpoch}
       and last_position = ${previous}
  `);
  return { commitId, intentId };
}

async function expectBackendWaitingOnHeadLock(
  executor: RawSqlExecutor,
  backendPid: number
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const activity = await executor.execute<{
      waiting: boolean;
    }>(sql`
      select exists (
        select 1
          from pg_catalog.pg_stat_activity activity_row
         where activity_row.pid = ${backendPid}
           and activity_row.wait_event_type = 'Lock'
           and activity_row.query like
             '%inbox_v2_tenant_stream_heads%'
      ) as waiting
    `);
    if (activity.rows[0]?.waiting === true) return;
    await executor.execute(sql`select pg_sleep(0.01)`);
  }
  throw new Error(
    "DB-007 position-2 writer did not block behind the position-1 head lock."
  );
}

function projectionApplyInput(
  fixture: StreamFixture,
  commitId: ReturnType<typeof inboxV2TenantStreamCommitIdSchema.parse>,
  position: number,
  expectedCheckpoint: string
) {
  return inboxV2ApplyProjectionContiguousInputSchema.parse({
    context: { tenantId: fixture.tenantId },
    projectionId,
    scopeId: projectionScopeId,
    syncGeneration: generation,
    expectedCheckpoint: checkpoint(expectedCheckpoint),
    input: {
      tenantId: fixture.tenantId,
      streamEpoch: fixture.streamEpoch,
      commitId,
      commitSchemaVersion: tenantStreamSchemaVersion,
      streamPosition: inboxV2TenantStreamCommitPositionSchema.parse(
        String(position)
      )
    },
    relevance: "relevant" as const
  });
}

async function streamReplayArtifacts(
  executor: RawSqlExecutor,
  fixture: StreamFixture
): Promise<
  readonly Readonly<{
    position: string;
    change_count: number;
    event_count: number;
    intent_count: number;
  }>[]
> {
  const result = await executor.execute<{
    position: string;
    change_count: number;
    event_count: number;
    intent_count: number;
  }>(sql`
    select commit_row.position::text as position,
           (
             select count(*)::int
               from inbox_v2_tenant_stream_changes change_row
              where change_row.tenant_id = commit_row.tenant_id
                and change_row.stream_commit_id = commit_row.id
           ) as change_count,
           (
             select count(*)::int
               from inbox_v2_domain_events event_row
              where event_row.tenant_id = commit_row.tenant_id
                and event_row.stream_commit_id = commit_row.id
           ) as event_count,
           (
             select count(*)::int
               from inbox_v2_outbox_intents intent_row
              where intent_row.tenant_id = commit_row.tenant_id
                and intent_row.stream_commit_id = commit_row.id
           ) as intent_count
      from inbox_v2_tenant_stream_commits commit_row
     where commit_row.tenant_id = ${fixture.tenantId}
       and commit_row.stream_epoch = ${fixture.streamEpoch}
     order by commit_row.position
  `);
  return result.rows;
}

async function streamHead(
  executor: RawSqlExecutor,
  fixture: StreamFixture
): Promise<Readonly<{ min_retained_position: string; revision: string }>> {
  const result = await executor.execute<{
    min_retained_position: string;
    revision: string;
  }>(sql`
    select min_retained_position::text, revision::text
      from inbox_v2_tenant_stream_heads
     where tenant_id = ${fixture.tenantId}
       and stream_epoch = ${fixture.streamEpoch}
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("DB-007 stream head disappeared.");
  return row;
}

async function databaseTimestamp(executor: RawSqlExecutor): Promise<string> {
  const result = await executor.execute<{ db_now: Date | string }>(sql`
    select clock_timestamp() as db_now
  `);
  const value = result.rows[0]?.db_now;
  if (value === undefined) throw new Error("PostgreSQL returned no DB clock.");
  return timestampText(value);
}

async function expectDatabaseFailure(
  operation: Promise<unknown>,
  sqlState: string,
  message: string
): Promise<void> {
  let caught: unknown;
  try {
    await operation;
  } catch (error) {
    caught = error;
  }
  expect(postgresSqlState(caught)).toBe(sqlState);
  expect(postgresErrorText(caught)).toContain(message);
}

function requiredCommit(
  commits: ReadonlyMap<number, SeededCommit>,
  position: number
): SeededCommit {
  const commit = commits.get(position);
  if (commit === undefined) {
    throw new Error(`Missing DB-007 fixture commit at ${position}.`);
  }
  return commit;
}

function requiredIntent(
  commit: SeededCommit
): ReturnType<typeof inboxV2OutboxIntentIdSchema.parse> {
  if (commit.intentId === null) {
    throw new Error("DB-007 fixture commit has no outbox intent.");
  }
  return commit.intentId;
}

function exactTokenBatch(count: number, token: string): readonly string[] {
  if (count !== 1) {
    throw new Error("DB-007 token fixture only supports one claim.");
  }
  return [token];
}

function checkpoint(value: string) {
  return inboxV2ProjectionCheckpointSchema.parse(value);
}

function fixtureTenantId(label: string) {
  return inboxV2TenantIdSchema.parse(`tenant:db007-${label}-${runId}`);
}

function streamPosition(value: string) {
  return inboxV2TenantStreamPositionSchema.parse(value);
}

function digest(value: string) {
  return inboxV2Sha256DigestSchema.parse(
    `sha256:${createHash("sha256").update(value).digest("hex")}`
  );
}

function timestampText(value: Date | string): string {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("PostgreSQL returned an invalid timestamp.");
  }
  return timestamp.toISOString();
}

function postgresSqlState(error: unknown): string | null {
  for (const current of databaseErrorChain(error)) {
    if (
      typeof current !== "object" ||
      current === null ||
      !("code" in current)
    ) {
      continue;
    }
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}

function postgresErrorText(error: unknown): string {
  return databaseErrorChain(error)
    .map((current) =>
      current instanceof Error ? current.message : String(current)
    )
    .join(" ");
}

function databaseErrorChain(error: unknown): readonly unknown[] {
  const queue: unknown[] = [error];
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    chain.push(current);
    if (typeof current !== "object" || current === null) continue;
    if ("cause" in current) queue.push((current as { cause?: unknown }).cause);
    if ("errors" in current && Array.isArray(current.errors)) {
      queue.push(...current.errors);
    }
  }
  return chain;
}
