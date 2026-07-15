import {
  calculateInboxV2OutboxLeaseTokenHash,
  inboxV2ClaimOutboxInputSchema,
  inboxV2FinalizeOutboxInputSchema,
  inboxV2RenewOutboxLeaseInputSchema
} from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  buildClaimInboxV2OutboxSql,
  buildFinalizeInboxV2OutboxSql,
  buildInsertInboxV2OutboxOutcomeSql,
  buildLockInboxV2OutboxWorkSql,
  buildRenewInboxV2OutboxLeaseSql,
  createSqlInboxV2RepositoryOutbox,
  InboxV2RepositoryOutboxPersistenceInvariantError,
  type InboxV2RepositoryOutboxTransactionExecutor
} from "./sql-inbox-v2-repository-outbox";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const tenantId = "tenant:db007-outbox";
const otherTenantId = "tenant:db007-other";
const workerId = "core:outbox-worker";
const intent1 = "outbox-intent:db007-1";
const intent2 = "outbox-intent:db007-2";
const tokenA = `lease-token-${"a".repeat(32)}`;
const tokenB = `lease-token-${"b".repeat(32)}`;
const tokenHashA = calculateInboxV2OutboxLeaseTokenHash(tokenA);
const tokenHashB = calculateInboxV2OutboxLeaseTokenHash(tokenB);
const hashA = `sha256:${"a".repeat(64)}`;
const hashB = `sha256:${"b".repeat(64)}`;
const t0 = "2026-07-15T09:00:00.000Z";
const t1 = "2026-07-15T09:01:00.000Z";
const dbNow = "2026-07-15T09:01:30.000Z";
const t2 = "2026-07-15T09:02:00.000Z";
const t3 = "2026-07-15T09:02:30.000Z";

describe("SQL Inbox V2 repository outbox", () => {
  it("claims due pending and expired leases with DB clock, SKIP LOCKED and ordinal digests", () => {
    const input = claimInput(2);
    const rendered = renderQuery(
      buildClaimInboxV2OutboxSql(input, [tokenHashA, tokenHashB])
    );
    const statement = normalizeSql(rendered.sql);

    expect(statement).toContain("select clock_timestamp() as db_now");
    expect(statement).toContain(
      "work.state = 'pending' and work.available_at <= db_clock.db_now"
    );
    expect(statement).toContain(
      "work.state = 'leased' and work.lease_expires_at <= db_clock.db_now"
    );
    expect(statement).toContain("for update of work skip locked");
    expect(statement).toContain("row_number() over");
    expect(statement).toContain(
      "when ranked_candidates.previous_state = 'pending' then 1"
    );
    expect(statement).toContain("else ranked_candidates.lease_revision + 1");
    expect(statement).toContain("order by claim_ordinal asc");
    expect(rendered.params).toContain(tenantId);
    expect(rendered.params.join("\n")).toContain(tokenHashA);
    expect(rendered.params.join("\n")).toContain(tokenHashB);
    expect(rendered.params).not.toContain(tokenA);
    expect(rendered.params).not.toContain(tokenB);

    const serializedClaimTokens = rendered.params.find(
      (value): value is string =>
        typeof value === "string" && value.includes('"claim_ordinal"')
    );
    expect(serializedClaimTokens).toBeDefined();
    expect(JSON.parse(serializedClaimTokens!)).toEqual([
      { claim_ordinal: 1, token_hash: tokenHashA },
      { claim_ordinal: 2, token_hash: tokenHashB }
    ]);
    expect(serializedClaimTokens).not.toContain("claimOrdinal");
    expect(serializedClaimTokens).not.toContain("tokenHash");
  });

  it("maps unordered claimed rows back to raw capabilities by contiguous ordinal", async () => {
    const initial = leasedRow({
      intentId: intent1,
      tokenHash: tokenHashA,
      leaseRevision: "1",
      attemptCount: "1",
      revision: "2",
      claimedAt: dbNow,
      expiresAt: t3,
      updatedAt: dbNow,
      previous_state: "pending",
      claim_ordinal: 1
    });
    const reclaimed = leasedRow({
      intentId: intent2,
      tokenHash: tokenHashB,
      leaseRevision: "3",
      attemptCount: "4",
      revision: "7",
      claimedAt: dbNow,
      expiresAt: t3,
      updatedAt: dbNow,
      previous_state: "leased",
      claim_ordinal: 2
    });
    const executor = new ScriptedTransactionExecutor([[reclaimed, initial]]);
    const repository = createSqlInboxV2RepositoryOutbox(executor, {
      tokenSource: () => [tokenA, tokenB]
    });

    const result = await repository.claimAvailable(claimInput(2));

    expect(result).toMatchObject({
      outcome: "claimed",
      tenantId,
      workerId,
      batchSize: 2,
      claims: [
        { claimKind: "initial", leaseToken: tokenA },
        { claimKind: "reclaimed", leaseToken: tokenB }
      ]
    });
    if (result.outcome !== "claimed") throw new Error("fixture invariant");
    expect(result.claims[0]!.work.lease?.leaseTokenHash).toBe(tokenHashA);
    expect(result.claims[1]!.work.lease?.leaseTokenHash).toBe(tokenHashB);
    expect(executor.transactionCount).toBe(1);
    expect(executor.queries).toHaveLength(1);
    const persistedParams = executor.renderedQueries[0]!.params;
    expect(persistedParams).not.toContain(tokenA);
    expect(persistedParams).not.toContain(tokenB);
    executor.expectExhausted();
  });

  it("rejects bad token batches before SQL and fails closed on cross-tenant claim rows", async () => {
    const duplicateExecutor = new ScriptedTransactionExecutor([]);
    const duplicateRepository = createSqlInboxV2RepositoryOutbox(
      duplicateExecutor,
      { tokenSource: () => [tokenA, tokenA] }
    );
    await expect(
      duplicateRepository.claimAvailable(claimInput(2))
    ).rejects.toBeInstanceOf(InboxV2RepositoryOutboxPersistenceInvariantError);
    expect(duplicateExecutor.transactionCount).toBe(0);
    expect(duplicateExecutor.queries).toHaveLength(0);

    const crossTenant = leasedRow({
      tenantId: otherTenantId,
      claimedAt: dbNow,
      expiresAt: t3,
      updatedAt: dbNow,
      previous_state: "pending",
      claim_ordinal: 1
    });
    const executor = new ScriptedTransactionExecutor([[crossTenant]]);
    const repository = createSqlInboxV2RepositoryOutbox(executor, {
      tokenSource: () => [tokenA]
    });
    await expect(repository.claimAvailable(claimInput(1))).rejects.toThrow(
      "outside the requested tenant"
    );
  });

  it("renews only an exact lease and keeps repeated early renewals TTL-bounded", async () => {
    const locked = {
      ...leasedRow(),
      db_now: dbNow
    };
    const renewed = leasedRow({
      leaseRevision: "2",
      revision: "3",
      expiresAt: t3,
      updatedAt: dbNow
    });
    const executor = new ScriptedTransactionExecutor([[locked], [renewed]]);
    const repository = createSqlInboxV2RepositoryOutbox(executor);

    const result = await repository.renewLease(renewInput());

    expect(result).toMatchObject({
      outcome: "renewed",
      work: { tenantId, intentId: intent1, state: "leased", revision: "3" }
    });
    expect(executor.queries).toHaveLength(2);
    const lockSql = normalizeSql(executor.renderedQueries[0]!.sql);
    const renewSql = normalizeSql(executor.renderedQueries[1]!.sql);
    expect(lockSql).toContain("clock_timestamp() as db_now");
    expect(lockSql).toContain("for update of work");
    expect(renewSql).toContain("work.lease_owner_id =");
    expect(renewSql).toContain("work.lease_token_hash =");
    expect(renewSql).toContain("work.lease_revision =");
    expect(renewSql).toContain("work.lease_expires_at >");
    expect(renewSql).toContain("work.revision =");
    expect(renewSql).toContain("greatest(");
    expect(renewSql).toContain("::timestamptz + make_interval(secs =>");
    expect(renewSql).not.toContain(") + make_interval(secs =>");
    expect(executor.renderedQueries[1]!.params).toContain(tokenHashA);
    expect(executor.renderedQueries[1]!.params).not.toContain(tokenA);
    executor.expectExhausted();
  });

  it.each([
    ["not_found", []],
    ["not_leased", [{ ...pendingRow(), db_now: dbNow }]],
    [
      "stale_token",
      [{ ...leasedRow({ tokenHash: tokenHashB }), db_now: dbNow }]
    ],
    ["lease_expired", [{ ...leasedRow({ expiresAt: t1 }), db_now: dbNow }]],
    [
      "lease_revision_conflict",
      [{ ...leasedRow({ leaseRevision: "2" }), db_now: dbNow }]
    ]
  ] as const)(
    "maps renew failure %s without attempting a write",
    async (outcome, rows) => {
      const executor = new ScriptedTransactionExecutor([rows]);
      const result =
        await createSqlInboxV2RepositoryOutbox(executor).renewLease(
          renewInput()
        );

      expect(result.outcome).toBe(outcome);
      expect(executor.queries).toHaveLength(1);
      executor.expectExhausted();
    }
  );

  it("persists retry, processed and dead outcomes before the fenced work transition", async () => {
    const cases = [
      {
        instruction: {
          kind: "retry" as const,
          resultHash: hashB,
          errorCode: "core:outbox.retryable",
          retryAfterSeconds: 60
        },
        resultOutcome: "retry_scheduled",
        work: retryWorkRow()
      },
      {
        instruction: {
          kind: "processed" as const,
          resultHash: hashB,
          resultReference: resultReference()
        },
        resultOutcome: "processed",
        work: terminalWorkRow("processed")
      },
      {
        instruction: {
          kind: "dead" as const,
          resultHash: hashB,
          errorCode: "core:outbox.terminal",
          resultReference: null
        },
        resultOutcome: "dead",
        work: terminalWorkRow("dead")
      }
    ];

    for (const testCase of cases) {
      const executor = new ScriptedTransactionExecutor([
        [{ ...leasedRow(), db_now: dbNow }],
        [{ outcome_revision: "3" }],
        [testCase.work],
        []
      ]);
      const repository = createSqlInboxV2RepositoryOutbox(executor);
      const input = finalizeInput(testCase.instruction);

      const result = await repository.finalize(input);

      expect(result.outcome).toBe(testCase.resultOutcome);
      expect(executor.queries).toHaveLength(4);
      const statements = executor.renderedQueries.map(({ sql }) =>
        normalizeSql(sql)
      );
      expect(statements[0]).toContain("for update of work");
      expect(statements[1]).toContain(
        "insert into public.inbox_v2_outbox_outcomes"
      );
      expect(statements[2]).toContain(
        "update public.inbox_v2_outbox_work_items work"
      );
      expect(statements[3]).toBe("set constraints all immediate");
      expect(statements[2]).toContain("work.lease_owner_id =");
      expect(statements[2]).toContain("work.lease_token_hash =");
      expect(statements[2]).toContain("work.lease_revision =");
      expect(statements[2]).toContain("work.lease_expires_at >");
      expect(executor.renderedQueries[1]!.params).toContain(tokenHashA);
      expect(executor.renderedQueries[2]!.params).toContain(tokenHashA);
      expect(
        executor.renderedQueries.flatMap(({ params }) => params)
      ).not.toContain(tokenA);
      executor.expectExhausted();
    }
  });

  it("returns stale-token finalization without inserting an outcome", async () => {
    const executor = new ScriptedTransactionExecutor([
      [{ ...leasedRow({ tokenHash: tokenHashB }), db_now: dbNow }]
    ]);
    const result = await createSqlInboxV2RepositoryOutbox(executor).finalize(
      finalizeInput({
        kind: "processed",
        resultHash: hashB,
        resultReference: null
      })
    );

    expect(result).toMatchObject({ outcome: "stale_token" });
    expect(executor.queries).toHaveLength(1);
    executor.expectExhausted();
  });

  it("fails closed when a locked row crosses tenant or contains incoherent groups", async () => {
    const crossTenant = new ScriptedTransactionExecutor([
      [{ ...leasedRow({ tenantId: otherTenantId }), db_now: dbNow }]
    ]);
    await expect(
      createSqlInboxV2RepositoryOutbox(crossTenant).renewLease(renewInput())
    ).rejects.toThrow("outside the requested tenant");

    const incoherent = new ScriptedTransactionExecutor([
      [
        {
          ...leasedRow(),
          terminal_result_hash: hashB,
          db_now: dbNow
        }
      ]
    ]);
    await expect(
      createSqlInboxV2RepositoryOutbox(incoherent).renewLease(renewInput())
    ).rejects.toThrow("incoherent terminal result group");
  });

  it("keeps all standalone renew/finalize builders tenant and token fenced", () => {
    const renew = renderQuery(
      buildRenewInboxV2OutboxLeaseSql({
        input: renewInput(),
        tokenHash: tokenHashA,
        dbNow,
        expectedWorkRevision: "2"
      })
    );
    const finalizedInput = finalizeInput({
      kind: "processed",
      resultHash: hashB,
      resultReference: resultReference()
    });
    const outcome = renderQuery(
      buildInsertInboxV2OutboxOutcomeSql({
        input: finalizedInput,
        tokenHash: tokenHashA,
        dbNow,
        outcomeRevision: "3"
      })
    );
    const finalize = renderQuery(
      buildFinalizeInboxV2OutboxSql({
        input: finalizedInput,
        tokenHash: tokenHashA,
        dbNow,
        expectedWorkRevision: "2",
        outcomeRevision: "3"
      })
    );
    const normalizedRenew = renewInput();
    const lock = renderQuery(
      buildLockInboxV2OutboxWorkSql({
        context: normalizedRenew.context,
        intentId: normalizedRenew.intentId
      })
    );

    for (const rendered of [renew, outcome, finalize, lock]) {
      expect(rendered.params).toContain(tenantId);
      expect(rendered.params).not.toContain(tokenA);
    }
    expect(outcome.params).toContain(tokenHashA);
    expect(finalize.params).toContain(tokenHashA);
    expect(normalizeSql(outcome.sql)).toContain("outcome_revision");
    expect(normalizeSql(finalize.sql)).toContain("and work.revision =");
  });
});

function claimInput(batchSize = 1) {
  return inboxV2ClaimOutboxInputSchema.parse({
    context: { tenantId },
    workerId,
    leaseDurationSeconds: 60,
    batchSize
  });
}

function renewInput() {
  return inboxV2RenewOutboxLeaseInputSchema.parse({
    context: { tenantId },
    intentId: intent1,
    workerId,
    leaseToken: tokenA,
    expectedLeaseRevision: "1",
    leaseDurationSeconds: 30
  });
}

function finalizeInput(instruction: unknown) {
  return inboxV2FinalizeOutboxInputSchema.parse({
    context: { tenantId },
    intentId: intent1,
    workerId,
    leaseToken: tokenA,
    expectedLeaseRevision: "1",
    instruction
  });
}

function resultReference() {
  return {
    tenantId,
    recordId: "outbox-result:db007",
    schemaId: "core:inbox-v2.outbox-result",
    schemaVersion: "v1",
    digest: hashA
  };
}

type RowOverrides = Readonly<{
  tenantId?: string;
  intentId?: string;
  tokenHash?: string;
  leaseRevision?: string;
  attemptCount?: string;
  revision?: string;
  claimedAt?: string;
  expiresAt?: string;
  updatedAt?: string;
  previous_state?: string;
  claim_ordinal?: number;
}>;

function leasedRow(overrides: RowOverrides = {}) {
  return {
    tenant_id: overrides.tenantId ?? tenantId,
    intent_id: overrides.intentId ?? intent1,
    state: "leased",
    attempt_count: overrides.attemptCount ?? "1",
    available_at: t0,
    lease_owner_id: workerId,
    lease_token_hash: overrides.tokenHash ?? tokenHashA,
    lease_revision: overrides.leaseRevision ?? "1",
    lease_claimed_at: overrides.claimedAt ?? t1,
    lease_expires_at: overrides.expiresAt ?? t2,
    last_retry_result_hash: null,
    last_retry_error_code: null,
    last_retry_available_at: null,
    last_retry_recorded_at: null,
    terminal_result_hash: null,
    terminal_error_code: null,
    terminal_result_reference: null,
    terminal_finalized_at: null,
    revision: overrides.revision ?? "2",
    created_at: t0,
    updated_at: overrides.updatedAt ?? t1,
    ...(overrides.previous_state === undefined
      ? {}
      : { previous_state: overrides.previous_state }),
    ...(overrides.claim_ordinal === undefined
      ? {}
      : { claim_ordinal: overrides.claim_ordinal })
  };
}

function pendingRow() {
  return {
    tenant_id: tenantId,
    intent_id: intent1,
    state: "pending",
    attempt_count: "0",
    available_at: t0,
    lease_owner_id: null,
    lease_token_hash: null,
    lease_revision: null,
    lease_claimed_at: null,
    lease_expires_at: null,
    last_retry_result_hash: null,
    last_retry_error_code: null,
    last_retry_available_at: null,
    last_retry_recorded_at: null,
    terminal_result_hash: null,
    terminal_error_code: null,
    terminal_result_reference: null,
    terminal_finalized_at: null,
    revision: "1",
    created_at: t0,
    updated_at: t0
  };
}

function retryWorkRow() {
  return {
    ...pendingRow(),
    attempt_count: "1",
    available_at: t3,
    last_retry_result_hash: hashB,
    last_retry_error_code: "core:outbox.retryable",
    last_retry_available_at: t3,
    last_retry_recorded_at: dbNow,
    revision: "3",
    updated_at: dbNow
  };
}

function terminalWorkRow(state: "processed" | "dead") {
  return {
    ...pendingRow(),
    state,
    attempt_count: "1",
    available_at: null,
    terminal_result_hash: hashB,
    terminal_error_code: state === "dead" ? "core:outbox.terminal" : null,
    terminal_result_reference: state === "processed" ? resultReference() : null,
    terminal_finalized_at: dbNow,
    revision: "3",
    updated_at: dbNow
  };
}

class ScriptedTransactionExecutor implements InboxV2RepositoryOutboxTransactionExecutor {
  readonly queries: SQL[] = [];
  readonly renderedQueries: Array<{ sql: string; params: unknown[] }> = [];
  transactionCount = 0;
  private readonly responses: Array<readonly Record<string, unknown>[]>;

  constructor(responses: readonly (readonly Record<string, unknown>[])[]) {
    this.responses = responses.map((rows) => [...rows]);
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
    work: (transaction: RawSqlExecutor) => Promise<TResult>
  ): Promise<TResult> {
    this.transactionCount += 1;
    return work(this);
  }

  expectExhausted(): void {
    expect(this.responses).toHaveLength(0);
  }
}

function renderQuery(query: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(query);
}

function normalizeSql(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLowerCase();
}
