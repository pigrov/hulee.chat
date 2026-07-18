import {
  INBOX_V2_SOURCE_CURSOR_PURPOSE_ID,
  INBOX_V2_SOURCE_REPLAY_PURPOSE_ID,
  calculateInboxV2CanonicalSha256,
  calculateInboxV2SourceReplayRequestHash,
  defineInboxV2RawIngressSanitizer,
  defineInboxV2RawIngressSanitizerProfile,
  defineInboxV2SourceNormalizer,
  defineInboxV2SourceNormalizerProfile,
  executeInboxV2SourceNormalizer,
  inboxV2ApplySourceProcessingOutcomeInputSchema,
  inboxV2NamespacedIdSchema,
  inboxV2SafeSourceDiagnosticSchema,
  inboxV2SourceAccountIdSchema,
  inboxV2SourceConnectionIdSchema,
  inboxV2SourceCursorLoadInputSchema,
  inboxV2SourceCursorDurableTargetLookupInputSchema,
  inboxV2SourceCursorPositionSchema,
  inboxV2SourceCursorPersistenceInputSchema,
  inboxV2SourceCursorProtectionSchema,
  inboxV2SourceDedupeHmacVerificationSchema,
  inboxV2SourceDedupeIdentityCandidatesSchema,
  inboxV2SourceDedupeReplayabilityExpireInputSchema,
  inboxV2SourceDedupeSkeletonExpireInputSchema,
  inboxV2SourceDedupeSkeletonLookupInputSchema,
  inboxV2SourceDedupeSkeletonWriteInputSchema,
  inboxV2SourceProcessingKeyRetirementInputSchema,
  inboxV2SourceProcessingKeyRotationInputSchema,
  inboxV2SourceProcessingScopeSchema,
  inboxV2SourceProcessingOutcomeSchema,
  inboxV2SourceReplayRequestSchema,
  inboxV2TenantIdSchema,
  sanitizeInboxV2RawIngress,
  type InboxV2ApplySourceProcessingOutcomeInput,
  type InboxV2RawIngressInput,
  type InboxV2SanitizedRawIngressCandidate,
  type InboxV2SafeSourceDiagnostic,
  type InboxV2SourceBackpressurePolicy,
  type InboxV2SourceProcessingCryptographicAuthorityPort,
  type InboxV2SourceCursorDurableTargetResolverPort,
  type InboxV2SourceProcessingOutcome,
  type InboxV2SourceProcessingRuntimeClaim,
  type InboxV2SourceProcessingRuntimeRepositoryPort,
  type InboxV2SourceProcessingScope,
  type InboxV2SourceNormalizationCandidateBatch,
  type InboxV2SourceNormalizedEventDraft,
  type InboxV2SourceReplayRequest
} from "@hulee/contracts";
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import {
  createProductionSqlInboxV2RawIngressRepository,
  createSqlInboxV2RawIngressRepository
} from "./sql-inbox-v2-raw-ingress-repository";
import {
  createSqlInboxV2SourceNormalizationRepository,
  type CreateSqlInboxV2SourceNormalizationRepositoryOptions
} from "./sql-inbox-v2-source-normalization-repository";
import {
  buildReconcileMissingInboxV2SourceProcessingBridgeSql,
  createSqlInboxV2SourceProcessingRuntimeRepository,
  type CreateSqlInboxV2SourceProcessingRuntimeRepositoryOptions
} from "./sql-inbox-v2-source-processing-runtime-repository";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const suffix = `src008-${process.pid}-${Date.now().toString(36)}`;
const fixtureTenants = new Set<string>();
const secretSentinel = `src008-secret-${suffix}`;
const rawIdentitySentinel = `src008-provider-id-${suffix}`;
const fixtureTime = "2026-07-17T00:00:00.000Z";
const normalizationDigestKeyGeneration = "src008-normalization-v1";
const normalizationDigestKey = new TextEncoder().encode(
  "src008-normalization-integration-key-material-000000000000000000"
);
const normalizationAdapterContract = {
  contractId: "module:synthetic:source-adapter-src008",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "core:direct-messenger",
  loadedByTrustedServiceId: "core:source-runtime",
  loadedAt: fixtureTime
} as const;
const rawIngressSanitizerPin = {
  profileSchemaId: "core:inbox-v2.raw-ingress-sanitizer-profile",
  profileSchemaVersion: "v1",
  handlerId: "module:synthetic:sanitize-src008",
  handlerVersion: "v1",
  declarationRevision: "1",
  restrictedPayloadSchema: {
    schemaId: "module:synthetic:raw-src008",
    schemaVersion: "v1"
  }
} as const;

describePostgres(
  "SQL Inbox V2 source-processing runtime PostgreSQL invariants",
  () => {
    let database: HuleeDatabase;

    beforeAll(async () => {
      if (!process.env.DATABASE_URL) {
        throw new Error(
          "DATABASE_URL is required for the SRC-008 repository integration test."
        );
      }
      database = createHuleeDatabase({
        connectionString: process.env.DATABASE_URL,
        poolConfig: { max: 12 }
      });
      await assertMigrationReady(database);
    }, 30_000);

    afterAll(async () => {
      if (database) {
        await cleanupFixtures(database).catch(() => {});
        await closeHuleeDatabase(database);
      }
    }, 30_000);

    it("keeps an N-1 raw write durable without authority and bridges it once authority becomes current", async () => {
      const ids = await seedScope(database, "late-authority");
      const recorded = await recordRaw(database, ids, "late-authority");

      expect(await loadRuntimeAggregate(database, ids.tenantId)).toMatchObject({
        raw_ingest_count: "0",
        normalization_count: "0",
        pressure_count: "0"
      });

      await seedCurrentConnectionAuthority(database, ids);
      const claimed = await runtimeRepository(database, "late-authority").claim(
        {
          tenantId: ids.tenantId,
          workerId: inboxV2NamespacedIdSchema.parse(
            "core:src008-late-authority-worker"
          ),
          leaseDurationSeconds: 30,
          policy: policy({ maxClaimBatch: 1 })
        }
      );

      expect(claimed.outcome).toBe("claimed");
      if (claimed.outcome !== "claimed") throw new Error("fixture invariant");
      expect(claimed.claims).toHaveLength(1);
      expect(claimed.claims[0]).toMatchObject({
        attempt: {
          scope: {
            tenantId: ids.tenantId,
            rawEventId: recorded.rawEventId,
            stage: "normalization"
          }
        },
        rawIngressClaim: {
          work: { rawEventId: recorded.rawEventId, state: "leased" }
        }
      });
      expect(await loadRuntimeAggregate(database, ids.tenantId)).toMatchObject({
        raw_ingest_count: "1",
        normalization_count: "1",
        pressure_count: "1",
        queued: "0",
        in_flight: "1"
      });
    });

    it("recovers a coordinator crash gap and fans out distinct normalization envelopes exactly once", async () => {
      const label = "successor-fanout";
      const ids = await seedScope(database, label, { withAuthority: true });
      const recorded = await recordRaw(database, ids, label);
      const repository = runtimeRepository(database, label);
      const initial = await repository.claim({
        tenantId: ids.tenantId,
        workerId: inboxV2NamespacedIdSchema.parse(
          "core:src008-successor-normalization-worker"
        ),
        leaseDurationSeconds: 30,
        policy: policy({ maxClaimBatch: 1 })
      });
      expect(initial.outcome).toBe("claimed");
      if (initial.outcome !== "claimed") throw new Error("fixture invariant");
      const normalizationClaim = initial.claims[0];
      const rawLease = normalizationClaim?.rawIngressClaim?.work.lease;
      if (normalizationClaim === undefined || rawLease == null) {
        throw new Error("Expected a bridged normalization/raw lease pair.");
      }

      const candidate = await normalizedFanoutCandidate(
        ids,
        recorded.rawEventId,
        label,
        2
      );
      await expect(
        normalizationRepository(database, label).complete({
          candidate,
          workerId: normalizationClaim.attempt.workerId,
          leaseToken: normalizationClaim.rawIngressClaim!.leaseToken,
          expectedLeaseRevision: rawLease.leaseRevision
        })
      ).resolves.toMatchObject({
        outcome: "completed",
        completion: {
          outcome: "normalized",
          normalizedEventIds: candidate.events.map((_, ordinal) =>
            normalizedEventId(label, ordinal)
          )
        }
      });

      expect(
        await countProcessingStage(
          database,
          ids.tenantId,
          "identity_resolution"
        )
      ).toBe(0);
      await delay(20);
      await expect(
        repository.applyOutcome({
          leaseToken: normalizationClaim.leaseToken,
          outcome: processedOutcome(
            normalizationClaim,
            await databaseNow(database)
          ),
          deadLetterRecord: null
        })
      ).resolves.toEqual({ outcome: "applied" });

      const timing = await loadNormalizationCoordinatorTiming(
        database,
        ids.tenantId,
        recorded.rawEventId
      );
      expect(Date.parse(timing.work_completed_at)).toBeGreaterThan(
        Date.parse(timing.result_completed_at)
      );

      const successor = await repository.claim({
        tenantId: ids.tenantId,
        workerId: inboxV2NamespacedIdSchema.parse(
          "core:src008-successor-identity-worker"
        ),
        leaseDurationSeconds: 30,
        policy: policy({
          maxClaimBatch: 2,
          maxInFlightPerTenant: 2,
          maxInFlightPerConnection: 2,
          maxInFlightPerAccount: 2,
          maxQueuedPerTenant: 2,
          maxQueuedPerConnection: 2,
          maxQueuedPerAccount: 2
        })
      });
      expect(successor.outcome).toBe("claimed");
      if (successor.outcome !== "claimed") throw new Error("fixture invariant");
      expect(successor.claims).toHaveLength(2);
      expect(
        successor.claims.map((claim) => claim.attempt.scope.stage)
      ).toEqual(["identity_resolution", "identity_resolution"]);
      expect(
        new Set(
          successor.claims.map((claim) => claim.attempt.scope.normalizedEventId)
        )
      ).toEqual(
        new Set(
          candidate.events.map((_, ordinal) =>
            normalizedEventId(label, ordinal)
          )
        )
      );

      await repository.claim({
        tenantId: ids.tenantId,
        workerId: inboxV2NamespacedIdSchema.parse(
          "core:src008-successor-repeat-worker"
        ),
        leaseDurationSeconds: 30,
        policy: policy({ maxClaimBatch: 2 })
      });
      expect(
        await countProcessingStage(
          database,
          ids.tenantId,
          "identity_resolution"
        )
      ).toBe(2);
      await expectDeterministicStageWorkIds(
        database,
        ids.tenantId,
        "identity_resolution"
      );
    });

    it("keeps another account progressing while a materialization retry is isolated", async () => {
      const label = "materialization-isolation";
      const primaryLabel = `${label}-primary`;
      const secondaryLabel = `${label}-secondary`;
      const ids = await seedScope(database, label, {
        withAuthority: true,
        includeSecondAccount: true
      });
      await recordRaw(database, ids, primaryLabel);
      await recordRaw(
        database,
        accountScope(ids, ids.secondAccountId),
        secondaryLabel
      );
      const repository = runtimeRepository(database, label);
      const bounded = policy({
        maxClaimBatch: 2,
        maxInFlightPerTenant: 2,
        maxInFlightPerConnection: 2,
        maxInFlightPerAccount: 1,
        maxQueuedPerTenant: 2,
        maxQueuedPerConnection: 2,
        maxQueuedPerAccount: 1
      });
      const normalizationClaims = await claimStageBatch(
        repository,
        ids.tenantId,
        "materialization-normalization",
        "normalization",
        bounded,
        2
      );
      for (const claim of normalizationClaims) {
        const accountId = claim.attempt.scope.sourceAccountId;
        const eventLabel =
          accountId === ids.accountId ? primaryLabel : secondaryLabel;
        const rawLease = claim.rawIngressClaim?.work.lease;
        if (accountId === null || rawLease == null) {
          throw new Error("Expected an account-scoped normalization lease.");
        }
        const candidate = await normalizedFanoutCandidate(
          { ...ids, accountId },
          claim.attempt.scope.rawEventId,
          eventLabel,
          1
        );
        await expect(
          normalizationRepository(database, eventLabel).complete({
            candidate,
            workerId: claim.attempt.workerId,
            leaseToken: claim.rawIngressClaim!.leaseToken,
            expectedLeaseRevision: rawLease.leaseRevision
          })
        ).resolves.toMatchObject({
          outcome: "completed",
          completion: { outcome: "normalized" }
        });
      }
      await delay(20);
      await applyProcessedClaims(database, repository, normalizationClaims);

      for (const stage of [
        "identity_resolution",
        "conversation_resolution",
        "routing",
        "message_reconciliation"
      ] as const) {
        const claims = await claimStageBatch(
          repository,
          ids.tenantId,
          `materialization-${stage}`,
          stage,
          bounded,
          2
        );
        await applyProcessedClaims(database, repository, claims);
      }

      const firstMaterialization = await claimStageBatch(
        repository,
        ids.tenantId,
        "materialization-first",
        "materialization",
        { ...bounded, maxClaimBatch: 1 },
        1
      );
      const failedClaim = firstMaterialization[0]!;
      const failedAccountId = failedClaim.attempt.scope.sourceAccountId;
      const failedAt = await databaseNow(database);
      await expect(
        repository.applyOutcome({
          leaseToken: failedClaim.leaseToken,
          outcome: retryableFailureOutcome(
            failedClaim,
            failedAt,
            timestamp(Date.parse(failedAt) + 60_000)
          ),
          deadLetterRecord: null
        })
      ).resolves.toEqual({ outcome: "applied" });

      const otherMaterialization = await claimStageBatch(
        repository,
        ids.tenantId,
        "materialization-other-account",
        "materialization",
        { ...bounded, maxClaimBatch: 1 },
        1
      );
      expect(otherMaterialization[0]!.attempt.scope.sourceAccountId).not.toBe(
        failedAccountId
      );
      expect(
        await countProcessingStage(database, ids.tenantId, "materialization")
      ).toBe(2);
      const pressure = await loadPressureHeads(database, ids.tenantId);
      expect(
        pressure.find((head) => head.source_account_id === failedAccountId)
      ).toMatchObject({ state: "paused", queued: 1, in_flight: 0 });
      expect(
        pressure.find(
          (head) =>
            head.source_account_id ===
            otherMaterialization[0]!.attempt.scope.sourceAccountId
        )
      ).toMatchObject({ state: "open", queued: 0, in_flight: 1 });
      await expectDeterministicStageWorkIds(
        database,
        ids.tenantId,
        "materialization"
      );
    });

    it("creates the additive raw bridge and fairly represents a cold account beside a hot account", async () => {
      const ids = await seedScope(database, "fair", {
        withAuthority: true,
        includeSecondAccount: true
      });
      const hotOne = await recordRaw(database, ids, "fair-hot-1");
      const hotTwo = await recordRaw(database, ids, "fair-hot-2");
      const cold = await recordRaw(
        database,
        accountScope(ids, ids.secondAccountId),
        "fair-cold"
      );

      expect(await loadRuntimeAggregate(database, ids.tenantId)).toMatchObject({
        raw_ingest_count: "3",
        normalization_count: "0",
        pressure_count: "0",
        queued: "0",
        in_flight: "0"
      });

      const claimed = await runtimeRepository(database, "fair").claim({
        tenantId: ids.tenantId,
        workerId: inboxV2NamespacedIdSchema.parse("core:src008-fair-worker"),
        leaseDurationSeconds: 30,
        policy: policy({
          maxClaimBatch: 2,
          maxInFlightPerTenant: 2,
          maxInFlightPerConnection: 2,
          maxInFlightPerAccount: 1
        })
      });

      expect(claimed.outcome).toBe("claimed");
      if (claimed.outcome !== "claimed") throw new Error("fixture invariant");
      expect(claimed.claims).toHaveLength(2);
      const claimedRawIds = new Set(
        claimed.claims.map((claim) => String(claim.attempt.scope.rawEventId))
      );
      expect(claimedRawIds.has(String(cold.rawEventId))).toBe(true);
      expect(
        [hotOne.rawEventId, hotTwo.rawEventId].filter((rawEventId) =>
          claimedRawIds.has(String(rawEventId))
        )
      ).toHaveLength(1);
      expect(
        new Set(
          claimed.claims.map((claim) => claim.attempt.scope.sourceAccountId)
        ).size
      ).toBe(2);
      for (const claim of claimed.claims) {
        expect(claim.rawIngressClaim?.leaseToken).toBe(claim.leaseToken);
      }
    });

    it("keeps overflow raw work durable and admits the cold account at queue capacity one", async () => {
      const ids = await seedScope(database, "queue-cap", {
        withAuthority: true,
        includeSecondAccount: true
      });
      const hotOne = await recordRaw(database, ids, "queue-cap-hot-1");
      const cold = await recordRaw(
        database,
        accountScope(ids, ids.secondAccountId),
        "queue-cap-cold"
      );
      const hotTwo = await recordRaw(database, ids, "queue-cap-hot-2");
      const bounded = policy({
        maxClaimBatch: 1,
        maxInFlightPerTenant: 1,
        maxInFlightPerConnection: 1,
        maxInFlightPerAccount: 1,
        maxQueuedPerTenant: 1,
        maxQueuedPerConnection: 1,
        maxQueuedPerAccount: 1
      });
      const firstRepository = runtimeRepository(database, "queue-cap-first");
      const secondRepository = runtimeRepository(database, "queue-cap-second");

      const first = await firstRepository.claim({
        tenantId: ids.tenantId,
        workerId: inboxV2NamespacedIdSchema.parse(
          "core:src008-queue-cap-first"
        ),
        leaseDurationSeconds: 30,
        policy: bounded
      });
      expect(first.outcome).toBe("claimed");
      if (first.outcome !== "claimed") throw new Error("fixture invariant");
      expect(first.claims[0]?.attempt.scope.rawEventId).toBe(hotOne.rawEventId);

      await expect(
        secondRepository.claim({
          tenantId: ids.tenantId,
          workerId: inboxV2NamespacedIdSchema.parse(
            "core:src008-queue-cap-second"
          ),
          leaseDurationSeconds: 30,
          policy: bounded
        })
      ).resolves.toMatchObject({
        outcome: "backpressured",
        scope: "source_account"
      });
      expect(await loadRuntimeAggregate(database, ids.tenantId)).toMatchObject({
        raw_ingest_count: "3",
        normalization_count: "2",
        pressure_count: "2",
        queued: "1",
        in_flight: "1"
      });
      expect(await countRawWithoutNormalization(database, ids.tenantId)).toBe(
        1
      );

      await expect(
        firstRepository.applyOutcome({
          leaseToken: first.claims[0]!.leaseToken,
          outcome: processedOutcome(
            first.claims[0]!,
            await databaseNow(database)
          ),
          deadLetterRecord: null
        })
      ).resolves.toEqual({ outcome: "applied" });
      const coldClaim = await secondRepository.claim({
        tenantId: ids.tenantId,
        workerId: inboxV2NamespacedIdSchema.parse("core:src008-queue-cap-cold"),
        leaseDurationSeconds: 30,
        policy: bounded
      });
      expect(coldClaim.outcome).toBe("claimed");
      if (coldClaim.outcome !== "claimed") throw new Error("fixture invariant");
      expect(coldClaim.claims[0]?.attempt.scope.rawEventId).toBe(
        cold.rawEventId
      );
      expect(coldClaim.claims[0]?.attempt.scope.rawEventId).not.toBe(
        hotTwo.rawEventId
      );
    });

    it("keeps shared tenant, connection and account caps bounded across concurrent replicas", async () => {
      const ids = await seedScope(database, "replicas", {
        withAuthority: true,
        includeSecondAccount: true
      });
      for (let index = 0; index < 3; index += 1) {
        await recordRaw(database, ids, `replicas-hot-${index}`);
        await recordRaw(
          database,
          accountScope(ids, ids.secondAccountId),
          `replicas-cold-${index}`
        );
      }
      const boundedPolicy = policy({
        maxClaimBatch: 3,
        maxInFlightPerTenant: 3,
        maxInFlightPerConnection: 2,
        maxInFlightPerAccount: 1
      });
      const replicas = ["a", "b", "c"].map((label) =>
        runtimeRepository(database, `replica-${label}`)
      );

      const results = await Promise.all(
        replicas.map((repository, index) =>
          repository.claim({
            tenantId: ids.tenantId,
            workerId: inboxV2NamespacedIdSchema.parse(
              `core:src008-replica-${index}`
            ),
            leaseDurationSeconds: 30,
            policy: boundedPolicy
          })
        )
      );
      const claims = results.flatMap((result) =>
        result.outcome === "claimed" ? result.claims : []
      );

      expect(claims).toHaveLength(2);
      expect(
        new Set(claims.map((claim) => claim.attempt.scope.sourceAccountId)).size
      ).toBe(2);
      expect(await loadPressureTotals(database, ids.tenantId)).toEqual({
        in_flight: "2",
        maximum_account_in_flight: "1"
      });
    });

    it("fences every sibling for connection rate limits but isolates account rate limits", async () => {
      const connectionIds = await seedScope(database, "rate-connection", {
        withAuthority: true,
        includeSecondAccount: true
      });
      await recordRaw(database, connectionIds, "rate-connection-primary");
      await recordRaw(
        database,
        accountScope(connectionIds, connectionIds.secondAccountId),
        "rate-connection-sibling"
      );
      const connectionRepository = runtimeRepository(
        database,
        "rate-connection"
      );
      const connectionClaims = await connectionRepository.claim({
        tenantId: connectionIds.tenantId,
        workerId: inboxV2NamespacedIdSchema.parse(
          "core:src008-rate-connection"
        ),
        leaseDurationSeconds: 30,
        policy: policy({
          maxClaimBatch: 2,
          maxInFlightPerTenant: 2,
          maxInFlightPerConnection: 2,
          maxInFlightPerAccount: 1
        })
      });
      expect(connectionClaims.outcome).toBe("claimed");
      if (connectionClaims.outcome !== "claimed") {
        throw new Error("fixture invariant");
      }
      const primary = connectionClaims.claims.find(
        (claim) =>
          claim.attempt.scope.sourceAccountId === connectionIds.accountId
      )!;
      const sibling = connectionClaims.claims.find(
        (claim) =>
          claim.attempt.scope.sourceAccountId === connectionIds.secondAccountId
      )!;
      const completedAt = await databaseNow(database);
      const retryAt = timestamp(Date.parse(completedAt) + 20_000);
      await expect(
        connectionRepository.applyOutcome({
          leaseToken: primary.leaseToken,
          outcome: rateLimitedOutcome(
            primary,
            completedAt,
            retryAt,
            "source_connection"
          ),
          deadLetterRecord: null
        })
      ).resolves.toEqual({ outcome: "applied" });
      const fencedHeads = await loadPressureHeads(
        database,
        connectionIds.tenantId
      );
      expect(fencedHeads).toHaveLength(3);
      expect(fencedHeads.every((head) => head.state === "rate_limited")).toBe(
        true
      );
      await recordRaw(
        database,
        accountScope(connectionIds, connectionIds.secondAccountId),
        "rate-connection-fenced-new-raw"
      );
      await expect(
        connectionRepository.claim({
          tenantId: connectionIds.tenantId,
          workerId: inboxV2NamespacedIdSchema.parse(
            "core:src008-rate-connection-observer"
          ),
          leaseDurationSeconds: 30,
          policy: policy({
            maxClaimBatch: 2,
            maxInFlightPerTenant: 2,
            maxInFlightPerConnection: 2,
            maxInFlightPerAccount: 1
          })
        })
      ).resolves.toMatchObject({
        outcome: "backpressured",
        scope: "source_connection",
        retryAt
      });
      expect(
        await countRawWithoutNormalization(database, connectionIds.tenantId)
      ).toBe(1);
      await expect(
        connectionRepository.applyOutcome({
          leaseToken: sibling.leaseToken,
          outcome: processedOutcome(sibling, await databaseNow(database)),
          deadLetterRecord: null
        })
      ).resolves.toEqual({ outcome: "applied" });
      expect(
        (await loadPressureHeads(database, connectionIds.tenantId)).every(
          (head) => head.state === "rate_limited"
        )
      ).toBe(true);

      const accountIds = await seedScope(database, "rate-account", {
        withAuthority: true,
        includeSecondAccount: true
      });
      await recordRaw(database, accountIds, "rate-account-primary");
      await recordRaw(
        database,
        accountScope(accountIds, accountIds.secondAccountId),
        "rate-account-sibling"
      );
      const accountRepository = runtimeRepository(database, "rate-account");
      const accountClaims = await accountRepository.claim({
        tenantId: accountIds.tenantId,
        workerId: inboxV2NamespacedIdSchema.parse("core:src008-rate-account"),
        leaseDurationSeconds: 30,
        policy: policy({
          maxClaimBatch: 2,
          maxInFlightPerTenant: 2,
          maxInFlightPerConnection: 2,
          maxInFlightPerAccount: 1
        })
      });
      expect(accountClaims.outcome).toBe("claimed");
      if (accountClaims.outcome !== "claimed") {
        throw new Error("fixture invariant");
      }
      const accountPrimary = accountClaims.claims.find(
        (claim) => claim.attempt.scope.sourceAccountId === accountIds.accountId
      )!;
      const accountSibling = accountClaims.claims.find(
        (claim) =>
          claim.attempt.scope.sourceAccountId === accountIds.secondAccountId
      )!;
      const accountCompletedAt = await databaseNow(database);
      const accountRetryAt = timestamp(Date.parse(accountCompletedAt) + 20_000);
      await expect(
        accountRepository.applyOutcome({
          leaseToken: accountPrimary.leaseToken,
          outcome: rateLimitedOutcome(
            accountPrimary,
            accountCompletedAt,
            accountRetryAt,
            "source_account"
          ),
          deadLetterRecord: null
        })
      ).resolves.toEqual({ outcome: "applied" });
      const accountHeads = await loadPressureHeads(
        database,
        accountIds.tenantId
      );
      expect(
        accountHeads.find(
          (head) => head.source_account_id === accountIds.accountId
        )?.state
      ).toBe("rate_limited");
      expect(
        accountHeads.find(
          (head) => head.source_account_id === accountIds.secondAccountId
        )?.state
      ).toBe("open");
      await expect(
        accountRepository.applyOutcome({
          leaseToken: accountSibling.leaseToken,
          outcome: processedOutcome(
            accountSibling,
            await databaseNow(database)
          ),
          deadLetterRecord: null
        })
      ).resolves.toEqual({ outcome: "applied" });
      const isolatedRaw = await recordRaw(
        database,
        accountScope(accountIds, accountIds.secondAccountId),
        "rate-account-isolated-sibling"
      );
      const isolatedClaim = await accountRepository.claim({
        tenantId: accountIds.tenantId,
        workerId: inboxV2NamespacedIdSchema.parse(
          "core:src008-rate-account-isolated"
        ),
        leaseDurationSeconds: 30,
        policy: policy({
          maxClaimBatch: 1,
          maxInFlightPerTenant: 2,
          maxInFlightPerConnection: 2,
          maxInFlightPerAccount: 1
        })
      });
      expect(isolatedClaim.outcome).toBe("claimed");
      if (isolatedClaim.outcome !== "claimed") {
        throw new Error("fixture invariant");
      }
      expect(isolatedClaim.claims[0]?.attempt.scope.rawEventId).toBe(
        isolatedRaw.rawEventId
      );
    });

    it("rejects stale capabilities, then reclaims an expired lease without burning an attempt", async () => {
      const ids = await seedScope(database, "lease", { withAuthority: true });
      await recordRaw(database, ids, "lease");
      const repository = runtimeRepository(database, "lease");
      const claim = await claimOne(repository, ids.tenantId, "lease", 1);
      const outcome = processedOutcome(claim, claim.attempt.startedAt);

      await expect(
        repository.applyOutcome({
          leaseToken: `stale-capability-${"x".repeat(48)}`,
          outcome,
          deadLetterRecord: null
        })
      ).resolves.toEqual({ outcome: "stale_token" });
      await delay(1_100);
      await expect(
        repository.applyOutcome({
          leaseToken: claim.leaseToken,
          outcome,
          deadLetterRecord: null
        })
      ).resolves.toEqual({ outcome: "lease_expired" });
      expect(await countAttempts(database, ids.tenantId)).toBe(0);

      const reclaimed = await claimOne(
        repository,
        ids.tenantId,
        "lease-reclaim"
      );
      expect(reclaimed.attempt.attemptNumber).toBe(claim.attempt.attemptNumber);
      expect(reclaimed.attempt.attemptId).not.toBe(claim.attempt.attemptId);
      expect(reclaimed.rawIngressClaim?.claimKind).toBe("reclaimed");
      await expect(
        repository.applyOutcome({
          leaseToken: reclaimed.leaseToken,
          outcome: processedOutcome(reclaimed, await databaseNow(database)),
          deadLetterRecord: null
        })
      ).resolves.toEqual({ outcome: "applied" });
      expect(await countAttempts(database, ids.tenantId)).toBe(1);
    });

    it("atomically records a finite DLQ fact, immutable attempt, terminal head and pressure release", async () => {
      const ids = await seedScope(database, "dlq", { withAuthority: true });
      await recordRaw(database, ids, "dlq");
      const repository = runtimeRepository(database, "dlq");
      const claim = await claimOne(repository, ids.tenantId, "dlq");
      const completedAt = await databaseNow(database);
      const input = deadLetterInput(claim, completedAt, "dlq");

      await expect(repository.applyOutcome(input)).resolves.toEqual({
        outcome: "applied"
      });
      await expect(repository.applyOutcome(input)).resolves.toEqual({
        outcome: "already_applied"
      });

      const aggregate = await loadDeadLetterAggregate(
        database,
        ids.tenantId,
        input.deadLetterRecord!.deadLetterId
      );
      expect(aggregate).toMatchObject({
        work_state: "dead_lettered",
        attempt_outcome: "dead_lettered",
        dead_letter_reason: "terminal_failure",
        diagnostic_code_id: "core:source-processing.terminal",
        diagnostic_retryability: "not_retryable",
        diagnostic_correlation_token: `correlation:${suffix}-dlq`,
        in_flight: "0",
        queued: "0"
      });
      expect(iso(aggregate.raw_payload_expires_at)).toBe(
        input.deadLetterRecord!.evidenceDeadlines.rawPayloadExpiresAt
      );
      expect(iso(aggregate.allowed_raw_headers_expires_at)).toBe(
        input.deadLetterRecord!.evidenceDeadlines.allowedRawHeadersExpiresAt
      );
      expect(iso(aggregate.replay_not_after)).toBe(
        input.deadLetterRecord!.replayNotAfter
      );
      expect(iso(aggregate.expires_at)).toBe(input.deadLetterRecord!.expiresAt);
      expect(JSON.stringify(aggregate)).not.toContain(secretSentinel);
      expect(JSON.stringify(aggregate)).not.toContain(rawIdentitySentinel);
    });

    it("makes replay exact, revision-fenced, state-safe, durable and idempotent", async () => {
      const ids = await seedScope(database, "replay", {
        withAuthority: true,
        includeSecondAccount: true
      });
      const repository = runtimeRepository(database, "replay");
      await seedTenantSecret(
        database,
        ids.tenantId,
        hmacKeySecretRefFor(
          ids.tenantId,
          INBOX_V2_SOURCE_REPLAY_PURPOSE_ID,
          "replay-v1"
        )
      );
      await databaseNow(database);
      await rotateReplayKey(repository, ids.tenantId, "replay-v1");

      const targetA = await createDeadLetterTarget(
        database,
        repository,
        ids,
        "replay-a",
        "replay-v1"
      );
      const targetB = await createDeadLetterTarget(
        database,
        repository,
        accountScope(ids, ids.secondAccountId),
        "replay-b",
        "replay-v1"
      );
      const before = await loadWorkPair(database, ids.tenantId, [
        targetA.claim.attempt.workId,
        targetB.claim.attempt.workId
      ]);

      const crossWork = replayRequest(targetA.scope, targetA.workRevision, {
        label: "cross-work",
        deadLetterId: targetB.deadLetterId
      });
      const crossWorkResult = await repository.requestReplay(crossWork);
      expect(crossWorkResult).toMatchObject({
        outcome: "rejected",
        reason: "replay_expired"
      });
      expect(
        await loadWorkPair(database, ids.tenantId, [
          targetA.claim.attempt.workId,
          targetB.claim.attempt.workId
        ])
      ).toEqual(before);
      await expectDurableReplayDecision(
        database,
        ids.tenantId,
        crossWork.requestId,
        "expired",
        "replay_expired"
      );

      const staleRevision = replayRequest(
        targetA.scope,
        decrementRevision(targetA.workRevision),
        { label: "stale-revision", deadLetterId: targetA.deadLetterId }
      );
      await expect(
        repository.requestReplay(staleRevision)
      ).resolves.toMatchObject({
        outcome: "rejected",
        reason: "revision_conflict"
      });
      await expectDurableReplayDecision(
        database,
        ids.tenantId,
        staleRevision.requestId,
        "denied",
        "revision_conflict"
      );

      const exact = replayRequest(targetA.scope, targetA.workRevision, {
        label: "exact",
        deadLetterId: targetA.deadLetterId
      });
      const queued = await repository.requestReplay(exact);
      expect(queued).toMatchObject({
        outcome: "queued",
        workId: targetA.claim.attempt.workId,
        workRevision: incrementRevision(targetA.workRevision)
      });
      await expect(repository.requestReplay(exact)).resolves.toMatchObject({
        outcome: "idempotent_replay",
        workId: targetA.claim.attempt.workId,
        workRevision: incrementRevision(targetA.workRevision)
      });
      expect(
        await loadRuntimeWork(
          database,
          ids.tenantId,
          targetB.claim.attempt.workId
        )
      ).toEqual(before[targetB.claim.attempt.workId]);
    });

    it("retains replay snapshots finitely and deletes replay, DLQ, attempts and terminal work in order", async () => {
      const ids = await seedScope(database, "retention", {
        withAuthority: true
      });
      const repository = runtimeRepository(database, "retention");
      const keyGeneration = await ensureReplayKey(
        database,
        repository,
        ids.tenantId
      );
      const target = await createDeadLetterTarget(
        database,
        repository,
        ids,
        "retention",
        keyGeneration
      );
      const request = replayRequest(target.scope, target.workRevision, {
        label: "retention",
        deadLetterId: target.deadLetterId
      });

      await expect(repository.requestReplay(request)).resolves.toMatchObject({
        outcome: "queued",
        workId: target.claim.attempt.workId
      });
      const retained = await loadReplayRetention(
        database,
        ids.tenantId,
        request.requestId,
        target.deadLetterId
      );
      expect(iso(retained.replay_expires_at)).toBe(
        iso(retained.dlq_expires_at)
      );

      await expectDatabaseRejection(
        deleteReplayAsRetention(database, ids.tenantId, request.requestId),
        /not retention eligible/u
      );
      await forceRetentionDeadlines(database, {
        tenantId: ids.tenantId,
        workId: target.claim.attempt.workId,
        replayRequestId: request.requestId,
        includeHistory: false
      });
      await expectDatabaseRejection(
        deleteReplayAsRetention(database, ids.tenantId, request.requestId),
        /not retention eligible/u
      );

      expect(
        await loadRuntimeWork(
          database,
          ids.tenantId,
          target.claim.attempt.workId
        )
      ).toMatchObject({ state: "pending", processing_generation: "2" });
      expect(await loadRuntimeAggregate(database, ids.tenantId)).toMatchObject({
        queued: "1",
        in_flight: "0"
      });
      await forceRawLeaseDue(
        database,
        ids.tenantId,
        target.claim.attempt.scope.rawEventId
      );

      const replayClaim = await claimOne(
        repository,
        ids.tenantId,
        "retention-replay"
      );
      expect(replayClaim.attempt.workId).toBe(target.claim.attempt.workId);
      await expect(
        repository.applyOutcome({
          leaseToken: replayClaim.leaseToken,
          outcome: processedOutcome(replayClaim, await databaseNow(database)),
          deadLetterRecord: null
        })
      ).resolves.toEqual({ outcome: "applied" });

      await expectDatabaseRejection(
        deleteWorkAsRetention(
          database,
          ids.tenantId,
          target.claim.attempt.workId
        ),
        /runtime dependents/u
      );
      await forceRetentionDeadlines(database, {
        tenantId: ids.tenantId,
        workId: target.claim.attempt.workId,
        replayRequestId: request.requestId,
        includeHistory: true
      });
      await deleteSourceProcessingHistoryAsRetention(database, {
        tenantId: ids.tenantId,
        workId: target.claim.attempt.workId,
        replayRequestId: request.requestId,
        deadLetterId: target.deadLetterId
      });

      await expect(
        loadSourceProcessingRetentionCounts(
          database,
          ids.tenantId,
          target.claim.attempt.workId,
          request.requestId
        )
      ).resolves.toEqual({
        replay_count: "0",
        dlq_count: "0",
        attempt_count: "0",
        work_count: "0"
      });
    });

    it("rechecks target revision after authorization and rejects pending or non-DLQ terminal states durably", async () => {
      const ids = await seedScope(database, "replay-states", {
        withAuthority: true
      });
      const baselineRepository = runtimeRepository(database, "replay-states");
      const targets: Array<{
        label: string;
        expectedState: "pending" | "processed" | "ignored" | "duplicate";
        scope: InboxV2SourceProcessingScope;
        revision: string;
      }> = [];

      for (const state of [
        "processed",
        "ignored",
        "duplicate",
        "pending"
      ] as const) {
        const recorded = await recordRaw(database, ids, `state-${state}`);
        if (state === "pending") {
          await database.execute(
            buildReconcileMissingInboxV2SourceProcessingBridgeSql({
              tenantId: ids.tenantId,
              batchSize: 1,
              policy: policy({ maxClaimBatch: 1 })
            })
          );
          const work = await loadRuntimeWorkByRaw(
            database,
            ids.tenantId,
            recorded.rawEventId,
            "normalization"
          );
          targets.push({
            label: state,
            expectedState: state,
            scope: scopeFromWork(work),
            revision: String(work.revision)
          });
          continue;
        }
        const claim = await claimOne(
          baselineRepository,
          ids.tenantId,
          `state-${state}`
        );
        const completedAt = await databaseNow(database);
        await baselineRepository.applyOutcome({
          leaseToken: claim.leaseToken,
          outcome:
            state === "processed"
              ? processedOutcome(claim, completedAt)
              : diagnosticTerminalOutcome(claim, completedAt, state),
          deadLetterRecord: null
        });
        const work = await loadRuntimeWork(
          database,
          ids.tenantId,
          claim.attempt.workId
        );
        targets.push({
          label: state,
          expectedState: state,
          scope: claim.attempt.scope,
          revision: String(work.revision)
        });
      }

      for (const target of targets) {
        expect(
          (await loadRuntimeWorkByScope(database, target.scope)).state
        ).toBe(target.expectedState);
        const request = rawReplayRequest(
          target.scope,
          target.revision,
          target.label
        );
        await expect(
          baselineRepository.requestReplay(request)
        ).resolves.toMatchObject({
          outcome: "rejected",
          reason: "target_not_replayable"
        });
        await expectDurableReplayDecision(
          database,
          ids.tenantId,
          request.requestId,
          "denied",
          "target_not_replayable"
        );
      }

      const raceTarget = await createDeadLetterTarget(
        database,
        baselineRepository,
        ids,
        "revision-race",
        await ensureReplayKey(database, baselineRepository, ids.tenantId)
      );
      let authorizationCalls = 0;
      const racingRepository = runtimeRepository(database, "revision-race", {
        replayAuthorization: {
          async authorizeReplay() {
            authorizationCalls += 1;
            await bumpWorkRevisionUnsafe(
              database,
              ids.tenantId,
              raceTarget.claim.attempt.workId
            );
            return { outcome: "authorized" as const };
          }
        }
      });
      const raceRequest = replayRequest(
        raceTarget.scope,
        raceTarget.workRevision,
        { label: "revision-race", deadLetterId: raceTarget.deadLetterId }
      );
      await expect(
        racingRepository.requestReplay(raceRequest)
      ).resolves.toMatchObject({
        outcome: "rejected",
        reason: "revision_conflict"
      });
      expect(authorizationCalls).toBe(1);
      expect(
        (
          await loadRuntimeWork(
            database,
            ids.tenantId,
            raceTarget.claim.attempt.workId
          )
        ).state
      ).toBe("dead_lettered");
    });

    it("persists evidence-missing and replay-expired decisions and never revives their targets", async () => {
      const ids = await seedScope(database, "replay-expiry", {
        withAuthority: true
      });
      const repository = runtimeRepository(database, "replay-expiry");
      await seedTenantSecret(
        database,
        ids.tenantId,
        hmacKeySecretRefFor(
          ids.tenantId,
          INBOX_V2_SOURCE_REPLAY_PURPOSE_ID,
          "expiry-v1"
        )
      );
      await databaseNow(database);
      await rotateReplayKey(repository, ids.tenantId, "expiry-v1");
      const missing = await createDeadLetterTarget(
        database,
        repository,
        ids,
        "missing-evidence",
        "expiry-v1"
      );
      await removeRawPayloadEvidenceUnsafe(
        database,
        ids.tenantId,
        missing.scope.rawEventId
      );
      const missingRequest = replayRequest(
        missing.scope,
        missing.workRevision,
        {
          label: "missing-evidence",
          deadLetterId: missing.deadLetterId
        }
      );
      await expect(
        repository.requestReplay(missingRequest)
      ).resolves.toMatchObject({
        outcome: "rejected",
        reason: "evidence_unavailable"
      });
      await expect(
        repository.requestReplay(missingRequest)
      ).resolves.toMatchObject({
        outcome: "rejected",
        reason: "evidence_unavailable"
      });
      await expectDurableReplayDecision(
        database,
        ids.tenantId,
        missingRequest.requestId,
        "denied",
        "evidence_unavailable"
      );

      const expiring = await createDeadLetterTarget(
        database,
        repository,
        ids,
        "expired-window",
        "expiry-v1",
        {
          replayWindowMilliseconds: 1_500,
          skeletonWindowMilliseconds: 1_500
        }
      );
      await delay(1_700);
      await expect(
        repository.expireDedupeReplayability(
          inboxV2SourceDedupeReplayabilityExpireInputSchema.parse({
            tenantId: ids.tenantId,
            skeletonId: expiring.skeletonId,
            expectedRevision: "1",
            reason: "guarantee_expired"
          })
        )
      ).resolves.toEqual({ outcome: "expired", revision: "2" });
      const expiredRequest = replayRequest(
        expiring.scope,
        expiring.workRevision,
        {
          label: "expired-window",
          deadLetterId: expiring.deadLetterId
        }
      );
      await expect(
        repository.requestReplay(expiredRequest)
      ).resolves.toMatchObject({
        outcome: "rejected",
        reason: "replay_expired"
      });
      await expectDurableReplayDecision(
        database,
        ids.tenantId,
        expiredRequest.requestId,
        "expired",
        "replay_expired"
      );
      expect(
        (
          await loadRuntimeWork(
            database,
            ids.tenantId,
            expiring.claim.attempt.workId
          )
        ).state
      ).toBe("dead_lettered");
    });

    it("acknowledges only the exact durable raw head and persists no clear provider cursor", async () => {
      const ids = await seedScope(database, "cursor", { withAuthority: true });
      const recorded = await recordRaw(database, ids, "cursor");
      const repository = runtimeRepository(database, "cursor");
      const cursorKey = "cursor-v1";
      const clearCursor = `provider-cursor-${secretSentinel}`;
      const cursorHmacKeySecretRef = hmacKeySecretRefFor(
        ids.tenantId,
        INBOX_V2_SOURCE_CURSOR_PURPOSE_ID,
        cursorKey
      );
      const cursorValueSecretRef = cursorValueSecretRefFor(
        ids.tenantId,
        clearCursor
      );
      await seedTenantSecret(database, ids.tenantId, cursorHmacKeySecretRef);
      await seedTenantSecret(
        database,
        ids.tenantId,
        cursorValueSecretRef,
        "inbox_v2.source_cursor_value"
      );
      await expect(
        rotateProcessingKey(
          repository,
          ids.tenantId,
          INBOX_V2_SOURCE_CURSOR_PURPOSE_ID,
          cursorKey,
          { secretRef: cursorHmacKeySecretRef }
        )
      ).resolves.toMatchObject({ outcome: "rotated", generation: cursorKey });
      const rawWork = await loadRuntimeWorkByRaw(
        database,
        ids.tenantId,
        recorded.rawEventId,
        "raw_ingest"
      );
      const acknowledgedAt = await databaseNow(database);
      const input = inboxV2SourceCursorPersistenceInputSchema.parse({
        acknowledgement: {
          target: {
            kind: "raw_work" as const,
            scope: scopeFromWork(rawWork),
            durableWorkId: String(rawWork.work_id),
            durableWorkRevision: String(rawWork.revision),
            durableWorkState: "processed" as const,
            persistedAt: iso(rawWork.updated_at)
          },
          cursorOwner: "source_account" as const,
          sourceThreadBindingId: null,
          cursor: { kind: "receive_cursor" as const, value: clearCursor },
          acknowledgedAt
        },
        cursorSlotId: `cursor-slot:${suffix}`,
        routeGeneration: String(rawWork.route_generation),
        expectedCheckpointRevision: null
      });

      await expect(repository.acknowledgeCursor(input)).resolves.toEqual({
        outcome: "acknowledged",
        revision: "1"
      });
      await expect(repository.acknowledgeCursor(input)).resolves.toEqual({
        outcome: "already_acknowledged",
        revision: "1"
      });
      await expect(
        repository.loadCursor(
          inboxV2SourceCursorLoadInputSchema.parse({
            source: {
              tenantId: ids.tenantId,
              sourceConnectionId: ids.connectionId,
              sourceAccountId: ids.accountId
            },
            cursorOwner: "source_account",
            sourceThreadBindingId: null,
            cursorSlotId: `cursor-slot:${suffix}`
          })
        )
      ).resolves.toMatchObject({
        outcome: "loaded",
        cursor: { kind: "receive_cursor", value: clearCursor },
        checkpointRevision: "1"
      });
      await expect(
        repository.acknowledgeCursor(
          inboxV2SourceCursorPersistenceInputSchema.parse({
            ...input,
            acknowledgement: {
              ...input.acknowledgement,
              target: {
                ...input.acknowledgement.target,
                durableWorkRevision: incrementRevision(String(rawWork.revision))
              }
            }
          })
        )
      ).resolves.toEqual({ outcome: "durable_work_mismatch" });

      const persisted = await database.execute<{ serialized: unknown }>(sql`
        select row_to_json(checkpoint)::text as serialized
          from public.inbox_v2_source_ingress_cursor_checkpoints checkpoint
         where checkpoint.tenant_id = ${ids.tenantId}
      `);
      expect(persisted.rows).toHaveLength(1);
      expect(String(persisted.rows[0]?.serialized)).not.toContain(clearCursor);
      expect(String(persisted.rows[0]?.serialized)).toContain(
        hmac(clearCursor)
      );
    });

    it("advances an ordered cursor past an exact durable sanitizer quarantine", async () => {
      const ids = await seedScope(database, "quarantine-cursor", {
        withAuthority: true
      });
      const quarantined = await recordQuarantine(
        database,
        ids,
        "quarantine-cursor"
      );
      const repository = runtimeRepository(database, "quarantine-cursor");
      const generation = "cursor-v1";
      const clearCursor = `provider-quarantine-cursor-${secretSentinel}`;
      const hmacSecretRef = hmacKeySecretRefFor(
        ids.tenantId,
        INBOX_V2_SOURCE_CURSOR_PURPOSE_ID,
        generation
      );
      const valueSecretRef = cursorValueSecretRefFor(ids.tenantId, clearCursor);
      await seedTenantSecret(database, ids.tenantId, hmacSecretRef);
      await seedTenantSecret(
        database,
        ids.tenantId,
        valueSecretRef,
        "inbox_v2.source_cursor_value"
      );
      await rotateProcessingKey(
        repository,
        ids.tenantId,
        INBOX_V2_SOURCE_CURSOR_PURPOSE_ID,
        generation,
        { secretRef: hmacSecretRef }
      );
      const source = {
        tenantId: ids.tenantId,
        sourceConnectionId: ids.connectionId,
        sourceAccountId: ids.accountId
      };
      const lookup = inboxV2SourceCursorDurableTargetLookupInputSchema.parse({
        source,
        receipt: {
          kind: "quarantine",
          quarantineId: quarantined.quarantineId,
          safeEnvelopeDigest: quarantined.safeEnvelopeDigest,
          reasonCode: quarantined.reasonCode
        }
      });
      const resolved = await repository.resolveCursorDurableTarget(lookup);
      expect(resolved).toMatchObject({
        outcome: "resolved",
        target: {
          kind: "quarantine",
          quarantineId: quarantined.quarantineId,
          reasonCode: quarantined.reasonCode
        }
      });
      if (resolved.outcome !== "resolved") {
        throw new Error("quarantine cursor fixture invariant");
      }
      const input = inboxV2SourceCursorPersistenceInputSchema.parse({
        acknowledgement: {
          target: resolved.target,
          cursorOwner: "source_account",
          sourceThreadBindingId: null,
          cursor: { kind: "receive_cursor", value: clearCursor },
          acknowledgedAt: resolved.resolvedAt
        },
        cursorSlotId: `quarantine-cursor-slot:${suffix}`,
        routeGeneration: "1",
        expectedCheckpointRevision: null
      });

      await expect(repository.acknowledgeCursor(input)).resolves.toEqual({
        outcome: "acknowledged",
        revision: "1"
      });
      await expect(repository.acknowledgeCursor(input)).resolves.toEqual({
        outcome: "already_acknowledged",
        revision: "1"
      });
      await expect(
        repository.resolveCursorDurableTarget({
          ...lookup,
          source: {
            ...lookup.source,
            sourceAccountId: inboxV2SourceAccountIdSchema.parse(
              "source_account:cross-account"
            )
          }
        })
      ).resolves.toEqual({ outcome: "mismatch" });

      const checkpoint = await database.execute<Record<string, unknown>>(sql`
        select durable_target_kind::text as target_kind,
               durable_work_id, last_durable_raw_event_id, quarantine_id,
               quarantine_fingerprint_sha256
          from public.inbox_v2_source_ingress_cursor_checkpoints
         where tenant_id = ${ids.tenantId}
           and cursor_slot_id = ${`quarantine-cursor-slot:${suffix}`}
      `);
      expect(checkpoint.rows).toEqual([
        expect.objectContaining({
          target_kind: "quarantine",
          durable_work_id: null,
          last_durable_raw_event_id: null,
          quarantine_id: quarantined.quarantineId
        })
      ]);
      expect(String(checkpoint.rows[0]?.quarantine_fingerprint_sha256)).toMatch(
        /^sha256:[0-9a-f]{64}$/u
      );
    });

    it("provisions, rotates and retires cursor-purpose keys through the normal lifecycle API", async () => {
      const ids = await seedScope(database, "cursor-key-lifecycle", {
        withAuthority: true
      });
      const repository = runtimeRepository(database, "cursor-key-lifecycle");
      for (const generation of ["cursor-lifecycle-v1", "cursor-lifecycle-v2"]) {
        await seedTenantSecret(
          database,
          ids.tenantId,
          hmacKeySecretRefFor(
            ids.tenantId,
            INBOX_V2_SOURCE_CURSOR_PURPOSE_ID,
            generation
          )
        );
      }
      const first = await rotateProcessingKey(
        repository,
        ids.tenantId,
        INBOX_V2_SOURCE_CURSOR_PURPOSE_ID,
        "cursor-lifecycle-v1",
        {
          useWindowMilliseconds: 500,
          guaranteeWindowMilliseconds: 700,
          verifyWindowMilliseconds: 900
        }
      );
      expect(first).toMatchObject({
        outcome: "rotated",
        generation: "cursor-lifecycle-v1",
        revision: "1"
      });
      await expect(
        rotateProcessingKey(
          repository,
          ids.tenantId,
          INBOX_V2_SOURCE_CURSOR_PURPOSE_ID,
          "cursor-lifecycle-v2",
          { expectedActiveGeneration: "cursor-lifecycle-v1" }
        )
      ).resolves.toMatchObject({
        outcome: "rotated",
        generation: "cursor-lifecycle-v2"
      });
      await delay(1_100);
      await expect(
        repository.retireProcessingKeyGeneration(
          inboxV2SourceProcessingKeyRetirementInputSchema.parse({
            tenantId: ids.tenantId,
            purposeId: INBOX_V2_SOURCE_CURSOR_PURPOSE_ID,
            generation: "cursor-lifecycle-v1",
            expectedRevision: "2"
          })
        )
      ).resolves.toEqual({
        outcome: "retired",
        generation: "cursor-lifecycle-v1",
        revision: "3"
      });
    });

    it("finds one coherent dedupe outcome across active and verification-only keys", async () => {
      const ids = await seedScope(database, "dedupe-key-lookup", {
        withAuthority: true
      });
      const generations = ["lookup-v2", "lookup-v1"] as const;
      const repository = runtimeRepository(database, "dedupe-key-lookup", {
        cryptographicAuthority: testCryptographicAuthority(generations)
      });
      for (const generation of [...generations].reverse()) {
        await seedTenantSecret(
          database,
          ids.tenantId,
          hmacKeySecretRefFor(
            ids.tenantId,
            INBOX_V2_SOURCE_REPLAY_PURPOSE_ID,
            generation
          )
        );
      }
      await expect(
        rotateReplayKey(repository, ids.tenantId, "lookup-v1")
      ).resolves.toMatchObject({ outcome: "rotated", generation: "lookup-v1" });
      await expect(
        rotateReplayKey(repository, ids.tenantId, "lookup-v2", {
          expectedActiveGeneration: "lookup-v1"
        })
      ).resolves.toMatchObject({ outcome: "rotated", generation: "lookup-v2" });

      const target = await createDeadLetterTarget(
        database,
        repository,
        ids,
        "dedupe-key-lookup",
        "lookup-v2"
      );
      const identityMaterial = `${rawIdentitySentinel}-dedupe-key-lookup`;
      await expect(
        repository.writeDedupeSkeleton(
          inboxV2SourceDedupeSkeletonWriteInputSchema.parse({
            skeletonId: `${target.skeletonId}-v1`,
            routeGeneration: target.routeGeneration,
            skeleton: {
              ...target.skeleton,
              digestKeyGeneration: "lookup-v1",
              keyVerifyUntil: await loadKeyVerifyUntil(
                database,
                ids.tenantId,
                "lookup-v1"
              ),
              identityHmacSha256: dedupeIdentityHmac(
                identityMaterial,
                "lookup-v1"
              ),
              outcomeHmacSha256: hmac("dedupe-key-lookup-outcome-v1")
            },
            identityMaterial
          })
        )
      ).resolves.toEqual({ outcome: "written" });

      await expect(
        repository.lookupDedupeSkeleton(
          inboxV2SourceDedupeSkeletonLookupInputSchema.parse({
            source: target.skeleton.source,
            phase: target.skeleton.target.phase,
            purposeId: target.skeleton.purposeId,
            identityMaterial
          })
        )
      ).resolves.toMatchObject({
        outcome: "found",
        skeletonId: target.skeletonId,
        routeGeneration: target.routeGeneration,
        matchedKeyGenerations: generations
      });
    });

    it("rotates finite HMAC generations, expires skeletons and fails closed when a pinned key is unavailable", async () => {
      const ids = await seedScope(database, "key-lifecycle", {
        withAuthority: true
      });
      const repository = runtimeRepository(database, "key-lifecycle");
      await seedTenantSecret(
        database,
        ids.tenantId,
        hmacKeySecretRefFor(
          ids.tenantId,
          INBOX_V2_SOURCE_REPLAY_PURPOSE_ID,
          "key-v1"
        )
      );
      await seedTenantSecret(
        database,
        ids.tenantId,
        hmacKeySecretRefFor(
          ids.tenantId,
          INBOX_V2_SOURCE_REPLAY_PURPOSE_ID,
          "key-v2"
        )
      );
      await databaseNow(database);
      const first = await rotateReplayKey(repository, ids.tenantId, "key-v1", {
        useWindowMilliseconds: 500,
        guaranteeWindowMilliseconds: 900,
        verifyWindowMilliseconds: 1_300
      });
      expect(first).toMatchObject({ outcome: "rotated", generation: "key-v1" });
      const second = await rotateReplayKey(repository, ids.tenantId, "key-v2", {
        expectedActiveGeneration: "key-v1"
      });
      expect(second).toMatchObject({
        outcome: "rotated",
        generation: "key-v2"
      });

      const target = await createDeadLetterTarget(
        database,
        repository,
        ids,
        "key-lifecycle",
        "key-v2",
        { skeletonWindowMilliseconds: 1_300 }
      );
      await expect(
        repository.writeDedupeSkeleton(
          inboxV2SourceDedupeSkeletonWriteInputSchema.parse({
            skeletonId: `dedupe:${suffix}-unknown-key`,
            routeGeneration: "1",
            skeleton: {
              ...target.skeleton,
              digestKeyGeneration: "unknown-key",
              identityHmacSha256: hmac("unknown-key-identity"),
              outcomeHmacSha256: hmac("unknown-key-outcome")
            },
            identityMaterial: "provider-identity-unknown-key"
          })
        )
      ).resolves.toEqual({ outcome: "key_unavailable" });

      await expect(
        repository.expireDedupeSkeleton(
          inboxV2SourceDedupeSkeletonExpireInputSchema.parse({
            tenantId: ids.tenantId,
            skeletonId: target.skeletonId,
            expectedRevision: "1"
          })
        )
      ).resolves.toEqual({ outcome: "not_due" });
      await delay(1_500);
      await expect(
        repository.expireDedupeSkeleton(
          inboxV2SourceDedupeSkeletonExpireInputSchema.parse({
            tenantId: ids.tenantId,
            skeletonId: target.skeletonId,
            expectedRevision: "1"
          })
        )
      ).resolves.toEqual({ outcome: "expired", revision: "3" });
      await expect(
        repository.retireProcessingKeyGeneration(
          inboxV2SourceProcessingKeyRetirementInputSchema.parse({
            tenantId: ids.tenantId,
            purposeId: INBOX_V2_SOURCE_REPLAY_PURPOSE_ID,
            generation: "key-v1",
            expectedRevision: "2"
          })
        )
      ).resolves.toEqual({
        outcome: "retired",
        generation: "key-v1",
        revision: "3"
      });

      const retiredTarget = await createDeadLetterTarget(
        database,
        repository,
        ids,
        "retired-key",
        "key-v2"
      );
      await makeKeyUnavailableUnsafe(database, ids.tenantId, "key-v2");
      const request = replayRequest(
        retiredTarget.scope,
        retiredTarget.workRevision,
        { label: "retired-key", deadLetterId: retiredTarget.deadLetterId }
      );
      await expect(repository.requestReplay(request)).resolves.toMatchObject({
        outcome: "rejected",
        reason: "key_unavailable"
      });
      await expectDurableReplayDecision(
        database,
        ids.tenantId,
        request.requestId,
        "denied",
        "key_unavailable"
      );
    });

    it("requires admission-first retention deletion for a handed-off raw skeleton", async () => {
      const label = "terminal-skeleton-delete-order";
      const ids = await seedScope(database, label, { withAuthority: true });
      const repository = runtimeRepository(database, label);
      const generation = "delete-order-v1";
      await seedTenantSecret(
        database,
        ids.tenantId,
        hmacKeySecretRefFor(
          ids.tenantId,
          INBOX_V2_SOURCE_REPLAY_PURPOSE_ID,
          generation
        )
      );
      await databaseNow(database);
      await expect(
        rotateReplayKey(repository, ids.tenantId, generation)
      ).resolves.toMatchObject({ outcome: "rotated", generation });
      const guaranteeUntil = timestamp(Date.now() + 3_000);
      const skeletonExpiresAt = timestamp(Date.parse(guaranteeUntil) + 1_000);
      const identityHmacSha256 = dedupeIdentityHmac(
        `${rawIdentitySentinel}-${label}`,
        generation
      );
      await recordProductionRaw(database, ids, label, {
        generation,
        secretRef: hmacKeySecretRefFor(
          ids.tenantId,
          INBOX_V2_SOURCE_REPLAY_PURPOSE_ID,
          generation
        ),
        identityHmacSha256,
        safeEnvelopeHmacSha256: hmac(`${label}-safe-envelope`),
        guaranteeUntil
      });
      const target = await createDeadLetterTarget(
        database,
        repository,
        ids,
        label,
        generation,
        {
          recordRawOccurrence: false,
          guaranteeUntil,
          skeletonExpiresAt
        }
      );
      await linkRawAdmissionToTerminalSkeleton(database, {
        tenantId: ids.tenantId,
        rawEventId: target.scope.rawEventId,
        generation,
        identityHmacSha256: target.skeleton.identityHmacSha256,
        terminalSkeletonId: target.skeletonId,
        terminalOutcomeHmacSha256: target.skeleton.outcomeHmacSha256,
        terminalAt: target.skeleton.terminalAt,
        guaranteeUntil: target.skeleton.guaranteeUntil
      });

      await delay(Math.max(0, Date.parse(guaranteeUntil) - Date.now() + 200));
      await expect(
        repository.expireDedupeReplayability(
          inboxV2SourceDedupeReplayabilityExpireInputSchema.parse({
            tenantId: ids.tenantId,
            skeletonId: target.skeletonId,
            expectedRevision: "1",
            reason: "guarantee_expired"
          })
        )
      ).resolves.toEqual({ outcome: "expired", revision: "2" });
      await delay(
        Math.max(0, Date.parse(skeletonExpiresAt) - Date.now() + 200)
      );
      await expect(
        repository.expireDedupeSkeleton(
          inboxV2SourceDedupeSkeletonExpireInputSchema.parse({
            tenantId: ids.tenantId,
            skeletonId: target.skeletonId,
            expectedRevision: "2"
          })
        )
      ).resolves.toEqual({ outcome: "expired", revision: "3" });

      await expectDatabaseRejection(
        deleteTerminalSkeletonAsRetention(database, {
          tenantId: ids.tenantId,
          skeletonId: target.skeletonId,
          deleteAdmissionFirst: false
        }),
        /not retention eligible|remains referenced/u
      );

      await expect(
        deleteTerminalSkeletonAsRetention(database, {
          tenantId: ids.tenantId,
          skeletonId: target.skeletonId,
          deleteAdmissionFirst: true
        })
      ).resolves.toBeUndefined();
      const remaining = await database.execute<{ count: string }>(sql`
        select count(*)::text as count
          from public.inbox_v2_source_delivery_dedupe_skeletons
         where tenant_id = ${ids.tenantId}
           and id = ${target.skeletonId}
      `);
      expect(remaining.rows[0]?.count).toBe("0");
    });
  }
);

type Scope = ReturnType<typeof scope>;
type CandidateScope = Readonly<{
  tenantId: Scope["tenantId"];
  connectionId: Scope["connectionId"];
  accountId: Scope["accountId"];
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
    secondAccountId: inboxV2SourceAccountIdSchema.parse(
      `source_account:${suffix}-${label}-second`
    )
  } as const;
}

function accountScope(
  ids: Scope,
  accountId: Scope["accountId"]
): CandidateScope {
  return { tenantId: ids.tenantId, connectionId: ids.connectionId, accountId };
}

async function seedScope(
  database: HuleeDatabase,
  label: string,
  options: { withAuthority?: boolean; includeSecondAccount?: boolean } = {}
): Promise<Scope> {
  const ids = scope(label);
  fixtureTenants.add(ids.tenantId);
  await database.execute(sql`
    insert into public.tenants (id, slug, display_name)
    values (
      ${ids.tenantId}, ${`${suffix}-${label}`}, ${`SRC-008 ${label}`}
    )
  `);
  await database.execute(sql`
    insert into public.source_connections (
      id, tenant_id, source_type, source_name, display_name, status,
      auth_type, capabilities, config, diagnostics, metadata
    ) values (
      ${ids.connectionId}, ${ids.tenantId}, 'messenger', 'synthetic',
      ${`SRC-008 ${label}`}, 'active', 'custom', '{}'::jsonb, '{}'::jsonb,
      '{}'::jsonb, '{}'::jsonb
    )
  `);
  const accountIds = options.includeSecondAccount
    ? [ids.accountId, ids.secondAccountId]
    : [ids.accountId];
  for (const accountId of accountIds) {
    await database.execute(sql`
      insert into public.source_accounts (
        id, tenant_id, source_connection_id, external_account_id,
        external_account_name, account_type, display_name, status, metadata
      ) values (
        ${accountId}, ${ids.tenantId}, ${ids.connectionId},
        ${`external-${accountId}`}, 'SRC-008 account', 'direct',
        'SRC-008 account', 'active', '{}'::jsonb
      )
    `);
  }
  if (options.withAuthority === true) {
    await seedCurrentConnectionAuthority(database, ids);
  }
  return ids;
}

async function seedCurrentConnectionAuthority(
  database: HuleeDatabase,
  ids: Scope
): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local session_replication_role = 'replica'`
    );
    await transaction.execute(sql`
      insert into public.inbox_v2_source_registry_heads (
        tenant_id, authority_id, authority_kind, source_connection_id,
        source_account_id, connector_id, session_id, auth_challenge_id,
        revision, state, route_generation, route_authority_state,
        route_authority_reason_code_id, route_authority_changed_at,
        account_identity_transition_id, account_identity_revision,
        account_generation, account_identity_state,
        account_identity_fence_digest_sha256,
        account_canonical_key_digest_sha256,
        account_access_resource_head_id, account_resource_access_revision,
        account_structural_relation_revision, adapter_contract_id,
        adapter_contract_version, adapter_declaration_revision,
        adapter_surface_id, adapter_loaded_by_trusted_service_id,
        adapter_loaded_at, adapter_handler_id, authority_copy_slot,
        authority_registry_id, authority_registry_composition_hash,
        authority_registry_revision, authority_data_class_id,
        authority_storage_root_id, authority_purpose_id,
        authority_canonical_anchor_id, authority_lineage_revision,
        authority_effective_policy_id, authority_effective_policy_version,
        authority_effective_rule_id, authority_effective_rule_revision,
        authority_policy_activation_id, authority_policy_activation_revision,
        authority_policy_activation_head_revision,
        authority_legal_hold_set_revision,
        authority_restriction_set_revision, last_transition_id,
        created_by_actor_kind, created_by_employee_id,
        created_by_trusted_service_id, created_by_authorization_epoch,
        created_at, updated_at
      ) values (
        ${ids.tenantId}, ${`authority:${suffix}-${ids.connectionId}`},
        'source_connection', ${ids.connectionId}, null, null, null, null,
        1, 'active', 1, 'enabled', 'core:source-route.enabled',
        ${fixtureTime}, null, null, null, null, null, null, null, null, null,
        'module:synthetic:src008', 'v1', 1, 'core:direct-messenger',
        'core:src008-fixture', ${fixtureTime}, 'module:synthetic:src008-handler',
        'source_connection_registry', 'core:src008-registry', ${"a".repeat(64)},
        1, 'core:source_account_connector_metadata', 'core:src008-sql',
        'core:source_replay_and_diagnostics', 'core:src008-anchor', 1,
        'policy:src008', 1, 'rule:src008', 1, 'activation:src008', 1, 1, 0, 0,
        ${`transition:${suffix}-${ids.connectionId}`}, 'trusted_service', null,
        'core:src008-fixture', null, ${fixtureTime}, ${fixtureTime}
      )
      on conflict (tenant_id, authority_id) do nothing
    `);
  });
}

async function recordRaw(
  database: HuleeDatabase,
  ids: CandidateScope,
  label: string
) {
  const candidate = await acceptedCandidate(ids, label);
  const result = await createSqlInboxV2RawIngressRepository(database, {
    rawEventIdSource: () => `raw_inbound_event:${suffix}-${label}`,
    quarantineIdSource: () => `core:${suffix}-${label}-quarantine`
  }).record(candidate);
  if (result.outcome !== "recorded") {
    throw new Error(`Expected raw fixture ${label} to be newly recorded.`);
  }
  return result;
}

async function recordProductionRaw(
  database: HuleeDatabase,
  ids: CandidateScope,
  label: string,
  admission: {
    generation: string;
    secretRef: string;
    identityHmacSha256: `hmac-sha256:${string}`;
    safeEnvelopeHmacSha256: `hmac-sha256:${string}`;
    guaranteeUntil: string;
  }
) {
  const candidate = await acceptedCandidate(ids, label);
  const writeCandidate = {
    generation: admission.generation,
    hmacKeySecretRef: admission.secretRef,
    identityHmacSha256: admission.identityHmacSha256,
    safeEnvelopeHmacSha256: admission.safeEnvelopeHmacSha256
  } as const;
  const result = await createProductionSqlInboxV2RawIngressRepository(
    database,
    {
      admissionAuthority: {
        authorizeRawAdmission: async (input) => ({
          outcome: "authorized" as const,
          source: input.source,
          identityKind: input.identityKind,
          purposeId: input.purposeId,
          writeCandidate,
          candidates: [writeCandidate],
          guaranteeUntil: admission.guaranteeUntil
        })
      },
      rawEventIdSource: () => `raw_inbound_event:${suffix}-${label}`,
      quarantineIdSource: () => `core:${suffix}-${label}-quarantine`
    }
  ).record(candidate);
  if (result.outcome !== "recorded") {
    throw new Error(`Expected production raw fixture ${label} to be recorded.`);
  }
  return result;
}

async function recordQuarantine(
  database: HuleeDatabase,
  ids: CandidateScope,
  label: string
) {
  const sanitized = await sanitizeInboxV2RawIngress({
    sanitizer: defineInboxV2RawIngressSanitizer({
      profile: rawSanitizerProfile(),
      handler: async () => ({
        outcome: "quarantined" as const,
        reasonCode: "source.sanitizer_rejected" as const
      }),
      parseRestrictedPayload() {
        return {};
      }
    }),
    request: rawRequest(ids, label)
  });
  if (sanitized.outcome !== "quarantined") {
    throw new Error("Expected a quarantined sanitizer fixture.");
  }
  const result = await createSqlInboxV2RawIngressRepository(database, {
    rawEventIdSource: () => `raw_inbound_event:${suffix}-${label}`,
    quarantineIdSource: () => `core:${suffix}-${label}-quarantine`
  }).record(sanitized.candidate);
  if (result.outcome !== "quarantined") {
    throw new Error(`Expected raw fixture ${label} to be quarantined.`);
  }
  return result;
}

async function acceptedCandidate(
  ids: CandidateScope,
  label: string
): Promise<InboxV2SanitizedRawIngressCandidate> {
  const result = await sanitizeInboxV2RawIngress({
    sanitizer: defineInboxV2RawIngressSanitizer({
      profile: rawSanitizerProfile(),
      handler: async ({ headers }) => ({
        outcome: "accepted" as const,
        restrictedPayload: { message: `message-${label}` },
        validatedAllowedHeaders: [
          { name: "x-request-id", values: [headers["x-request-id"]![0]!] }
        ]
      }),
      parseRestrictedPayload(value) {
        if (
          typeof value !== "object" ||
          value === null ||
          Array.isArray(value) ||
          typeof (value as { message?: unknown }).message !== "string"
        ) {
          throw new TypeError("Expected the SRC-008 fixture payload.");
        }
        return { message: (value as { message: string }).message };
      }
    }),
    request: rawRequest(ids, label)
  });
  if (result.outcome !== "accepted") throw new Error("fixture invariant");
  return result.candidate;
}

function rawSanitizerProfile() {
  return defineInboxV2RawIngressSanitizerProfile({
    schemaId: "core:inbox-v2.raw-ingress-sanitizer-profile",
    schemaVersion: "v1",
    payload: {
      adapterContract: {
        contractId: "module:synthetic:raw-ingress-src008",
        contractVersion: "v1",
        declarationRevision: "1",
        surfaceId: "core:direct-messenger",
        loadedByTrustedServiceId: "core:source-runtime",
        loadedAt: fixtureTime
      },
      handlerId: "module:synthetic:sanitize-src008",
      handlerVersion: "v1",
      declarationRevision: "1",
      restrictedPayloadSchema: {
        schemaId: "module:synthetic:raw-src008",
        schemaVersion: "v1"
      },
      persistedHeaderNames: ["x-request-id"],
      payloadClassification: {
        dataClassId: "core:raw_provider_payload",
        purposeIds: [INBOX_V2_SOURCE_REPLAY_PURPOSE_ID]
      },
      allowedHeadersClassification: {
        dataClassId: "core:raw_provider_allowed_headers",
        purposeIds: [INBOX_V2_SOURCE_REPLAY_PURPOSE_ID]
      }
    }
  });
}

function rawRequest(
  ids: CandidateScope,
  label: string
): InboxV2RawIngressInput {
  return {
    tenantId: ids.tenantId,
    sourceConnectionId: ids.connectionId,
    sourceAccountId: ids.accountId,
    transport: "polling",
    eventIdentity: {
      kind: "provider_event_id",
      value: `${rawIdentitySentinel}-${label}`
    },
    providerOccurredAt: fixtureTime,
    receivedAt: "2026-07-17T00:00:01.000Z",
    sanitizedAt: "2026-07-17T00:00:02.000Z",
    body: new TextEncoder().encode(JSON.stringify({ secretSentinel })),
    headers: {
      Authorization: `Bearer ${secretSentinel}`,
      "X-Request-Id": `request-${suffix}-${label}`
    }
  };
}

async function normalizedFanoutCandidate(
  ids: Scope,
  rawEventId: string,
  label: string,
  eventCount: number
): Promise<InboxV2SourceNormalizationCandidateBatch> {
  const normalizer = defineInboxV2SourceNormalizer({
    profile: sourceNormalizerProfile(),
    parseRestrictedPayload: parseNormalizationPayload,
    evidenceParsers: {
      "module:synthetic:message-content-src008": parseNormalizationEvidence
    },
    handler: () => ({
      outcome: "emitted",
      events: Array.from({ length: eventCount }, (_, ordinal) =>
        normalizedMessageEvent(ids, label, ordinal)
      )
    })
  });
  return executeInboxV2SourceNormalizer({
    normalizer,
    raw: {
      tenantId: ids.tenantId,
      rawEventId,
      sourceConnectionId: ids.connectionId,
      sourceAccountId: ids.accountId,
      transport: "polling",
      providerOccurredAt: fixtureTime,
      rawIngressSanitizer: rawIngressSanitizerPin,
      restrictedPayload: { message: `message-${label}` }
    }
  });
}

function sourceNormalizerProfile() {
  const identityDeclarations = [
    normalizationThreadDeclaration(),
    normalizationMessageDeclaration()
  ].sort((left, right) =>
    String(calculateInboxV2CanonicalSha256(left)).localeCompare(
      String(calculateInboxV2CanonicalSha256(right))
    )
  );
  return defineInboxV2SourceNormalizerProfile({
    schemaId: "core:inbox-v2.source-normalizer-profile",
    schemaVersion: "v1",
    payload: {
      adapterContract: normalizationAdapterContract,
      handlerId: "module:synthetic:normalize-src008",
      handlerVersion: "v1",
      declarationRevision: "1",
      rawIngressSanitizer: rawIngressSanitizerPin,
      eventKinds: ["message_created"],
      identityDeclarations,
      evidenceSlots: [
        {
          slotId: "module:synthetic:message-content-src008",
          schemaId: "module:synthetic:message-content-src008",
          schemaVersion: "v1",
          dataClassId: "core:normalized_event_payload",
          purposeIds: [INBOX_V2_SOURCE_REPLAY_PURPOSE_ID]
        }
      ]
    }
  });
}

function normalizedMessageEvent(
  ids: Scope,
  label: string,
  ordinal: number
): InboxV2SourceNormalizedEventDraft {
  const owner = {
    tenantId: ids.tenantId,
    kind: "source_account" as const,
    id: ids.accountId
  };
  return {
    direction: "inbound",
    visibility: "public",
    payloadVersion: "v1",
    providerOccurredAt: fixtureTime,
    semantic: {
      kind: "message_created",
      originKind: "polling",
      authorObservationKey: null
    },
    thread: {
      identityDeclaration: normalizationThreadDeclaration(),
      key: {
        realm: {
          realmId: "module:synthetic:thread-realm-src008",
          realmVersion: "v1",
          canonicalizationVersion: "v1"
        },
        scope: { kind: "source_account", owner },
        objectKindId: "module:synthetic:chat-src008",
        canonicalExternalSubject: `Chat-${label}`
      },
      observedExternalSubject: `Chat-${label}`
    },
    message: {
      identityDeclaration: normalizationMessageDeclaration(),
      realm: {
        realmId: "module:synthetic:message-realm-src008",
        realmVersion: "v1",
        canonicalizationVersion: "v1"
      },
      scope: { kind: "source_account", owner },
      objectKindId: "module:synthetic:message-src008",
      observedExternalSubject: `Message-${label}-${ordinal}`,
      canonicalExternalSubject: `Message-${label}-${ordinal}`
    },
    identityObservations: [],
    rosterObservation: null,
    capabilityObservation: {
      schemaId: "module:synthetic:capabilities-src008",
      schemaVersion: "v1",
      capabilities: []
    },
    evidence: [
      {
        slotId: "module:synthetic:message-content-src008",
        value: { text: `classified-${label}-${ordinal}` }
      }
    ]
  };
}

function normalizationThreadDeclaration() {
  return {
    adapterContract: normalizationAdapterContract,
    identityKind: "external_thread" as const,
    realmId: "module:synthetic:thread-realm-src008",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic:chat-src008",
    scopeKind: "source_account" as const,
    decisionStrength: "safe_default" as const
  };
}

function normalizationMessageDeclaration() {
  return {
    adapterContract: normalizationAdapterContract,
    identityKind: "message" as const,
    realmId: "module:synthetic:message-realm-src008",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic:message-src008",
    scopeKind: "source_account" as const,
    decisionStrength: "safe_default" as const
  };
}

function parseNormalizationPayload(value: unknown): { message: string } {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    typeof (value as { message?: unknown }).message !== "string"
  ) {
    throw new TypeError("Expected the exact SRC-008 normalization payload.");
  }
  return { message: (value as { message: string }).message };
}

function parseNormalizationEvidence(value: unknown): { text: string } {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    typeof (value as { text?: unknown }).text !== "string"
  ) {
    throw new TypeError("Expected the exact SRC-008 normalization evidence.");
  }
  return { text: (value as { text: string }).text };
}

function normalizedEventId(label: string, ordinal: number): string {
  return `normalized_inbound_event:${suffix}-${label}-${ordinal}`;
}

function normalizationRepository(database: HuleeDatabase, label: string) {
  return createSqlInboxV2SourceNormalizationRepository(
    database,
    normalizationRepositoryOptions(label)
  );
}

function normalizationRepositoryOptions(
  label: string
): CreateSqlInboxV2SourceNormalizationRepositoryOptions {
  return {
    normalizationDigestKeySource: ({ keyGeneration }) => {
      if (
        keyGeneration !== null &&
        keyGeneration !== normalizationDigestKeyGeneration
      ) {
        throw new Error(
          `Unknown SRC-008 normalization digest generation: ${keyGeneration}`
        );
      }
      return {
        keyGeneration: normalizationDigestKeyGeneration,
        key: Uint8Array.from(normalizationDigestKey)
      };
    },
    normalizedEventIdSource: ({ ordinal }) => normalizedEventId(label, ordinal),
    quarantineIdSource: () => `core:${suffix}-${label}-normalization-quarantine`
  };
}

function runtimeRepository(
  database: HuleeDatabase,
  label: string,
  overrides: Partial<CreateSqlInboxV2SourceProcessingRuntimeRepositoryOptions> = {}
): InboxV2SourceProcessingRuntimeRepositoryPort &
  InboxV2SourceCursorDurableTargetResolverPort {
  let tokenSequence = 0;
  let attemptSequence = 0;
  const defaults: CreateSqlInboxV2SourceProcessingRuntimeRepositoryOptions = {
    replayAuthorization: {
      authorizeReplay: async () => ({ outcome: "authorized" })
    },
    retentionPolicy: {
      attemptRetentionSeconds: 3_600,
      replayRequestRetentionSeconds: 3_600
    },
    deadLetterLifecycleResolver: ({ deadLetteredAt }) => {
      const terminal = Date.parse(deadLetteredAt);
      return {
        evidenceDeadlines: {
          capturedAt: deadLetteredAt,
          rawPayloadExpiresAt: timestamp(terminal + 3_600_000),
          allowedRawHeadersExpiresAt: timestamp(terminal + 1_800_000),
          normalizedPayloadExpiresAt: null
        },
        replayNotAfter: timestamp(terminal + 900_000),
        expiresAt: timestamp(terminal + 7_200_000)
      };
    },
    terminalDedupe: { mode: "compatibility_optional" },
    cryptographicAuthority: testCryptographicAuthority(),
    leaseTokenSource: (count) =>
      Array.from({ length: count }, () => {
        tokenSequence += 1;
        return `source-processing-${suffix}-${label}-${tokenSequence}-${"x".repeat(32)}`;
      }),
    attemptIdSource: (count) =>
      Array.from({ length: count }, () => {
        attemptSequence += 1;
        return `attempt:${suffix}-${label}-${attemptSequence}`;
      }),
    replayEpisodeIdSource: (request) =>
      `replay-episode:${suffix}-${label}-${request.requestId}`
  };
  return createSqlInboxV2SourceProcessingRuntimeRepository(database, {
    ...defaults,
    ...overrides
  });
}

function testCryptographicAuthority(
  dedupeLookupGenerations: readonly string[] = []
): InboxV2SourceProcessingCryptographicAuthorityPort {
  const protectedCursors = new Map<
    string,
    ReturnType<typeof inboxV2SourceCursorPositionSchema.parse>
  >();
  return {
    async protectCursor(input) {
      const target = input.acknowledgement.target;
      const source = target.kind === "raw_work" ? target.scope : target.source;
      const cursorValueSecretRef = cursorValueSecretRefFor(
        source.tenantId,
        input.acknowledgement.cursor.value
      );
      protectedCursors.set(
        cursorValueSecretRef,
        inboxV2SourceCursorPositionSchema.parse(input.acknowledgement.cursor)
      );
      return inboxV2SourceCursorProtectionSchema.parse({
        tenantId: source.tenantId,
        keyGeneration: "cursor-v1",
        hmacKeySecretRef: hmacKeySecretRefFor(
          source.tenantId,
          INBOX_V2_SOURCE_CURSOR_PURPOSE_ID,
          "cursor-v1"
        ),
        cursorValueSecretRef,
        cursorHmacSha256: hmac(input.acknowledgement.cursor.value)
      });
    },
    async resolveCursor({ protection }) {
      return protectedCursors.get(protection.cursorValueSecretRef) ?? null;
    },
    async verifyDedupeSkeleton(input) {
      return inboxV2SourceDedupeHmacVerificationSchema.parse({
        outcome: "verified",
        tenantId: input.skeleton.source.tenantId,
        hmacKeySecretRef: hmacKeySecretRefFor(
          input.skeleton.source.tenantId,
          input.skeleton.purposeId,
          input.skeleton.digestKeyGeneration
        )
      });
    },
    async deriveDedupeIdentityCandidates(input) {
      if (dedupeLookupGenerations.length === 0) {
        return { outcome: "rejected", reason: "key_unavailable" };
      }
      return inboxV2SourceDedupeIdentityCandidatesSchema.parse({
        outcome: "derived",
        source: input.source,
        phase: input.phase,
        purposeId: input.purposeId,
        candidates: dedupeLookupGenerations.map((generation) => ({
          generation,
          hmacKeySecretRef: hmacKeySecretRefFor(
            input.source.tenantId,
            input.purposeId,
            generation
          ),
          identityHmacSha256: dedupeIdentityHmac(
            input.identityMaterial,
            generation
          )
        }))
      });
    }
  };
}

function policy(
  overrides: Partial<InboxV2SourceBackpressurePolicy> = {}
): InboxV2SourceBackpressurePolicy {
  return {
    maxClaimBatch: 10,
    maxInFlightPerTenant: 10,
    maxInFlightPerConnection: 10,
    maxInFlightPerAccount: 10,
    maxQueuedPerTenant: 10_000,
    maxQueuedPerConnection: 10_000,
    maxQueuedPerAccount: 10_000,
    maxAttempts: 5,
    baseRetryDelaySeconds: 1,
    maxRetryDelaySeconds: 60,
    jitterBasisPoints: 0,
    ...overrides
  };
}

async function claimOne(
  repository: InboxV2SourceProcessingRuntimeRepositoryPort,
  tenantId: string,
  label: string,
  leaseDurationSeconds = 30
): Promise<InboxV2SourceProcessingRuntimeClaim> {
  const result = await repository.claim({
    tenantId: inboxV2TenantIdSchema.parse(tenantId),
    workerId: inboxV2NamespacedIdSchema.parse(`core:src008-${label}-worker`),
    leaseDurationSeconds,
    policy: policy({ maxClaimBatch: 1 })
  });
  if (result.outcome !== "claimed" || result.claims.length !== 1) {
    throw new Error(
      `Expected exactly one SRC-008 ${label} claim, received ${JSON.stringify(result)}.`
    );
  }
  return result.claims[0]!;
}

async function claimStageBatch(
  repository: InboxV2SourceProcessingRuntimeRepositoryPort,
  tenantId: string,
  label: string,
  expectedStage: InboxV2SourceProcessingScope["stage"],
  claimPolicy: InboxV2SourceBackpressurePolicy,
  expectedCount: number
): Promise<readonly InboxV2SourceProcessingRuntimeClaim[]> {
  const result = await repository.claim({
    tenantId: inboxV2TenantIdSchema.parse(tenantId),
    workerId: inboxV2NamespacedIdSchema.parse(
      `core:src008-${label.replaceAll("_", "-")}-worker`
    ),
    leaseDurationSeconds: 30,
    policy: claimPolicy
  });
  if (result.outcome !== "claimed") {
    throw new Error(`Expected a claimed SRC-008 ${expectedStage} batch.`);
  }
  expect(result.claims).toHaveLength(expectedCount);
  expect(
    result.claims.every((claim) => claim.attempt.scope.stage === expectedStage)
  ).toBe(true);
  return result.claims;
}

async function applyProcessedClaims(
  database: HuleeDatabase,
  repository: InboxV2SourceProcessingRuntimeRepositoryPort,
  claims: readonly InboxV2SourceProcessingRuntimeClaim[]
): Promise<void> {
  const ordered = [...claims].sort((left, right) =>
    String(left.attempt.scope.sourceAccountId).localeCompare(
      String(right.attempt.scope.sourceAccountId),
      "en"
    )
  );
  for (const claim of ordered) {
    await delay(2);
    await expect(
      repository.applyOutcome({
        leaseToken: claim.leaseToken,
        outcome: processedOutcome(claim, await databaseNow(database)),
        deadLetterRecord: null
      })
    ).resolves.toEqual({ outcome: "applied" });
  }
}

function processedOutcome(
  claim: InboxV2SourceProcessingRuntimeClaim,
  completedAt: string
): InboxV2SourceProcessingOutcome {
  return {
    kind: "processed",
    attempt: claim.attempt,
    completedAt,
    diagnostic: null
  };
}

function retryableFailureOutcome(
  claim: InboxV2SourceProcessingRuntimeClaim,
  completedAt: string,
  retryAt: string
): InboxV2SourceProcessingOutcome {
  return inboxV2SourceProcessingOutcomeSchema.parse({
    kind: "retry_scheduled",
    attempt: claim.attempt,
    completedAt,
    diagnostic: {
      codeId: "core:source-materialization-temporary-failure",
      retryable: true,
      correlationToken: claim.attempt.attemptId,
      safeOperatorHintId: "core:retry-materialization"
    },
    retry: {
      reason: "bounded_backoff",
      nextAttemptAt: retryAt,
      rateLimitHint: null
    }
  });
}

function rateLimitedOutcome(
  claim: InboxV2SourceProcessingRuntimeClaim,
  completedAt: string,
  retryAt: string,
  scope: "source_connection" | "source_account"
): InboxV2SourceProcessingOutcome {
  return inboxV2SourceProcessingOutcomeSchema.parse({
    kind: "retry_scheduled",
    attempt: claim.attempt,
    completedAt,
    diagnostic: {
      codeId: "core:source-provider-rate-limited",
      retryable: true,
      correlationToken: claim.attempt.attemptId,
      safeOperatorHintId: "core:wait-for-provider-rate-limit"
    },
    retry: {
      reason: "rate_limited",
      nextAttemptAt: retryAt,
      rateLimitHint: {
        kind: "provider_retry_after",
        scope,
        observedAt: completedAt,
        retryAt
      }
    }
  });
}

function diagnosticTerminalOutcome(
  claim: InboxV2SourceProcessingRuntimeClaim,
  completedAt: string,
  kind: "ignored" | "duplicate"
): InboxV2SourceProcessingOutcome {
  return {
    kind,
    attempt: claim.attempt,
    completedAt,
    diagnostic: diagnostic(`${kind}-${claim.attempt.attemptId}`, false)
  };
}

function deadLetterInput(
  claim: InboxV2SourceProcessingRuntimeClaim,
  completedAt: string,
  label: string,
  options: {
    replayWindowMilliseconds?: number;
    expiresWindowMilliseconds?: number;
  } = {}
): InboxV2ApplySourceProcessingOutcomeInput {
  const terminal = Date.parse(completedAt);
  const replayNotAfter = timestamp(
    terminal + (options.replayWindowMilliseconds ?? 600_000)
  );
  const expiresAt = timestamp(
    terminal + (options.expiresWindowMilliseconds ?? 7_200_000)
  );
  const safeDiagnostic = diagnostic(label, false);
  const deadLetterId = `dead-letter:${suffix}-${label}`;
  const evidenceDeadlines = {
    capturedAt: claim.attempt.startedAt,
    rawPayloadExpiresAt: timestamp(terminal + 3_600_000),
    allowedRawHeadersExpiresAt: timestamp(terminal + 1_800_000),
    normalizedPayloadExpiresAt: null
  } as const;
  return inboxV2ApplySourceProcessingOutcomeInputSchema.parse({
    leaseToken: claim.leaseToken,
    outcome: {
      kind: "dead_lettered",
      attempt: claim.attempt,
      completedAt,
      diagnostic: safeDiagnostic,
      deadLetter: {
        id: deadLetterId,
        reason: "terminal_failure",
        deadLetteredAt: completedAt
      }
    },
    deadLetterRecord: {
      deadLetterId,
      attempt: claim.attempt,
      reason: "terminal_failure",
      diagnostic: safeDiagnostic,
      deadLetteredAt: completedAt,
      evidenceDeadlines,
      replayNotAfter,
      expiresAt
    }
  });
}

function diagnostic(
  label: string,
  retryable: boolean
): InboxV2SafeSourceDiagnostic {
  return inboxV2SafeSourceDiagnosticSchema.parse({
    codeId: retryable
      ? "core:source-processing.retryable"
      : "core:source-processing.terminal",
    retryable,
    correlationToken: `correlation:${suffix}-${label}`,
    safeOperatorHintId: "core:source-processing.inspect-account"
  });
}

async function createDeadLetterTarget(
  database: HuleeDatabase,
  repository: InboxV2SourceProcessingRuntimeRepositoryPort,
  ids: CandidateScope,
  label: string,
  keyGeneration: string,
  options: {
    replayWindowMilliseconds?: number;
    skeletonWindowMilliseconds?: number;
    recordRawOccurrence?: boolean;
    guaranteeUntil?: string;
    skeletonExpiresAt?: string;
  } = {}
) {
  if (options.recordRawOccurrence !== false) {
    await recordRaw(database, ids, label);
  }
  const claim = await claimOne(repository, ids.tenantId, label);
  const completedAt = await databaseNow(database);
  const deadLetter = deadLetterInput(claim, completedAt, label, {
    replayWindowMilliseconds: options.replayWindowMilliseconds
  });
  if (deadLetter.deadLetterRecord === null) {
    throw new Error(`Expected ${label} DLQ record fixture.`);
  }
  const deadLetterRecord = deadLetter.deadLetterRecord;
  const applied = await repository.applyOutcome(deadLetter);
  if (applied.outcome !== "applied") {
    throw new Error(`Expected ${label} DLQ transition to apply.`);
  }
  const work = await loadRuntimeWork(
    database,
    ids.tenantId,
    claim.attempt.workId
  );
  const terminal = Date.parse(completedAt);
  const skeletonWindow = options.skeletonWindowMilliseconds ?? 3_600_000;
  const guaranteeUntil =
    options.guaranteeUntil ?? timestamp(terminal + skeletonWindow);
  const skeletonExpiresAt =
    options.skeletonExpiresAt ?? timestamp(terminal + skeletonWindow);
  const replayUntil = timestamp(
    Math.min(
      terminal +
        (options.replayWindowMilliseconds ?? Math.min(600_000, skeletonWindow)),
      Date.parse(guaranteeUntil),
      Date.parse(skeletonExpiresAt)
    )
  );
  const skeletonId = `dedupe:${suffix}-${label}`;
  const keyVerifyUntil = await loadKeyVerifyUntil(
    database,
    ids.tenantId,
    keyGeneration
  );
  const skeleton = {
    source: {
      tenantId: ids.tenantId,
      sourceConnectionId: ids.connectionId,
      sourceAccountId: ids.accountId
    },
    target: {
      phase: "raw" as const,
      rawEventId: claim.attempt.scope.rawEventId,
      normalizedEventId: null
    },
    purposeId: INBOX_V2_SOURCE_REPLAY_PURPOSE_ID,
    digestKeyGeneration: keyGeneration,
    keyVerifyUntil,
    identityHmacSha256: dedupeIdentityHmac(
      `${rawIdentitySentinel}-${label}`,
      keyGeneration
    ),
    outcomeHmacSha256: hmac(`${label}-outcome`),
    outcome: {
      kind: "dead_lettered" as const,
      diagnosticCodeId: deadLetterRecord.diagnostic.codeId
    },
    evidenceDeadlines: deadLetterRecord.evidenceDeadlines,
    terminalAt: completedAt,
    guaranteeUntil,
    skeletonExpiresAt,
    replayability: { state: "replayable" as const, replayUntil },
    lifecycleState: "active" as const,
    expiredAt: null
  };
  const write = await repository.writeDedupeSkeleton(
    inboxV2SourceDedupeSkeletonWriteInputSchema.parse({
      skeletonId,
      routeGeneration: String(work.route_generation),
      skeleton,
      identityMaterial: `${rawIdentitySentinel}-${label}`
    })
  );
  if (write.outcome !== "written" && write.outcome !== "already_written") {
    throw new Error(`Expected ${label} dedupe skeleton to be written.`);
  }
  return {
    claim,
    scope: claim.attempt.scope,
    workRevision: String(work.revision),
    deadLetterId: deadLetterRecord.deadLetterId,
    skeletonId,
    routeGeneration: String(work.route_generation),
    skeleton
  } as const;
}

function replayRequest(
  scope: InboxV2SourceProcessingScope,
  expectedTargetRevision: string,
  input: { label: string; deadLetterId: string }
): InboxV2SourceReplayRequest {
  const material = {
    target: {
      kind: "dead_letter" as const,
      deadLetterId: input.deadLetterId,
      scope
    },
    expectedTargetRevision,
    reasonId: "core:source-replay.operator-requested",
    requestedBy: {
      kind: "trusted_service" as const,
      trustedServiceId: "core:source-replay-worker"
    },
    requestedAt: scopeTimestamp()
  };
  return inboxV2SourceReplayRequestSchema.parse({
    requestId: `request:${suffix}-${input.label}`,
    requestHash: calculateInboxV2SourceReplayRequestHash(material),
    ...material
  });
}

function rawReplayRequest(
  scope: InboxV2SourceProcessingScope,
  expectedTargetRevision: string,
  label: string
): InboxV2SourceReplayRequest {
  const material = {
    target: { kind: "raw_event" as const, scope },
    expectedTargetRevision,
    reasonId: "core:source-replay.operator-requested",
    requestedBy: {
      kind: "trusted_service" as const,
      trustedServiceId: "core:source-replay-worker"
    },
    requestedAt: scopeTimestamp()
  };
  return inboxV2SourceReplayRequestSchema.parse({
    requestId: `request:${suffix}-${label}`,
    requestHash: calculateInboxV2SourceReplayRequestHash(material),
    ...material
  });
}

let latestDatabaseTimestamp = fixtureTime;

async function databaseNow(database: HuleeDatabase): Promise<string> {
  const result = await database.execute<{ db_now: Date | string }>(sql`
    select clock_timestamp() as db_now
  `);
  const value = result.rows[0]?.db_now;
  if (value === undefined) throw new Error("Database clock fixture failed.");
  latestDatabaseTimestamp = new Date(value).toISOString();
  return latestDatabaseTimestamp;
}

function scopeTimestamp(): string {
  return latestDatabaseTimestamp;
}

async function seedTenantSecret(
  database: HuleeDatabase,
  tenantId: string,
  secretRef: string,
  purpose = "inbox_v2.source_processing_hmac"
): Promise<void> {
  await database.execute(sql`
    insert into public.tenant_secrets (
      tenant_id, secret_ref, purpose, encrypted_value, encryption_key_ref
    ) values (
      ${tenantId}, ${secretRef}, ${purpose},
      ${`sealed:${digest(secretRef)}`}, 'test-key:src008'
    ) on conflict (tenant_id, secret_ref) do nothing
  `);
}

async function rotateReplayKey(
  repository: InboxV2SourceProcessingRuntimeRepositoryPort,
  tenantId: string,
  generation: string,
  options: {
    expectedActiveGeneration?: string | null;
    secretRef?: string;
    useWindowMilliseconds?: number;
    guaranteeWindowMilliseconds?: number;
    verifyWindowMilliseconds?: number;
  } = {}
) {
  return rotateProcessingKey(
    repository,
    tenantId,
    INBOX_V2_SOURCE_REPLAY_PURPOSE_ID,
    generation,
    options
  );
}

async function rotateProcessingKey(
  repository: InboxV2SourceProcessingRuntimeRepositoryPort,
  tenantId: string,
  purposeId:
    | typeof INBOX_V2_SOURCE_REPLAY_PURPOSE_ID
    | typeof INBOX_V2_SOURCE_CURSOR_PURPOSE_ID,
  generation: string,
  options: {
    expectedActiveGeneration?: string | null;
    secretRef?: string;
    useWindowMilliseconds?: number;
    guaranteeWindowMilliseconds?: number;
    verifyWindowMilliseconds?: number;
  } = {}
) {
  const now = Date.parse(scopeTimestamp());
  return repository.rotateProcessingKeyGeneration(
    inboxV2SourceProcessingKeyRotationInputSchema.parse({
      tenantId,
      purposeId,
      generation,
      secretRef:
        options.secretRef ??
        hmacKeySecretRefFor(tenantId, purposeId, generation),
      activatedAt: timestamp(now - 1_000),
      useUntil: timestamp(now + (options.useWindowMilliseconds ?? 3_600_000)),
      guaranteeUntil: timestamp(
        now + (options.guaranteeWindowMilliseconds ?? 43_200_000)
      ),
      verifyUntil: timestamp(
        now + (options.verifyWindowMilliseconds ?? 86_400_000)
      ),
      expectedActiveGeneration: options.expectedActiveGeneration ?? null
    })
  );
}

async function ensureReplayKey(
  database: HuleeDatabase,
  repository: InboxV2SourceProcessingRuntimeRepositoryPort,
  tenantId: string
): Promise<string> {
  const generation = "states-v1";
  await seedTenantSecret(
    database,
    tenantId,
    hmacKeySecretRefFor(tenantId, INBOX_V2_SOURCE_REPLAY_PURPOSE_ID, generation)
  );
  await databaseNow(database);
  const result = await rotateReplayKey(repository, tenantId, generation);
  if (result.outcome !== "rotated" && result.outcome !== "already_active") {
    throw new Error("Expected replay key fixture to become active.");
  }
  return generation;
}

async function loadKeyVerifyUntil(
  database: HuleeDatabase,
  tenantId: string,
  generation: string
): Promise<string> {
  const result = await database.execute<{ verify_until: Date | string }>(sql`
    select verify_until
      from public.inbox_v2_source_processing_key_generations
     where tenant_id = ${tenantId}
       and purpose_id = ${INBOX_V2_SOURCE_REPLAY_PURPOSE_ID}
       and generation = ${generation}
  `);
  const value = result.rows[0]?.verify_until;
  if (value === undefined) {
    throw new Error(`Expected dedupe key generation ${generation}.`);
  }
  return iso(value);
}

async function makeKeyUnavailableUnsafe(
  database: HuleeDatabase,
  tenantId: string,
  generation: string
): Promise<void> {
  const now = Date.parse(await databaseNow(database));
  await database.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local session_replication_role = 'replica'`
    );
    await transaction.execute(sql`
      update public.inbox_v2_source_processing_key_generations
         set state = 'retired',
             use_until = activated_at + interval '1 millisecond',
             guarantee_not_after = activated_at + interval '2 milliseconds',
             verify_until = activated_at + interval '3 milliseconds',
             retired_at = ${timestamp(now)}, revision = revision + 1,
             updated_at = ${timestamp(now)}
       where tenant_id = ${tenantId}
         and purpose_id = ${INBOX_V2_SOURCE_REPLAY_PURPOSE_ID}
         and generation = ${generation}
    `);
  });
}

async function removeRawPayloadEvidenceUnsafe(
  database: HuleeDatabase,
  tenantId: string,
  rawEventId: string
): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local session_replication_role = 'replica'`
    );
    await transaction.execute(sql`
      delete from public.inbox_v2_source_raw_evidence
       where tenant_id = ${tenantId} and raw_event_id = ${rawEventId}
         and evidence_kind = 'provider_payload'
    `);
    await transaction.execute(sql`
      update public.inbox_v2_source_raw_envelopes
         set provider_payload_evidence_present = false
       where tenant_id = ${tenantId} and raw_event_id = ${rawEventId}
    `);
  });
}

async function bumpWorkRevisionUnsafe(
  database: HuleeDatabase,
  tenantId: string,
  workId: string
): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local session_replication_role = 'replica'`
    );
    await transaction.execute(sql`
      update public.inbox_v2_source_processing_work_heads
         set revision = revision + 1,
             updated_at = updated_at + interval '1 millisecond',
             dead_lettered_at = dead_lettered_at + interval '1 millisecond'
       where tenant_id = ${tenantId} and work_id = ${workId}
    `);
  });
}

async function loadRuntimeAggregate(database: HuleeDatabase, tenantId: string) {
  const result = await database.execute<Record<string, unknown>>(sql`
    select
      count(*) filter (where work.stage = 'raw_ingest')::text
        as raw_ingest_count,
      count(*) filter (where work.stage = 'normalization')::text
        as normalization_count,
      (select count(*)::text
         from public.inbox_v2_source_account_pressure_heads pressure
        where pressure.tenant_id = ${tenantId}) as pressure_count,
      coalesce((select sum(pressure.queued)::text
         from public.inbox_v2_source_account_pressure_heads pressure
        where pressure.tenant_id = ${tenantId}), '0') as queued,
      coalesce((select sum(pressure.in_flight)::text
         from public.inbox_v2_source_account_pressure_heads pressure
        where pressure.tenant_id = ${tenantId}), '0') as in_flight
    from public.inbox_v2_source_processing_work_heads work
    where work.tenant_id = ${tenantId}
  `);
  return result.rows[0]!;
}

async function countProcessingStage(
  database: HuleeDatabase,
  tenantId: string,
  stage: string
): Promise<number> {
  const result = await database.execute<{ count: number }>(sql`
    select count(*)::integer as count
      from public.inbox_v2_source_processing_work_heads work
     where work.tenant_id = ${tenantId}
       and work.stage::text = ${stage}
  `);
  return Number(result.rows[0]?.count ?? 0);
}

async function loadNormalizationCoordinatorTiming(
  database: HuleeDatabase,
  tenantId: string,
  rawEventId: string
): Promise<{
  result_completed_at: string;
  work_completed_at: string;
}> {
  const result = await database.execute<{
    result_completed_at: Date | string;
    work_completed_at: Date | string;
  }>(sql`
    select result.completed_at as result_completed_at,
           work.completed_at as work_completed_at
      from public.inbox_v2_source_normalization_results result
      join public.inbox_v2_source_processing_work_heads work
        on work.tenant_id = result.tenant_id
       and work.raw_event_id = result.raw_event_id
       and work.stage = 'normalization'
     where result.tenant_id = ${tenantId}
       and result.raw_event_id = ${rawEventId}
       and result.outcome = 'normalized'
  `);
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Expected normalization/coordinator timing evidence.");
  }
  return {
    result_completed_at: iso(row.result_completed_at),
    work_completed_at: iso(row.work_completed_at)
  };
}

async function expectDeterministicStageWorkIds(
  database: HuleeDatabase,
  tenantId: string,
  stage: string
): Promise<void> {
  const result = await database.execute<{ mismatch_count: number }>(sql`
    select count(*)::integer as mismatch_count
      from public.inbox_v2_source_processing_work_heads work
     where work.tenant_id = ${tenantId}
       and work.stage::text = ${stage}
       and work.work_id <> 'srcwork:' || encode(sha256(convert_to(
         'source-processing-work:v1|' || work.tenant_id || chr(31) ||
         work.raw_event_id || chr(31) || work.normalized_event_scope_key ||
         chr(31) || work.stage::text, 'UTF8')), 'hex')
  `);
  expect(result.rows[0]?.mismatch_count ?? -1).toBe(0);
}

async function loadPressureTotals(database: HuleeDatabase, tenantId: string) {
  const result = await database.execute<{
    in_flight: string;
    maximum_account_in_flight: string;
  }>(sql`
    select coalesce(sum(in_flight), 0)::text as in_flight,
           coalesce(max(in_flight), 0)::text as maximum_account_in_flight
      from public.inbox_v2_source_account_pressure_heads
     where tenant_id = ${tenantId}
  `);
  return result.rows[0]!;
}

async function loadPressureHeads(database: HuleeDatabase, tenantId: string) {
  const result = await database.execute<{
    source_account_id: string | null;
    state: string;
    in_flight: number;
    queued: number;
    rate_limit_reset_at: Date | string | null;
  }>(sql`
    select source_account_id, state::text as state, in_flight, queued,
           rate_limit_reset_at
      from public.inbox_v2_source_account_pressure_heads
     where tenant_id = ${tenantId}
     order by source_account_scope_key collate "C"
  `);
  return result.rows;
}

async function countRawWithoutNormalization(
  database: HuleeDatabase,
  tenantId: string
): Promise<number> {
  const result = await database.execute<{ count: number }>(sql`
    select count(*)::integer as count
      from public.inbox_v2_source_raw_work_items raw_work
     where raw_work.tenant_id = ${tenantId}
       and not exists (
         select 1
           from public.inbox_v2_source_processing_work_heads work
          where work.tenant_id = raw_work.tenant_id
            and work.raw_event_id = raw_work.raw_event_id
            and work.stage = 'normalization'
       )
  `);
  return Number(result.rows[0]?.count ?? 0);
}

async function countAttempts(database: HuleeDatabase, tenantId: string) {
  const result = await database.execute<{ count: number }>(sql`
    select count(*)::int as count
      from public.inbox_v2_source_processing_attempts
     where tenant_id = ${tenantId}
  `);
  return result.rows[0]?.count ?? 0;
}

async function loadDeadLetterAggregate(
  database: HuleeDatabase,
  tenantId: string,
  deadLetterId: string
) {
  const result = await database.execute<Record<string, unknown>>(sql`
    select work.state::text as work_state,
           attempt.outcome::text as attempt_outcome,
           dead_letter.reason::text as dead_letter_reason,
           dead_letter.diagnostic_code_id,
           dead_letter.retryability::text as diagnostic_retryability,
           dead_letter.diagnostic_correlation_token,
           dead_letter.raw_payload_expires_at,
           dead_letter.allowed_raw_headers_expires_at,
           dead_letter.replay_not_after, dead_letter.expires_at,
           pressure.in_flight::text as in_flight,
           pressure.queued::text as queued
      from public.inbox_v2_source_processing_dead_letters dead_letter
      join public.inbox_v2_source_processing_attempts attempt
        on attempt.tenant_id = dead_letter.tenant_id
       and attempt.attempt_id = dead_letter.attempt_id
      join public.inbox_v2_source_processing_work_heads work
        on work.tenant_id = dead_letter.tenant_id
       and work.work_id = dead_letter.work_id
      join public.inbox_v2_source_account_pressure_heads pressure
        on pressure.tenant_id = work.tenant_id
       and pressure.source_connection_id = work.source_connection_id
       and pressure.source_account_scope_key = work.source_account_scope_key
     where dead_letter.tenant_id = ${tenantId}
       and dead_letter.id = ${deadLetterId}
  `);
  if (result.rows.length !== 1) throw new Error("Expected one DLQ aggregate.");
  return result.rows[0]!;
}

async function loadReplayRetention(
  database: HuleeDatabase,
  tenantId: string,
  replayRequestId: string,
  deadLetterId: string
) {
  const result = await database.execute<{
    replay_expires_at: Date | string;
    dlq_expires_at: Date | string;
  }>(sql`
    select replay.expires_at as replay_expires_at,
           dead_letter.expires_at as dlq_expires_at
      from public.inbox_v2_source_replay_requests replay
      join public.inbox_v2_source_processing_dead_letters dead_letter
        on dead_letter.tenant_id = replay.tenant_id
       and dead_letter.id = replay.dead_letter_id
     where replay.tenant_id = ${tenantId}
       and replay.id = ${replayRequestId}
       and dead_letter.id = ${deadLetterId}
  `);
  if (result.rows.length !== 1) {
    throw new Error("Expected one replay retention snapshot.");
  }
  return result.rows[0]!;
}

async function forceRetentionDeadlines(
  database: HuleeDatabase,
  input: {
    tenantId: string;
    workId: string;
    replayRequestId: string;
    includeHistory: boolean;
  }
): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local session_replication_role = 'replica'`
    );
    await transaction.execute(sql`
      update public.inbox_v2_source_replay_requests
         set replay_not_after = greatest(
               requested_at, available_at, updated_at,
               coalesce(completed_at, updated_at)
             ) + interval '1 millisecond',
             expires_at = greatest(
               requested_at, available_at, updated_at,
               coalesce(completed_at, updated_at)
             ) + interval '2 milliseconds'
       where tenant_id = ${input.tenantId}
         and id = ${input.replayRequestId}
    `);
    if (input.includeHistory) {
      await transaction.execute(sql`
        update public.inbox_v2_source_processing_dead_letters
           set replay_not_after = recorded_at + interval '1 millisecond',
               expires_at = recorded_at + interval '2 milliseconds'
         where tenant_id = ${input.tenantId}
           and work_id = ${input.workId}
      `);
      await transaction.execute(sql`
        update public.inbox_v2_source_processing_attempts
           set expires_at = finished_at + interval '1 millisecond'
         where tenant_id = ${input.tenantId}
           and work_id = ${input.workId}
      `);
    }
  });
  await delay(5);
}

async function forceRawLeaseDue(
  database: HuleeDatabase,
  tenantId: string,
  rawEventId: string
): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local session_replication_role = 'replica'`
    );
    await transaction.execute(sql`
      update public.inbox_v2_source_raw_work_items
         set lease_expires_at = lease_claimed_at + interval '1 millisecond'
       where tenant_id = ${tenantId}
         and raw_event_id = ${rawEventId}
         and state = 'leased'
    `);
  });
  await delay(5);
}

async function deleteReplayAsRetention(
  database: HuleeDatabase,
  tenantId: string,
  replayRequestId: string
): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local role hulee_inbox_v2_retention_owner`
    );
    await transaction.execute(sql`
      delete from public.inbox_v2_source_replay_requests
       where tenant_id = ${tenantId} and id = ${replayRequestId}
    `);
  });
}

async function linkRawAdmissionToTerminalSkeleton(
  database: HuleeDatabase,
  input: {
    tenantId: string;
    rawEventId: string;
    generation: string;
    identityHmacSha256: string;
    terminalSkeletonId: string;
    terminalOutcomeHmacSha256: string;
    terminalAt: string;
    guaranteeUntil: string;
  }
): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.execute(sql`
      update public.inbox_v2_source_raw_admissions admission
         set state = 'skeleton_handed_off',
             terminal_skeleton_id = ${input.terminalSkeletonId},
             terminal_outcome_hmac_sha256 =
               ${input.terminalOutcomeHmacSha256},
             skeleton_handed_off_at = ${input.terminalAt}::timestamptz,
             revision = 2,
             updated_at = ${input.terminalAt}::timestamptz
       where admission.tenant_id = ${input.tenantId}
         and admission.raw_event_id = ${input.rawEventId}
         and admission.key_generation = ${input.generation}
         and admission.identity_hmac_sha256 = ${input.identityHmacSha256}
         and admission.guarantee_until = ${input.guaranteeUntil}::timestamptz
         and admission.revision = 1
    `);
  });
}

async function deleteTerminalSkeletonAsRetention(
  database: HuleeDatabase,
  input: {
    tenantId: string;
    skeletonId: string;
    deleteAdmissionFirst: boolean;
  }
): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local role hulee_inbox_v2_retention_owner`
    );
    if (input.deleteAdmissionFirst) {
      await transaction.execute(sql`
        delete from public.inbox_v2_source_raw_admissions
         where tenant_id = ${input.tenantId}
           and terminal_skeleton_id = ${input.skeletonId}
      `);
    }
    await transaction.execute(sql`
      delete from public.inbox_v2_source_delivery_dedupe_skeletons
       where tenant_id = ${input.tenantId}
         and id = ${input.skeletonId}
    `);
  });
}

async function deleteWorkAsRetention(
  database: HuleeDatabase,
  tenantId: string,
  workId: string
): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local role hulee_inbox_v2_retention_owner`
    );
    await transaction.execute(sql`
      delete from public.inbox_v2_source_processing_work_heads
       where tenant_id = ${tenantId} and work_id = ${workId}
    `);
  });
}

async function deleteSourceProcessingHistoryAsRetention(
  database: HuleeDatabase,
  input: {
    tenantId: string;
    workId: string;
    replayRequestId: string;
    deadLetterId: string;
  }
): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local role hulee_inbox_v2_retention_owner`
    );
    await transaction.execute(sql`
      delete from public.inbox_v2_source_replay_requests
       where tenant_id = ${input.tenantId}
         and id = ${input.replayRequestId}
    `);
    await transaction.execute(sql`
      delete from public.inbox_v2_source_processing_dead_letters
       where tenant_id = ${input.tenantId}
         and id = ${input.deadLetterId}
    `);
    await transaction.execute(sql`
      delete from public.inbox_v2_source_processing_attempts
       where tenant_id = ${input.tenantId}
         and work_id = ${input.workId}
    `);
    await transaction.execute(sql`
      delete from public.inbox_v2_source_processing_work_heads
       where tenant_id = ${input.tenantId}
         and work_id = ${input.workId}
    `);
  });
}

async function loadSourceProcessingRetentionCounts(
  database: HuleeDatabase,
  tenantId: string,
  workId: string,
  replayRequestId: string
) {
  const result = await database.execute<{
    replay_count: string;
    dlq_count: string;
    attempt_count: string;
    work_count: string;
  }>(sql`
    select
      (select count(*)::text
         from public.inbox_v2_source_replay_requests
        where tenant_id = ${tenantId} and id = ${replayRequestId})
        as replay_count,
      (select count(*)::text
         from public.inbox_v2_source_processing_dead_letters
        where tenant_id = ${tenantId} and work_id = ${workId}) as dlq_count,
      (select count(*)::text
         from public.inbox_v2_source_processing_attempts
        where tenant_id = ${tenantId} and work_id = ${workId})
        as attempt_count,
      (select count(*)::text
         from public.inbox_v2_source_processing_work_heads
        where tenant_id = ${tenantId} and work_id = ${workId}) as work_count
  `);
  if (result.rows.length !== 1) {
    throw new Error("Expected source-processing retention counts.");
  }
  return result.rows[0]!;
}

async function loadRuntimeWork(
  database: HuleeDatabase,
  tenantId: string,
  workId: string
) {
  const result = await database.execute<Record<string, unknown>>(sql`
    select work.*, work.stage::text as stage, work.state::text as state,
           work.revision::text as revision,
           work.route_generation::text as route_generation
      from public.inbox_v2_source_processing_work_heads work
     where work.tenant_id = ${tenantId} and work.work_id = ${workId}
  `);
  if (result.rows.length !== 1)
    throw new Error("Expected one runtime work row.");
  return normalizeRow(result.rows[0]!);
}

async function loadRuntimeWorkByRaw(
  database: HuleeDatabase,
  tenantId: string,
  rawEventId: string,
  stage: "raw_ingest" | "normalization"
) {
  const result = await database.execute<Record<string, unknown>>(sql`
    select work.*, work.stage::text as stage, work.state::text as state,
           work.revision::text as revision,
           work.route_generation::text as route_generation
      from public.inbox_v2_source_processing_work_heads work
     where work.tenant_id = ${tenantId}
       and work.raw_event_id = ${rawEventId} and work.stage = ${stage}
  `);
  if (result.rows.length !== 1)
    throw new Error("Expected one scoped work row.");
  return normalizeRow(result.rows[0]!);
}

async function loadRuntimeWorkByScope(
  database: HuleeDatabase,
  scope: InboxV2SourceProcessingScope
) {
  const result = await database.execute<Record<string, unknown>>(sql`
    select work.*, work.stage::text as stage, work.state::text as state,
           work.revision::text as revision
      from public.inbox_v2_source_processing_work_heads work
     where work.tenant_id = ${scope.tenantId}
       and work.raw_event_id = ${scope.rawEventId}
       and work.normalized_event_id is not distinct from ${scope.normalizedEventId}
       and work.stage = ${scope.stage}
       and work.source_connection_id = ${scope.sourceConnectionId}
       and work.source_account_id is not distinct from ${scope.sourceAccountId}
  `);
  if (result.rows.length !== 1) throw new Error("Expected one exact work row.");
  return normalizeRow(result.rows[0]!);
}

async function loadWorkPair(
  database: HuleeDatabase,
  tenantId: string,
  workIds: readonly string[]
) {
  const entries = await Promise.all(
    workIds.map(
      async (workId) =>
        [workId, await loadRuntimeWork(database, tenantId, workId)] as const
    )
  );
  return Object.fromEntries(entries) as Record<string, Record<string, unknown>>;
}

function scopeFromWork(
  work: Record<string, unknown>
): InboxV2SourceProcessingScope {
  return inboxV2SourceProcessingScopeSchema.parse({
    tenantId: String(work.tenant_id),
    sourceConnectionId: String(work.source_connection_id),
    sourceAccountId:
      work.source_account_id === null ? null : String(work.source_account_id),
    rawEventId: String(work.raw_event_id),
    normalizedEventId:
      work.normalized_event_id === null
        ? null
        : String(work.normalized_event_id),
    stage: String(work.stage) as InboxV2SourceProcessingScope["stage"]
  });
}

async function expectDatabaseRejection(
  operation: Promise<unknown>,
  expectedMessage: RegExp
): Promise<void> {
  const failure = await operation.then(
    () => null,
    (error: unknown) => error
  );
  expect(failure).toBeInstanceOf(Error);
  const messages: string[] = [];
  const visited = new Set<unknown>();
  let current: unknown = failure;
  while (
    current !== null &&
    typeof current === "object" &&
    !visited.has(current)
  ) {
    visited.add(current);
    const record = current as Readonly<Record<string, unknown>>;
    if (typeof record.message === "string") messages.push(record.message);
    current = record.cause;
  }
  expect(messages.join("\n")).toMatch(expectedMessage);
}

async function expectDurableReplayDecision(
  database: HuleeDatabase,
  tenantId: string,
  requestId: string,
  expectedState: "denied" | "expired",
  expectedReason: string
): Promise<void> {
  const result = await database.execute<Record<string, unknown>>(sql`
    select state::text as state, rejection_reason::text as rejection_reason,
           diagnostic_code_id, diagnostic_retryability::text
             as diagnostic_retryability,
           diagnostic_correlation_token
      from public.inbox_v2_source_replay_requests
     where tenant_id = ${tenantId} and id = ${requestId}
  `);
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({
    state: expectedState,
    rejection_reason: expectedReason,
    diagnostic_retryability: "not_retryable",
    diagnostic_correlation_token: requestId
  });
}

async function assertMigrationReady(database: HuleeDatabase): Promise<void> {
  const result = await database.execute<Record<string, unknown>>(sql`
    select to_regclass(
             'public.inbox_v2_source_processing_work_heads'
           )::text as work_heads,
           to_regclass(
             'public.inbox_v2_source_processing_dead_letters'
           )::text as dead_letters,
           to_regclass(
             'public.inbox_v2_source_delivery_dedupe_skeletons'
           )::text as dedupe_skeletons,
           to_regclass(
             'public.inbox_v2_source_ingress_cursor_checkpoints'
           )::text as cursor_checkpoints
  `);
  if (
    result.rows.length !== 1 ||
    Object.values(result.rows[0]!).some((value) => value === null)
  ) {
    throw new Error("Inbox V2 SRC-008 migration 0048 is not installed.");
  }
}

async function cleanupFixtures(database: HuleeDatabase): Promise<void> {
  const tables = await database.execute<{ table_name: string }>(sql`
    select distinct columns.table_name
      from information_schema.columns columns
      join information_schema.tables tables
        on tables.table_schema = columns.table_schema
       and tables.table_name = columns.table_name
       and tables.table_type = 'BASE TABLE'
     where columns.table_schema = 'public'
       and columns.column_name = 'tenant_id'
     order by columns.table_name
  `);
  await database.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local session_replication_role = 'replica'`
    );
    for (const { table_name: tableName } of tables.rows) {
      if (!/^[a-z][a-z0-9_]*$/u.test(tableName)) {
        throw new Error(`Unsafe SRC-008 cleanup table: ${tableName}`);
      }
      for (const tenantId of fixtureTenants) {
        const literal = tenantId.replaceAll("'", "''");
        await transaction.execute(
          sql.raw(
            `delete from public.${tableName} where tenant_id = '${literal}'`
          )
        );
      }
    }
    for (const tenantId of fixtureTenants) {
      await transaction.execute(
        sql`delete from public.tenants where id = ${tenantId}`
      );
    }
  });
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function hmac(value: string): `hmac-sha256:${string}` {
  return `hmac-sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function dedupeIdentityHmac(
  identityMaterial: string,
  generation: string
): `hmac-sha256:${string}` {
  return hmac(`src008-dedupe-identity\0${generation}\0${identityMaterial}`);
}

function hmacKeySecretRefFor(
  tenantId: string,
  purposeId: string,
  generation: string
): string {
  const token = createHash("sha256")
    .update(`${purposeId}\0${generation}`)
    .digest("hex")
    .slice(0, 24);
  return `secret:${tenantId}/src008-hmac-${token}`;
}

function cursorValueSecretRefFor(tenantId: string, value: string): string {
  const token = createHash("sha256").update(value).digest("hex").slice(0, 24);
  return `secret:${tenantId}/src008-cursor-${token}`;
}

function timestamp(epochMilliseconds: number): string {
  return new Date(epochMilliseconds).toISOString();
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  throw new TypeError("Expected an integration timestamp.");
}

function incrementRevision(revision: string): string {
  return (BigInt(revision) + 1n).toString();
}

function decrementRevision(revision: string): string {
  const value = BigInt(revision) - 1n;
  return (value < 1n ? 1n : value).toString();
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value
    ])
  );
}
