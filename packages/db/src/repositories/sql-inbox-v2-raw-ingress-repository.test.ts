import {
  calculateInboxV2RawIngressLeaseTokenHash,
  defineInboxV2RawIngressSanitizer,
  defineInboxV2RawIngressSanitizerProfile,
  inboxV2ClaimRawIngressInputSchema,
  inboxV2EntityRevisionSchema,
  inboxV2NamespacedIdSchema,
  inboxV2RawInboundEventIdSchema,
  inboxV2SourceAccountIdSchema,
  inboxV2SourceConnectionIdSchema,
  inboxV2TenantIdSchema,
  sanitizeInboxV2RawIngress,
  type InboxV2RawIngressInput,
  type InboxV2SanitizedRawIngressCandidate
} from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import * as rawIngressModule from "./sql-inbox-v2-raw-ingress-repository";
import {
  buildClaimInboxV2RawIngressSql,
  createProductionSqlInboxV2RawIngressRepository,
  createSqlInboxV2RawIngressRepository,
  handoffInboxV2RawAdmissionSkeletonInTransaction,
  loadPendingInboxV2RawDedupeAdmission,
  InboxV2RawIngressPersistenceInvariantError,
  type InboxV2RawIngressTransactionExecutor
} from "./sql-inbox-v2-raw-ingress-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const tenantId = inboxV2TenantIdSchema.parse("tenant:src002-unit");
const connectionId = inboxV2SourceConnectionIdSchema.parse(
  "source_connection:src002-unit"
);
const accountId = inboxV2SourceAccountIdSchema.parse(
  "source_account:src002-unit"
);
const rawEventId = inboxV2RawInboundEventIdSchema.parse(
  "raw_inbound_event:src002-unit"
);
const existingRawEventId = inboxV2RawInboundEventIdSchema.parse(
  "raw_inbound_event:existing-src002"
);
const quarantineId = inboxV2NamespacedIdSchema.parse(
  "core:raw-ingress-quarantine-src002-unit"
);
const workerId = inboxV2NamespacedIdSchema.parse(
  "core:raw-ingress-worker-src002"
);
const revision2 = inboxV2EntityRevisionSchema.parse("2");
const revision3 = inboxV2EntityRevisionSchema.parse("3");
const revision1 = inboxV2EntityRevisionSchema.parse("1");
const tokenA = `src002-token-a-${"a".repeat(32)}`;
const tokenB = `src002-token-b-${"b".repeat(32)}`;
const tokenHashA = calculateInboxV2RawIngressLeaseTokenHash(tokenA);
const tokenHashB = calculateInboxV2RawIngressLeaseTokenHash(tokenB);
const forcedDigest = `sha256:${"f".repeat(64)}`;
const t0 = "2026-07-16T08:00:00.000Z";
const t1 = "2026-07-16T08:00:01.000Z";
const t2 = "2026-07-16T08:00:02.000Z";
const t3 = "2026-07-16T08:01:02.000Z";
const guarantee = "2026-07-17T08:00:00.000Z";
const secretSentinel = "credential-sentinel-src002";
const rawIdentitySentinel = "raw-provider-identity-src002";

describe("SQL Inbox V2 raw-ingress repository", () => {
  it("persists only the sanitized aggregate through one READ COMMITTED transaction", async () => {
    const candidate = await acceptedCandidate();
    const executor = new ScriptedTransactionExecutor([
      [{ id: rawEventId }],
      [],
      [],
      [],
      [pendingRow()],
      []
    ]);
    const digestSource = vi.fn(() => forcedDigest);
    const repository = createSqlInboxV2RawIngressRepository(executor, {
      rawEventIdSource: () => rawEventId,
      quarantineIdSource: () => quarantineId,
      idempotencyKeyDigestSource: digestSource
    });

    const result = await repository.record(candidate);

    expect(result).toMatchObject({
      outcome: "recorded",
      rawEventId,
      work: { state: "pending", revision: "1" }
    });
    expect(executor.transactionConfigs).toEqual([
      { isolationLevel: "read committed" }
    ]);
    expect(digestSource).toHaveBeenCalledWith({
      tenantId,
      sourceConnectionId: connectionId,
      sourceAccountId: accountId,
      transport: "webhook",
      eventIdentityKind: "provider_event_id",
      eventIdentityDigestSha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u)
    });
    const allSqlParameters = executor.renderedQueries.flatMap(
      (query) => query.params
    );
    const serialized = JSON.stringify(allSqlParameters);
    expect(serialized).not.toContain(secretSentinel);
    expect(serialized).not.toContain(rawIdentitySentinel);
    expect(serialized).toContain("safe-message");
    expect(serialized).toContain("request-src002");
    expect(serialized).toContain(`source:v2:raw:${"f".repeat(64)}`);
    const anchor = normalizeSql(executor.renderedQueries[0]!.sql);
    expect(anchor).toContain("external_event_id, event_signature");
    expect(anchor).toContain("'{}'::jsonb, '{}'::jsonb, 'ignored'");
    executor.expectExhausted();
  });

  it("rejects structural candidate forgery before opening a transaction and keeps write builders private", async () => {
    const candidate = await acceptedCandidate();
    const executor = new ScriptedTransactionExecutor([]);
    const repository = createSqlInboxV2RawIngressRepository(executor);

    await expect(repository.record(structuredClone(candidate))).rejects.toThrow(
      "authentic sanitized candidate"
    );
    expect(executor.transactionConfigs).toEqual([]);

    const publicSurface = rawIngressModule as Record<string, unknown>;
    for (const unsafeBuilder of [
      "buildInsertInboxV2RawIngressAnchorSql",
      "buildInsertInboxV2RawIngressEnvelopeSql",
      "buildInsertInboxV2RawIngressPayloadEvidenceSql",
      "buildInsertInboxV2RawIngressHeaderEvidenceSql",
      "buildInsertInboxV2RawIngressWorkSql",
      "buildInsertInboxV2RawIngressQuarantineSql"
    ]) {
      expect(publicSurface[unsafeBuilder]).toBeUndefined();
    }
  });

  it("stores stable safe quarantine for sanitizer rejection without raw/evidence/work writes", async () => {
    const candidate = await quarantinedCandidate();
    const executor = new ScriptedTransactionExecutor([
      [quarantineReceiptRow()]
    ]);
    const repository = createSqlInboxV2RawIngressRepository(executor, {
      quarantineIdSource: () => quarantineId,
      idempotencyKeyDigestSource: () => forcedDigest
    });

    const result = await repository.record(candidate);

    expect(result).toMatchObject({
      outcome: "quarantined",
      quarantineId,
      existingRawEventId: null,
      reasonCode: "source.sanitizer_rejected"
    });
    expect(executor.renderedQueries).toHaveLength(1);
    const query = executor.renderedQueries[0]!;
    expect(normalizeSql(query.sql)).toContain(
      "insert into public.inbox_v2_source_raw_quarantines"
    );
    expect(JSON.stringify(query.params)).not.toContain(secretSentinel);
    expect(JSON.stringify(query.params)).not.toContain(rawIdentitySentinel);
    executor.expectExhausted();
  });

  it("maps a forced idempotency collision to a stable quarantine instead of an unrelated raw row", async () => {
    const candidate = await acceptedCandidate();
    const existing = existingEnvelopeRow({
      source_connection_id: "source_connection:other"
    });
    const executor = new ScriptedTransactionExecutor([
      [],
      [existing],
      [quarantineReceiptRow()]
    ]);
    const repository = createSqlInboxV2RawIngressRepository(executor, {
      rawEventIdSource: () => rawEventId,
      quarantineIdSource: () => quarantineId,
      idempotencyKeyDigestSource: () => forcedDigest
    });

    const result = await repository.record(candidate);

    expect(result).toEqual({
      outcome: "quarantined",
      source: {
        tenantId,
        sourceConnectionId: connectionId,
        sourceAccountId: accountId
      },
      quarantineId,
      existingRawEventId: "raw_inbound_event:existing-src002",
      safeEnvelopeDigest: candidate.safeEnvelopeDigest,
      reasonCode: "source.idempotency_collision"
    });
    expect(normalizeSql(executor.renderedQueries[1]!.sql)).toContain(
      "for update of anchor"
    );
    expect(normalizeSql(executor.renderedQueries[1]!.sql)).not.toContain(
      "source_raw_evidence"
    );
    executor.expectExhausted();
  });

  it("records production raw ingress only through a live pinned HMAC admission", async () => {
    const candidate = await acceptedCandidate();
    const authority = {
      authorizeRawAdmission: vi.fn(async () => productionAuthorization())
    };
    const executor = new ScriptedTransactionExecutor([
      [],
      [rawAdmissionKeyRow()],
      [],
      [{ id: rawEventId }],
      [],
      [],
      [],
      [pendingRow()],
      [],
      []
    ]);
    const repository = createProductionSqlInboxV2RawIngressRepository(
      executor,
      {
        admissionAuthority: authority,
        rawEventIdSource: () => rawEventId,
        quarantineIdSource: () => quarantineId
      }
    );

    await expect(repository.record(candidate)).resolves.toMatchObject({
      outcome: "recorded",
      rawEventId
    });
    expect(authority.authorizeRawAdmission).toHaveBeenCalledWith(
      expect.objectContaining({
        identityMaterial: rawIdentitySentinel,
        purposeId: "core:source_replay_and_diagnostics"
      })
    );
    const sqlParameters = JSON.stringify(
      executor.renderedQueries.flatMap((query) => query.params)
    );
    expect(sqlParameters).not.toContain(rawIdentitySentinel);
    expect(sqlParameters).not.toContain(candidate.safeEnvelopeDigest);
    expect(sqlParameters).toContain(`hmac-sha256:${"b".repeat(64)}`);
    expect(sqlParameters).toContain(`hmac-sha256:${"e".repeat(64)}`);
    expect(
      executor.renderedQueries.map((query) => normalizeSql(query.sql)).join(" ")
    ).toContain("insert into public.inbox_v2_source_raw_admissions");
    executor.expectExhausted();
  });

  it("pins production quarantine HMAC metadata without persisting clear identity or safe SHA", async () => {
    const candidate = await quarantinedCandidate();
    const executor = new ScriptedTransactionExecutor([
      [],
      [rawAdmissionKeyRow()],
      [quarantineReceiptRow()]
    ]);
    const repository = createProductionSqlInboxV2RawIngressRepository(
      executor,
      {
        admissionAuthority: {
          authorizeRawAdmission: async () => productionAuthorization()
        },
        quarantineIdSource: () => quarantineId
      }
    );

    await expect(repository.record(candidate)).resolves.toMatchObject({
      outcome: "quarantined",
      source: {
        tenantId,
        sourceConnectionId: connectionId,
        sourceAccountId: accountId
      },
      quarantineId
    });
    const parameters = JSON.stringify(
      executor.renderedQueries.flatMap((query) => query.params)
    );
    expect(parameters).not.toContain(rawIdentitySentinel);
    expect(parameters).not.toContain(candidate.safeEnvelopeDigest);
    expect(parameters).toContain("source-key:2026-08");
    expect(parameters).toContain(
      "secret:tenant:src002-unit/inbox-v2/source-key-2026-08"
    );
    expect(parameters).toContain(guarantee);
  });

  it("fails closed without opening a transaction when admission key is unavailable", async () => {
    const candidate = await acceptedCandidate();
    const executor = new ScriptedTransactionExecutor([]);
    const repository = createProductionSqlInboxV2RawIngressRepository(
      executor,
      {
        admissionAuthority: {
          authorizeRawAdmission: async () => ({
            outcome: "rejected",
            reason: "key_unavailable"
          })
        }
      }
    );

    await expect(repository.record(candidate)).resolves.toEqual({
      outcome: "key_unavailable"
    });
    expect(executor.transactionConfigs).toEqual([]);
  });

  it("fails closed when the authority generation is absent from the locked DB key ring", async () => {
    const candidate = await acceptedCandidate();
    const executor = new ScriptedTransactionExecutor([[], []]);
    const repository = createProductionSqlInboxV2RawIngressRepository(
      executor,
      {
        admissionAuthority: {
          authorizeRawAdmission: async () => productionAuthorization()
        }
      }
    );

    await expect(repository.record(candidate)).resolves.toEqual({
      outcome: "key_unavailable"
    });
    expect(executor.renderedQueries).toHaveLength(2);
    expect(normalizeSql(executor.renderedQueries[0]!.sql)).toContain(
      "pg_advisory_xact_lock"
    );
    expect(normalizeSql(executor.renderedQueries[1]!.sql)).toContain(
      "for share of key_row"
    );
  });

  it("transports domain-separated raw-admission lock keys without PostgreSQL-forbidden NUL bytes", async () => {
    const candidate = await acceptedCandidate();
    const executor = new ScriptedTransactionExecutor([[], []]);
    const repository = createProductionSqlInboxV2RawIngressRepository(
      executor,
      {
        admissionAuthority: {
          authorizeRawAdmission: async () =>
            productionAuthorization({ includePrevious: true })
        }
      }
    );

    await expect(repository.record(candidate)).resolves.toEqual({
      outcome: "key_unavailable"
    });
    const lockQuery = executor.renderedQueries[0]!;
    const statement = normalizeSql(lockQuery.sql);
    const parameters = JSON.stringify(lockQuery.params);
    expect(statement).toContain("jsonb_build_array");
    expect(statement).toContain('order by candidate.lock_key collate "c"');
    expect(statement).not.toContain("jsonb_to_recordset");
    expect(parameters).toContain("inbox-v2:raw-admission:v1");
    expect(parameters).toContain("source-key:2026-08");
    expect(parameters).toContain("source-key:2026-07");
    expect(parameters).not.toContain("\\u0000");
    executor.expectExhausted();
  });

  it("matches a verify-only previous generation during rotation without creating another raw row", async () => {
    const candidate = await acceptedCandidate();
    const authorization = productionAuthorization({ includePrevious: true });
    const executor = new ScriptedTransactionExecutor([
      [],
      [
        rawAdmissionKeyRow(),
        rawAdmissionKeyRow({
          generation: "source-key:2026-07",
          secret_ref: "secret:tenant:src002-unit/inbox-v2/source-key-2026-07",
          state: "verify_only",
          is_write: false
        })
      ],
      [
        rawAdmissionRow(candidate, {
          key_generation: "source-key:2026-07",
          hmac_key_secret_ref:
            "secret:tenant:src002-unit/inbox-v2/source-key-2026-07",
          identity_hmac_sha256: `hmac-sha256:${"c".repeat(64)}`,
          event_identity_digest_sha256: `hmac-sha256:${"c".repeat(64)}`,
          safe_envelope_digest_sha256: `hmac-sha256:${"f".repeat(64)}`
        })
      ]
    ]);
    const repository = createProductionSqlInboxV2RawIngressRepository(
      executor,
      {
        admissionAuthority: { authorizeRawAdmission: async () => authorization }
      }
    );

    await expect(repository.record(candidate)).resolves.toEqual({
      outcome: "duplicate",
      source: {
        tenantId,
        sourceConnectionId: connectionId,
        sourceAccountId: accountId
      },
      rawEventId: "raw_inbound_event:existing-src002",
      safeEnvelopeDigest: `hmac-sha256:${"f".repeat(64)}`,
      matchedKeyGenerations: ["source-key:2026-07"]
    });
    expect(
      executor.renderedQueries.some((query) =>
        normalizeSql(query.sql).includes(
          "insert into public.raw_inbound_events"
        )
      )
    ).toBe(false);
    expect(JSON.stringify(executor.renderedQueries)).not.toContain(
      rawIdentitySentinel
    );
    executor.expectExhausted();
  });

  it("loads a bounded pending snapshot and CAS-hands it off without clear identity", async () => {
    const candidate = await acceptedCandidate();
    const pendingAdmission = rawAdmissionRow(candidate, { db_now: t2 });
    const loadExecutor = new ScriptedTransactionExecutor([[pendingAdmission]]);
    const loaded = await loadPendingInboxV2RawDedupeAdmission(loadExecutor, {
      tenantId,
      rawEventId: existingRawEventId
    });
    expect(loaded).toMatchObject({
      outcome: "pending",
      snapshot: {
        admissionRevision: "1",
        keyGeneration: "source-key:2026-08"
      }
    });
    expect(JSON.stringify(loaded)).not.toContain(rawIdentitySentinel);
    expect(normalizeSql(loadExecutor.renderedQueries[0]!.sql)).toContain(
      "limit 2"
    );

    const handoffExecutor = new ScriptedTransactionExecutor([
      [pendingAdmission],
      [
        rawAdmissionRow(candidate, {
          state: "skeleton_handed_off",
          terminal_skeleton_id: "source-skeleton:src008-unit",
          terminal_outcome_hmac_sha256: `hmac-sha256:${"9".repeat(64)}`,
          skeleton_handed_off_at: t3,
          revision: "2"
        })
      ]
    ]);
    const handedOff = await handoffInboxV2RawAdmissionSkeletonInTransaction(
      handoffExecutor,
      {
        tenantId,
        rawEventId: existingRawEventId,
        expectedAdmissionRevision: revision1,
        handedOffAt: t3,
        terminalSkeletonId: "source-skeleton:src008-unit",
        terminalOutcomeHmacSha256: `hmac-sha256:${"9".repeat(64)}`
      }
    );
    expect(handedOff).toMatchObject({
      outcome: "handed_off",
      sealedSkeleton: { admissionRevision: "1" }
    });
    const update = normalizeSql(handoffExecutor.renderedQueries[1]!.sql);
    expect(update).toContain("admission.revision =");
    expect(update).toContain("admission.guarantee_until >");
    expect(JSON.stringify(handoffExecutor.renderedQueries)).not.toContain(
      rawIdentitySentinel
    );
  });

  it("claims pending and expired work with DB clock, SKIP LOCKED and raw-token ordinals", async () => {
    const input = inboxV2ClaimRawIngressInputSchema.parse({
      tenantId,
      workerId,
      leaseDurationSeconds: 60,
      batchSize: 2,
      maxClaimsPerAccount: 1
    });
    const rendered = renderQuery(
      buildClaimInboxV2RawIngressSql(input, [tokenHashA, tokenHashB])
    );
    const statement = normalizeSql(rendered.sql);
    expect(statement).toContain("select clock_timestamp() as db_now");
    expect(statement).toContain("for update of work skip locked");
    expect(statement).toContain(
      "partition by envelope.source_connection_id, envelope.source_account_scope_key"
    );
    expect(statement).toContain("account_claim_ordinal <=");
    expect(statement).toContain("work.state = 'pending'");
    expect(statement).toContain("work.state = 'leased'");
    expect(statement).toContain("last_reclaimed_from_expires_at");
    expect(rendered.params).not.toContain(tokenA);
    expect(rendered.params).not.toContain(tokenB);

    const initial = leasedRow({
      raw_event_id: rawEventId,
      lease_token_hash: tokenHashA,
      lease_revision: "2",
      revision: "2",
      previous_state: "pending",
      previous_lease_owner_id: null,
      previous_lease_revision: null,
      previous_lease_claimed_at: null,
      previous_lease_expires_at: null,
      claim_ordinal: 1
    });
    const reclaimed = leasedRow({
      raw_event_id: "raw_inbound_event:src002-reclaimed",
      lease_token_hash: tokenHashB,
      lease_revision: "4",
      revision: "4",
      attempt_count: "2",
      reclaim_count: "1",
      last_reclaimed_at: t2,
      last_reclaimed_from_expires_at: t1,
      last_reclaimed_lease_owner_id: "core:expired-worker",
      last_reclaimed_lease_token_hash: `sha256:${"e".repeat(64)}`,
      last_reclaimed_lease_revision: "3",
      previous_state: "leased",
      previous_lease_owner_id: "core:expired-worker",
      previous_lease_revision: "3",
      previous_lease_claimed_at: t0,
      previous_lease_expires_at: t1,
      claim_ordinal: 2
    });
    const executor = new ScriptedTransactionExecutor([[reclaimed, initial]]);
    const repository = createSqlInboxV2RawIngressRepository(executor, {
      leaseTokenSource: () => [tokenA, tokenB]
    });

    const result = await repository.claim(input);

    expect(result).toMatchObject({
      outcome: "claimed",
      tenantId,
      workerId,
      claims: [
        { claimKind: "pending", leaseToken: tokenA, expiredLease: null },
        {
          claimKind: "reclaimed",
          leaseToken: tokenB,
          expiredLease: {
            workerId: "core:expired-worker",
            leaseRevision: "3",
            claimedAt: t0,
            expiredAt: t1
          }
        }
      ]
    });
    expect(
      JSON.stringify(executor.renderedQueries.flatMap((query) => query.params))
    ).not.toContain(tokenA);
    expect(
      JSON.stringify(executor.renderedQueries.flatMap((query) => query.params))
    ).not.toContain(tokenB);
    executor.expectExhausted();
  });

  it("rejects duplicate claim capabilities before SQL", async () => {
    const executor = new ScriptedTransactionExecutor([]);
    const repository = createSqlInboxV2RawIngressRepository(executor, {
      leaseTokenSource: () => [tokenA, tokenA]
    });
    await expect(
      repository.claim({
        tenantId,
        workerId,
        leaseDurationSeconds: 60,
        batchSize: 2
      })
    ).rejects.toBeInstanceOf(InboxV2RawIngressPersistenceInvariantError);
    expect(executor.transactionConfigs).toEqual([]);
  });

  it.each([
    ["not_found", []],
    ["not_leased", [{ ...pendingRow(), db_now: t2 }]],
    [
      "stale_token",
      [{ ...leasedRow({ lease_token_hash: tokenHashB }), db_now: t2 }]
    ],
    [
      "lease_expired",
      [
        {
          ...leasedRow({
            lease_claimed_at: t0,
            lease_expires_at: t1,
            updated_at: t0
          }),
          db_now: t2
        }
      ]
    ],
    [
      "lease_revision_conflict",
      [{ ...leasedRow({ lease_revision: "3", revision: "3" }), db_now: t2 }]
    ]
  ] as const)(
    "classifies %s lease fences before mutation",
    async (outcome, rows) => {
      const executor = new ScriptedTransactionExecutor([rows]);
      const repository = createSqlInboxV2RawIngressRepository(executor);
      const result = await repository.renewLease({
        tenantId,
        rawEventId,
        workerId,
        leaseToken: tokenA,
        expectedLeaseRevision: revision2,
        leaseDurationSeconds: 60
      });
      expect(result.outcome).toBe(outcome);
      if (outcome === "lease_expired") {
        expect(result).toMatchObject({ expiredAt: t1 });
      }
      expect(executor.renderedQueries).toHaveLength(1);
    }
  );

  it("renews and releases only the exact unexpired CAS lease", async () => {
    const renewedRow = leasedRow({
      lease_revision: "3",
      revision: "3",
      lease_expires_at: "2026-07-16T08:02:02.000Z",
      updated_at: t2
    });
    const renewExecutor = new ScriptedTransactionExecutor([
      [{ ...leasedRow(), db_now: t2 }],
      [renewedRow]
    ]);
    const renewRepository = createSqlInboxV2RawIngressRepository(renewExecutor);
    const renewed = await renewRepository.renewLease({
      tenantId,
      rawEventId,
      workerId,
      leaseToken: tokenA,
      expectedLeaseRevision: revision2,
      leaseDurationSeconds: 60
    });
    expect(renewed).toMatchObject({
      outcome: "renewed",
      work: { revision: "3", lease: { leaseRevision: "3" } }
    });
    const renewSql = normalizeSql(renewExecutor.renderedQueries[1]!.sql);
    expect(renewSql).toContain("interval '1 millisecond'");
    expect(renewSql).toContain("work.revision =");

    const releaseExecutor = new ScriptedTransactionExecutor([
      [{ ...renewedRow, db_now: t2 }],
      [
        pendingRow({
          attempt_count: "1",
          revision: "4",
          available_at: t2,
          updated_at: t2
        })
      ]
    ]);
    const releaseRepository =
      createSqlInboxV2RawIngressRepository(releaseExecutor);
    const released = await releaseRepository.releaseLease({
      tenantId,
      rawEventId,
      workerId,
      leaseToken: tokenA,
      expectedLeaseRevision: revision3
    });
    expect(released).toMatchObject({
      outcome: "released",
      work: { state: "pending", revision: "4", lease: null }
    });
  });

  it("retries a complete READ COMMITTED record transaction on serialization failure", async () => {
    const candidate = await acceptedCandidate();
    const executor = new ScriptedTransactionExecutor(
      [[{ id: rawEventId }], [], [], [], [pendingRow()], []],
      ["40001"]
    );
    const repository = createSqlInboxV2RawIngressRepository(executor, {
      rawEventIdSource: () => rawEventId,
      quarantineIdSource: () => quarantineId
    });

    await expect(repository.record(candidate)).resolves.toMatchObject({
      outcome: "recorded",
      rawEventId
    });
    expect(executor.transactionConfigs).toHaveLength(2);
    executor.expectExhausted();
  });

  it("retries when Drizzle wraps a retryable PostgreSQL SQLSTATE in cause", async () => {
    const candidate = await acceptedCandidate();
    const executor = new ScriptedTransactionExecutor(
      [[{ id: rawEventId }], [], [], [], [pendingRow()], []],
      [{ code: "40P01", wrapped: true }]
    );
    const repository = createSqlInboxV2RawIngressRepository(executor, {
      rawEventIdSource: () => rawEventId,
      quarantineIdSource: () => quarantineId
    });

    await expect(repository.record(candidate)).resolves.toMatchObject({
      outcome: "recorded",
      rawEventId
    });
    expect(executor.transactionConfigs).toHaveLength(2);
    executor.expectExhausted();
  });
});

async function acceptedCandidate(): Promise<InboxV2SanitizedRawIngressCandidate> {
  const result = await sanitizeInboxV2RawIngress({
    sanitizer: testSanitizer(async ({ headers }) => {
      const requestIds = headers["x-request-id"];
      if (requestIds?.length !== 1 || requestIds[0] !== "request-src002") {
        return {
          outcome: "quarantined",
          reasonCode: "source.sanitizer_rejected"
        };
      }
      return {
        outcome: "accepted",
        restrictedPayload: { message: "safe-message" },
        validatedAllowedHeaders: [
          { name: "x-request-id", values: [requestIds[0]] }
        ]
      };
    }),
    request: rawRequest()
  });
  if (result.outcome !== "accepted") throw new Error("fixture invariant");
  return result.candidate;
}

async function quarantinedCandidate(): Promise<InboxV2SanitizedRawIngressCandidate> {
  const result = await sanitizeInboxV2RawIngress({
    sanitizer: testSanitizer(async () => ({
      outcome: "quarantined",
      reasonCode: "source.sanitizer_rejected"
    })),
    request: rawRequest()
  });
  if (result.outcome !== "quarantined") throw new Error("fixture invariant");
  return result.candidate;
}

function testSanitizer(
  handler: Parameters<typeof defineInboxV2RawIngressSanitizer>[0]["handler"]
) {
  return defineInboxV2RawIngressSanitizer({
    profile: defineInboxV2RawIngressSanitizerProfile({
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
    }),
    handler,
    parseRestrictedPayload: parseMessagePayload
  });
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

function rawRequest(): InboxV2RawIngressInput {
  return {
    tenantId,
    sourceConnectionId: connectionId,
    sourceAccountId: accountId,
    transport: "webhook",
    eventIdentity: {
      kind: "provider_event_id",
      value: rawIdentitySentinel
    },
    providerOccurredAt: t0,
    receivedAt: t1,
    sanitizedAt: t2,
    body: new TextEncoder().encode(
      JSON.stringify({ password: secretSentinel, message: "unsafe" })
    ),
    headers: {
      Authorization: `Bearer ${secretSentinel}`,
      Cookie: `sid=${secretSentinel}`,
      "X-Request-Id": "request-src002"
    }
  };
}

function existingEnvelopeRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    raw_event_id: "raw_inbound_event:existing-src002",
    source_connection_id: connectionId,
    source_account_id: accountId,
    source_account_scope_key: `1:${accountId.length}:${accountId}`,
    transport_kind: "webhook",
    event_identity_kind: "provider_event_id",
    event_identity_digest_sha256: `sha256:${"a".repeat(64)}`,
    safe_envelope_digest_sha256: `sha256:${"b".repeat(64)}`,
    sanitizer_id: "module:synthetic:sanitize-src002",
    sanitizer_version: "v1",
    sanitizer_declaration_revision: "1",
    ...overrides
  };
}

function quarantineReceiptRow(): Record<string, unknown> {
  return {
    id: quarantineId,
    tenant_id: tenantId,
    source_connection_id: connectionId,
    source_account_id: accountId
  };
}

function productionAuthorization(
  options: Readonly<{ includePrevious?: boolean }> = {}
) {
  const active = {
    generation: "source-key:2026-08",
    hmacKeySecretRef: "secret:tenant:src002-unit/inbox-v2/source-key-2026-08",
    identityHmacSha256: `hmac-sha256:${"b".repeat(64)}`,
    safeEnvelopeHmacSha256: `hmac-sha256:${"e".repeat(64)}`
  };
  return {
    outcome: "authorized" as const,
    source: {
      tenantId,
      sourceConnectionId: connectionId,
      sourceAccountId: accountId
    },
    identityKind: "provider_event_id" as const,
    purposeId: "core:source_replay_and_diagnostics" as const,
    writeCandidate: active,
    candidates: options.includePrevious
      ? [
          active,
          {
            generation: "source-key:2026-07",
            hmacKeySecretRef:
              "secret:tenant:src002-unit/inbox-v2/source-key-2026-07",
            identityHmacSha256: `hmac-sha256:${"c".repeat(64)}`,
            safeEnvelopeHmacSha256: `hmac-sha256:${"f".repeat(64)}`
          }
        ]
      : [active],
    guaranteeUntil: guarantee
  };
}

function rawAdmissionKeyRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    generation: "source-key:2026-08",
    secret_ref: "secret:tenant:src002-unit/inbox-v2/source-key-2026-08",
    state: "active",
    activated_at: t0,
    use_until: "2026-07-18T08:00:00.000Z",
    guarantee_not_after: "2026-07-19T08:00:00.000Z",
    verify_until: "2026-08-01T08:00:00.000Z",
    is_write: true,
    db_now: t2,
    ...overrides
  };
}

function rawAdmissionRow(
  candidate: InboxV2SanitizedRawIngressCandidate,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    purpose_id: "core:source_replay_and_diagnostics",
    key_generation: "source-key:2026-08",
    hmac_key_secret_ref:
      "secret:tenant:src002-unit/inbox-v2/source-key-2026-08",
    identity_hmac_sha256: `hmac-sha256:${"b".repeat(64)}`,
    identity_kind: "provider_event_id",
    source_connection_id: connectionId,
    source_account_id: accountId,
    source_account_scope_key: `1:${accountId.length}:${accountId}`,
    raw_event_id: "raw_inbound_event:existing-src002",
    safe_envelope_digest_sha256: `hmac-sha256:${"e".repeat(64)}`,
    guarantee_until: guarantee,
    state: "skeleton_pending",
    terminal_skeleton_id: null,
    terminal_outcome_hmac_sha256: null,
    skeleton_handed_off_at: null,
    revision: "1",
    transport_kind: "webhook",
    event_identity_kind: "provider_event_id",
    event_identity_digest_sha256: `hmac-sha256:${"b".repeat(64)}`,
    sanitizer_id: "module:synthetic:sanitize-src002",
    sanitizer_version: "v1",
    sanitizer_declaration_revision: "1",
    ...overrides
  };
}

function pendingRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    raw_event_id: rawEventId,
    state: "pending",
    available_at: t2,
    attempt_count: "0",
    lease_owner_id: null,
    lease_token_hash: null,
    lease_revision: null,
    lease_claimed_at: null,
    lease_expires_at: null,
    reclaim_count: "0",
    last_reclaimed_at: null,
    last_reclaimed_from_expires_at: null,
    last_reclaimed_lease_owner_id: null,
    last_reclaimed_lease_token_hash: null,
    last_reclaimed_lease_revision: null,
    revision: "1",
    created_at: t2,
    updated_at: t2,
    ...overrides
  };
}

function leasedRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...pendingRow(),
    state: "leased",
    attempt_count: "1",
    lease_owner_id: workerId,
    lease_token_hash: tokenHashA,
    lease_revision: "2",
    lease_claimed_at: t2,
    lease_expires_at: t3,
    revision: "2",
    updated_at: t2,
    ...overrides
  };
}

type ScriptedTransactionFailure =
  | string
  | Readonly<{ code: string; wrapped: true }>;

class ScriptedTransactionExecutor implements InboxV2RawIngressTransactionExecutor {
  readonly queries: SQL[] = [];
  readonly renderedQueries: Array<{ sql: string; params: unknown[] }> = [];
  readonly transactionConfigs: unknown[] = [];
  private readonly responses: Array<readonly Record<string, unknown>[]>;
  private readonly transactionFailures: ScriptedTransactionFailure[];

  constructor(
    responses: readonly (readonly Record<string, unknown>[])[],
    transactionFailures: readonly ScriptedTransactionFailure[] = []
  ) {
    this.responses = responses.map((rows) => [...rows]);
    this.transactionFailures = [...transactionFailures];
  }

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(query);
    this.renderedQueries.push(renderQuery(query));
    const rows = this.responses.shift();
    if (rows === undefined) throw new Error("Unexpected SQL execution.");
    return { rows: rows as readonly Row[] };
  }

  async transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config?: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult> {
    this.transactionConfigs.push(config);
    const failure = this.transactionFailures.shift();
    if (failure !== undefined) {
      if (typeof failure !== "string") {
        throw Object.assign(new Error("wrapped transaction failure"), {
          cause: Object.assign(new Error("retryable PostgreSQL transaction"), {
            code: failure.code
          })
        });
      }
      throw Object.assign(new Error("retryable transaction"), {
        code: failure
      });
    }
    return work(this);
  }

  expectExhausted(): void {
    expect(this.responses).toHaveLength(0);
    expect(this.transactionFailures).toHaveLength(0);
  }
}

function renderQuery(query: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(query);
}

function normalizeSql(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLowerCase();
}
