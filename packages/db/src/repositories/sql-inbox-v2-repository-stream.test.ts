import {
  inboxV2LoadTenantStreamSnapshotInputSchema,
  inboxV2ReplayTenantStreamInputSchema
} from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { InboxV2PersistenceInvariantError } from "./sql-inbox-v2-conversation-repository";
import {
  buildListInboxV2TenantStreamChangesSql,
  buildListInboxV2TenantStreamCommitsSql,
  buildLoadInboxV2TenantStreamSnapshotSql,
  createSqlInboxV2TenantStreamRepository,
  type InboxV2TenantStreamTransactionExecutor
} from "./sql-inbox-v2-repository-stream";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const tenantId = "tenant:stream-repository";
const otherTenantId = "tenant:other-stream";
const streamEpoch = "stream:epoch:0001";
const capturedAt = "2026-07-15T10:00:00.000Z";
const hashA = `sha256:${"a".repeat(64)}`;

describe("SQL Inbox V2 tenant stream repository", () => {
  it("uses tenant/epoch/position keysets and commit-first child loading", () => {
    const head = renderQuery(buildLoadInboxV2TenantStreamSnapshotSql(tenantId));
    const commits = renderQuery(
      buildListInboxV2TenantStreamCommitsSql({
        tenantId,
        streamEpoch,
        afterPosition: "4",
        throughPosition: "9",
        limit: 2
      })
    );
    const changes = renderQuery(
      buildListInboxV2TenantStreamChangesSql({
        tenantId,
        streamEpoch,
        commitIds: [commitId("5"), commitId("6")]
      })
    );

    expect(normalizeSql(head.sql)).toContain("where tenant_id = $1");
    expect(head.params).toEqual([tenantId]);
    expect(normalizeSql(commits.sql)).toContain(
      "and (tenant_id, stream_epoch, position) >"
    );
    expect(normalizeSql(commits.sql)).toContain(
      "and (tenant_id, stream_epoch, position) <="
    );
    expect(normalizeSql(commits.sql)).toContain(
      "order by tenant_id, stream_epoch, position limit"
    );
    expect(commits.params.at(-1)).toBe(3);
    expect(normalizeSql(changes.sql)).toContain(
      "join inbox_v2_tenant_stream_commits commit_row"
    );
    expect(normalizeSql(changes.sql)).toContain(
      "change_row.stream_commit_id in"
    );
    expect(normalizeSql(changes.sql)).toContain(
      "order by change_row.tenant_id, commit_row.stream_epoch, change_row.stream_position, change_row.ordinal"
    );
    expect(changes.params).toEqual([
      tenantId,
      streamEpoch,
      commitId("5"),
      commitId("6")
    ]);
  });

  it("loads and maps one strict tenant snapshot in a read-only repeatable snapshot", async () => {
    const executor = new ScriptedStreamExecutor([[headRow("7", "2")]]);
    const repository = createSqlInboxV2TenantStreamRepository(executor);

    const result = await repository.loadSnapshot(
      inboxV2LoadTenantStreamSnapshotInputSchema.parse({
        context: { tenantId }
      })
    );

    expect(result).toEqual({
      outcome: "found",
      tenantId,
      snapshot: {
        tenantId,
        streamEpoch,
        lastPosition: "7",
        minRetainedPosition: "2",
        capturedAt
      }
    });
    expect(executor.transactionConfigs).toEqual([
      { isolationLevel: "repeatable read", accessMode: "read only" }
    ]);
    expect(executor.normalizedStatements()).toEqual([
      expect.stringContaining("from inbox_v2_tenant_stream_heads")
    ]);
    executor.expectExhausted();
  });

  it("maps tombstone state_reason_id and exact ordinal manifests", async () => {
    const executor = new ScriptedStreamExecutor([
      [headRow("1")],
      [commitRow("1")],
      [changeRow("1")]
    ]);
    const repository = createSqlInboxV2TenantStreamRepository(executor);

    const result = await repository.replayBounded(replayInput());

    expect(result).toMatchObject({
      outcome: "page",
      page: {
        tenantId,
        streamEpoch,
        snapshotPosition: "1",
        throughInclusive: "1",
        scannedThrough: "1",
        hasMore: false,
        nextAfterPosition: null,
        commits: [
          {
            commit: { id: commitId("1"), position: "1" },
            changes: [
              {
                reference: { ordinal: "1", streamPosition: "1" },
                state: {
                  kind: "tombstone",
                  reasonId: "core:privacy-erased"
                }
              }
            ]
          }
        ]
      }
    });
    expect(executor.normalizedStatements().map(statementKind)).toEqual([
      "head",
      "commits",
      "changes"
    ]);
    executor.expectExhausted();
  });

  it("distinguishes missing, epoch, expired, future and observed-gap outcomes", async () => {
    await expect(
      createSqlInboxV2TenantStreamRepository(
        new ScriptedStreamExecutor([[]])
      ).replayBounded(replayInput())
    ).resolves.toEqual({ outcome: "not_found", tenantId });

    await expect(
      createSqlInboxV2TenantStreamRepository(
        new ScriptedStreamExecutor([
          [headRow("3", "0", { stream_epoch: "stream:epoch:0002" })]
        ])
      ).replayBounded(replayInput())
    ).resolves.toEqual({
      outcome: "epoch_mismatch",
      tenantId,
      currentStreamEpoch: "stream:epoch:0002"
    });

    await expect(
      createSqlInboxV2TenantStreamRepository(
        new ScriptedStreamExecutor([[headRow("3", "2")]])
      ).replayBounded(replayInput({ afterPosition: "0" }))
    ).resolves.toEqual({
      outcome: "cursor_expired",
      tenantId,
      minRetainedPosition: "2"
    });

    await expect(
      createSqlInboxV2TenantStreamRepository(
        new ScriptedStreamExecutor([
          [headRow("3", "2")],
          [commitRow("2")],
          [changeRow("2")]
        ])
      ).replayBounded(replayInput({ afterPosition: "1", throughPosition: "2" }))
    ).resolves.toMatchObject({
      outcome: "page",
      page: {
        minRetainedPosition: "2",
        fromExclusive: "1",
        commits: [{ commit: { position: "2" } }]
      }
    });

    await expect(
      createSqlInboxV2TenantStreamRepository(
        new ScriptedStreamExecutor([[headRow("1")]])
      ).replayBounded(replayInput({ afterPosition: "2", throughPosition: "3" }))
    ).resolves.toEqual({
      outcome: "cursor_future",
      tenantId,
      lastPosition: "1"
    });

    const gapExecutor = new ScriptedStreamExecutor([
      [headRow("3")],
      [commitRow("2")]
    ]);
    await expect(
      createSqlInboxV2TenantStreamRepository(gapExecutor).replayBounded(
        replayInput({ throughPosition: "3" })
      )
    ).resolves.toEqual({
      outcome: "gap_detected",
      tenantId,
      expectedPosition: "1",
      observedPosition: "2"
    });
    expect(gapExecutor.normalizedStatements().map(statementKind)).toEqual([
      "head",
      "commits"
    ]);
  });

  it("clamps through to the captured high-water and never skips a lower in-flight commit", async () => {
    const executor = new ScriptedStreamExecutor([
      // First snapshot cannot see the still in-flight positions 2 and 3.
      [headRow("1")],
      [commitRow("1")],
      [changeRow("1")],
      // They become committed only before the next REPEATABLE READ snapshot.
      [headRow("3")],
      [commitRow("2"), commitRow("3")],
      [changeRow("2"), changeRow("3")]
    ]);
    const repository = createSqlInboxV2TenantStreamRepository(executor);

    const first = await repository.replayBounded(
      replayInput({ throughPosition: "3" })
    );
    const second = await repository.replayBounded(
      replayInput({ afterPosition: "1", throughPosition: "3" })
    );

    expect(pagePositions(first)).toEqual(["1"]);
    expect(first).toMatchObject({
      outcome: "page",
      page: {
        snapshotPosition: "1",
        throughInclusive: "1",
        hasMore: false
      }
    });
    expect(pagePositions(second)).toEqual(["2", "3"]);
    expect(second).toMatchObject({
      outcome: "page",
      page: {
        fromExclusive: "1",
        snapshotPosition: "3",
        throughInclusive: "3",
        scannedThrough: "3"
      }
    });
    expect(executor.transactionConfigs).toEqual([
      { isolationLevel: "repeatable read", accessMode: "read only" },
      { isolationLevel: "repeatable read", accessMode: "read only" }
    ]);
    executor.expectExhausted();
  });

  it("returns a commit-limited continuation without loading later children", async () => {
    const executor = new ScriptedStreamExecutor([
      [headRow("3")],
      [commitRow("1"), commitRow("2")],
      [changeRow("1")]
    ]);
    const result = await createSqlInboxV2TenantStreamRepository(
      executor
    ).replayBounded(replayInput({ limit: 1, throughPosition: "3" }));

    expect(pagePositions(result)).toEqual(["1"]);
    expect(result).toMatchObject({
      outcome: "page",
      page: {
        scannedThrough: "1",
        hasMore: true,
        nextAfterPosition: "1"
      }
    });
    expect(executor.queries).toHaveLength(3);
    executor.expectExhausted();
  });

  it("fails closed when any mapped row escapes the explicit tenant or tombstone contract", async () => {
    const crossTenant = new ScriptedStreamExecutor([
      [headRow("1")],
      [commitRow("1", { tenant_id: otherTenantId })]
    ]);
    await expect(
      createSqlInboxV2TenantStreamRepository(crossTenant).replayBounded(
        replayInput()
      )
    ).rejects.toBeInstanceOf(InboxV2PersistenceInvariantError);

    const missingReason = new ScriptedStreamExecutor([
      [headRow("1")],
      [commitRow("1")],
      [changeRow("1", { state_reason_id: null })]
    ]);
    await expect(
      createSqlInboxV2TenantStreamRepository(missingReason).replayBounded(
        replayInput()
      )
    ).rejects.toBeInstanceOf(InboxV2PersistenceInvariantError);
  });
});

class ScriptedStreamExecutor implements InboxV2TenantStreamTransactionExecutor {
  readonly queries: SQL[] = [];
  readonly transactionConfigs: Array<{
    isolationLevel: "repeatable read";
    accessMode: "read only";
  }> = [];

  constructor(
    private readonly steps: Array<readonly Record<string, unknown>[]>
  ) {}

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(query);
    const rows = this.steps.shift();
    if (rows === undefined) {
      throw new Error(`No scripted rows for ${renderQuery(query).sql}`);
    }
    return { rows: rows as readonly Row[] };
  }

  async transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config: Readonly<{
      isolationLevel: "repeatable read";
      accessMode: "read only";
    }>
  ): Promise<TResult> {
    this.transactionConfigs.push({ ...config });
    return work(this);
  }

  normalizedStatements(): string[] {
    return this.queries.map((query) => normalizeSql(renderQuery(query).sql));
  }

  expectExhausted(): void {
    expect(this.steps).toHaveLength(0);
  }
}

function replayInput(
  overrides: Readonly<{
    afterPosition?: string;
    throughPosition?: string;
    limit?: number;
  }> = {}
) {
  return inboxV2ReplayTenantStreamInputSchema.parse({
    context: { tenantId },
    streamEpoch,
    afterPosition: overrides.afterPosition ?? "0",
    throughPosition: overrides.throughPosition ?? "1",
    limit: overrides.limit ?? 10
  });
}

function headRow(
  lastPosition: string,
  minRetainedPosition = "0",
  overrides: Readonly<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    stream_epoch: streamEpoch,
    last_position: lastPosition,
    min_retained_position: minRetainedPosition,
    captured_at: new Date(capturedAt),
    ...overrides
  };
}

function commitRow(
  position: string,
  overrides: Readonly<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    id: commitId(position),
    stream_epoch: streamEpoch,
    position,
    previous_position: String(BigInt(position) - 1n),
    schema_version: "v1",
    correlation_id: `correlation:stream-${position}`,
    command_ids: [],
    client_mutation_ids: [],
    authorization_decision_refs: [],
    change_ids: [changeId(position)],
    event_ids: [`event:stream-${position}`],
    outbox_intent_ids: [],
    audience_impact_kind: "none",
    audience_impact_manifest: { kind: "none" },
    change_count: "1",
    event_count: "1",
    outbox_intent_count: "0",
    committed_at: new Date(capturedAt),
    commit_hash: hashA,
    ...overrides
  };
}

function changeRow(
  position: string,
  overrides: Readonly<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    id: changeId(position),
    stream_commit_id: commitId(position),
    stream_position: position,
    ordinal: "1",
    entity_type_id: "core:message",
    entity_id: `message:stream-${position}`,
    resulting_revision: "1",
    timeline: null,
    audience: "conversation_external",
    state_kind: "tombstone",
    state_schema_id: null,
    state_schema_version: null,
    state_reason_id: "core:privacy-erased",
    state_hash: hashA,
    payload_reference: null,
    domain_commit_reference: {
      tenantId,
      recordId: `domain-commit:stream-${position}`,
      schemaId: "core:inbox-v2.message-tombstone",
      schemaVersion: "v1",
      digest: hashA
    },
    ...overrides
  };
}

function commitId(position: string): string {
  return `commit:stream-${position}`;
}

function changeId(position: string): string {
  return `change:stream-${position}`;
}

function pagePositions(result: unknown): string[] {
  if (
    typeof result !== "object" ||
    result === null ||
    !("outcome" in result) ||
    result.outcome !== "page" ||
    !("page" in result) ||
    typeof result.page !== "object" ||
    result.page === null ||
    !("commits" in result.page) ||
    !Array.isArray(result.page.commits)
  ) {
    throw new Error("Expected a tenant stream replay page.");
  }
  return result.page.commits.map((entry) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("commit" in entry) ||
      typeof entry.commit !== "object" ||
      entry.commit === null ||
      !("position" in entry.commit)
    ) {
      throw new Error("Expected a replay commit.");
    }
    return String(entry.commit.position);
  });
}

function statementKind(statement: string): string {
  if (statement.includes("from inbox_v2_tenant_stream_heads")) return "head";
  if (statement.includes("from inbox_v2_tenant_stream_commits")) {
    return "commits";
  }
  if (statement.includes("from inbox_v2_tenant_stream_changes")) {
    return "changes";
  }
  return "unknown";
}

function renderQuery(query: SQL): { sql: string; params: unknown[] } {
  const rendered = new PgDialect().sqlToQuery(query);
  return { sql: rendered.sql, params: [...rendered.params] };
}

function normalizeSql(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}
