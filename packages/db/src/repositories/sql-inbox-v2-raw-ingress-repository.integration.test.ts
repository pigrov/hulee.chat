import {
  defineInboxV2RawIngressSanitizer,
  defineInboxV2RawIngressSanitizerProfile,
  inboxV2NamespacedIdSchema,
  inboxV2SourceAccountIdSchema,
  inboxV2SourceConnectionIdSchema,
  inboxV2TenantIdSchema,
  sanitizeInboxV2RawIngress,
  type InboxV2RawIngressInput,
  type InboxV2SanitizedRawIngressCandidate
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import {
  createSqlInboxV2RawIngressRepository,
  type InboxV2RawIngressTransactionExecutor
} from "./sql-inbox-v2-raw-ingress-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const suffix = `src002-${process.pid}-${Date.now().toString(36)}`;
const t0 = "2026-07-16T08:00:00.000Z";
const t1 = "2026-07-16T08:00:01.000Z";
const t2 = "2026-07-16T08:00:02.000Z";
const t3 = "2026-07-16T08:00:03.000Z";
const t4 = "2026-07-16T08:00:04.000Z";
const secretSentinel = `credential-sentinel-${suffix}`;
const rawIdentitySentinel = `raw-provider-identity-${suffix}`;
const forcedDigest = `sha256:${"f".repeat(64)}`;

describePostgres("SQL Inbox V2 raw-ingress PostgreSQL invariants", () => {
  let database: HuleeDatabase;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is required for SRC-002 integration tests."
      );
    }
    database = createHuleeDatabase({
      connectionString: process.env.DATABASE_URL,
      poolConfig: { max: 8 }
    });
    await assertMigrationReady(database);
    await seedScope(database, scope("atomic"));
    await seedScope(database, scope("sanitizer"));
    await seedScope(database, scope("collision"), { includeSecondEdge: true });
    await seedScope(database, scope("concurrent"));
    await seedScope(database, scope("lease"));
    await seedScope(database, scope("rollback"));
    await seedScope(database, scope("isolation-a"));
    await seedScope(database, scope("isolation-b"));
  }, 30_000);

  afterAll(async () => {
    if (database) await closeHuleeDatabase(database);
  }, 30_000);

  it("atomically persists a secret-free aggregate and replays after evidence expiry", async () => {
    const ids = scope("atomic");
    const candidate = await acceptedCandidate(ids, {
      identity: `${rawIdentitySentinel}-atomic`,
      payload: { message: "safe-atomic" }
    });
    const repository = repositoryFor(database, "atomic");

    const recorded = await repository.record(candidate);
    expect(recorded).toMatchObject({
      outcome: "recorded",
      work: { state: "pending", revision: "1", attemptCount: "0" }
    });
    if (recorded.outcome !== "recorded") throw new Error("fixture invariant");

    const aggregate = await database.execute<{
      anchor_count: unknown;
      envelope_count: unknown;
      evidence_count: unknown;
      work_count: unknown;
      unsafe_count: unknown;
    }>(sql`
      select count(*) filter (where anchor.id is not null)::text as anchor_count,
             count(*) filter (where envelope.raw_event_id is not null)::text
               as envelope_count,
             (select count(*)::text
                from public.inbox_v2_source_raw_evidence evidence
               where evidence.tenant_id = ${ids.tenantId}
                 and evidence.raw_event_id = ${recorded.rawEventId})
               as evidence_count,
             (select count(*)::text
                from public.inbox_v2_source_raw_work_items work
               where work.tenant_id = ${ids.tenantId}
                 and work.raw_event_id = ${recorded.rawEventId}) as work_count,
             count(*) filter (where
               anchor.external_event_id is not null
               or anchor.event_signature is not null
               or anchor.payload <> '{}'::jsonb
               or anchor.headers <> '{}'::jsonb
               or anchor.processing_status <> 'ignored'
               or anchor.error_code is not null
               or anchor.error_message is not null)::text as unsafe_count
        from public.raw_inbound_events anchor
        join public.inbox_v2_source_raw_envelopes envelope
          on envelope.tenant_id = anchor.tenant_id
         and envelope.raw_event_id = anchor.id
       where anchor.tenant_id = ${ids.tenantId}
         and anchor.id = ${recorded.rawEventId}
    `);
    expect(aggregate.rows[0]).toMatchObject({
      anchor_count: "1",
      envelope_count: "1",
      evidence_count: "2",
      work_count: "1",
      unsafe_count: "0"
    });

    const laterRetryCandidate = await acceptedCandidate(ids, {
      identity: `${rawIdentitySentinel}-atomic`,
      payload: { message: "safe-atomic" },
      receivedAt: t3,
      sanitizedAt: t4
    });
    expect(laterRetryCandidate.safeEnvelopeDigest).toBe(
      candidate.safeEnvelopeDigest
    );
    const evidenceRows = await database.execute<{
      evidence_kind: unknown;
      content: unknown;
      serialized: unknown;
    }>(sql`
      select evidence_kind::text as evidence_kind, content,
             row_to_json(evidence)::text as serialized
        from public.inbox_v2_source_raw_evidence evidence
       where tenant_id = ${ids.tenantId}
         and raw_event_id = ${recorded.rawEventId}
       order by evidence_kind::text
    `);
    expect(evidenceRows.rows).toEqual([
      expect.objectContaining({
        evidence_kind: "allowed_headers",
        content: {
          headers: [{ name: "x-request-id", values: [`request-${suffix}`] }]
        }
      }),
      expect.objectContaining({
        evidence_kind: "provider_payload",
        content: { message: "safe-atomic" }
      })
    ]);
    for (const row of evidenceRows.rows) {
      expect(String(row.serialized)).not.toContain(secretSentinel);
      expect(String(row.serialized)).not.toContain(rawIdentitySentinel);
    }

    const replay = await repository.record(laterRetryCandidate);
    expect(replay).toEqual({
      outcome: "already_recorded",
      rawEventId: recorded.rawEventId,
      safeEnvelopeDigest: candidate.safeEnvelopeDigest
    });
    const workBeforePurge = await loadWork(
      database,
      ids.tenantId,
      recorded.rawEventId
    );

    await database.execute(sql`
      delete from public.inbox_v2_source_raw_evidence
       where tenant_id = ${ids.tenantId}
         and raw_event_id = ${recorded.rawEventId}
    `);
    const replayAfterPurge = await repository.record(laterRetryCandidate);
    expect(replayAfterPurge).toEqual(replay);
    expect(await loadWork(database, ids.tenantId, recorded.rawEventId)).toEqual(
      workBeforePurge
    );

    const leakCount = await database.execute<{ leak_count: unknown }>(sql`
      select (
        (select count(*) from public.raw_inbound_events row
          where row.tenant_id = ${ids.tenantId}
            and row_to_json(row)::text like ${`%${secretSentinel}%`})
        +
        (select count(*) from public.inbox_v2_source_raw_envelopes row
          where row.tenant_id = ${ids.tenantId}
            and row_to_json(row)::text like ${`%${rawIdentitySentinel}%`})
        +
        (select count(*) from public.inbox_v2_source_raw_quarantines row
          where row.tenant_id = ${ids.tenantId}
            and (row_to_json(row)::text like ${`%${secretSentinel}%`}
              or row_to_json(row)::text like ${`%${rawIdentitySentinel}%`}))
      )::text as leak_count
    `);
    expect(leakCount.rows[0]?.leak_count).toBe("0");
  });

  it("persists a sanitizer rejection as quarantine only", async () => {
    const ids = scope("sanitizer");
    const candidate = await quarantinedCandidate(
      ids,
      `${rawIdentitySentinel}-sanitizer`
    );
    const repository = repositoryFor(database, "sanitizer-rejected");

    const result = await repository.record(candidate);

    expect(result).toMatchObject({
      outcome: "quarantined",
      existingRawEventId: null,
      reasonCode: "source.sanitizer_rejected"
    });
    const rows = await database.execute<{
      reason_code: unknown;
      existing_raw_event_id: unknown;
      serialized: unknown;
      anchor_count: unknown;
      envelope_count: unknown;
      evidence_count: unknown;
      work_count: unknown;
    }>(sql`
      select quarantine.reason_code::text as reason_code,
             quarantine.existing_raw_event_id,
             row_to_json(quarantine)::text as serialized,
             (select count(*)::text from public.raw_inbound_events
               where tenant_id = ${ids.tenantId}) as anchor_count,
             (select count(*)::text from public.inbox_v2_source_raw_envelopes
               where tenant_id = ${ids.tenantId}) as envelope_count,
             (select count(*)::text from public.inbox_v2_source_raw_evidence
               where tenant_id = ${ids.tenantId}) as evidence_count,
             (select count(*)::text from public.inbox_v2_source_raw_work_items
               where tenant_id = ${ids.tenantId}) as work_count
        from public.inbox_v2_source_raw_quarantines quarantine
       where quarantine.tenant_id = ${ids.tenantId}
    `);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      reason_code: "source.sanitizer_rejected",
      existing_raw_event_id: null,
      anchor_count: "0",
      envelope_count: "0",
      evidence_count: "0",
      work_count: "0"
    });
    expect(String(rows.rows[0]?.serialized)).not.toContain(secretSentinel);
    expect(String(rows.rows[0]?.serialized)).not.toContain(rawIdentitySentinel);
  });

  it("quarantines forced cross-edge and changed-envelope key collisions stably", async () => {
    const ids = scope("collision");
    const digestSource = () => forcedDigest;
    const first = await acceptedCandidate(ids, {
      identity: `${rawIdentitySentinel}-collision`,
      payload: { message: "first" }
    });
    const firstRepository = repositoryFor(database, "collision-first", {
      idempotencyKeyDigestSource: digestSource
    });
    const recorded = await firstRepository.record(first);
    expect(recorded.outcome).toBe("recorded");
    if (recorded.outcome !== "recorded") throw new Error("fixture invariant");

    const crossConnection = await acceptedCandidate(
      {
        ...ids,
        connectionId: ids.secondConnectionId,
        accountId: ids.secondAccountId
      },
      {
        identity: `${rawIdentitySentinel}-collision`,
        payload: { message: "first" }
      }
    );
    const crossRepository = repositoryFor(database, "collision-cross", {
      idempotencyKeyDigestSource: digestSource
    });
    const crossCollision = await crossRepository.record(crossConnection);
    expect(crossCollision).toMatchObject({
      outcome: "quarantined",
      existingRawEventId: recorded.rawEventId,
      reasonCode: "source.idempotency_collision"
    });
    const crossReplay = await repositoryFor(
      database,
      "collision-cross-replay",
      { idempotencyKeyDigestSource: digestSource }
    ).record(crossConnection);
    expect(crossReplay).toEqual(crossCollision);

    const crossAccount = await acceptedCandidate(
      { ...ids, accountId: null },
      {
        identity: `${rawIdentitySentinel}-collision`,
        payload: { message: "first" }
      }
    );
    const accountCollision = await repositoryFor(
      database,
      "collision-account",
      { idempotencyKeyDigestSource: digestSource }
    ).record(crossAccount);
    expect(accountCollision).toMatchObject({
      outcome: "quarantined",
      existingRawEventId: recorded.rawEventId,
      reasonCode: "source.idempotency_collision"
    });

    const changed = await acceptedCandidate(ids, {
      identity: `${rawIdentitySentinel}-collision`,
      payload: { message: "changed-safe-envelope" }
    });
    const changedCollision = await repositoryFor(
      database,
      "collision-changed",
      { idempotencyKeyDigestSource: digestSource }
    ).record(changed);
    expect(changedCollision).toMatchObject({
      outcome: "quarantined",
      existingRawEventId: recorded.rawEventId,
      reasonCode: "source.idempotency_collision"
    });
    expect(changedCollision).not.toEqual(crossCollision);

    const counts = await database.execute<{
      anchor_count: unknown;
      work_count: unknown;
      quarantine_count: unknown;
    }>(sql`
      select
        (select count(*)::text from public.raw_inbound_events
          where tenant_id = ${ids.tenantId}) as anchor_count,
        (select count(*)::text from public.inbox_v2_source_raw_work_items
          where tenant_id = ${ids.tenantId}) as work_count,
        (select count(*)::text from public.inbox_v2_source_raw_quarantines
          where tenant_id = ${ids.tenantId}) as quarantine_count
    `);
    expect(counts.rows[0]).toMatchObject({
      anchor_count: "1",
      work_count: "1",
      quarantine_count: "3"
    });
  });

  it("serializes concurrent exact records to one anchor and the original outcome", async () => {
    const ids = scope("concurrent");
    const candidate = await acceptedCandidate(ids, {
      identity: `${rawIdentitySentinel}-concurrent`,
      payload: { message: "concurrent" }
    });
    const repositoryA = repositoryFor(database, "concurrent-a");
    const repositoryB = repositoryFor(database, "concurrent-b");

    const results = await Promise.all([
      repositoryA.record(candidate),
      repositoryB.record(candidate)
    ]);
    expect(results.map((result) => result.outcome).sort()).toEqual([
      "already_recorded",
      "recorded"
    ]);
    const rawIds = results.map((result) =>
      result.outcome === "quarantined"
        ? result.existingRawEventId
        : result.rawEventId
    );
    expect(new Set(rawIds).size).toBe(1);

    const counts = await database.execute<{
      anchor_count: unknown;
      work_count: unknown;
    }>(sql`
      select
        (select count(*)::text from public.raw_inbound_events
          where tenant_id = ${ids.tenantId}) as anchor_count,
        (select count(*)::text from public.inbox_v2_source_raw_work_items
          where tenant_id = ${ids.tenantId}) as work_count
    `);
    expect(counts.rows[0]).toMatchObject({
      anchor_count: "1",
      work_count: "1"
    });
  });

  it("fences two workers, release/retry and expired crash reclaim diagnostics", async () => {
    const ids = scope("lease");
    const candidate = await acceptedCandidate(ids, {
      identity: `${rawIdentitySentinel}-lease`,
      payload: { message: "lease" }
    });
    const ingressRepository = repositoryFor(database, "lease-record");
    const recorded = await ingressRepository.record(candidate);
    if (recorded.outcome !== "recorded") throw new Error("fixture invariant");

    const workerA = inboxV2NamespacedIdSchema.parse("core:src002-worker-a");
    const workerB = inboxV2NamespacedIdSchema.parse("core:src002-worker-b");
    const tokenA = `src002-live-a-${"a".repeat(32)}`;
    const tokenB = `src002-live-b-${"b".repeat(32)}`;
    const claims = await Promise.all([
      createSqlInboxV2RawIngressRepository(database, {
        leaseTokenSource: () => [tokenA]
      }).claim({
        tenantId: candidate.tenantId,
        workerId: workerA,
        leaseDurationSeconds: 30,
        batchSize: 1
      }),
      createSqlInboxV2RawIngressRepository(database, {
        leaseTokenSource: () => [tokenB]
      }).claim({
        tenantId: candidate.tenantId,
        workerId: workerB,
        leaseDurationSeconds: 30,
        batchSize: 1
      })
    ]);
    const winner = claims.find((result) => result.outcome === "claimed");
    expect(
      claims.filter((result) => result.outcome === "claimed")
    ).toHaveLength(1);
    expect(claims.filter((result) => result.outcome === "empty")).toHaveLength(
      1
    );
    if (winner?.outcome !== "claimed") throw new Error("fixture invariant");
    const firstClaim = winner.claims[0]!;
    expect(firstClaim.claimKind).toBe("pending");

    const ownerRepository = createSqlInboxV2RawIngressRepository(database);
    const released = await ownerRepository.releaseLease({
      tenantId: candidate.tenantId,
      rawEventId: recorded.rawEventId,
      workerId: firstClaim.work.lease!.workerId,
      leaseToken: firstClaim.leaseToken,
      expectedLeaseRevision: firstClaim.work.lease!.leaseRevision
    });
    expect(released).toMatchObject({
      outcome: "released",
      work: { state: "pending", attemptCount: "1", lease: null }
    });

    const crashToken = `src002-live-crash-${"c".repeat(32)}`;
    const crashWorker = inboxV2NamespacedIdSchema.parse(
      "core:src002-worker-crash"
    );
    const crashRepository = createSqlInboxV2RawIngressRepository(database, {
      leaseTokenSource: () => [crashToken]
    });
    const crashClaim = await crashRepository.claim({
      tenantId: candidate.tenantId,
      workerId: crashWorker,
      leaseDurationSeconds: 1,
      batchSize: 1
    });
    expect(crashClaim.outcome).toBe("claimed");
    if (crashClaim.outcome !== "claimed") throw new Error("fixture invariant");
    const expiredOwner = crashClaim.claims[0]!;

    const noSteal = await createSqlInboxV2RawIngressRepository(database).claim({
      tenantId: candidate.tenantId,
      workerId: workerB,
      leaseDurationSeconds: 30,
      batchSize: 1
    });
    expect(noSteal.outcome).toBe("empty");
    expect(await ingressRepository.record(candidate)).toEqual({
      outcome: "already_recorded",
      rawEventId: recorded.rawEventId,
      safeEnvelopeDigest: candidate.safeEnvelopeDigest
    });

    await delay(1_150);
    const reclaimToken = `src002-live-reclaim-${"d".repeat(32)}`;
    const reclaimRepository = createSqlInboxV2RawIngressRepository(database, {
      leaseTokenSource: () => [reclaimToken]
    });
    const reclaimed = await reclaimRepository.claim({
      tenantId: candidate.tenantId,
      workerId: workerB,
      leaseDurationSeconds: 30,
      batchSize: 1
    });
    expect(reclaimed.outcome).toBe("claimed");
    if (reclaimed.outcome !== "claimed") throw new Error("fixture invariant");
    const reclaim = reclaimed.claims[0]!;
    expect(reclaim).toMatchObject({
      claimKind: "reclaimed",
      expiredLease: {
        workerId: crashWorker,
        leaseRevision: expiredOwner.work.lease!.leaseRevision,
        claimedAt: expiredOwner.work.lease!.claimedAt,
        expiredAt: expiredOwner.work.lease!.expiresAt
      },
      work: { attemptCount: "3" }
    });

    for (const operation of [
      crashRepository.renewLease({
        tenantId: candidate.tenantId,
        rawEventId: recorded.rawEventId,
        workerId: crashWorker,
        leaseToken: crashToken,
        expectedLeaseRevision: expiredOwner.work.lease!.leaseRevision,
        leaseDurationSeconds: 30
      }),
      crashRepository.releaseLease({
        tenantId: candidate.tenantId,
        rawEventId: recorded.rawEventId,
        workerId: crashWorker,
        leaseToken: crashToken,
        expectedLeaseRevision: expiredOwner.work.lease!.leaseRevision
      })
    ]) {
      await expect(operation).resolves.toMatchObject({
        outcome: "stale_token"
      });
    }
  }, 15_000);

  it("rolls back a partial aggregate and database guards reject unsafe anchors and transitions", async () => {
    const ids = scope("rollback");
    const candidate = await acceptedCandidate(ids, {
      identity: `${rawIdentitySentinel}-rollback`,
      payload: { message: "rollback" }
    });
    const rawId = `raw_inbound_event:${suffix}-partial`;
    const failingRepository = createSqlInboxV2RawIngressRepository(
      new FailAfterAnchorExecutor(database),
      {
        rawEventIdSource: () => rawId,
        quarantineIdSource: () => `core:${suffix}-partial-quarantine`
      }
    );
    await expect(failingRepository.record(candidate)).rejects.toThrow(
      "injected failure after anchor"
    );
    expect(await countRows(database, "raw_inbound_events", ids.tenantId)).toBe(
      0
    );

    const repository = repositoryFor(database, "rollback-success");
    const recorded = await repository.record(candidate);
    if (recorded.outcome !== "recorded") throw new Error("fixture invariant");

    const unsafeId = `raw_inbound_event:${suffix}-unsafe`;
    const unsafeFailure = await database
      .transaction(async (transaction) => {
        await transaction.execute(sql`
          insert into public.raw_inbound_events (
            id, tenant_id, source_connection_id, source_account_id,
            external_event_id, event_signature, idempotency_key, received_at,
            provider_timestamp, payload, headers, processing_status,
            error_code, error_message, created_at, updated_at
          ) values (
            ${unsafeId}, ${ids.tenantId}, ${ids.connectionId}, ${ids.accountId},
            'unsafe-external-id', 'unsafe-signature',
            ${`source:v2:raw:${"e".repeat(64)}`}, now(), null,
            ${JSON.stringify({ secret: secretSentinel })}::jsonb,
            '{}'::jsonb, 'new', null, null, now(), now()
          )
        `);
      })
      .then(
        () => null,
        (error: unknown) => error
      );
    expect(unsafeFailure).toBeInstanceOf(Error);
    expect(
      String(
        (unsafeFailure as { cause?: { message?: unknown } }).cause?.message
      )
    ).toMatch(/immutable envelope/iu);
    const unsafeCount = await database.execute<{ count: unknown }>(sql`
      select count(*)::text as count from public.raw_inbound_events
       where tenant_id = ${ids.tenantId} and id = ${unsafeId}
    `);
    expect(unsafeCount.rows[0]?.count).toBe("0");

    const transitionFailure = await database
      .execute(
        sql`
        update public.inbox_v2_source_raw_work_items
           set attempt_count = attempt_count + 1
         where tenant_id = ${ids.tenantId}
           and raw_event_id = ${recorded.rawEventId}
      `
      )
      .then(
        () => null,
        (error: unknown) => error
      );
    expect(transitionFailure).toBeInstanceOf(Error);
    expect(
      String(
        (transitionFailure as { cause?: { message?: unknown } }).cause?.message
      )
    ).toMatch(/\+1 cas|mutation requires/iu);
  });

  it("claims are tenant isolated", async () => {
    const tenantA = scope("isolation-a");
    const tenantB = scope("isolation-b");
    const candidate = await acceptedCandidate(tenantA, {
      identity: `${rawIdentitySentinel}-isolation`,
      payload: { message: "isolation" }
    });
    await repositoryFor(database, "isolation").record(candidate);

    const result = await createSqlInboxV2RawIngressRepository(database).claim({
      tenantId: tenantB.tenantId,
      workerId: inboxV2NamespacedIdSchema.parse("core:src002-isolation-worker"),
      leaseDurationSeconds: 30,
      batchSize: 10
    });
    expect(result.outcome).toBe("empty");
  });
});

type Scope = ReturnType<typeof scope>;
type CandidateScope = Readonly<{
  tenantId: string;
  connectionId: string;
  accountId: string | null;
}>;

function scope(label: string) {
  return {
    tenantId: inboxV2TenantIdSchema.parse(`tenant:${suffix}-${label}`),
    connectionId: inboxV2SourceConnectionIdSchema.parse(
      `source_connection:${suffix}-${label}`
    ),
    accountId: inboxV2SourceAccountIdSchema.parse(
      `source_account:${suffix}-${label}`
    ),
    secondConnectionId: inboxV2SourceConnectionIdSchema.parse(
      `source_connection:${suffix}-${label}-second`
    ),
    secondAccountId: inboxV2SourceAccountIdSchema.parse(
      `source_account:${suffix}-${label}-second`
    )
  } as const;
}

async function seedScope(
  executor: HuleeDatabase,
  ids: Scope,
  options: { includeSecondEdge?: boolean } = {}
): Promise<void> {
  await executor.execute(sql`
    insert into public.tenants (id, slug, display_name)
    values (${ids.tenantId}, ${`${suffix}-${ids.tenantId.split(":").at(-1)}`},
      ${`SRC-002 ${ids.tenantId}`})
  `);
  await executor.execute(sql`
    insert into public.source_connections (
      id, tenant_id, source_type, source_name, display_name, status,
      auth_type, capabilities, config, diagnostics, metadata
    ) values (
      ${ids.connectionId}, ${ids.tenantId}, 'messenger', 'synthetic',
      'SRC-002 connection', 'active', 'custom', '{}'::jsonb, '{}'::jsonb,
      '{}'::jsonb, '{}'::jsonb
    )
  `);
  await executor.execute(sql`
    insert into public.source_accounts (
      id, tenant_id, source_connection_id, external_account_id,
      external_account_name, account_type, display_name, status, metadata
    ) values (
      ${ids.accountId}, ${ids.tenantId}, ${ids.connectionId},
      ${`external-${ids.accountId}`}, 'SRC-002 account', 'direct',
      'SRC-002 account', 'active', '{}'::jsonb
    )
  `);
  if (options.includeSecondEdge === true) {
    await executor.execute(sql`
      insert into public.source_connections (
        id, tenant_id, source_type, source_name, display_name, status,
        auth_type, capabilities, config, diagnostics, metadata
      ) values (
        ${ids.secondConnectionId}, ${ids.tenantId}, 'messenger', 'synthetic',
        'SRC-002 second connection', 'active', 'custom', '{}'::jsonb,
        '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
      )
    `);
    await executor.execute(sql`
      insert into public.source_accounts (
        id, tenant_id, source_connection_id, external_account_id,
        external_account_name, account_type, display_name, status, metadata
      ) values (
        ${ids.secondAccountId}, ${ids.tenantId}, ${ids.secondConnectionId},
        ${`external-${ids.secondAccountId}`}, 'SRC-002 second account',
        'direct', 'SRC-002 second account', 'active', '{}'::jsonb
      )
    `);
  }
}

async function acceptedCandidate(
  ids: CandidateScope,
  input: {
    identity: string;
    payload: Readonly<Record<string, unknown>>;
    receivedAt?: string;
    sanitizedAt?: string;
  }
): Promise<InboxV2SanitizedRawIngressCandidate> {
  const result = await sanitizeInboxV2RawIngress({
    sanitizer: defineInboxV2RawIngressSanitizer({
      profile: testProfile(),
      handler: async ({ headers }) => {
        const requestIds = headers["x-request-id"];
        if (requestIds?.length !== 1 || requestIds[0] !== `request-${suffix}`) {
          return {
            outcome: "quarantined",
            reasonCode: "source.sanitizer_rejected"
          };
        }
        return {
          outcome: "accepted",
          restrictedPayload: input.payload,
          validatedAllowedHeaders: [
            { name: "x-request-id", values: [requestIds[0]] }
          ]
        };
      },
      parseRestrictedPayload: parseMessagePayload
    }),
    request: rawRequest(ids, input.identity, {
      receivedAt: input.receivedAt,
      sanitizedAt: input.sanitizedAt
    })
  });
  if (result.outcome !== "accepted") throw new Error("fixture invariant");
  return result.candidate;
}

async function quarantinedCandidate(
  ids: CandidateScope,
  identity: string
): Promise<InboxV2SanitizedRawIngressCandidate> {
  const result = await sanitizeInboxV2RawIngress({
    sanitizer: defineInboxV2RawIngressSanitizer({
      profile: testProfile(),
      handler: async () => ({
        outcome: "quarantined",
        reasonCode: "source.sanitizer_rejected"
      }),
      parseRestrictedPayload: parseMessagePayload
    }),
    request: rawRequest(ids, identity)
  });
  if (result.outcome !== "quarantined") throw new Error("fixture invariant");
  return result.candidate;
}

function parseMessagePayload(value: unknown): { message: string } {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    typeof (value as { message?: unknown }).message !== "string"
  ) {
    throw new TypeError("Expected the exact SRC-002 message payload.");
  }
  return { message: (value as { message: string }).message };
}

function testProfile() {
  return defineInboxV2RawIngressSanitizerProfile({
    schemaId: "core:inbox-v2.raw-ingress-sanitizer-profile",
    schemaVersion: "v1",
    payload: {
      adapterContract: {
        contractId: "module:synthetic:raw-ingress-src002",
        contractVersion: "v1",
        declarationRevision: "1",
        surfaceId: "core:direct-messenger",
        loadedByTrustedServiceId: "core:source-runtime",
        loadedAt: t0
      },
      handlerId: "module:synthetic:sanitize-src002",
      handlerVersion: "v1",
      declarationRevision: "1",
      restrictedPayloadSchema: {
        schemaId: "module:synthetic:raw-webhook-src002",
        schemaVersion: "v1"
      },
      persistedHeaderNames: ["x-request-id"],
      payloadClassification: {
        dataClassId: "core:raw_provider_payload",
        purposeIds: ["core:source_replay_and_diagnostics"]
      },
      allowedHeadersClassification: {
        dataClassId: "core:raw_provider_allowed_headers",
        purposeIds: ["core:source_replay_and_diagnostics"]
      }
    }
  });
}

function rawRequest(
  ids: CandidateScope,
  identity: string,
  clocks: { receivedAt?: string; sanitizedAt?: string } = {}
): InboxV2RawIngressInput {
  return {
    tenantId: ids.tenantId,
    sourceConnectionId: ids.connectionId,
    sourceAccountId: ids.accountId,
    transport: "webhook",
    eventIdentity: { kind: "provider_event_id", value: identity },
    providerOccurredAt: t0,
    receivedAt: clocks.receivedAt ?? t1,
    sanitizedAt: clocks.sanitizedAt ?? t2,
    body: new TextEncoder().encode(
      JSON.stringify({ authorization: secretSentinel })
    ),
    headers: {
      Authorization: `Bearer ${secretSentinel}`,
      Cookie: `sid=${secretSentinel}`,
      "X-Request-Id": `request-${suffix}`
    }
  };
}

function repositoryFor(
  executor: HuleeDatabase,
  label: string,
  options: {
    idempotencyKeyDigestSource?: () => string;
  } = {}
) {
  return createSqlInboxV2RawIngressRepository(executor, {
    rawEventIdSource: () => `raw_inbound_event:${suffix}-${label}`,
    quarantineIdSource: () => `core:${suffix}-${label}-quarantine`,
    idempotencyKeyDigestSource: options.idempotencyKeyDigestSource
  });
}

async function assertMigrationReady(executor: HuleeDatabase): Promise<void> {
  const result = await executor.execute<{ relation_name: unknown }>(sql`
    select to_regclass('public.inbox_v2_source_raw_envelopes')::text
      as relation_name
  `);
  if (result.rows[0]?.relation_name !== "inbox_v2_source_raw_envelopes") {
    throw new Error("SRC-002 migration is not installed.");
  }
}

async function loadWork(
  executor: HuleeDatabase,
  tenantId: string,
  rawEventId: string
): Promise<Record<string, unknown>> {
  const result = await executor.execute<Record<string, unknown>>(sql`
    select state::text as state, attempt_count::text as attempt_count,
           lease_owner_id, lease_token_hash,
           lease_revision::text as lease_revision,
           revision::text as revision, updated_at
      from public.inbox_v2_source_raw_work_items
     where tenant_id = ${tenantId} and raw_event_id = ${rawEventId}
  `);
  if (result.rows.length !== 1) throw new Error("Expected one raw work row.");
  return normalizeDates(result.rows[0]!);
}

async function countRows(
  executor: HuleeDatabase,
  table: "raw_inbound_events",
  tenantId: string
): Promise<number> {
  if (table !== "raw_inbound_events")
    throw new Error("Unsupported test table.");
  const result = await executor.execute<{ count: unknown }>(sql`
    select count(*)::text as count from public.raw_inbound_events
     where tenant_id = ${tenantId}
  `);
  return Number(result.rows[0]?.count);
}

function normalizeDates(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value
    ])
  );
}

class FailAfterAnchorExecutor implements InboxV2RawIngressTransactionExecutor {
  constructor(private readonly database: HuleeDatabase) {}

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    const result = await this.database.execute(query);
    return { rows: result.rows as readonly Row[] };
  }

  transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config?: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult> {
    return this.database.transaction(async (transaction) => {
      let statementCount = 0;
      const failingExecutor: RawSqlExecutor = {
        execute: async <Row extends Record<string, unknown>>(query: SQL) => {
          statementCount += 1;
          if (statementCount === 2) {
            throw new Error("injected failure after anchor");
          }
          const result = await transaction.execute(query);
          return { rows: result.rows as readonly Row[] };
        }
      };
      return work(failingExecutor);
    }, config);
  }
}
