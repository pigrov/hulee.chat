import {
  INBOX_V2_SECURITY_DENIAL_POLICY,
  inboxV2SecurityDenialAttemptSchema,
  inboxV2SecurityDenialShardForActorFingerprint,
  inboxV2TenantIdSchema,
  type InboxV2SecurityDenialAttempt
} from "@hulee/contracts";
import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  InboxV2SecurityDenialPersistenceInvariantError,
  buildListInboxV2SecurityDenialReviewsSql,
  buildRecordInboxV2SecurityDenialSql,
  createSqlInboxV2SecurityDenialRepository
} from "./sql-inbox-v2-security-denial-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const tenantId = inboxV2TenantIdSchema.parse("tenant:security-denial-db");
const otherTenantId = inboxV2TenantIdSchema.parse(
  "tenant:security-denial-db-other"
);
const occurredAt = "2026-07-15T10:10:00.000Z";
const observationReceipt = `security-denial-observation:${"c".repeat(64)}`;
const windowStartedAt = "2026-07-15T10:00:00.000Z";
const windowEndedAt = "2026-07-15T11:00:00.000Z";
const expiresAt = "2026-08-14T10:00:00.000Z";
const actorFingerprint = `hmac-sha256:${"a".repeat(64)}`;
const dedupeFingerprint = `hmac-sha256:${"b".repeat(64)}`;
const shardNo = inboxV2SecurityDenialShardForActorFingerprint(actorFingerprint);

function attempt(
  overrides: Partial<InboxV2SecurityDenialAttempt> = {}
): InboxV2SecurityDenialAttempt {
  return inboxV2SecurityDenialAttemptSchema.parse({
    tenantId,
    action: "resource.read",
    principalClass: "employee",
    fingerprintKeyEpoch: "security-denial-key:0123456789abcdef",
    actorFingerprint,
    dedupeFingerprint,
    observationReceipt,
    denialKind: "unknown_or_hidden_resource",
    publicErrorClass: "not_found",
    risk: "high",
    reviewSignal: {
      reviewType: "guessed_identifier_probe",
      alertType: "security_probe_review",
      candidateRef: null
    },
    policy: INBOX_V2_SECURITY_DENIAL_POLICY,
    ...overrides
  });
}

function recordRow(overrides: Record<string, unknown> = {}) {
  return {
    observation_receipt: observationReceipt,
    observed_at: new Date(occurredAt),
    disposition: "recorded",
    shard_no: shardNo,
    window_started_at: new Date(windowStartedAt),
    window_ended_at: new Date(windowEndedAt),
    expires_at: new Date(expiresAt),
    shard_attempt_count: "9007199254740993",
    detail_occurrence_count: "1",
    admitted_detail_bucket_count: 1,
    overflow_count: "0",
    counter_saturated: false,
    review_types: ["guessed_identifier_probe"],
    review_dispositions: ["candidate_created"],
    ...overrides
  };
}

function reviewRow(overrides: Record<string, unknown> = {}) {
  return {
    tenant_id: tenantId,
    review_sequence: "41",
    window_started_at: new Date(windowStartedAt),
    window_ended_at: new Date(windowEndedAt),
    shard_no: shardNo,
    review_type: "guessed_identifier_probe",
    alert_type: "security_probe_review",
    aggregation_kind: "candidate",
    aggregation_key: dedupeFingerprint,
    candidate_fingerprint: dedupeFingerprint,
    candidate_ref: null,
    risk: "high",
    status: "open",
    trigger_count: "9007199254740993",
    first_seen_at: new Date(occurredAt),
    last_seen_at: new Date("2026-07-15T10:11:00.000Z"),
    expires_at: new Date(expiresAt),
    snapshot_high_water: "42",
    ...overrides
  };
}

describe("SQL Inbox V2 bounded security-denial repository", () => {
  it("records one strict attempt through only the dedicated function and keeps bigint counters exact", async () => {
    const executor = queuedExecutor([[recordRow()]]);
    const repository = createSqlInboxV2SecurityDenialRepository(executor);
    expect(repository).not.toHaveProperty("prune");

    await expect(
      repository.record(attempt(), recordOptions())
    ).resolves.toEqual({
      tenantId,
      observationReceipt,
      observedAt: occurredAt,
      disposition: "recorded",
      shardNo,
      windowStartedAt,
      windowEndedAt,
      expiresAt,
      shardAttemptCount: "9007199254740993",
      detailOccurrenceCount: "1",
      admittedDetailBucketCount: 1,
      overflowCount: "0",
      counterSaturated: false,
      reviewWrites: [
        {
          reviewType: "guessed_identifier_probe",
          disposition: "candidate_created"
        }
      ]
    });

    expect(executor.queries).toHaveLength(1);
    const query = executor.queries[0]!;
    expect(normalizeSql(query.sql)).toContain(
      "from public.inbox_v2_security_denial_record("
    );
    expect(query.params).toEqual([
      tenantId,
      "resource.read",
      "employee",
      "security-denial-key:0123456789abcdef",
      actorFingerprint,
      dedupeFingerprint,
      observationReceipt,
      "unknown_or_hidden_resource",
      "not_found",
      "high",
      "guessed_identifier_probe",
      "security_probe_review",
      null,
      INBOX_V2_SECURITY_DENIAL_POLICY.policyId,
      INBOX_V2_SECURITY_DENIAL_POLICY.windowSeconds,
      INBOX_V2_SECURITY_DENIAL_POLICY.retentionSeconds,
      INBOX_V2_SECURITY_DENIAL_POLICY.shardCount,
      INBOX_V2_SECURITY_DENIAL_POLICY.detailBucketLimitPerShard,
      INBOX_V2_SECURITY_DENIAL_POLICY.reviewCandidateLimitPerShard,
      INBOX_V2_SECURITY_DENIAL_POLICY.attemptRateLimitPerShard,
      INBOX_V2_SECURITY_DENIAL_POLICY.lockTimeoutMilliseconds,
      INBOX_V2_SECURITY_DENIAL_POLICY.statementTimeoutMilliseconds
    ]);
    expectNoForbiddenAmplificationSql(query.sql);
  });

  it("rejects non-contract input before SQL and cannot pass arbitrary payload growth", async () => {
    const executor = queuedExecutor([]);
    const invalid = {
      ...attempt(),
      targetId: "employee:guessed",
      metadata: { body: "attacker-controlled" }
    };

    await expect(
      createSqlInboxV2SecurityDenialRepository(executor).record(
        invalid as InboxV2SecurityDenialAttempt,
        recordOptions()
      )
    ).rejects.toThrow();
    expect(executor.queries).toHaveLength(0);
  });

  it("rejects lossy bigint results, malformed review arrays and non-singleton function output", async () => {
    for (const rows of [
      [recordRow({ shard_attempt_count: 9_007_199_254_740_992 })],
      [recordRow({ review_dispositions: [] })],
      [recordRow(), recordRow()]
    ]) {
      const repository = createSqlInboxV2SecurityDenialRepository(
        queuedExecutor([rows])
      );
      await expect(
        repository.record(attempt(), recordOptions())
      ).rejects.toThrow();
    }
  });

  it("honors an already-aborted sink call before validation or SQL", async () => {
    const executor = queuedExecutor([]);
    const controller = new AbortController();
    controller.abort(new Error("security-denial observation timed out"));

    await expect(
      createSqlInboxV2SecurityDenialRepository(executor).record(attempt(), {
        signal: controller.signal
      })
    ).rejects.toThrow("security-denial observation timed out");
    expect(executor.queries).toHaveLength(0);
  });

  it("surfaces one SQL sink failure without request-level retries", async () => {
    const failure = new Error("bounded denial sink unavailable");
    let executeCount = 0;
    const executor: RawSqlExecutor = {
      async execute() {
        executeCount += 1;
        throw failure;
      }
    };

    await expect(
      createSqlInboxV2SecurityDenialRepository(executor).record(
        attempt(),
        recordOptions()
      )
    ).rejects.toBe(failure);
    expect(executeCount).toBe(1);
  });

  it("builds a tenant-fenced bounded review query and maps only strict redacted rows", async () => {
    const executor = queuedExecutor([[reviewRow()]]);
    const repository = createSqlInboxV2SecurityDenialRepository(executor);

    await expect(
      repository.listReviews({
        tenantId,
        limit: 25,
        status: "open",
        reviewType: "guessed_identifier_probe"
      })
    ).resolves.toEqual({
      items: [
        {
          tenantId,
          windowStartedAt,
          windowEndedAt,
          shardNo,
          reviewType: "guessed_identifier_probe",
          alertType: "security_probe_review",
          aggregationKind: "candidate",
          candidateFingerprint: dedupeFingerprint,
          candidateRef: null,
          risk: "high",
          status: "open",
          triggerCount: "9007199254740993",
          firstSeenAt: occurredAt,
          lastSeenAt: "2026-07-15T10:11:00.000Z",
          expiresAt
        }
      ],
      nextCursor: null
    });

    const query = executor.queries[0]!;
    const rendered = normalizeSql(query.sql);
    expect(rendered).toContain(
      "from public.inbox_v2_security_denial_review_signals review"
    );
    expect(rendered).toContain("where review.tenant_id =");
    expect(rendered).toContain("review.expires_at > clock_timestamp()");
    expect(rendered).toContain(
      "review.review_sequence <= bounds.snapshot_high_water"
    );
    expect(rendered).toContain("order by review.review_sequence desc");
    expect(query.params.at(-1)).toBe(26);
    expectNoForbiddenAmplificationSql(query.sql);
  });

  it("fails closed on cross-tenant review rows and invalid page expansion", async () => {
    await expect(
      createSqlInboxV2SecurityDenialRepository(
        queuedExecutor([[reviewRow({ tenant_id: otherTenantId })]])
      ).listReviews({ tenantId, limit: 10 })
    ).rejects.toBeInstanceOf(InboxV2SecurityDenialPersistenceInvariantError);

    const executor = queuedExecutor([]);
    await expect(
      createSqlInboxV2SecurityDenialRepository(executor).listReviews({
        tenantId,
        limit: 101
      })
    ).rejects.toThrow(/between 1 and 100/u);
    expect(executor.queries).toHaveLength(0);
  });

  it("returns a tenant/filter-bound immutable high-water cursor with every ordering key", async () => {
    const executor = queuedExecutor([
      [
        reviewRow({ review_sequence: "42", snapshot_high_water: "50" }),
        reviewRow({ review_sequence: "41", snapshot_high_water: "50" })
      ]
    ]);
    const repository = createSqlInboxV2SecurityDenialRepository(executor);
    const page = await repository.listReviews({
      tenantId,
      limit: 1,
      status: "open",
      reviewType: "guessed_identifier_probe"
    });

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toEqual({
      cursorVersion: 1,
      tenantId,
      filterStatus: "open",
      filterReviewType: "guessed_identifier_probe",
      snapshotHighWater: "50",
      lastReviewSequence: "42",
      lastWindowStartedAt: windowStartedAt,
      lastShardNo: shardNo,
      lastReviewType: "guessed_identifier_probe",
      lastAggregationKind: "candidate",
      lastAggregationKey: dedupeFingerprint
    });

    const cursorQuery = renderQuery(
      buildListInboxV2SecurityDenialReviewsSql({
        tenantId,
        limit: 1,
        status: "open",
        reviewType: "guessed_identifier_probe",
        cursor: page.nextCursor!
      })
    );
    const rendered = normalizeSql(cursorQuery.sql);
    expect(rendered).toContain("review.review_sequence <");
    expect(rendered).toContain("review.window_started_at <");
    expect(rendered).toContain("review.shard_no >");
    expect(rendered).toContain("review.review_type >");
    expect(rendered).toContain("review.aggregation_kind >");
    expect(rendered).toContain("review.aggregation_key >");

    await expect(
      repository.listReviews({
        tenantId: otherTenantId,
        limit: 1,
        status: "open",
        reviewType: "guessed_identifier_probe",
        cursor: page.nextCursor!
      })
    ).rejects.toThrow(/not bound/u);
    expect(executor.queries).toHaveLength(1);
  });

  it("keeps every exported SQL builder inside the denial store boundary", () => {
    for (const query of [
      buildRecordInboxV2SecurityDenialSql(attempt()),
      buildListInboxV2SecurityDenialReviewsSql({ tenantId, limit: 10 })
    ]) {
      expectNoForbiddenAmplificationSql(renderQuery(query).sql);
    }
  });
});

class QueuedExecutor implements RawSqlExecutor {
  readonly queries: ReturnType<typeof renderQuery>[] = [];

  constructor(
    private readonly queuedRows: readonly (readonly Record<string, unknown>[])[]
  ) {}

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(renderQuery(query));
    const rows = this.queuedRows[this.queries.length - 1] ?? [];
    return { rows: rows as unknown as readonly Row[] };
  }
}

function queuedExecutor(
  rows: readonly (readonly Record<string, unknown>[])[]
): QueuedExecutor {
  return new QueuedExecutor(rows);
}

function recordOptions() {
  return { signal: new AbortController().signal };
}

function renderQuery(query: SQL) {
  return new PgDialect().sqlToQuery(query);
}

function normalizeSql(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLowerCase();
}

function expectNoForbiddenAmplificationSql(value: string): void {
  const normalized = normalizeSql(value);
  expect(normalized).not.toMatch(
    /(?:inbox_v2_tenant_stream|inbox_v2_auth_(?:command|mutation|audit)|event_store|domain_events|provider_outbox|\boutbox\b)/u
  );
}
