import { createHash } from "node:crypto";

import {
  INBOX_V2_SECURITY_DENIAL_POLICY,
  inboxV2SecurityDenialAttemptSchema,
  inboxV2SecurityDenialWindowForObservedAt,
  inboxV2TenantIdSchema,
  type InboxV2SecurityDenialAction,
  type InboxV2SecurityDenialAttempt,
  type InboxV2SecurityDenialResult,
  type InboxV2SecurityDenialReviewRecord,
  type InboxV2SecurityDenialReviewType
} from "@hulee/contracts";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import { createSqlInboxV2SecurityDenialRetentionRepository } from "./sql-inbox-v2-security-denial-retention-repository";
import { createSqlInboxV2SecurityDenialRepository } from "./sql-inbox-v2-security-denial-repository";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const tenantPrefix = `tenant:rbac007-${runId}`;

const scenarioTenants = {
  dedupe: tenant("dedupe"),
  flood: tenant("flood"),
  rateLimit: tenant("rate-limit"),
  selfClaim: tenant("self-claim"),
  invalidSelfClaim: tenant("invalid-self-claim"),
  lifecycle: tenant("lifecycle"),
  crossSource: tenant("cross-source"),
  crossTarget: tenant("cross-target"),
  crossPrivacy: tenant("cross-privacy"),
  streamLock: tenant("stream-lock"),
  sinkLock: tenant("sink-lock"),
  pruneLock: tenant("prune-lock"),
  cleanup: tenant("cleanup"),
  pagination: tenant("pagination"),
  directDml: tenant("direct-dml")
} as const;

describePostgres(
  "SQL Inbox V2 bounded security-denial repository (live PostgreSQL)",
  () => {
    let db: HuleeDatabase;

    beforeAll(async () => {
      db = createHuleeDatabase({ poolConfig: { max: 10 } });
      const readiness = await db.execute<Record<string, string | null>>(sql`
        select
          to_regclass(
            'public.inbox_v2_security_denial_window_shards'
          )::text as window_shards,
          to_regclass(
            'public.inbox_v2_security_denial_buckets'
          )::text as buckets,
          to_regclass(
            'public.inbox_v2_security_denial_review_signals'
          )::text as review_signals,
          to_regproc(
            'public.inbox_v2_security_denial_record'
          )::text as record_function,
          to_regproc(
            'public.inbox_v2_security_denial_prune'
          )::text as prune_function
      `);
      const row = readiness.rows[0];
      if (
        row === undefined ||
        Object.values(row).some((value) => value === null)
      ) {
        throw new Error(
          "Inbox V2 security-denial schema/function migration is not applied."
        );
      }
      await seedTenants(db, Object.values(scenarioTenants));
    }, 30_000);

    afterAll(async () => {
      if (!db) return;
      await db.execute(sql`
        delete from tenants where id like ${`${tenantPrefix}%`}
      `);
      await closeHuleeDatabase(db);
    }, 30_000);

    it("deduplicates one guessed-ID signal and retains exact counters in one bucket/review", async () => {
      const repository = createSqlInboxV2SecurityDenialRepository(db);
      const denied = guessedAttempt(scenarioTenants.dedupe, 1, "dedupe");

      await expect(
        repository.record(denied, recordOptions())
      ).resolves.toMatchObject({
        tenantId: scenarioTenants.dedupe,
        disposition: "recorded",
        shardAttemptCount: "1",
        detailOccurrenceCount: "1",
        reviewWrites: [
          {
            reviewType: "guessed_identifier_probe",
            disposition: "candidate_created"
          }
        ]
      });
      await expect(
        repository.record(denied, recordOptions())
      ).resolves.toMatchObject({
        disposition: "deduplicated",
        shardAttemptCount: "2",
        detailOccurrenceCount: "2",
        reviewWrites: [
          {
            reviewType: "guessed_identifier_probe",
            disposition: "candidate_aggregated"
          }
        ]
      });

      expect(await denialStorageCounts(db, scenarioTenants.dedupe)).toEqual({
        windows: "1",
        buckets: "1",
        reviews: "1"
      });
      await expect(
        repository
          .listReviews({
            tenantId: scenarioTenants.dedupe,
            limit: 10,
            status: "open"
          })
          .then(({ items }) => items)
      ).resolves.toMatchObject([
        {
          reviewType: "guessed_identifier_probe",
          aggregationKind: "candidate",
          triggerCount: "2"
        }
      ]);
    });

    it("caps unique guessed-ID flood rows per shard and aggregates detail/review overflow", async () => {
      const repository = createSqlInboxV2SecurityDenialRepository(db);
      const results = [];
      for (let index = 0; index < 20; index += 1) {
        results.push(
          await repository.record(
            guessedAttempt(scenarioTenants.flood, 0, `flood-${index}`),
            recordOptions()
          )
        );
      }

      expect(
        results.filter(({ disposition }) => disposition === "recorded")
      ).toHaveLength(INBOX_V2_SECURITY_DENIAL_POLICY.detailBucketLimitPerShard);
      expect(
        results.filter(
          ({ disposition }) => disposition === "aggregated_overflow"
        )
      ).toHaveLength(4);
      expect(await denialStorageCounts(db, scenarioTenants.flood)).toEqual({
        windows: "1",
        buckets: "16",
        reviews: "6"
      });
      const shard = await loadOnlyDenialShard(db, scenarioTenants.flood);
      expect(shard).toMatchObject({
        attempt_count: "20",
        admitted_detail_bucket_count: 16,
        admitted_review_candidate_count: 4,
        overflow_count: "4"
      });
      expect(
        Number((await denialStorageCounts(db, scenarioTenants.flood)).reviews)
      ).toBeLessThanOrEqual(
        INBOX_V2_SECURITY_DENIAL_POLICY.reviewCandidateLimitPerShard + 12
      );
    });

    it("rate-limits the 601st attempt in one shard and creates one bounded abuse review", async () => {
      const repository = createSqlInboxV2SecurityDenialRepository(db);
      const denied = guessedAttempt(scenarioTenants.rateLimit, 7, "rate-limit");
      let admitted: InboxV2SecurityDenialResult | undefined;
      for (
        let count = 1;
        count <= INBOX_V2_SECURITY_DENIAL_POLICY.attemptRateLimitPerShard;
        count += 1
      ) {
        admitted = await repository.record(denied, recordOptions());
      }
      expect(admitted).toMatchObject({
        disposition: "deduplicated",
        shardAttemptCount: "600",
        detailOccurrenceCount: "600",
        overflowCount: "0"
      });

      const limited = await repository.record(denied, recordOptions());
      expect(limited).toMatchObject({
        disposition: "rate_limited",
        shardAttemptCount: "601",
        detailOccurrenceCount: null,
        overflowCount: "1"
      });
      expect(limited.reviewWrites).toEqual(
        expect.arrayContaining([
          {
            reviewType: "guessed_identifier_probe",
            disposition: "overflow_created"
          },
          {
            reviewType: "denial_rate_exceeded",
            disposition: "overflow_created"
          }
        ])
      );

      expect(await denialStorageCounts(db, scenarioTenants.rateLimit)).toEqual({
        windows: "1",
        buckets: "1",
        reviews: "3"
      });
      await expect(
        repository
          .listReviews({
            tenantId: scenarioTenants.rateLimit,
            limit: 10,
            reviewType: "denial_rate_exceeded"
          })
          .then(({ items }) => items)
      ).resolves.toMatchObject([
        {
          alertType: "abuse_threshold_alert",
          aggregationKind: "overflow",
          triggerCount: "1",
          risk: "high"
        }
      ]);
    }, 120_000);

    it("aggregates repeated manual self-claim into one high-risk review candidate", async () => {
      const repository = createSqlInboxV2SecurityDenialRepository(db);
      const denied = selfClaimAttempt(scenarioTenants.selfClaim);

      const first = await repository.record(denied, recordOptions());
      const second = await repository.record(denied, recordOptions());
      expect(first.reviewWrites).toEqual([
        {
          reviewType: "manual_self_claim",
          disposition: "candidate_created"
        }
      ]);
      expect(second.reviewWrites).toEqual([
        {
          reviewType: "manual_self_claim",
          disposition: "candidate_aggregated"
        }
      ]);
      await expect(
        repository
          .listReviews({
            tenantId: scenarioTenants.selfClaim,
            limit: 10,
            reviewType: "manual_self_claim"
          })
          .then(({ items }) => items)
      ).resolves.toMatchObject([
        {
          alertType: "identity_claim_review",
          risk: "high",
          aggregationKind: "candidate",
          triggerCount: "2",
          candidateRef: internalRef("self-claim")
        }
      ]);
    });

    it("rejects manual self-claim outside its exact identity denial binding", async () => {
      const invalidBindings = [
        {
          action: "privacy.deletion.execute",
          publicErrorClass: "identity_claim_self_forbidden",
          risk: "critical"
        },
        {
          action: "identity.claim",
          publicErrorClass: "permission_denied",
          risk: "high"
        }
      ] as const;

      for (const [index, invalid] of invalidBindings.entries()) {
        await expectDatabaseError(
          () =>
            db.execute(sql`
              select *
                from public.inbox_v2_security_denial_record(
                  ${scenarioTenants.invalidSelfClaim},
                  ${invalid.action}::public.inbox_v2_security_denial_action,
                  'employee'::public.inbox_v2_security_denial_principal_class,
                  'security-denial-key:0123456789abcdef',
                  ${fingerprint(8 + index, `invalid-self:${index}:actor`)},
                  ${fingerprint(12 + index, `invalid-self:${index}:dedupe`)},
                  ${observationReceipt(`invalid-self:${index}`)},
                  'manual_self_claim'::public.inbox_v2_security_denial_kind,
                  ${invalid.publicErrorClass}::public.inbox_v2_security_denial_public_error_class,
                  ${invalid.risk}::public.inbox_v2_security_denial_risk,
                  'manual_self_claim'::public.inbox_v2_security_denial_review_type,
                  'identity_claim_review'::public.inbox_v2_security_denial_alert_type,
                  null,
                  ${INBOX_V2_SECURITY_DENIAL_POLICY.policyId},
                  ${INBOX_V2_SECURITY_DENIAL_POLICY.windowSeconds},
                  ${INBOX_V2_SECURITY_DENIAL_POLICY.retentionSeconds},
                  ${INBOX_V2_SECURITY_DENIAL_POLICY.shardCount},
                  ${INBOX_V2_SECURITY_DENIAL_POLICY.detailBucketLimitPerShard},
                  ${INBOX_V2_SECURITY_DENIAL_POLICY.reviewCandidateLimitPerShard},
                  ${INBOX_V2_SECURITY_DENIAL_POLICY.attemptRateLimitPerShard},
                  ${INBOX_V2_SECURITY_DENIAL_POLICY.lockTimeoutMilliseconds},
                  ${INBOX_V2_SECURITY_DENIAL_POLICY.statementTimeoutMilliseconds}
                )
            `),
          "22023",
          "inbox_v2.security_denial_manual_self_claim_invalid"
        );
      }
      expect(
        await denialStorageCounts(db, scenarioTenants.invalidSelfClaim)
      ).toEqual({ windows: "0", buckets: "0", reviews: "0" });
    });

    it("persists the complete action-specific lifecycle denial review matrix", async () => {
      const matrix: readonly [
        InboxV2SecurityDenialAction,
        InboxV2SecurityDenialReviewType,
        "high" | "critical"
      ][] = [
        ["privacy.hold.issue", "privacy_hold_issue_denied", "high"],
        ["privacy.hold.release", "privacy_hold_release_denied", "high"],
        [
          "privacy.subject_evidence.view",
          "privacy_evidence_access_denied",
          "high"
        ],
        ["privacy.tenant_export", "tenant_export_denied", "high"],
        ["privacy.deletion.preview", "destructive_preview_denied", "high"],
        ["privacy.deletion.approve", "destructive_approval_denied", "high"],
        ["privacy.deletion.execute", "destructive_execution_denied", "critical"]
      ];
      const repository = createSqlInboxV2SecurityDenialRepository(db);

      for (const [index, [action, reviewType, risk]] of matrix.entries()) {
        const result = await repository.record(
          lifecycleAttempt({
            tenantId: scenarioTenants.lifecycle,
            shardNo: index,
            action,
            reviewType,
            risk
          }),
          recordOptions()
        );
        expect(result.reviewWrites).toEqual([
          { reviewType, disposition: "candidate_created" }
        ]);
      }

      const { items: reviews } = await repository.listReviews({
        tenantId: scenarioTenants.lifecycle,
        limit: 20,
        status: "open"
      });
      expect(reviews.map(({ reviewType }) => reviewType).sort()).toEqual(
        matrix.map(([, reviewType]) => reviewType).sort()
      );
      expect(
        reviews.every(({ alertType }) => alertType === "privacy_control_review")
      ).toBe(true);
    });

    it("binds cross-tenant probes only to the authenticated source tenant", async () => {
      const repository = createSqlInboxV2SecurityDenialRepository(db);
      await repository.record(
        crossTenantAttempt(scenarioTenants.crossSource),
        recordOptions()
      );

      await expect(
        repository
          .listReviews({
            tenantId: scenarioTenants.crossSource,
            limit: 10
          })
          .then(({ items }) => items)
      ).resolves.toMatchObject([
        {
          tenantId: scenarioTenants.crossSource,
          reviewType: "cross_tenant_probe",
          candidateRef: null
        }
      ]);
      await expect(
        repository
          .listReviews({
            tenantId: scenarioTenants.crossTarget,
            limit: 10
          })
          .then(({ items }) => items)
      ).resolves.toEqual([]);
      expect(
        await denialStorageCounts(db, scenarioTenants.crossTarget)
      ).toEqual({ windows: "0", buckets: "0", reviews: "0" });
    });

    it("keeps privacy review precedence for a cross-tenant denial", async () => {
      const repository = createSqlInboxV2SecurityDenialRepository(db);

      const result = await repository.record(
        crossTenantPrivacyAttempt(scenarioTenants.crossPrivacy),
        recordOptions()
      );
      const expectedWindow = inboxV2SecurityDenialWindowForObservedAt(
        result.observedAt
      );

      expect(result).toMatchObject({
        disposition: "recorded",
        windowStartedAt: expectedWindow.windowStartedAt,
        expiresAt: expectedWindow.expiresAt,
        reviewWrites: [
          {
            reviewType: "privacy_hold_release_denied",
            disposition: "candidate_created"
          }
        ]
      });
      await expect(
        repository
          .listReviews({
            tenantId: scenarioTenants.crossPrivacy,
            limit: 10
          })
          .then(({ items }) => items)
      ).resolves.toMatchObject([
        {
          reviewType: "privacy_hold_release_denied",
          alertType: "privacy_control_review",
          candidateRef: null,
          risk: "critical"
        }
      ]);
    });

    it("does not wait for or mutate a held Inbox stream head and creates no event/outbox artifacts", async () => {
      const currentTenant = scenarioTenants.streamLock;
      const createdAt = new Date();
      await db.execute(sql`
        insert into inbox_v2_tenant_stream_heads (
          tenant_id, stream_epoch, last_position, min_retained_position,
          revision, created_at, updated_at
        ) values (
          ${currentTenant}, ${`stream-epoch-${runId}`}, 0, 0, 1,
          ${createdAt}, ${createdAt}
        )
      `);
      const before = await amplificationCounts(db, currentTenant);
      const client = await db.$client.connect();
      try {
        await client.query("begin");
        await client.query(
          "select tenant_id from inbox_v2_tenant_stream_heads where tenant_id = $1 for update",
          [currentTenant]
        );

        const startedAt = Date.now();
        await expect(
          createSqlInboxV2SecurityDenialRepository(db).record(
            guessedAttempt(currentTenant, 2, "stream-lock"),
            recordOptions()
          )
        ).resolves.toMatchObject({ disposition: "recorded" });
        expect(Date.now() - startedAt).toBeLessThan(1_000);
      } finally {
        await client.query("rollback");
        client.release();
      }
      expect(await amplificationCounts(db, currentTenant)).toEqual(before);
      expect(await denialStorageCounts(db, currentTenant)).toEqual({
        windows: "1",
        buckets: "1",
        reviews: "1"
      });
    });

    it("surfaces a bounded denial-shard lock failure and remains usable after release", async () => {
      const currentTenant = scenarioTenants.sinkLock;
      const repository = createSqlInboxV2SecurityDenialRepository(db);
      const denied = guessedAttempt(currentTenant, 3, "sink-lock");
      const first = await repository.record(denied, recordOptions());
      const client = await db.$client.connect();
      try {
        await client.query("begin");
        await client.query(
          `select tenant_id
             from inbox_v2_security_denial_window_shards
            where tenant_id = $1 and window_started_at = $2 and shard_no = $3
            for update`,
          [currentTenant, first.windowStartedAt, first.shardNo]
        );
        const startedAt = Date.now();
        await expect(
          repository.record(denied, recordOptions())
        ).rejects.toThrow();
        expect(Date.now() - startedAt).toBeLessThan(1_000);
      } finally {
        await client.query("rollback");
        client.release();
      }
      await expect(
        repository.record(denied, recordOptions())
      ).resolves.toMatchObject({
        disposition: "deduplicated",
        detailOccurrenceCount: "2"
      });
    });

    it("traverses more than one hundred reviews through one immutable high-water despite concurrent updates/inserts", async () => {
      const currentTenant = scenarioTenants.pagination;
      const repository = createSqlInboxV2SecurityDenialRepository(db);
      for (
        let shardNo = 0;
        shardNo < INBOX_V2_SECURITY_DENIAL_POLICY.shardCount;
        shardNo += 1
      ) {
        for (let candidateNo = 0; candidateNo < 5; candidateNo += 1) {
          await repository.record(
            guessedAttempt(
              currentTenant,
              shardNo,
              `page-${shardNo}-guessed-${candidateNo}`
            ),
            recordOptions()
          );
        }
        await repository.record(
          lifecycleAttempt({
            tenantId: currentTenant,
            shardNo,
            action: "privacy.hold.issue",
            reviewType: "privacy_hold_issue_denied",
            risk: "high"
          }),
          recordOptions()
        );
        await repository.record(
          lifecycleAttempt({
            tenantId: currentTenant,
            shardNo,
            action: "privacy.hold.release",
            reviewType: "privacy_hold_release_denied",
            risk: "high"
          }),
          recordOptions()
        );
      }

      const firstPage = await repository.listReviews({
        tenantId: currentTenant,
        limit: 25,
        status: "open"
      });
      expect(firstPage.items).toHaveLength(25);
      expect(firstPage.nextCursor).not.toBeNull();

      await repository.record(
        guessedAttempt(currentTenant, 0, "page-0-guessed-0"),
        recordOptions()
      );
      await repository.record(
        lifecycleAttempt({
          tenantId: currentTenant,
          shardNo: 0,
          action: "privacy.subject_evidence.view",
          reviewType: "privacy_evidence_access_denied",
          risk: "high"
        }),
        recordOptions()
      );

      const seen = new Set(firstPage.items.map(reviewIdentity));
      let cursor = firstPage.nextCursor;
      while (cursor !== null) {
        const page = await repository.listReviews({
          tenantId: currentTenant,
          limit: 25,
          status: "open",
          cursor
        });
        for (const review of page.items) {
          expect(seen.has(reviewIdentity(review))).toBe(false);
          seen.add(reviewIdentity(review));
        }
        cursor = page.nextCursor;
      }
      expect(seen.size).toBe(112);

      const latest = await repository.listReviews({
        tenantId: currentTenant,
        limit: 100,
        status: "open",
        reviewType: "privacy_evidence_access_denied"
      });
      expect(latest.items).toHaveLength(1);
    }, 120_000);

    it("rejects direct-DML detail/review overflow, identity rewrites and non-current windows", async () => {
      const currentTenant = scenarioTenants.directDml;
      const repository = createSqlInboxV2SecurityDenialRepository(db);
      const attempts = [];
      let boundaryResult: InboxV2SecurityDenialResult | undefined;
      for (let index = 0; index < 5; index += 1) {
        const denied = guessedAttempt(currentTenant, 9, `direct-dml-${index}`);
        attempts.push(denied);
        boundaryResult = await repository.record(denied, recordOptions());
      }
      const window = boundaryResult!;
      const fifth = attempts[4]!;

      await expectDatabaseError(
        () =>
          db.execute(sql`
            insert into public.inbox_v2_security_denial_review_signals (
              tenant_id, window_started_at, shard_no, review_type,
              aggregation_kind, candidate_fingerprint, alert_type,
              candidate_ref, risk, status, trigger_count, window_ended_at,
              first_seen_at, last_seen_at, expires_at, created_at, updated_at
            ) values (
              ${currentTenant}, ${window.windowStartedAt}::timestamptz,
              ${window.shardNo}, 'guessed_identifier_probe', 'candidate',
              ${fifth.dedupeFingerprint}, 'security_probe_review', null,
              'high', 'open', 1, ${window.windowEndedAt}::timestamptz,
              ${window.observedAt}::timestamptz,
              ${window.observedAt}::timestamptz,
              ${window.expiresAt}::timestamptz,
              clock_timestamp(), clock_timestamp()
            )
          `),
        "23514",
        "inbox_v2.security_denial_review_budget_exceeded"
      );

      for (let index = 5; index < 16; index += 1) {
        const denied = guessedAttempt(currentTenant, 9, `direct-dml-${index}`);
        attempts.push(denied);
        boundaryResult = await repository.record(denied, recordOptions());
      }
      const seventeenth = guessedAttempt(currentTenant, 9, "direct-dml-16");
      await expectDatabaseError(
        () =>
          db.execute(sql`
            insert into public.inbox_v2_security_denial_buckets (
              tenant_id, window_started_at, shard_no, dedupe_fingerprint,
              window_ended_at, expires_at, action, principal_class,
              fingerprint_key_epoch, actor_fingerprint, denial_kind,
              public_error_class, risk, occurrence_count, first_seen_at,
              last_seen_at, created_at, updated_at
            ) values (
              ${currentTenant}, ${boundaryResult!.windowStartedAt}::timestamptz,
              ${boundaryResult!.shardNo}, ${seventeenth.dedupeFingerprint},
              ${boundaryResult!.windowEndedAt}::timestamptz,
              ${boundaryResult!.expiresAt}::timestamptz, 'resource.read',
              'employee', ${seventeenth.fingerprintKeyEpoch},
              ${seventeenth.actorFingerprint}, 'unknown_or_hidden_resource',
              'not_found', 'high', 1,
              ${boundaryResult!.observedAt}::timestamptz,
              ${boundaryResult!.observedAt}::timestamptz,
              clock_timestamp(), clock_timestamp()
            )
          `),
        "23514",
        "inbox_v2.security_denial_detail_budget_exceeded"
      );

      await expectDatabaseErrorCode(
        () =>
          db.execute(sql`
            update public.inbox_v2_security_denial_review_signals
               set review_sequence = review_sequence + 1000000
             where tenant_id = ${currentTenant}
               and aggregation_kind = 'candidate'
          `),
        "428C9"
      );
      await expectDatabaseError(
        () =>
          db.execute(sql`
            update public.inbox_v2_security_denial_window_shards
               set admitted_detail_bucket_count = 15
             where tenant_id = ${currentTenant}
               and window_started_at = ${boundaryResult!.windowStartedAt}::timestamptz
               and shard_no = ${boundaryResult!.shardNo}
          `),
        "23514",
        "inbox_v2.security_denial_cardinality_invalid"
      );
      await expectDatabaseError(
        () =>
          db.execute(sql`
            insert into public.inbox_v2_security_denial_window_shards (
              tenant_id, window_started_at, shard_no, window_ended_at,
              policy_id, attempt_count, admitted_detail_bucket_count,
              admitted_review_candidate_count, overflow_count,
              counter_saturated, first_seen_at, last_seen_at, expires_at,
              created_at, updated_at
            )
            select ${currentTenant}, future_start, 0,
                   future_start + interval '1 hour',
                   ${INBOX_V2_SECURITY_DENIAL_POLICY.policyId},
                   1, 0, 0, 0, false, future_start, future_start,
                   future_start + interval '30 days',
                   clock_timestamp(), clock_timestamp()
              from (
                select date_bin(
                  interval '1 hour', clock_timestamp(),
                  timestamptz '1970-01-01 00:00:00+00'
                ) + interval '2 hours' as future_start
              ) future
          `),
        "23514",
        "inbox_v2.security_denial_window_clock_invalid"
      );
    }, 120_000);

    it("uses only the DB clock for prune eligibility and cannot delete current evidence early", async () => {
      const currentTenant = scenarioTenants.cleanup;
      const repository = createSqlInboxV2SecurityDenialRepository(db);
      const retentionRepository =
        createSqlInboxV2SecurityDenialRetentionRepository(db);
      await repository.record(
        guessedAttempt(currentTenant, 4, "cleanup-a"),
        recordOptions()
      );
      await repository.record(
        guessedAttempt(currentTenant, 5, "cleanup-b"),
        recordOptions()
      );
      expect(await denialStorageCounts(db, currentTenant)).toEqual({
        windows: "2",
        buckets: "2",
        reviews: "2"
      });

      await expect(
        retentionRepository.prune({
          tenantId: currentTenant,
          batchSize: 1
        })
      ).resolves.toEqual({ deletedWindowCount: "0" });
      expect(await denialStorageCounts(db, currentTenant)).toEqual({
        windows: "2",
        buckets: "2",
        reviews: "2"
      });
    });

    it("cancels a table-locked prune through the dedicated bounded retention pool", async () => {
      const retentionDb = createHuleeDatabase({
        poolConfig: {
          max: 1,
          connectionTimeoutMillis: 1_000,
          statement_timeout:
            INBOX_V2_SECURITY_DENIAL_POLICY.statementTimeoutMilliseconds,
          lock_timeout: INBOX_V2_SECURITY_DENIAL_POLICY.lockTimeoutMilliseconds,
          query_timeout:
            INBOX_V2_SECURITY_DENIAL_POLICY.statementTimeoutMilliseconds + 500,
          application_name: "hulee-test-security-denial-retention"
        }
      });
      const lockClient = await db.$client.connect();
      try {
        const settings = await retentionDb.execute<{
          lock_timeout: string;
          statement_timeout: string;
        }>(sql`
          select
            current_setting('lock_timeout') as lock_timeout,
            current_setting('statement_timeout') as statement_timeout
        `);
        expect(settings.rows).toEqual([
          {
            lock_timeout: `${INBOX_V2_SECURITY_DENIAL_POLICY.lockTimeoutMilliseconds}ms`,
            statement_timeout: `${INBOX_V2_SECURITY_DENIAL_POLICY.statementTimeoutMilliseconds}ms`
          }
        ]);

        await lockClient.query("begin");
        await lockClient.query(
          "lock table public.inbox_v2_security_denial_window_shards in access exclusive mode"
        );
        const startedAt = Date.now();
        let failure: unknown;
        try {
          await createSqlInboxV2SecurityDenialRetentionRepository(
            retentionDb
          ).prune({
            tenantId: scenarioTenants.pruneLock,
            batchSize: 1
          });
        } catch (error) {
          failure = error;
        }
        const elapsedMilliseconds = Date.now() - startedAt;

        expect(findDatabaseError(failure)?.code).toBe("55P03");
        expect(elapsedMilliseconds).toBeLessThan(1_000);
      } finally {
        await lockClient.query("rollback").catch(() => {});
        lockClient.release();
        await closeHuleeDatabase(retentionDb);
      }
    });
  }
);

function guessedAttempt(
  tenantId: ReturnType<typeof tenant>,
  shardNo: number,
  unique: string
): InboxV2SecurityDenialAttempt {
  return parseAttempt({
    tenantId,
    action: "resource.read",
    principalClass: "employee",
    fingerprintKeyEpoch: "security-denial-key:0123456789abcdef",
    actorFingerprint: fingerprint(shardNo, `${unique}:actor`),
    dedupeFingerprint: fingerprint(
      (shardNo + 8) % INBOX_V2_SECURITY_DENIAL_POLICY.shardCount,
      `${unique}:dedupe`
    ),
    observationReceipt: observationReceipt(unique),
    denialKind: "unknown_or_hidden_resource",
    publicErrorClass: "not_found",
    risk: "high",
    reviewSignal: {
      reviewType: "guessed_identifier_probe",
      alertType: "security_probe_review",
      candidateRef: null
    },
    policy: INBOX_V2_SECURITY_DENIAL_POLICY
  });
}

function selfClaimAttempt(
  tenantId: ReturnType<typeof tenant>
): InboxV2SecurityDenialAttempt {
  return parseAttempt({
    ...guessedAttempt(tenantId, 1, "self-claim"),
    action: "identity.claim",
    denialKind: "manual_self_claim",
    publicErrorClass: "identity_claim_self_forbidden",
    reviewSignal: {
      reviewType: "manual_self_claim",
      alertType: "identity_claim_review",
      candidateRef: internalRef("self-claim")
    }
  });
}

function lifecycleAttempt(input: {
  tenantId: ReturnType<typeof tenant>;
  shardNo: number;
  action: InboxV2SecurityDenialAction;
  reviewType: InboxV2SecurityDenialReviewType;
  risk: "high" | "critical";
}): InboxV2SecurityDenialAttempt {
  return parseAttempt({
    ...guessedAttempt(
      input.tenantId,
      input.shardNo,
      `lifecycle:${input.action}`
    ),
    action: input.action,
    denialKind: "missing_permission",
    publicErrorClass: "permission_denied",
    risk: input.risk,
    reviewSignal: {
      reviewType: input.reviewType,
      alertType: "privacy_control_review",
      candidateRef: null
    }
  });
}

function crossTenantAttempt(
  tenantId: ReturnType<typeof tenant>
): InboxV2SecurityDenialAttempt {
  return parseAttempt({
    ...guessedAttempt(tenantId, 6, "cross-tenant"),
    denialKind: "cross_tenant_probe",
    risk: "critical",
    reviewSignal: {
      reviewType: "cross_tenant_probe",
      alertType: "security_probe_review",
      candidateRef: null
    }
  });
}

function crossTenantPrivacyAttempt(
  tenantId: ReturnType<typeof tenant>
): InboxV2SecurityDenialAttempt {
  return parseAttempt({
    ...guessedAttempt(tenantId, 7, "cross-tenant-privacy"),
    action: "privacy.hold.release",
    denialKind: "cross_tenant_probe",
    risk: "critical",
    reviewSignal: {
      reviewType: "privacy_hold_release_denied",
      alertType: "privacy_control_review",
      candidateRef: null
    }
  });
}

function parseAttempt(input: unknown): InboxV2SecurityDenialAttempt {
  return inboxV2SecurityDenialAttemptSchema.parse(input);
}

function fingerprint(shardNo: number, unique: string): string {
  const shardPrefix = shardNo.toString(16).padStart(8, "0");
  const suffix = createHash("sha256")
    .update(`${runId}:${unique}`)
    .digest("hex")
    .slice(0, 56);
  return `hmac-sha256:${shardPrefix}${suffix}`;
}

function internalRef(value: string): string {
  return `internal-ref:${createHash("sha256").update(value).digest("hex")}`;
}

function observationReceipt(value: string): string {
  return `security-denial-observation:${createHash("sha256")
    .update(`${runId}:${value}:observation`)
    .digest("hex")}`;
}

function reviewIdentity(review: InboxV2SecurityDenialReviewRecord): string {
  return [
    review.windowStartedAt,
    review.shardNo,
    review.reviewType,
    review.aggregationKind,
    review.candidateFingerprint ?? "overflow"
  ].join("|");
}

function tenant(suffix: string) {
  return inboxV2TenantIdSchema.parse(`${tenantPrefix}-${suffix}`);
}

function recordOptions() {
  return { signal: new AbortController().signal };
}

async function expectDatabaseError(
  work: () => Promise<unknown>,
  expectedCode: string,
  expectedMessage: string
): Promise<void> {
  let observed: unknown;
  try {
    await work();
  } catch (error) {
    observed = error;
  }
  const databaseError = findDatabaseError(observed);
  expect(databaseError?.code).toBe(expectedCode);
  expect(databaseError?.message).toBe(expectedMessage);
}

async function expectDatabaseErrorCode(
  operation: () => Promise<unknown>,
  expectedCode: string
): Promise<void> {
  let observed: unknown;
  try {
    await operation();
  } catch (error) {
    observed = error;
  }
  expect(findDatabaseError(observed)?.code).toBe(expectedCode);
}

function findDatabaseError(
  error: unknown
): { code: string; message: string } | null {
  let current = error;
  for (let depth = 0; depth < 10 && current; depth += 1) {
    if (
      typeof current === "object" &&
      "code" in current &&
      typeof current.code === "string" &&
      "message" in current &&
      typeof current.message === "string"
    ) {
      return { code: current.code, message: current.message };
    }
    if (typeof current !== "object" || !("cause" in current)) break;
    const cause = current.cause;
    if (!cause || cause === current) break;
    current = cause;
  }
  return null;
}

async function seedTenants(
  db: HuleeDatabase,
  tenantIds: readonly string[]
): Promise<void> {
  for (const tenantId of tenantIds) {
    await db.execute(sql`
      insert into tenants (id, slug, display_name, created_at, updated_at)
      values (
        ${tenantId},
        ${tenantId.replaceAll(":", "-")},
        ${tenantId},
        clock_timestamp(),
        clock_timestamp()
      )
      on conflict (id) do nothing
    `);
  }
}

async function denialStorageCounts(db: HuleeDatabase, tenantId: string) {
  const result = await db.execute<{
    windows: string;
    buckets: string;
    reviews: string;
  }>(sql`
    select
      (select count(*)::text
         from inbox_v2_security_denial_window_shards
        where tenant_id = ${tenantId}) as windows,
      (select count(*)::text
         from inbox_v2_security_denial_buckets
        where tenant_id = ${tenantId}) as buckets,
      (select count(*)::text
         from inbox_v2_security_denial_review_signals
        where tenant_id = ${tenantId}) as reviews
  `);
  return result.rows[0]!;
}

async function loadOnlyDenialShard(db: HuleeDatabase, tenantId: string) {
  const result = await db.execute<Record<string, unknown>>(sql`
    select attempt_count::text as attempt_count,
           admitted_detail_bucket_count,
           admitted_review_candidate_count,
           overflow_count::text as overflow_count
      from inbox_v2_security_denial_window_shards
     where tenant_id = ${tenantId}
  `);
  expect(result.rows).toHaveLength(1);
  return result.rows[0]!;
}

async function amplificationCounts(db: HuleeDatabase, tenantId: string) {
  const result = await db.execute<Record<string, string>>(sql`
    select
      (select count(*)::text from inbox_v2_tenant_stream_heads
        where tenant_id = ${tenantId}) as stream_heads,
      (select coalesce(max(last_position), 0)::text
         from inbox_v2_tenant_stream_heads
        where tenant_id = ${tenantId}) as stream_position,
      (select count(*)::text from inbox_v2_tenant_stream_commits
        where tenant_id = ${tenantId}) as stream_commits,
      (select count(*)::text from inbox_v2_tenant_stream_changes
        where tenant_id = ${tenantId}) as stream_changes,
      (select count(*)::text from inbox_v2_domain_events
        where tenant_id = ${tenantId}) as domain_events,
      (select count(*)::text from inbox_v2_outbox_intents
        where tenant_id = ${tenantId}) as outbox_intents,
      (select count(*)::text from inbox_v2_auth_audit_events
        where tenant_id = ${tenantId}) as auth_audits,
      (select count(*)::text from event_store
        where tenant_id = ${tenantId}) as legacy_events,
      (select count(*)::text from outbox
        where tenant_id = ${tenantId}) as legacy_outbox
  `);
  return result.rows[0]!;
}
