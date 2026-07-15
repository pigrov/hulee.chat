import { calculateInboxV2CanonicalSha256 } from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";
import {
  buildSelectProjectionSnapshotSql,
  createSqlInboxV2RepositoryProjection,
  createSqlInboxV2RepositoryRetainedPrefix,
  type InboxV2RepositoryProjectionTransactionExecutor
} from "./sql-inbox-v2-repository-projection";

const tenantId = "tenant:tenant-1";
const otherTenantId = "tenant:tenant-2";
const projectionId = "core:inbox-recipient-projection";
const scopeId = "scope:employee-1";
const streamEpoch = "stream:epoch:0001";
const otherStreamEpoch = "stream:epoch:0002";
const initializedAt = "2026-07-15T09:00:00.000Z";
const activatedAt = "2026-07-15T09:01:00.000Z";
const cutoverAt = "2026-07-15T09:10:00.000Z";
const changedAt = "2026-07-15T09:20:00.000Z";
const retentionDbClock = "2026-07-15T09:19:30.000Z";

describe("SQL Inbox V2 projection repository", () => {
  it("initializes generation, checkpoint and active head in one transaction", async () => {
    const executor = new ScriptedProjectionExecutor([
      [],
      [tenantStreamHeadRow()],
      [],
      [identityRow("2")],
      [identityRow("2")],
      [identityRow("2")],
      [projectionSnapshotRow({ state: "active", checkpoint: "0" })]
    ]);
    const repository = createSqlInboxV2RepositoryProjection(executor, {
      applyProjectionRows: vi.fn()
    });

    const result = await repository.initializeGeneration(
      initializeInput("active") as never
    );

    expect(result.outcome).toBe("initialized");
    expect(executor.transactionCount).toBe(1);
    expect(renderedSql(executor.queries[0]!)).toContain(
      "where generation_row.tenant_id = $1"
    );
    expect(renderedParams(executor.queries[0]!)).toContain(tenantId);
    expect(executor.queries.map(renderedSql)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("insert into inbox_v2_projection_generations"),
        expect.stringContaining("insert into inbox_v2_projection_checkpoints"),
        expect.stringContaining("insert into inbox_v2_projection_heads")
      ])
    );
  });

  it("loads and recognizes an exactly idempotent shadow initialization", async () => {
    const existing = projectionSnapshotRow({
      state: "shadow",
      checkpoint: "0",
      generationRevision: "1"
    });
    const initializeExecutor = new ScriptedProjectionExecutor([[existing]]);
    const repository = createSqlInboxV2RepositoryProjection(
      initializeExecutor,
      { applyProjectionRows: vi.fn() }
    );

    await expect(
      repository.initializeGeneration(initializeInput("shadow") as never)
    ).resolves.toMatchObject({ outcome: "already_initialized" });
    expect(initializeExecutor.queries).toHaveLength(1);

    const loadExecutor = new ScriptedProjectionExecutor([[existing]]);
    const loaded = await createSqlInboxV2RepositoryProjection(loadExecutor, {
      applyProjectionRows: vi.fn()
    }).loadGeneration(loadInput() as never);
    expect(loaded).toMatchObject({
      outcome: "found",
      snapshot: { generation: { tenantId, state: "shadow" } }
    });
    expect(loadExecutor.transactionCount).toBe(1);
  });

  it("initializes a non-zero bootstrap checkpoint without inventing a commit id", async () => {
    const bootstrap = {
      ...initializeInput("shadow"),
      initialPosition: "5"
    };
    const persisted = {
      ...projectionSnapshotRow({
        state: "shadow",
        checkpoint: "5",
        generationRevision: "1"
      }),
      last_commit_id: null
    };
    const executor = new ScriptedProjectionExecutor([
      [],
      [tenantStreamHeadRow()],
      [identityRow("2")],
      [identityRow("2")],
      [persisted]
    ]);

    const result = await createSqlInboxV2RepositoryProjection(executor, {
      applyProjectionRows: vi.fn()
    }).initializeGeneration(bootstrap as never);

    expect(result).toMatchObject({
      outcome: "initialized",
      snapshot: { checkpoint: { position: "5" } }
    });
    const checkpointInsert = executor.queries.find((query) =>
      renderedSql(query).includes("insert into inbox_v2_projection_checkpoints")
    );
    expect(checkpointInsert).toBeDefined();
    expect(renderedSql(checkpointInsert!)).toMatch(
      /position, last_commit_id,[\s\S]*values \([\s\S]*\$[0-9]+, null, 1,/u
    );
  });

  it("applies relevant projection rows before advancing the locked checkpoint", async () => {
    const executor = new ScriptedProjectionExecutor([
      [projectionSnapshotRow({ state: "active", checkpoint: "4" })],
      [checkpointUpdateRow("5", "2")]
    ]);
    const applyProjectionRows = vi.fn(
      async ({ executor: callbackExecutor }) => {
        expect(callbackExecutor).toBe(executor);
        expect(executor.queries).toHaveLength(1);
      }
    );
    const repository = createSqlInboxV2RepositoryProjection(executor, {
      applyProjectionRows
    });

    const result = await repository.applyContiguous(
      applyInput("5", "relevant") as never
    );

    expect(result).toMatchObject({
      outcome: "applied",
      transition: {
        before: { position: "4" },
        after: { position: "5" },
        disposition: "applied"
      }
    });
    expect(applyProjectionRows).toHaveBeenCalledOnce();
    expect(renderedSql(executor.queries[0]!)).toContain(
      "for update of generation_row, checkpoint_row"
    );
    expect(renderedSql(executor.queries[1]!)).toMatch(
      /update inbox_v2_projection_checkpoints[\s\S]*tenant_id = \$[0-9]+[\s\S]*position = \$[0-9]+[\s\S]*revision = \$[0-9]+/u
    );
  });

  it("advances irrelevant commits without invoking the projection callback", async () => {
    const executor = new ScriptedProjectionExecutor([
      [projectionSnapshotRow({ state: "shadow", checkpoint: "4" })],
      [checkpointUpdateRow("5", "2")]
    ]);
    const applyProjectionRows = vi.fn();

    const result = await createSqlInboxV2RepositoryProjection(executor, {
      applyProjectionRows
    }).applyContiguous(applyInput("5", "irrelevant") as never);

    expect(result).toMatchObject({
      outcome: "advanced_irrelevant",
      transition: { disposition: "irrelevant" }
    });
    expect(applyProjectionRows).not.toHaveBeenCalled();
    expect(executor.queries).toHaveLength(2);
  });

  it.each([
    {
      label: "missing generation",
      row: null,
      input: applyInput("5", "relevant"),
      outcome: "generation_not_found"
    },
    {
      label: "duplicate",
      row: projectionSnapshotRow({ checkpoint: "5" }),
      input: applyInput("5", "relevant", "5"),
      outcome: "duplicate"
    },
    {
      label: "gap",
      row: projectionSnapshotRow({ checkpoint: "4" }),
      input: applyInput("6", "relevant"),
      outcome: "gap_detected"
    },
    {
      label: "epoch mismatch",
      row: projectionSnapshotRow({ checkpoint: "4" }),
      input: {
        ...applyInput("5", "relevant"),
        input: {
          ...applyInput("5", "relevant").input,
          streamEpoch: otherStreamEpoch
        }
      },
      outcome: "epoch_mismatch"
    },
    {
      label: "schema unsupported",
      row: projectionSnapshotRow({ checkpoint: "4" }),
      input: {
        ...applyInput("5", "relevant"),
        input: {
          ...applyInput("5", "relevant").input,
          commitSchemaVersion: "v2"
        }
      },
      outcome: "schema_unsupported"
    },
    {
      label: "retired generation",
      row: projectionSnapshotRow({
        state: "retired",
        checkpoint: "4",
        generationRevision: "3"
      }),
      input: applyInput("5", "relevant"),
      outcome: "generation_retired"
    },
    {
      label: "checkpoint conflict",
      row: projectionSnapshotRow({ checkpoint: "4" }),
      input: applyInput("5", "relevant", "3"),
      outcome: "checkpoint_conflict"
    }
  ])("classifies $label without touching projection rows", async (fixture) => {
    const executor = new ScriptedProjectionExecutor([
      fixture.row === null ? [] : [fixture.row]
    ]);
    const applyProjectionRows = vi.fn();

    const result = await createSqlInboxV2RepositoryProjection(executor, {
      applyProjectionRows
    }).applyContiguous(fixture.input as never);

    expect(result.outcome).toBe(fixture.outcome);
    expect(executor.queries).toHaveLength(1);
    expect(applyProjectionRows).not.toHaveBeenCalled();
  });

  it("does not advance the checkpoint when the projection callback fails", async () => {
    const executor = new ScriptedProjectionExecutor([
      [projectionSnapshotRow({ checkpoint: "4" })]
    ]);
    const failure = new Error("projection row write failed");
    const repository = createSqlInboxV2RepositoryProjection(executor, {
      applyProjectionRows: async () => {
        throw failure;
      }
    });

    await expect(
      repository.applyContiguous(applyInput("5", "relevant") as never)
    ).rejects.toBe(failure);
    expect(executor.queries).toHaveLength(1);
  });

  it("atomically retires the old active generation before activating and publishing the shadow", async () => {
    const executor = new ScriptedProjectionExecutor([
      [projectionHeadRow("1")],
      [
        projectionSnapshotRow({
          state: "shadow",
          generation: "2",
          checkpoint: "10"
        })
      ],
      [
        projectionSnapshotRow({
          state: "active",
          generation: "1",
          checkpoint: "10",
          generationRevision: "2"
        })
      ],
      [identityRow("1")],
      [identityRow("2")],
      [identityRow("2")],
      [
        projectionSnapshotRow({
          state: "active",
          generation: "2",
          checkpoint: "10",
          generationRevision: "2",
          activated: cutoverAt,
          updated: cutoverAt
        })
      ]
    ]);

    const result = await createSqlInboxV2RepositoryProjection(executor, {
      applyProjectionRows: vi.fn()
    }).cutoverGeneration(cutoverInput() as never);

    expect(result).toMatchObject({
      outcome: "cut_over",
      previousActive: { generation: { syncGeneration: "1", state: "active" } },
      active: { generation: { syncGeneration: "2", state: "active" } }
    });
    const statements = executor.queries.map(renderedSql);
    const retired = statements.findIndex((statement) =>
      statement.includes("set state = 'retired'")
    );
    const activated = statements.findIndex((statement) =>
      statement.includes("set state = 'active'")
    );
    const published = statements.findIndex((statement) =>
      statement.includes("update inbox_v2_projection_heads")
    );
    expect(retired).toBeGreaterThan(1);
    expect(activated).toBeGreaterThan(retired);
    expect(published).toBeGreaterThan(activated);
  });

  it("refuses to publish a shadow behind the current active checkpoint", async () => {
    const executor = new ScriptedProjectionExecutor([
      [projectionHeadRow("1")],
      [
        projectionSnapshotRow({
          state: "shadow",
          generation: "2",
          checkpoint: "9"
        })
      ],
      [
        projectionSnapshotRow({
          state: "active",
          generation: "1",
          checkpoint: "10",
          generationRevision: "2"
        })
      ]
    ]);

    const result = await createSqlInboxV2RepositoryProjection(executor, {
      applyProjectionRows: vi.fn()
    }).cutoverGeneration({
      ...cutoverInput(),
      expectedCandidateCheckpoint: "9",
      requiredThroughPosition: "9"
    } as never);

    expect(result).toEqual({
      outcome: "candidate_not_ready",
      currentCheckpoint: "9",
      requiredThroughPosition: "10"
    });
    expect(executor.queries).toHaveLength(3);
    expect(executor.queries.map(renderedSql).join(" ")).not.toMatch(
      /set state = '(?:retired|active)'|update inbox_v2_projection_heads/u
    );
  });

  it("returns already_cut_over without rewriting a published candidate", async () => {
    const executor = new ScriptedProjectionExecutor([
      [projectionHeadRow("2")],
      [
        projectionSnapshotRow({
          state: "active",
          generation: "2",
          checkpoint: "10",
          generationRevision: "2"
        })
      ]
    ]);
    const result = await createSqlInboxV2RepositoryProjection(executor, {
      applyProjectionRows: vi.fn()
    }).cutoverGeneration(cutoverInput() as never);

    expect(result.outcome).toBe("already_cut_over");
    expect(executor.queries).toHaveLength(2);
  });

  it("fails closed on a cross-tenant persistence row", async () => {
    const executor = new ScriptedProjectionExecutor([
      [projectionSnapshotRow({ tenant: otherTenantId })]
    ]);
    const repository = createSqlInboxV2RepositoryProjection(executor, {
      applyProjectionRows: vi.fn()
    });

    await expect(
      repository.loadGeneration(loadInput() as never)
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof CoreError && error.code === "tenant.boundary_violation"
    );
  });

  it("keeps tenant, generation and lock predicates in the snapshot SQL", () => {
    const rendered = render(
      buildSelectProjectionSnapshotSql(loadInput(), true)
    );
    expect(rendered.sql).toMatch(
      /tenant_id = \$1[\s\S]*projection_id = \$2[\s\S]*scope_id = \$3[\s\S]*generation = \$4/u
    );
    expect(rendered.sql).toContain(
      "for update of generation_row, checkpoint_row"
    );
    expect(rendered.params).toEqual([tenantId, projectionId, scopeId, "2"]);
  });
});

describe("SQL Inbox V2 retained-prefix repository", () => {
  it("prunes and audits a tenant-stream prefix in the same transaction as CAS", async () => {
    const executor = new ScriptedProjectionExecutor([
      [
        tenantStreamHeadRow({
          minimum: "1",
          revision: "2",
          dbNow: retentionDbClock
        })
      ],
      [
        {
          ...tenantStreamHeadRow({
            minimum: "5",
            revision: "3",
            updated: retentionDbClock
          }),
          id: "5",
          pruned_commit_count: "4"
        }
      ]
    ]);
    const repository = createSqlInboxV2RepositoryRetainedPrefix(executor, {
      tenantStreamRetentionReasonId: "core:retention.checkpoint-safe"
    });

    const result = await repository.compareAndSetRetainedPrefix(
      tenantRetainedInput() as never
    );

    expect(result).toMatchObject({
      outcome: "advanced",
      current: { minRetainedPosition: "5", revision: "3" }
    });
    expect(executor.transactionCount).toBe(1);
    expect(renderedSql(executor.queries[1]!)).toMatch(
      /inbox_v2_advance_tenant_stream_retained_prefix_v1/u
    );
    expect(renderedParams(executor.queries[1]!)).toEqual(
      expect.arrayContaining([
        tenantId,
        streamEpoch,
        "1",
        "5",
        "2",
        "5",
        "core:retention.checkpoint-safe"
      ])
    );
    const expectedAdvanceHash = calculateInboxV2CanonicalSha256({
      domain: "core:inbox-v2.tenant-stream-retention-advance",
      hashVersion: "v1",
      tenantId,
      streamEpoch,
      fromPosition: "1",
      toPosition: "5",
      expectedHeadRevision: "2",
      resultingHeadRevision: "3",
      mandatoryCheckpointFloor: "5",
      prunedCommitCount: "4",
      reasonId: "core:retention.checkpoint-safe",
      occurredAt: retentionDbClock
    });
    expect(renderedParams(executor.queries[1]!)).toContain(expectedAdvanceHash);
    expect(renderedParams(executor.queries[1]!)).toContain(retentionDbClock);
    expect(renderedParams(executor.queries[1]!)).not.toContain(changedAt);
    expect(renderedSql(executor.queries[1]!)).not.toMatch(/\bdelete\b/iu);
  });

  it("rolls back the logical advance when prune count is incoherent", async () => {
    const executor = new ScriptedProjectionExecutor([
      [tenantStreamHeadRow({ minimum: "1", revision: "2" })],
      [
        {
          ...tenantStreamHeadRow({
            minimum: "5",
            revision: "3",
            updated: changedAt
          }),
          id: "5",
          pruned_commit_count: "3"
        }
      ]
    ]);
    const repository = createSqlInboxV2RepositoryRetainedPrefix(executor, {
      tenantStreamRetentionReasonId: "core:retention.checkpoint-safe"
    });

    await expect(
      repository.compareAndSetRetainedPrefix(tenantRetainedInput() as never)
    ).rejects.toThrow(/incoherent commit count/u);
    expect(executor.queries).toHaveLength(2);
  });

  it("advances a projection generation against its locked checkpoint without stream pruning", async () => {
    const executor = new ScriptedProjectionExecutor([
      [
        projectionSnapshotRow({
          state: "active",
          checkpoint: "10",
          minimum: "1",
          generationRevision: "2"
        })
      ],
      [
        projectionSnapshotRow({
          state: "active",
          checkpoint: "10",
          minimum: "5",
          generationRevision: "3",
          updated: changedAt
        })
      ]
    ]);
    const repository = createSqlInboxV2RepositoryRetainedPrefix(executor, {
      tenantStreamRetentionReasonId: "core:retention.checkpoint-safe"
    });

    const result = await repository.compareAndSetRetainedPrefix(
      projectionRetainedInput() as never
    );

    expect(result).toMatchObject({
      outcome: "advanced",
      current: {
        owner: { kind: "projection_generation", syncGeneration: "2" },
        minRetainedPosition: "5",
        headPosition: "10",
        revision: "3"
      }
    });
    expect(renderedSql(executor.queries[1]!)).toMatch(
      /update inbox_v2_projection_generations generation_row[\s\S]*from inbox_v2_projection_checkpoints checkpoint_row[\s\S]*<= checkpoint_row\.position/u
    );
    expect(renderedParams(executor.queries[1]!)).toContain(tenantId);
  });

  it.each([
    {
      label: "already applied",
      row: tenantStreamHeadRow({ minimum: "6", revision: "3" }),
      input: tenantRetainedInput(),
      outcome: "already_applied"
    },
    {
      label: "CAS conflict",
      row: tenantStreamHeadRow({ minimum: "2", revision: "3" }),
      input: tenantRetainedInput(),
      outcome: "conflict"
    },
    {
      label: "checkpoint blocked",
      row: tenantStreamHeadRow({
        minimum: "1",
        revision: "2",
        lastPosition: "3"
      }),
      input: tenantRetainedInput(),
      outcome: "checkpoint_blocked"
    },
    {
      label: "epoch not found",
      row: tenantStreamHeadRow({ epoch: otherStreamEpoch }),
      input: tenantRetainedInput(),
      outcome: "not_found"
    },
    {
      label: "head not found",
      row: null,
      input: tenantRetainedInput(),
      outcome: "not_found"
    }
  ])("returns $label before pruning", async (fixture) => {
    const executor = new ScriptedProjectionExecutor([
      fixture.row === null ? [] : [fixture.row]
    ]);
    const result = await createSqlInboxV2RepositoryRetainedPrefix(executor, {
      tenantStreamRetentionReasonId: "core:retention.checkpoint-safe"
    }).compareAndSetRetainedPrefix(fixture.input as never);

    expect(result.outcome).toBe(fixture.outcome);
    expect(executor.queries).toHaveLength(1);
  });
});

class ScriptedProjectionExecutor implements InboxV2RepositoryProjectionTransactionExecutor {
  readonly queries: SQL[] = [];
  transactionCount = 0;

  constructor(
    private readonly scriptedRows: Array<
      readonly Record<string, unknown>[]
    > = []
  ) {}

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(query);
    const rows = this.scriptedRows.shift();
    if (rows === undefined) {
      throw new Error(`No scripted rows for query: ${renderedSql(query)}`);
    }
    return { rows: rows as readonly Row[] };
  }

  async transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>
  ): Promise<TResult> {
    this.transactionCount += 1;
    return work(this);
  }
}

function initializeInput(state: "shadow" | "active") {
  return {
    context: { tenantId },
    projectionId,
    scopeId,
    streamEpoch,
    syncGeneration: "2",
    projectionSchemaVersion: "v1",
    initialPosition: "0",
    minRetainedPosition: "0",
    initialState: state,
    initializedAt
  };
}

function loadInput() {
  return {
    context: { tenantId },
    projectionId,
    scopeId,
    syncGeneration: "2"
  };
}

function applyInput(
  position: string,
  relevance: "relevant" | "irrelevant" | "unsupported_mandatory_schema",
  expectedCheckpoint = "4"
) {
  return {
    ...loadInput(),
    expectedCheckpoint,
    input: {
      tenantId,
      streamEpoch,
      commitId: `commit:commit-${position}`,
      commitSchemaVersion: "v1",
      streamPosition: position
    },
    relevance
  };
}

function cutoverInput() {
  return {
    context: { tenantId },
    projectionId,
    scopeId,
    expectedActiveGeneration: "1",
    candidateGeneration: "2",
    expectedCandidateCheckpoint: "10",
    requiredThroughPosition: "10",
    cutoverAt
  };
}

function tenantRetainedInput() {
  return {
    context: { tenantId },
    owner: { kind: "tenant_stream", streamEpoch },
    expectedRevision: "2",
    expectedMinRetainedPosition: "1",
    nextMinRetainedPosition: "5",
    mandatoryCheckpointFloor: "5",
    changedAt
  };
}

function projectionRetainedInput() {
  return {
    context: { tenantId },
    owner: {
      kind: "projection_generation",
      projectionId,
      scopeId,
      streamEpoch,
      syncGeneration: "2"
    },
    expectedRevision: "2",
    expectedMinRetainedPosition: "1",
    nextMinRetainedPosition: "5",
    mandatoryCheckpointFloor: "5",
    changedAt
  };
}

function projectionSnapshotRow(
  input: {
    tenant?: string;
    state?: "shadow" | "active" | "retired";
    generation?: string;
    checkpoint?: string;
    minimum?: string;
    generationRevision?: string;
    checkpointRevision?: string;
    activated?: string;
    updated?: string;
  } = {}
): Record<string, unknown> {
  const state = input.state ?? "active";
  const checkpoint = input.checkpoint ?? "5";
  const activated =
    state === "shadow" ? null : (input.activated ?? activatedAt);
  const retired = state === "retired" ? cutoverAt : null;
  return {
    tenant_id: input.tenant ?? tenantId,
    projection_id: projectionId,
    scope_id: scopeId,
    generation: input.generation ?? "2",
    stream_epoch: streamEpoch,
    projection_schema_version: "v1",
    generation_state: state,
    min_retained_position: input.minimum ?? "0",
    generation_revision:
      input.generationRevision ??
      (state === "shadow" ? "1" : state === "active" ? "2" : "3"),
    initialized_at: initializedAt,
    activated_at: activated,
    retired_at: retired,
    generation_updated_at:
      input.updated ?? retired ?? activated ?? initializedAt,
    checkpoint_position: checkpoint,
    last_commit_id: checkpoint === "0" ? null : `commit:commit-${checkpoint}`,
    checkpoint_revision: input.checkpointRevision ?? "1",
    checkpoint_created_at: initializedAt,
    checkpoint_updated_at: input.updated ?? initializedAt
  };
}

function checkpointUpdateRow(position: string, revision: string) {
  return {
    tenant_id: tenantId,
    projection_id: projectionId,
    scope_id: scopeId,
    generation: "2",
    stream_epoch: streamEpoch,
    position,
    last_commit_id: `commit:commit-${position}`,
    revision,
    updated_at: activatedAt
  };
}

function projectionHeadRow(generation: string) {
  return {
    tenant_id: tenantId,
    projection_id: projectionId,
    scope_id: scopeId,
    current_generation: generation,
    stream_epoch: streamEpoch,
    projection_schema_version: "v1",
    revision: "1",
    created_at: initializedAt,
    updated_at: activatedAt
  };
}

function tenantStreamHeadRow(
  input: {
    tenant?: string;
    epoch?: string;
    lastPosition?: string;
    minimum?: string;
    revision?: string;
    updated?: string;
    dbNow?: string;
  } = {}
) {
  return {
    tenant_id: input.tenant ?? tenantId,
    stream_epoch: input.epoch ?? streamEpoch,
    last_position: input.lastPosition ?? "10",
    min_retained_position: input.minimum ?? "0",
    revision: input.revision ?? "1",
    created_at: initializedAt,
    updated_at: input.updated ?? initializedAt,
    db_now: input.dbNow ?? changedAt
  };
}

function identityRow(id: string) {
  return { tenant_id: tenantId, id };
}

function render(query: SQL): { sql: string; params: unknown[] } {
  const rendered = new PgDialect().sqlToQuery(query);
  return { sql: rendered.sql, params: [...rendered.params] };
}

function renderedSql(query: SQL): string {
  return render(query).sql.replace(/\s+/gu, " ").trim();
}

function renderedParams(query: SQL): unknown[] {
  return render(query).params;
}
