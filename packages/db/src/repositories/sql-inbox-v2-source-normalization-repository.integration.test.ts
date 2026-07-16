import {
  calculateInboxV2CanonicalSha256,
  encodeInboxV2CanonicalJson,
  defineInboxV2RawIngressSanitizer,
  defineInboxV2RawIngressSanitizerProfile,
  defineInboxV2SourceNormalizer,
  defineInboxV2SourceNormalizerProfile,
  executeInboxV2SourceNormalizer,
  inboxV2NamespacedIdSchema,
  inboxV2SourceAccountIdSchema,
  inboxV2SourceConnectionIdSchema,
  inboxV2TenantIdSchema,
  sanitizeInboxV2RawIngress,
  type InboxV2RawIngressInput,
  type InboxV2SanitizedRawIngressCandidate,
  type InboxV2SourceNormalizationCandidateBatch,
  type InboxV2SourceNormalizedEventDraft
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import { createSqlInboxV2RawIngressRepository } from "./sql-inbox-v2-raw-ingress-repository";
import {
  createSqlInboxV2SourceNormalizationRepository,
  type CreateSqlInboxV2SourceNormalizationRepositoryOptions,
  type InboxV2SourceNormalizationTransactionExecutor
} from "./sql-inbox-v2-source-normalization-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";
import { buildInboxV2AdvisoryXactLockSql } from "./sql-inbox-v2-advisory-lock";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const suffix = `src003-${process.pid}-${Date.now().toString(36)}`;
const t0 = "2026-07-16T08:00:00.000Z";
const t1 = "2026-07-16T08:00:01.000Z";
const t2 = "2026-07-16T08:00:02.000Z";
const digestKeyGeneration = "src003-test-v1";
const digestKey = new TextEncoder().encode(
  "src003-integration-test-tenant-key-material-00000000000000000000"
);

const adapterContract = {
  contractId: "module:synthetic:source-adapter-src003",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "core:direct-messenger",
  loadedByTrustedServiceId: "core:source-runtime",
  loadedAt: t0
} as const;

const rawIngressSanitizerPin = {
  profileSchemaId: "core:inbox-v2.raw-ingress-sanitizer-profile",
  profileSchemaVersion: "v1",
  handlerId: "module:synthetic:sanitize-src003",
  handlerVersion: "v1",
  declarationRevision: "1",
  restrictedPayloadSchema: {
    schemaId: "module:synthetic:raw-event-src003",
    schemaVersion: "v1"
  }
} as const;

describePostgres(
  "SQL Inbox V2 source-normalization PostgreSQL invariants",
  () => {
    let database: HuleeDatabase;

    beforeAll(async () => {
      if (!process.env.DATABASE_URL) {
        throw new Error(
          "DATABASE_URL is required for SRC-003 integration tests."
        );
      }
      database = createHuleeDatabase({
        connectionString: process.env.DATABASE_URL,
        poolConfig: { max: 8 }
      });
      await assertMigrationReady(database);
      await seedScope(database, scope("atomic"));
      await seedScope(database, scope("collision"));
      await seedScope(database, scope("cross-scope"), {
        includeSecondEdge: true
      });
      await seedScope(database, scope("lease"));
      await seedScope(database, scope("wait-expiry"));
      await seedScope(database, scope("closure"));
      await seedScope(database, scope("rollback"));
    }, 30_000);

    afterAll(async () => {
      if (database) await closeHuleeDatabase(database);
    }, 30_000);

    it("atomically completes normalization with an empty legacy anchor and replays after evidence payload purge", async () => {
      const ids = scope("atomic");
      const leased = await recordAndClaim(database, ids, "atomic", {
        identity: `provider-atomic-${suffix}`,
        leaseDurationSeconds: 30
      });
      const repository = normalizationRepository(database, "atomic");
      const loaded = await repository.loadClaimedInput(
        loadInput(ids.tenantId, leased)
      );
      expect(loaded).toMatchObject({
        outcome: "loaded",
        sourceTypeId: "core:messenger",
        sourceName: "synthetic",
        raw: {
          tenantId: ids.tenantId,
          rawEventId: leased.rawEventId,
          restrictedPayload: { message: leased.restrictedMessage }
        }
      });
      if (loaded.outcome !== "loaded") {
        throw new Error("Expected fenced raw normalization evidence to load.");
      }
      expect(Object.isFrozen(loaded.raw)).toBe(true);
      expect(Object.isFrozen(loaded.raw.restrictedPayload)).toBe(true);

      await expectSqlState(
        database.execute(sql`
          delete from public.inbox_v2_source_raw_evidence
           where tenant_id = ${ids.tenantId}
             and raw_event_id = ${leased.rawEventId}
             and evidence_kind = 'provider_payload'
        `),
        "23514"
      );

      const forged = await normalizedCandidate(
        ids,
        leased.rawEventId,
        "atomic",
        "caller-supplied-payload"
      );
      await expect(
        repository.complete(completionInput(forged, leased))
      ).rejects.toThrow(/persisted raw provider evidence/iu);
      expect(
        await loadCompletionCounts(database, ids.tenantId, leased.rawEventId)
      ).toEqual({ result_count: "0", work_count: "1" });

      const candidate = await normalizedCandidate(
        ids,
        leased.rawEventId,
        "atomic",
        leased.restrictedMessage
      );

      const completed = await repository.complete(
        completionInput(candidate, leased)
      );
      expect(completed).toMatchObject({
        outcome: "completed",
        completion: {
          tenantId: ids.tenantId,
          rawEventId: leased.rawEventId,
          outcome: "normalized",
          quarantineId: null
        }
      });
      if (completed.outcome !== "completed") {
        throw new Error("Expected an initial source-normalization completion.");
      }
      expect(completed.completion.normalizedEventIds).toEqual([
        normalizedEventId("atomic", 0)
      ]);

      const aggregate = await loadNormalizedAggregate(
        database,
        ids.tenantId,
        leased.rawEventId
      );
      expect(aggregate).toMatchObject({
        anchor_count: "1",
        envelope_count: "1",
        evidence_reference_count: "1",
        evidence_payload_count: "1",
        result_count: "1",
        work_count: "0",
        unsafe_legacy_anchor_count: "0"
      });

      await database.execute(sql`
        delete from public.inbox_v2_source_raw_evidence
         where tenant_id = ${ids.tenantId}
           and raw_event_id = ${leased.rawEventId}
           and evidence_kind = 'provider_payload'
      `);

      await database.execute(sql`
      delete from public.inbox_v2_source_normalized_evidence_payloads
       where tenant_id = ${ids.tenantId}
         and normalized_event_id = ${completed.completion.normalizedEventIds[0]!}
    `);

      const replayRepository = normalizationRepository(
        database,
        "atomic-retry"
      );
      const replay = await replayRepository.complete(
        completionInput(candidate, leased)
      );
      expect(replay).toEqual({
        outcome: "already_completed",
        completion: completed.completion
      });
      expect(
        await loadNormalizedAggregate(database, ids.tenantId, leased.rawEventId)
      ).toMatchObject({
        anchor_count: "1",
        envelope_count: "1",
        evidence_reference_count: "1",
        evidence_payload_count: "0",
        result_count: "1",
        work_count: "0",
        unsafe_legacy_anchor_count: "0"
      });

      const changedEvidenceCandidate = await normalizedCandidate(
        ids,
        leased.rawEventId,
        "atomic",
        leased.restrictedMessage,
        "classified-atomic-changed"
      );
      await expect(
        normalizationRepository(database, "atomic-changed-evidence").complete(
          completionInput(changedEvidenceCandidate, leased)
        )
      ).rejects.toThrow(/immutable candidate|does not match/iu);
      expect(
        await loadNormalizedAggregate(database, ids.tenantId, leased.rawEventId)
      ).toMatchObject({
        anchor_count: "1",
        envelope_count: "1",
        evidence_reference_count: "1",
        evidence_payload_count: "0",
        result_count: "1",
        work_count: "0"
      });
    });

    it("quarantines a changed raw aggregate with the same server key and rejects a cross-scope candidate", async () => {
      const ids = scope("collision");
      const first = await recordAndClaim(database, ids, "collision-first", {
        identity: `provider-collision-first-${suffix}`,
        leaseDurationSeconds: 30
      });
      const firstCandidate = await normalizedCandidate(
        ids,
        first.rawEventId,
        "shared-collision",
        first.restrictedMessage
      );
      const firstCompletion = await normalizationRepository(
        database,
        "collision-first"
      ).complete(completionInput(firstCandidate, first));
      expect(firstCompletion.outcome).toBe("completed");
      if (firstCompletion.outcome !== "completed") {
        throw new Error("Expected the collision fixture to normalize first.");
      }

      const second = await recordAndClaim(database, ids, "collision-second", {
        identity: `provider-collision-second-${suffix}`,
        leaseDurationSeconds: 30
      });
      const secondCandidate = await normalizedCandidate(
        ids,
        second.rawEventId,
        "shared-collision",
        second.restrictedMessage
      );
      const collision = await normalizationRepository(
        database,
        "collision-second"
      ).complete(completionInput(secondCandidate, second));
      expect(collision).toEqual({
        outcome: "quarantined",
        quarantineId: `core:${suffix}-collision-second-quarantine`,
        reasonCode: "source.idempotency_collision"
      });

      const collisionRows = await database.execute<{
        normalized_count: unknown;
        quarantine_count: unknown;
        result_outcome: unknown;
        work_count: unknown;
      }>(sql`
      select
        (select count(*)::text
           from public.inbox_v2_source_normalized_envelopes envelope
          where envelope.tenant_id = ${ids.tenantId}
            and envelope.raw_event_id = ${second.rawEventId})
          as normalized_count,
        (select count(*)::text
           from public.inbox_v2_source_normalized_quarantines quarantine
          where quarantine.tenant_id = ${ids.tenantId}
            and quarantine.raw_event_id = ${second.rawEventId})
          as quarantine_count,
        (select result.outcome::text
           from public.inbox_v2_source_normalization_results result
          where result.tenant_id = ${ids.tenantId}
            and result.raw_event_id = ${second.rawEventId})
          as result_outcome,
        (select count(*)::text
           from public.inbox_v2_source_raw_work_items work
          where work.tenant_id = ${ids.tenantId}
            and work.raw_event_id = ${second.rawEventId})
          as work_count
    `);
      expect(collisionRows.rows[0]).toEqual({
        normalized_count: "0",
        quarantine_count: "1",
        result_outcome: "quarantined",
        work_count: "0"
      });

      const mismatched = await recordAndClaim(
        database,
        ids,
        "collision-mismatched-result",
        {
          identity: `provider-collision-mismatched-${suffix}`,
          leaseDurationSeconds: 30
        }
      );
      await expectSqlState(
        database.execute(sql`
          insert into public.inbox_v2_source_normalization_results
          select (jsonb_populate_record(
            null::public.inbox_v2_source_normalization_results,
            to_jsonb(result_row) || jsonb_build_object(
              'raw_event_id', ${mismatched.rawEventId}::text
            )
          )).*
            from public.inbox_v2_source_normalization_results result_row
           where result_row.tenant_id = ${ids.tenantId}
             and result_row.raw_event_id = ${second.rawEventId}
        `),
        "23503"
      );
      expect(
        await loadCompletionCounts(
          database,
          ids.tenantId,
          mismatched.rawEventId
        )
      ).toEqual({ result_count: "0", work_count: "1" });

      const cross = scope("cross-scope");
      const crossLeased = await recordAndClaim(database, cross, "cross-scope", {
        identity: `provider-cross-scope-${suffix}`,
        leaseDurationSeconds: 30
      });
      const wrongScope = secondaryScope(cross);
      const crossCandidate = await normalizedCandidate(
        wrongScope,
        crossLeased.rawEventId,
        "cross-scope",
        crossLeased.restrictedMessage
      );
      await expect(
        normalizationRepository(database, "cross-scope").complete(
          completionInput(crossCandidate, crossLeased)
        )
      ).rejects.toThrow(/accepted raw source scope/iu);
      expect(
        await loadCompletionCounts(
          database,
          cross.tenantId,
          crossLeased.rawEventId
        )
      ).toEqual({ result_count: "0", work_count: "1" });
    });

    it("fences an expired owner after another worker reclaims the raw lease", async () => {
      const ids = scope("lease");
      const expired = await recordAndClaim(database, ids, "lease-expired", {
        identity: `provider-lease-${suffix}`,
        leaseDurationSeconds: 1
      });
      const candidate = await normalizedCandidate(
        ids,
        expired.rawEventId,
        "lease",
        expired.restrictedMessage
      );

      await delay(1_150);
      const reclaimWorker = inboxV2NamespacedIdSchema.parse(
        "core:src003-worker-reclaimed"
      );
      const reclaimToken = `src003-reclaimed-${"r".repeat(32)}`;
      const reclaimedResult = await createSqlInboxV2RawIngressRepository(
        database,
        { leaseTokenSource: () => [reclaimToken] }
      ).claim({
        tenantId: ids.tenantId,
        workerId: reclaimWorker,
        leaseDurationSeconds: 30,
        batchSize: 1
      });
      expect(reclaimedResult.outcome).toBe("claimed");
      if (reclaimedResult.outcome !== "claimed") {
        throw new Error("Expected expired SRC-003 work to be reclaimed.");
      }
      const reclaimed = reclaimedResult.claims[0]!;
      expect(reclaimed.claimKind).toBe("reclaimed");

      const repository = normalizationRepository(database, "lease");
      await expect(
        repository.complete(completionInput(candidate, expired))
      ).resolves.toMatchObject({
        outcome: "stale_token",
        tenantId: ids.tenantId,
        rawEventId: expired.rawEventId,
        currentLeaseRevision: reclaimed.work.lease!.leaseRevision
      });
      expect(
        await loadCompletionCounts(database, ids.tenantId, expired.rawEventId)
      ).toEqual({ result_count: "0", work_count: "1" });

      await expect(
        repository.complete({
          candidate,
          workerId: reclaimWorker,
          leaseToken: reclaimToken,
          expectedLeaseRevision: reclaimed.work.lease!.leaseRevision
        })
      ).resolves.toMatchObject({
        outcome: "completed",
        completion: { outcome: "normalized" }
      });
    }, 15_000);

    it("rechecks the database clock after an idempotency-lock wait and rolls back an expired completion", async () => {
      const ids = scope("wait-expiry");
      const leased = await recordAndClaim(database, ids, "wait-expiry", {
        identity: `provider-wait-expiry-${suffix}`,
        leaseDurationSeconds: 2
      });
      const candidate = await normalizedCandidate(
        ids,
        leased.rawEventId,
        "wait-expiry",
        leased.restrictedMessage
      );
      const idempotencyKey = candidateIdempotencyKey(candidate);

      let releaseBlocker!: () => void;
      const releasePromise = new Promise<void>((resolve) => {
        releaseBlocker = resolve;
      });
      let announceLock!: () => void;
      const lockAcquired = new Promise<void>((resolve) => {
        announceLock = resolve;
      });
      const blocker = database.transaction(async (transaction) => {
        await transaction.execute(
          buildInboxV2AdvisoryXactLockSql([
            "core:source-normalization-idempotency",
            ids.tenantId,
            idempotencyKey
          ])
        );
        announceLock();
        await releasePromise;
      });
      await lockAcquired;

      const completion = normalizationRepository(
        database,
        "wait-expiry"
      ).complete(completionInput(candidate, leased));
      await delay(2_200);
      releaseBlocker();
      await blocker;

      await expect(completion).resolves.toEqual({
        outcome: "lease_expired",
        tenantId: ids.tenantId,
        rawEventId: leased.rawEventId,
        currentLeaseRevision: leased.leaseRevision,
        expiredAt: expect.any(String)
      });
      expect(
        await loadNormalizedAggregate(database, ids.tenantId, leased.rawEventId)
      ).toMatchObject({
        anchor_count: "0",
        envelope_count: "0",
        result_count: "0",
        work_count: "1"
      });
    }, 15_000);

    it("rejects orphan normalized aggregates and any append after a terminal result", async () => {
      const ids = scope("closure");
      const terminal = await recordAndClaim(database, ids, "closure-terminal", {
        identity: `provider-closure-terminal-${suffix}`,
        leaseDurationSeconds: 30
      });
      const candidate = await normalizedCandidate(
        ids,
        terminal.rawEventId,
        "closure-terminal",
        terminal.restrictedMessage
      );
      const completed = await normalizationRepository(
        database,
        "closure-terminal"
      ).complete(completionInput(candidate, terminal));
      if (completed.outcome !== "completed") {
        throw new Error("Expected the closure fixture to normalize.");
      }
      const templateEventId = completed.completion.normalizedEventIds[0]!;

      await expectSqlState(
        insertClonedNormalizedAggregate(database, {
          tenantId: ids.tenantId,
          templateEventId,
          rawEventId: terminal.rawEventId,
          normalizedEventId: normalizedEventId("closure-append", 1),
          ordinal: 1,
          idempotencyHex: "a".repeat(64)
        }),
        "23514"
      );

      const orphan = await recordAndClaim(database, ids, "closure-orphan", {
        identity: `provider-closure-orphan-${suffix}`,
        leaseDurationSeconds: 30
      });
      await expectSqlState(
        insertClonedNormalizedAggregate(database, {
          tenantId: ids.tenantId,
          templateEventId,
          rawEventId: orphan.rawEventId,
          normalizedEventId: normalizedEventId("closure-orphan", 0),
          ordinal: 0,
          idempotencyHex: "b".repeat(64)
        }),
        "23514"
      );

      expect(
        await loadCompletionCounts(database, ids.tenantId, orphan.rawEventId)
      ).toEqual({ result_count: "0", work_count: "1" });
      expect(
        await loadNormalizedAggregate(
          database,
          ids.tenantId,
          terminal.rawEventId
        )
      ).toMatchObject({ envelope_count: "1", result_count: "1" });
    });

    it("rolls back every normalization write when persistence fails mid-transaction", async () => {
      const ids = scope("rollback");
      const leased = await recordAndClaim(database, ids, "rollback", {
        identity: `provider-rollback-${suffix}`,
        leaseDurationSeconds: 30
      });
      const candidate = await normalizedCandidate(
        ids,
        leased.rawEventId,
        "rollback",
        leased.restrictedMessage
      );
      const failingRepository = createSqlInboxV2SourceNormalizationRepository(
        new FailAfterNormalizedEnvelopeExecutor(database),
        normalizationOptions("rollback-failed")
      );

      await expect(
        failingRepository.complete(completionInput(candidate, leased))
      ).rejects.toThrow("injected failure after normalized envelope");
      expect(
        await loadNormalizedAggregate(database, ids.tenantId, leased.rawEventId)
      ).toMatchObject({
        anchor_count: "0",
        envelope_count: "0",
        evidence_reference_count: "0",
        evidence_payload_count: "0",
        result_count: "0",
        work_count: "1"
      });

      await expect(
        normalizationRepository(database, "rollback-success").complete(
          completionInput(candidate, leased)
        )
      ).resolves.toMatchObject({
        outcome: "completed",
        completion: { outcome: "normalized" }
      });
    });
  }
);

type Scope = ReturnType<typeof scope>;
type CandidateScope = Readonly<{
  tenantId: Scope["tenantId"];
  connectionId: Scope["connectionId"];
  accountId: Scope["accountId"];
}>;
type LeasedRaw = Awaited<ReturnType<typeof recordAndClaim>>;

async function expectSqlState(
  operation: Promise<unknown>,
  expectedCode: string
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    let current: unknown = error;
    for (let depth = 0; depth < 8; depth += 1) {
      if (current === null || typeof current !== "object") break;
      if (Reflect.get(current, "code") === expectedCode) return;
      current = Reflect.get(current, "cause");
    }
    throw error;
  }
  throw new Error(`Expected PostgreSQL SQLSTATE ${expectedCode}.`);
}

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

function secondaryScope(ids: Scope): CandidateScope {
  return {
    tenantId: ids.tenantId,
    connectionId: ids.secondConnectionId,
    accountId: ids.secondAccountId
  };
}

async function seedScope(
  executor: HuleeDatabase,
  ids: Scope,
  options: { includeSecondEdge?: boolean } = {}
): Promise<void> {
  await executor.execute(sql`
    insert into public.tenants (id, slug, display_name)
    values (${ids.tenantId}, ${`${suffix}-${ids.tenantId.split(":").at(-1)}`},
      ${`SRC-003 ${ids.tenantId}`})
  `);
  await seedSourceEdge(executor, ids.tenantId, ids.connectionId, ids.accountId);
  if (options.includeSecondEdge === true) {
    await seedSourceEdge(
      executor,
      ids.tenantId,
      ids.secondConnectionId,
      ids.secondAccountId
    );
  }
}

async function seedSourceEdge(
  executor: HuleeDatabase,
  tenantId: string,
  connectionId: string,
  accountId: string
): Promise<void> {
  await executor.execute(sql`
    insert into public.source_connections (
      id, tenant_id, source_type, source_name, display_name, status,
      auth_type, capabilities, config, diagnostics, metadata
    ) values (
      ${connectionId}, ${tenantId}, 'messenger', 'synthetic',
      'SRC-003 connection', 'active', 'custom', '{}'::jsonb, '{}'::jsonb,
      '{}'::jsonb, '{}'::jsonb
    )
  `);
  await executor.execute(sql`
    insert into public.source_accounts (
      id, tenant_id, source_connection_id, external_account_id,
      external_account_name, account_type, display_name, status, metadata
    ) values (
      ${accountId}, ${tenantId}, ${connectionId},
      ${`external-${accountId}`}, 'SRC-003 account', 'direct',
      'SRC-003 account', 'active', '{}'::jsonb
    )
  `);
}

async function recordAndClaim(
  executor: HuleeDatabase,
  ids: CandidateScope,
  label: string,
  input: Readonly<{
    identity: string;
    leaseDurationSeconds: number;
  }>
) {
  const rawRepository = createSqlInboxV2RawIngressRepository(executor, {
    rawEventIdSource: () => `raw_inbound_event:${suffix}-${label}`
  });
  const candidate = await acceptedRawCandidate(ids, input.identity);
  const recorded = await rawRepository.record(candidate);
  if (recorded.outcome !== "recorded") {
    throw new Error(`Expected SRC-003 raw ingress to be recorded: ${label}`);
  }
  const workerId = inboxV2NamespacedIdSchema.parse(
    `core:src003-worker-${label}`
  );
  const leaseToken = `src003-${label}-${"t".repeat(32)}`;
  const claim = await createSqlInboxV2RawIngressRepository(executor, {
    leaseTokenSource: () => [leaseToken]
  }).claim({
    tenantId: ids.tenantId,
    workerId,
    leaseDurationSeconds: input.leaseDurationSeconds,
    batchSize: 1
  });
  if (claim.outcome !== "claimed" || claim.claims.length !== 1) {
    throw new Error(`Expected exactly one SRC-003 raw claim: ${label}`);
  }
  const leased = claim.claims[0]!;
  if (leased.work.lease === null) {
    throw new Error(`Expected a leased SRC-003 raw work item: ${label}`);
  }
  return Object.freeze({
    rawEventId: recorded.rawEventId,
    workerId,
    leaseToken,
    leaseRevision: leased.work.lease.leaseRevision,
    restrictedMessage: input.identity
  });
}

async function acceptedRawCandidate(
  ids: CandidateScope,
  identity: string
): Promise<InboxV2SanitizedRawIngressCandidate> {
  const result = await sanitizeInboxV2RawIngress({
    sanitizer: defineInboxV2RawIngressSanitizer({
      profile: rawIngressProfile(),
      handler: async () => ({
        outcome: "accepted",
        restrictedPayload: { message: identity },
        validatedAllowedHeaders: []
      }),
      parseRestrictedPayload: parseMessagePayload
    }),
    request: rawRequest(ids, identity)
  });
  if (result.outcome !== "accepted") {
    throw new Error("Expected an accepted SRC-003 raw candidate.");
  }
  return result.candidate;
}

function rawIngressProfile() {
  return defineInboxV2RawIngressSanitizerProfile({
    schemaId: rawIngressSanitizerPin.profileSchemaId,
    schemaVersion: rawIngressSanitizerPin.profileSchemaVersion,
    payload: {
      adapterContract,
      handlerId: rawIngressSanitizerPin.handlerId,
      handlerVersion: rawIngressSanitizerPin.handlerVersion,
      declarationRevision: rawIngressSanitizerPin.declarationRevision,
      restrictedPayloadSchema: rawIngressSanitizerPin.restrictedPayloadSchema,
      persistedHeaderNames: [],
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
  identity: string
): InboxV2RawIngressInput {
  return {
    tenantId: ids.tenantId,
    sourceConnectionId: ids.connectionId,
    sourceAccountId: ids.accountId,
    transport: "webhook",
    eventIdentity: { kind: "provider_event_id", value: identity },
    providerOccurredAt: t0,
    receivedAt: t1,
    sanitizedAt: t2,
    body: new TextEncoder().encode(JSON.stringify({ message: identity })),
    headers: {}
  };
}

async function normalizedCandidate(
  ids: CandidateScope,
  rawEventId: string,
  semanticKey: string,
  restrictedMessage: string,
  evidenceText = `classified-${semanticKey}`
): Promise<InboxV2SourceNormalizationCandidateBatch> {
  const normalizer = defineInboxV2SourceNormalizer({
    profile: normalizerProfile(),
    parseRestrictedPayload: parseMessagePayload,
    evidenceParsers: {
      "module:synthetic:message-content-src003": parseMessageEvidence
    },
    handler: () => ({
      outcome: "emitted",
      events: [messageEvent(ids, semanticKey, evidenceText)]
    })
  });
  return executeInboxV2SourceNormalizer({
    normalizer,
    raw: {
      tenantId: ids.tenantId,
      rawEventId,
      sourceConnectionId: ids.connectionId,
      sourceAccountId: ids.accountId,
      transport: "webhook",
      providerOccurredAt: t0,
      rawIngressSanitizer: rawIngressSanitizerPin,
      restrictedPayload: { message: restrictedMessage }
    }
  });
}

function normalizerProfile() {
  const identityDeclarations = [
    threadDeclaration(),
    messageDeclaration(),
    senderDeclaration()
  ].sort((left, right) =>
    String(calculateInboxV2CanonicalSha256(left)).localeCompare(
      String(calculateInboxV2CanonicalSha256(right))
    )
  );
  return defineInboxV2SourceNormalizerProfile({
    schemaId: "core:inbox-v2.source-normalizer-profile",
    schemaVersion: "v1",
    payload: {
      adapterContract,
      handlerId: "module:synthetic:normalize-src003",
      handlerVersion: "v1",
      declarationRevision: "1",
      rawIngressSanitizer: rawIngressSanitizerPin,
      eventKinds: ["message_created"],
      identityDeclarations,
      evidenceSlots: [
        {
          slotId: "module:synthetic:message-content-src003",
          schemaId: "module:synthetic:message-content-src003",
          schemaVersion: "v1",
          dataClassId: "core:normalized_event_payload",
          purposeIds: ["core:source_replay_and_diagnostics"]
        }
      ]
    }
  });
}

function messageEvent(
  ids: CandidateScope,
  semanticKey: string,
  evidenceText: string
): InboxV2SourceNormalizedEventDraft {
  const owner = sourceAccountReference(ids);
  const authorKey = `author-${semanticKey}`;
  return {
    direction: "inbound",
    visibility: "public",
    payloadVersion: "v1",
    providerOccurredAt: t0,
    semantic: {
      kind: "message_created",
      originKind: "webhook",
      authorObservationKey: authorKey
    },
    thread: {
      identityDeclaration: threadDeclaration(),
      key: {
        realm: {
          realmId: "module:synthetic:thread-realm-src003",
          realmVersion: "v1",
          canonicalizationVersion: "v1"
        },
        scope: { kind: "source_account", owner },
        objectKindId: "module:synthetic:chat-src003",
        canonicalExternalSubject: `Chat-${semanticKey}`
      },
      observedExternalSubject: `Chat-${semanticKey}`
    },
    message: {
      identityDeclaration: messageDeclaration(),
      realm: {
        realmId: "module:synthetic:message-realm-src003",
        realmVersion: "v1",
        canonicalizationVersion: "v1"
      },
      scope: { kind: "source_account", owner },
      objectKindId: "module:synthetic:message-src003",
      observedExternalSubject: `Message-${semanticKey}`,
      canonicalExternalSubject: `Message-${semanticKey}`
    },
    identityObservations: [
      {
        observationKey: authorKey,
        purpose: "message_author",
        identityDeclaration: senderDeclaration(),
        realm: {
          realmId: "module:synthetic:sender-realm-src003",
          realmVersion: "v1",
          canonicalizationVersion: "v1"
        },
        scope: { kind: "source_account", owner },
        objectKindId: "module:synthetic:user-src003",
        observedExternalSubject: `User-${semanticKey}`,
        canonicalExternalSubject: `User-${semanticKey}`,
        stability: "stable",
        observedAt: t0
      }
    ],
    rosterObservation: null,
    capabilityObservation: {
      schemaId: "module:synthetic:capabilities-src003",
      schemaVersion: "v1",
      capabilities: []
    },
    evidence: [
      {
        slotId: "module:synthetic:message-content-src003",
        value: { text: evidenceText }
      }
    ]
  };
}

function sourceAccountReference(ids: CandidateScope) {
  return {
    tenantId: ids.tenantId,
    kind: "source_account" as const,
    id: ids.accountId
  };
}

function threadDeclaration() {
  return {
    adapterContract,
    identityKind: "external_thread" as const,
    realmId: "module:synthetic:thread-realm-src003",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic:chat-src003",
    scopeKind: "source_account" as const,
    decisionStrength: "safe_default" as const
  };
}

function messageDeclaration() {
  return {
    adapterContract,
    identityKind: "message" as const,
    realmId: "module:synthetic:message-realm-src003",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic:message-src003",
    scopeKind: "source_account" as const,
    decisionStrength: "safe_default" as const
  };
}

function senderDeclaration() {
  return {
    adapterContract,
    identityKind: "source_external_identity" as const,
    realmId: "module:synthetic:sender-realm-src003",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic:user-src003",
    scopeKind: "source_account" as const,
    decisionStrength: "safe_default" as const
  };
}

function parseMessagePayload(value: unknown): { message: string } {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    typeof (value as { message?: unknown }).message !== "string"
  ) {
    throw new TypeError("Expected the exact SRC-003 message payload.");
  }
  return { message: (value as { message: string }).message };
}

function parseMessageEvidence(value: unknown): { text: string } {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    typeof (value as { text?: unknown }).text !== "string"
  ) {
    throw new TypeError("Expected the exact SRC-003 message evidence.");
  }
  return { text: (value as { text: string }).text };
}

function completionInput(
  candidate: InboxV2SourceNormalizationCandidateBatch,
  leased: LeasedRaw
) {
  return {
    candidate,
    workerId: leased.workerId,
    leaseToken: leased.leaseToken,
    expectedLeaseRevision: leased.leaseRevision
  } as const;
}

function loadInput(tenantId: Scope["tenantId"], leased: LeasedRaw) {
  return {
    tenantId,
    rawEventId: leased.rawEventId,
    workerId: leased.workerId,
    leaseToken: leased.leaseToken,
    expectedLeaseRevision: leased.leaseRevision
  } as const;
}

function normalizationRepository(executor: HuleeDatabase, label: string) {
  return createSqlInboxV2SourceNormalizationRepository(
    executor,
    normalizationOptions(label)
  );
}

function normalizationOptions(
  label: string
): CreateSqlInboxV2SourceNormalizationRepositoryOptions {
  return {
    normalizationDigestKeySource: ({ keyGeneration }) => {
      if (keyGeneration !== null && keyGeneration !== digestKeyGeneration) {
        throw new Error(`Unknown SRC-003 digest generation: ${keyGeneration}`);
      }
      return {
        keyGeneration: digestKeyGeneration,
        key: Uint8Array.from(digestKey)
      };
    },
    normalizedEventIdSource: ({ ordinal }) => normalizedEventId(label, ordinal),
    quarantineIdSource: () => `core:${suffix}-${label}-quarantine`
  };
}

function normalizedEventId(label: string, ordinal: number): string {
  return `normalized_inbound_event:${suffix}-${label}-${ordinal}`;
}

function candidateIdempotencyKey(
  candidate: InboxV2SourceNormalizationCandidateBatch
): string {
  const event = candidate.events[0];
  if (event === undefined) {
    throw new Error("Advisory-lock fixture requires one normalized event.");
  }
  const digest = createHmac("sha256", digestKey)
    .update(
      encodeInboxV2CanonicalJson({
        domain: "core:inbox-v2.source-normalization-idempotency",
        version: "v1",
        protection: {
          tenantId: candidate.tenantId,
          purpose: "core:source-normalization-persistence",
          keyGeneration: digestKeyGeneration
        },
        sourceConnectionId: candidate.sourceConnectionId,
        sourceAccountId: candidate.sourceAccountId,
        ordinal: event.ordinal,
        eventType: event.eventType,
        providerOccurredAt: event.providerOccurredAt,
        semantic: event.semantic,
        thread: event.thread,
        message: event.message
      })
    )
    .digest("hex");
  return `source:v2:normalized:${digest}`;
}

async function insertClonedNormalizedAggregate(
  executor: HuleeDatabase,
  input: Readonly<{
    tenantId: string;
    templateEventId: string;
    rawEventId: string;
    normalizedEventId: string;
    ordinal: number;
    idempotencyHex: string;
  }>
): Promise<void> {
  const idempotencyKey = `source:v2:normalized:${input.idempotencyHex}`;
  await executor.transaction(async (transaction) => {
    await transaction.execute(sql`
      insert into public.normalized_inbound_events (
        id, tenant_id, raw_event_id, source_connection_id, source_account_id,
        source_type, source_name, event_type, direction, visibility,
        external_thread_id, external_message_id, external_user_id,
        payload_version, normalized_payload, reply_capability,
        conversation_id, message_id, idempotency_key, processing_status,
        created_at, updated_at
      )
      select ${input.normalizedEventId}, anchor_row.tenant_id,
             ${input.rawEventId}, anchor_row.source_connection_id,
             anchor_row.source_account_id, anchor_row.source_type,
             anchor_row.source_name, anchor_row.event_type,
             anchor_row.direction, anchor_row.visibility,
             anchor_row.external_thread_id, anchor_row.external_message_id,
             anchor_row.external_user_id, anchor_row.payload_version,
             anchor_row.normalized_payload, anchor_row.reply_capability,
             anchor_row.conversation_id, anchor_row.message_id,
             ${idempotencyKey}, anchor_row.processing_status,
             anchor_row.created_at, anchor_row.updated_at
        from public.normalized_inbound_events anchor_row
       where anchor_row.tenant_id = ${input.tenantId}
         and anchor_row.id = ${input.templateEventId}
    `);
    await transaction.execute(sql`
      insert into public.inbox_v2_source_normalized_envelopes
      select (jsonb_populate_record(
        null::public.inbox_v2_source_normalized_envelopes,
        to_jsonb(envelope_row) || jsonb_build_object(
          'normalized_event_id', ${input.normalizedEventId}::text,
          'raw_event_id', ${input.rawEventId}::text,
          'normalized_ordinal', ${input.ordinal}::integer,
          'idempotency_key', ${idempotencyKey}::text,
          'normalized_evidence_count', 0
        )
      )).*
        from public.inbox_v2_source_normalized_envelopes envelope_row
       where envelope_row.tenant_id = ${input.tenantId}
         and envelope_row.normalized_event_id = ${input.templateEventId}
    `);
  });
}

async function loadNormalizedAggregate(
  executor: HuleeDatabase,
  tenantId: string,
  rawEventId: string
): Promise<Record<string, unknown>> {
  const result = await executor.execute<Record<string, unknown>>(sql`
    select
      (select count(*)::text
         from public.normalized_inbound_events anchor
        where anchor.tenant_id = ${tenantId}
          and anchor.raw_event_id = ${rawEventId}) as anchor_count,
      (select count(*)::text
         from public.inbox_v2_source_normalized_envelopes envelope
        where envelope.tenant_id = ${tenantId}
          and envelope.raw_event_id = ${rawEventId}) as envelope_count,
      (select count(*)::text
         from public.inbox_v2_source_normalized_evidence evidence
         join public.inbox_v2_source_normalized_envelopes envelope
           on envelope.tenant_id = evidence.tenant_id
          and envelope.normalized_event_id = evidence.normalized_event_id
        where envelope.tenant_id = ${tenantId}
          and envelope.raw_event_id = ${rawEventId})
        as evidence_reference_count,
      (select count(*)::text
         from public.inbox_v2_source_normalized_evidence_payloads payload
         join public.inbox_v2_source_normalized_envelopes envelope
           on envelope.tenant_id = payload.tenant_id
          and envelope.normalized_event_id = payload.normalized_event_id
        where envelope.tenant_id = ${tenantId}
          and envelope.raw_event_id = ${rawEventId}) as evidence_payload_count,
      (select count(*)::text
         from public.inbox_v2_source_normalization_results result
        where result.tenant_id = ${tenantId}
          and result.raw_event_id = ${rawEventId}) as result_count,
      (select count(*)::text
         from public.inbox_v2_source_raw_work_items work
        where work.tenant_id = ${tenantId}
          and work.raw_event_id = ${rawEventId}) as work_count,
      (select count(*)::text
         from public.normalized_inbound_events anchor
        where anchor.tenant_id = ${tenantId}
          and anchor.raw_event_id = ${rawEventId}
          and (
            anchor.external_thread_id is not null
            or anchor.external_message_id is not null
            or anchor.external_user_id is not null
            or anchor.normalized_payload <> '{}'::jsonb
            or anchor.reply_capability <> '{}'::jsonb
            or anchor.conversation_id is not null
            or anchor.message_id is not null
            or anchor.processing_status <> 'ignored'
            or anchor.created_at <> anchor.updated_at
          )) as unsafe_legacy_anchor_count
  `);
  if (result.rows.length !== 1) {
    throw new Error("Expected one SRC-003 aggregate count row.");
  }
  return result.rows[0]!;
}

async function loadCompletionCounts(
  executor: HuleeDatabase,
  tenantId: string,
  rawEventId: string
) {
  const result = await executor.execute<{
    result_count: unknown;
    work_count: unknown;
  }>(sql`
    select
      (select count(*)::text
         from public.inbox_v2_source_normalization_results result
        where result.tenant_id = ${tenantId}
          and result.raw_event_id = ${rawEventId}) as result_count,
      (select count(*)::text
         from public.inbox_v2_source_raw_work_items work
        where work.tenant_id = ${tenantId}
          and work.raw_event_id = ${rawEventId}) as work_count
  `);
  if (result.rows.length !== 1) {
    throw new Error("Expected one SRC-003 completion count row.");
  }
  return result.rows[0]!;
}

async function assertMigrationReady(executor: HuleeDatabase): Promise<void> {
  const result = await executor.execute<{
    envelopes: unknown;
    results: unknown;
    payloads: unknown;
  }>(sql`
    select
      to_regclass('public.inbox_v2_source_normalized_envelopes')::text
        as envelopes,
      to_regclass('public.inbox_v2_source_normalization_results')::text
        as results,
      to_regclass('public.inbox_v2_source_normalized_evidence_payloads')::text
        as payloads
  `);
  expect(result.rows[0]).toEqual({
    envelopes: "inbox_v2_source_normalized_envelopes",
    results: "inbox_v2_source_normalization_results",
    payloads: "inbox_v2_source_normalized_evidence_payloads"
  });
}

class FailAfterNormalizedEnvelopeExecutor implements InboxV2SourceNormalizationTransactionExecutor {
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
          if (statementCount === 7) {
            throw new Error("injected failure after normalized envelope");
          }
          const result = await transaction.execute(query);
          return { rows: result.rows as readonly Row[] };
        }
      };
      return work(failingExecutor);
    }, config);
  }
}
