import {
  calculateInboxV2DeletionRunMutableStateHash,
  inboxV2CommitDeletionStageOneInputSchema,
  inboxV2CreateDeletionRunInputSchema,
  inboxV2DeletionRunStateTransitionInputSchema,
  initialInboxV2DeletionRunMutableState,
  inboxV2Sha256DigestSchema
} from "@hulee/contracts";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";
import {
  buildFindInboxV2CurrentDeletionRunTerminalExportSql,
  buildInsertInboxV2DeletionStageOneTargetsSql,
  buildInsertInboxV2DeletionRunTerminalExportSql,
  buildCreateInboxV2DeletionRunSql,
  buildLockInboxV2DeletionRunSql,
  buildTransitionInboxV2DeletionRunSql,
  createSqlInboxV2DeletionRunStateRepository,
  type InboxV2CommitDeletionStageOneInput,
  type InboxV2CreateDeletionRunInput,
  type InboxV2DeletionRunStateTransactionExecutor,
  type TransitionInboxV2DeletionRunInput
} from "./sql-inbox-v2-deletion-run-state-repository";

describe("SQL Inbox V2 deletion-run state repository", () => {
  it("creates a run only from an exact plan and DB-derived frozen checkpoint counts", () => {
    const rendered = new PgDialect().sqlToQuery(
      buildCreateInboxV2DeletionRunSql(
        createRunInput(),
        "2026-07-15T05:00:00.000Z"
      )
    );
    expect(rendered.sql).toContain("frozen_checkpoint_counts");
    expect(rendered.sql).toContain("current_authority as materialized");
    expect(rendered.sql).toContain("plan.plan_hash = $");
    expect(rendered.sql).toContain(
      "inbox_v2_data_governance_policy_activation_heads"
    );
    expect(rendered.sql).toContain(
      "inbox_v2_data_governance_control_set_heads"
    );
    expect(rendered.sql).toContain("plan.earliest_execution_at <= $");
    expect(rendered.sql).toContain("::timestamptz <= $");
    expect(rendered.sql).toContain(
      "for share of plan, activation_head, control_head"
    );
    expect(rendered.sql).toContain("frozen.operated_count >= 1");
    expect(rendered.sql).toContain(
      "on conflict (tenant_id, run_id, revision) do nothing"
    );

    const lock = new PgDialect().sqlToQuery(
      buildLockInboxV2DeletionRunSql(createRunInput())
    );
    expect(lock.sql).toContain("pg_advisory_xact_lock");
    expect(lock.sql).toContain("clock_timestamp() as admitted_at");
    expect(lock.params).toEqual(["tenant:one", "run:one", "1"]);
    expect(lock.params.join("")).not.toContain("\u0000");
  });

  it("creates and exactly retries one stable deletion-run revision", async () => {
    const input = createRunInput();
    const appliedExecutor = new ScriptedExecutor([
      admissionResult(),
      result([]),
      result([initialRunRow(input)]),
      result([])
    ]);
    await expect(
      createSqlInboxV2DeletionRunStateRepository(appliedExecutor).createRun(
        input
      )
    ).resolves.toEqual({ outcome: "applied", stateRevision: "1" });
    expect(appliedExecutor.queries.at(-1)).toBe(
      "set constraints all immediate"
    );

    const retryExecutor = new ScriptedExecutor([
      admissionResult(),
      result([initialRunRow(input)])
    ]);
    await expect(
      createSqlInboxV2DeletionRunStateRepository(retryExecutor).createRun(input)
    ).resolves.toEqual({ outcome: "already_applied", stateRevision: "1" });
  });

  it("admits tenant offboarding only through one exact current terminal export", async () => {
    const input = terminalCreateRunInput();
    const rendered = new PgDialect().sqlToQuery(
      buildCreateInboxV2DeletionRunSql(input, "2026-07-15T05:00:00.000Z")
    );
    expect(rendered.sql).toContain("current_terminal_export as materialized");
    expect(rendered.sql).toContain("plan.cause = 'tenant_offboarding'");
    expect(rendered.sql).toContain("export_job.state = 'ready'");
    expect(rendered.sql).toContain("artifact_head.current_state = 'ready'");
    expect(rendered.sql).toContain("artifact.payload_checksum = $");
    expect(rendered.sql).toContain("artifact.expires_at > $");
    expect(rendered.sql).toContain(
      "for share of scope_manifest, scope_authority, export_job"
    );

    const bindingSql = new PgDialect().sqlToQuery(
      buildInsertInboxV2DeletionRunTerminalExportSql(
        input,
        "2026-07-15T05:00:00.000Z"
      )
    );
    expect(bindingSql.sql).toContain(
      "inbox_v2_data_governance_deletion_run_terminal_exports"
    );
    expect(bindingSql.params).toEqual(
      expect.arrayContaining([
        input.terminalExport!.job.id,
        input.terminalExport!.manifest.id,
        input.terminalExport!.artifact.id
      ])
    );

    const initial = initialRunRow(input);
    initial.plan_cause = "tenant_offboarding";
    const executor = new ScriptedExecutor([
      admissionResult(),
      result([]),
      result([initial]),
      result([{ bound_at: "2026-07-15T05:00:00.000Z" }]),
      result([])
    ]);
    await expect(
      createSqlInboxV2DeletionRunStateRepository(executor).createRun(input)
    ).resolves.toEqual({ outcome: "applied", stateRevision: "1" });
    expect(
      executor.queries.some((query) =>
        query.includes(
          "insert into inbox_v2_data_governance_deletion_run_terminal_exports"
        )
      )
    ).toBe(true);
    expect(executor.queries.at(-1)).toBe("set constraints all immediate");
  });

  it("rechecks the exact current terminal export on retry and fails closed after revoke", async () => {
    const input = terminalCreateRunInput();
    const persisted = initialRunRow(input);
    persisted.plan_cause = "tenant_offboarding";
    const currentSql = new PgDialect().sqlToQuery(
      buildFindInboxV2CurrentDeletionRunTerminalExportSql(
        input,
        "2026-07-15T05:00:00.000Z"
      )
    );
    expect(currentSql.sql).toContain("binding.bound_at >= run_row.started_at");
    expect(currentSql.sql).toContain("artifact.expires_at > $");
    expect(currentSql.sql).toContain(
      "for share of activation_head, export_job, artifact_head, artifact"
    );

    const retry = new ScriptedExecutor([
      admissionResult(),
      result([persisted]),
      result([{ bound_at: "2026-07-15T05:00:00.000Z" }])
    ]);
    await expect(
      createSqlInboxV2DeletionRunStateRepository(retry).createRun(input)
    ).resolves.toEqual({ outcome: "already_applied", stateRevision: "1" });

    const revoked = new ScriptedExecutor([
      admissionResult(),
      result([persisted]),
      result([])
    ]);
    await expect(
      createSqlInboxV2DeletionRunStateRepository(revoked).createRun(input)
    ).resolves.toMatchObject({ outcome: "conflict" });

    const missingReference = new ScriptedExecutor([
      admissionResult(),
      result([persisted])
    ]);
    await expect(
      createSqlInboxV2DeletionRunStateRepository(missingReference).createRun({
        ...input,
        terminalExport: null
      })
    ).resolves.toMatchObject({ outcome: "conflict" });
  });

  it("does not admit an offboarding run when its terminal binding cannot be persisted", async () => {
    const input = terminalCreateRunInput();
    const inserted = initialRunRow(input);
    inserted.plan_cause = "tenant_offboarding";
    const executor = new ScriptedExecutor([
      admissionResult(),
      result([]),
      result([inserted]),
      result([])
    ]);
    await expect(
      createSqlInboxV2DeletionRunStateRepository(executor).createRun(input)
    ).rejects.toThrow(/did not persist its terminal export binding/u);
    expect(executor.queries).not.toContain("set constraints all immediate");
  });

  it("rejects a competing run anchor and distinguishes missing plan authority", async () => {
    const input = createRunInput();
    const competing = initialRunRow(input);
    competing.started_at = "2026-07-15T04:00:00.000Z";
    const conflictExecutor = new ScriptedExecutor([
      admissionResult(),
      result([competing])
    ]);
    await expect(
      createSqlInboxV2DeletionRunStateRepository(conflictExecutor).createRun(
        input
      )
    ).resolves.toEqual({
      outcome: "conflict",
      currentState: "executing",
      currentStateRevision: "1"
    });

    const wrongHashExecutor = new ScriptedExecutor([
      admissionResult(),
      result([initialRunRow(input)])
    ]);
    await expect(
      createSqlInboxV2DeletionRunStateRepository(wrongHashExecutor).createRun({
        ...input,
        plan: { ...input.plan, planHash: digest("e") }
      })
    ).resolves.toMatchObject({ outcome: "conflict" });

    const missingExecutor = new ScriptedExecutor([
      admissionResult(),
      result([]),
      result([]),
      result([])
    ]);
    await expect(
      createSqlInboxV2DeletionRunStateRepository(missingExecutor).createRun(
        input
      )
    ).resolves.toEqual({ outcome: "not_found" });
  });

  it("updates only the mutable aggregate through one state-revision CAS", () => {
    const rendered = new PgDialect().sqlToQuery(
      buildTransitionInboxV2DeletionRunSql(transitionInput())
    );
    expect(rendered.sql).toContain(
      "update inbox_v2_data_governance_deletion_runs"
    );
    expect(rendered.sql).toContain(
      "state_revision = run_row.state_revision + 1"
    );
    expect(rendered.sql).toContain("run_row.state_revision = $");
    expect(rendered.sql).toContain("run_row.state = $");
    expect(rendered.sql).not.toContain("operated_checkpoint_count =");
    expect(rendered.sql).not.toContain("plan_revision =");
    expect(rendered.sql).not.toContain("started_at =");
  });

  it("returns applied after the exact CAS update", async () => {
    const input = transitionInput();
    const executor = new ScriptedExecutor([
      result([row(input, "2")]),
      result([])
    ]);
    const repository = createSqlInboxV2DeletionRunStateRepository(executor);

    await expect(repository.transition(input)).resolves.toEqual({
      outcome: "applied",
      stateRevision: "2"
    });
    expect(executor.queries).toHaveLength(2);
    expect(executor.queries.at(-1)).toBe("set constraints all immediate");
  });

  it("recognizes an exact retried transition losslessly", async () => {
    const input = transitionInput();
    const persisted = row(input, "2");
    persisted.stage_one_committed_at = new Date(
      input.next.stageOneCommittedAt!
    );
    persisted.updated_at = new Date(input.next.updatedAt);
    const executor = new ScriptedExecutor([result([]), result([persisted])]);
    const repository = createSqlInboxV2DeletionRunStateRepository(executor);

    await expect(repository.transition(input)).resolves.toEqual({
      outcome: "already_applied",
      stateRevision: "2"
    });
    expect(executor.queries).toHaveLength(2);
  });

  it("returns the current CAS winner for a concurrent different transition", async () => {
    const input = transitionInput();
    const persisted = row(input, "3");
    persisted.state = "verification_pending";
    const executor = new ScriptedExecutor([result([]), result([persisted])]);
    const repository = createSqlInboxV2DeletionRunStateRepository(executor);

    await expect(repository.transition(input)).resolves.toEqual({
      outcome: "conflict",
      currentState: "verification_pending",
      currentStateRevision: "3"
    });
  });

  it("distinguishes a missing stable execution revision", async () => {
    const executor = new ScriptedExecutor([result([]), result([])]);
    const repository = createSqlInboxV2DeletionRunStateRepository(executor);
    await expect(repository.transition(transitionInput())).resolves.toEqual({
      outcome: "not_found"
    });
  });

  it("rejects contradictory terminal and stage-one shapes before SQL", async () => {
    const executor = new ScriptedExecutor([]);
    const repository = createSqlInboxV2DeletionRunStateRepository(executor);
    const input = transitionInput();
    input.next.stageOneCommittedAt = null;
    await expect(repository.transition(input)).rejects.toThrow(
      /stage-one state and commit timestamp must agree/u
    );
    expect(executor.queries).toHaveLength(0);
  });

  it("rejects pending stage-one aggregates before SQL", async () => {
    const executor = new ScriptedExecutor([]);
    const repository = createSqlInboxV2DeletionRunStateRepository(executor);
    const input = transitionInput();
    const pendingState = {
      ...input.next,
      stageOneState: "pending" as const,
      stageOneCommittedAt: null,
      completedCheckpointCount: "1"
    };

    await expect(
      repository.transition({
        ...input,
        expectedStageOneState: "pending",
        next: {
          ...pendingState,
          stateHash: inboxV2Sha256DigestSchema.parse(
            calculateInboxV2DeletionRunMutableStateHash(pendingState)
          )
        }
      })
    ).rejects.toThrow(
      /Pending stage one cannot report destructive checkpoint aggregates/u
    );
    expect(executor.queries).toHaveLength(0);
  });

  it("rethrows operational database failures", async () => {
    const failure = new Error("database unavailable");
    const executor = new ScriptedExecutor([failure]);
    const repository = createSqlInboxV2DeletionRunStateRepository(executor);
    await expect(repository.transition(transitionInput())).rejects.toBe(
      failure
    );
  });

  it("commits immutable target proofs and the stage-one CAS in one transaction", async () => {
    const input = commitStageOneInput();
    const current = row(input, "1");
    current.stage_one_state = "pending";
    current.stage_one_committed_at = null;
    current.updated_at = "2026-07-15T04:59:59.000Z";
    const executor = new ScriptedExecutor([
      result([current]),
      result([]),
      result([]),
      result([row(input, "2")]),
      result([])
    ]);
    const repository = createSqlInboxV2DeletionRunStateRepository(executor);

    await expect(repository.commitStageOne(input)).resolves.toEqual({
      outcome: "applied",
      stateRevision: "2"
    });
    expect(executor.transactionCalls).toBe(1);
    expect(executor.queries.some((query) => query.includes("for update"))).toBe(
      true
    );
    expect(
      executor.queries.some((query) =>
        query.includes("deletion_stage_one_targets")
      )
    ).toBe(true);
    expect(executor.queries.at(-1)).toBe("set constraints all immediate");
  });

  it("retries an exact atomic stage-one commit without duplicate proof rows", async () => {
    const input = commitStageOneInput();
    const executor = new ScriptedExecutor([
      result([row(input, "2")]),
      result([stageOneTargetRow(input)])
    ]);
    const repository = createSqlInboxV2DeletionRunStateRepository(executor);

    await expect(repository.commitStageOne(input)).resolves.toEqual({
      outcome: "already_applied",
      stateRevision: "2"
    });
    expect(executor.queries).toHaveLength(2);
    expect(executor.queries.every((query) => !query.startsWith("insert"))).toBe(
      true
    );
  });

  it("recognizes an exact retry after PostgreSQL normalizes timestamp offsets to UTC", async () => {
    const base = commitStageOneInput();
    const offsetCommittedAt = "2026-07-15T08:00:00.000+03:00";
    const offsetUpdatedAt = "2026-07-15T08:00:01.000+03:00";
    const { stateHash: _stateHash, ...offsetState } = {
      ...base.next,
      stageOneCommittedAt: offsetCommittedAt,
      updatedAt: offsetUpdatedAt
    };
    const input = inboxV2CommitDeletionStageOneInputSchema.parse({
      ...base,
      next: {
        ...offsetState,
        stateHash: calculateInboxV2DeletionRunMutableStateHash(offsetState)
      },
      targets: [{ ...base.targets[0]!, committedAt: offsetCommittedAt }]
    });
    const persisted = row(input, "2");
    persisted.stage_one_committed_at = new Date(offsetCommittedAt);
    persisted.updated_at = new Date(offsetUpdatedAt);
    const persistedTarget = stageOneTargetRow(input);
    persistedTarget.committed_at = new Date(offsetCommittedAt);
    const executor = new ScriptedExecutor([
      result([persisted]),
      result([persistedTarget])
    ]);
    const repository = createSqlInboxV2DeletionRunStateRepository(executor);

    await expect(repository.commitStageOne(input)).resolves.toEqual({
      outcome: "already_applied",
      stateRevision: "2"
    });
  });

  it("surfaces an atomic stage-one failure instead of reporting a partial success", async () => {
    const input = commitStageOneInput();
    const current = row(input, "1");
    current.stage_one_state = "pending";
    current.stage_one_committed_at = null;
    const failure = new Error("stage-one CAS failed");
    const executor = new ScriptedExecutor([
      result([current]),
      result([]),
      result([]),
      failure
    ]);
    const repository = createSqlInboxV2DeletionRunStateRepository(executor);

    await expect(repository.commitStageOne(input)).rejects.toBe(failure);
    expect(executor.transactionCalls).toBe(1);
  });

  it("builds typed tombstone proof inserts from the locked run anchor", () => {
    const rendered = new PgDialect().sqlToQuery(
      buildInsertInboxV2DeletionStageOneTargetsSql(commitStageOneInput())
    );
    expect(rendered.sql).toContain(
      "insert into inbox_v2_data_governance_deletion_stage_one_targets"
    );
    expect(rendered.sql).toContain("tombstone_schema_version");
    expect(rendered.sql).toContain("run_row.state_revision = $");
  });
});

function transitionInput(): TransitionInboxV2DeletionRunInput {
  const next = {
    state: "executing" as const,
    result: null,
    stageOneState: "content_unavailable" as const,
    stageOneCommittedAt: "2026-07-15T05:00:00.000Z",
    primaryAbsenceVerified: false,
    hasInternalResidual: false,
    hasExternalResidual: false,
    hasBackupExpiryPending: false,
    backupLatestPossibleExpiryAt: null,
    completedCheckpointCount: "0",
    completedAt: null,
    updatedAt: "2026-07-15T05:00:01.000Z"
  };
  return inboxV2DeletionRunStateTransitionInputSchema.parse({
    tenantId: "tenant:one",
    runId: "run:one",
    revision: "1",
    expectedState: "executing",
    expectedStageOneState: "content_unavailable",
    expectedStateRevision: "1",
    next: {
      ...next,
      stateHash: calculateInboxV2DeletionRunMutableStateHash(next)
    }
  });
}

function createRunInput(): InboxV2CreateDeletionRunInput {
  return inboxV2CreateDeletionRunInputSchema.parse({
    tenantId: "tenant:one",
    runId: "run:one",
    revision: "1",
    plan: {
      tenantId: "tenant:one",
      planId: "plan:one",
      revision: "1",
      planHash: digest("d")
    },
    terminalExport: null,
    startedAt: "2026-07-15T04:59:59.000Z"
  });
}

function terminalCreateRunInput(): InboxV2CreateDeletionRunInput {
  const input = createRunInput();
  return inboxV2CreateDeletionRunInputSchema.parse({
    ...input,
    terminalExport: {
      tenantId: input.tenantId,
      productKind: "tenant_deployment",
      job: { id: "export-job:terminal-one", revision: "1" },
      manifest: {
        id: "export-manifest:terminal-one",
        revision: "1",
        manifestHash: digest("a")
      },
      artifact: {
        id: "export-artifact:terminal-one",
        revision: "1",
        checksum: digest("b"),
        readyAt: "2026-07-15T04:58:00.000Z",
        expiresAt: "2026-07-15T06:00:00.000Z"
      },
      governanceContext: {
        tenantId: input.tenantId,
        id: "core:governance-terminal-one",
        version: "1",
        contextHash: digest("c")
      },
      policy: {
        tenantId: input.tenantId,
        id: "core:policy-terminal-one",
        version: "1",
        policyHash: digest("d")
      },
      rootSetHash: digest("e"),
      tenantScopeProofHash: digest("f")
    }
  });
}

function initialRunRow(
  input: InboxV2CreateDeletionRunInput
): Record<string, unknown> {
  const state = initialInboxV2DeletionRunMutableState(input);
  return {
    plan_id: input.plan.planId,
    plan_revision: input.plan.revision,
    plan_hash: input.plan.planHash,
    plan_cause: "retention_expiry",
    operated_checkpoint_count: "1",
    backup_checkpoint_count: "0",
    external_checkpoint_count: "0",
    started_at: input.startedAt,
    state_revision: "1",
    state: state.state,
    result: state.result,
    stage_one_state: state.stageOneState,
    stage_one_committed_at: state.stageOneCommittedAt,
    primary_absence_verified: state.primaryAbsenceVerified,
    has_internal_residual: state.hasInternalResidual,
    has_external_residual: state.hasExternalResidual,
    has_backup_expiry_pending: state.hasBackupExpiryPending,
    backup_latest_possible_expiry_at: state.backupLatestPossibleExpiryAt,
    completed_checkpoint_count: state.completedCheckpointCount,
    completed_at: state.completedAt,
    state_hash: state.stateHash,
    updated_at: state.updatedAt
  };
}

function commitStageOneInput(): InboxV2CommitDeletionStageOneInput {
  const input = transitionInput();
  return inboxV2CommitDeletionStageOneInputSchema.parse({
    ...input,
    expectedStageOneState: "pending",
    targets: [
      {
        checkpointId: "checkpoint:one",
        requirementHash: digest("a"),
        root: {
          tenantId: input.tenantId,
          dataClassId: "core:message-content",
          storageRootId: "core:postgres-primary",
          recordId: "data_root:record-one"
        },
        entity: {
          tenantId: input.tenantId,
          entityTypeId: "core:message",
          entityId: "message:one"
        },
        expectedRevision: "1",
        resultingRevision: "2",
        tombstoneManifest: {
          tenantId: input.tenantId,
          recordId: "tombstone:one",
          schemaId: "core:deletion-tombstone",
          schemaVersion: "v1",
          digest: digest("b")
        },
        invalidationDigest: digest("c"),
        committedAt: input.next.stageOneCommittedAt!
      }
    ]
  });
}

function stageOneTargetRow(
  input: InboxV2CommitDeletionStageOneInput
): Record<string, unknown> {
  const target = input.targets[0]!;
  return {
    tenant_id: input.tenantId,
    checkpoint_id: target.checkpointId,
    requirement_hash: target.requirementHash,
    storage_root_id: target.root.storageRootId,
    data_class_id: target.root.dataClassId,
    root_record_id: target.root.recordId,
    entity_type_id: target.entity.entityTypeId,
    entity_id: target.entity.entityId,
    expected_revision: target.expectedRevision,
    resulting_revision: target.resultingRevision,
    tombstone_tenant_id: target.tombstoneManifest.tenantId,
    tombstone_record_id: target.tombstoneManifest.recordId,
    tombstone_schema_id: target.tombstoneManifest.schemaId,
    tombstone_schema_version: target.tombstoneManifest.schemaVersion,
    tombstone_digest: target.tombstoneManifest.digest,
    invalidation_digest: target.invalidationDigest,
    committed_at: target.committedAt
  };
}

function digest(character: string) {
  return inboxV2Sha256DigestSchema.parse(`sha256:${character.repeat(64)}`);
}

function row(
  input: TransitionInboxV2DeletionRunInput,
  stateRevision: string
): Record<string, unknown> {
  return {
    state_revision: stateRevision,
    state: input.next.state,
    result: input.next.result,
    stage_one_state: input.next.stageOneState,
    stage_one_committed_at: input.next.stageOneCommittedAt,
    primary_absence_verified: input.next.primaryAbsenceVerified,
    has_internal_residual: input.next.hasInternalResidual,
    has_external_residual: input.next.hasExternalResidual,
    has_backup_expiry_pending: input.next.hasBackupExpiryPending,
    backup_latest_possible_expiry_at: input.next.backupLatestPossibleExpiryAt,
    completed_checkpoint_count: input.next.completedCheckpointCount,
    completed_at: input.next.completedAt,
    state_hash: input.next.stateHash,
    updated_at: input.next.updatedAt
  };
}

function result<Row extends Record<string, unknown>>(
  rows: readonly Row[]
): RawSqlQueryResult<Row> {
  return { rows };
}

function admissionResult(): RawSqlQueryResult<Record<string, unknown>> {
  return result([{ admitted_at: "2026-07-15T05:00:00.000Z" }]);
}

class ScriptedExecutor implements InboxV2DeletionRunStateTransactionExecutor {
  readonly queries: string[] = [];
  transactionCalls = 0;

  constructor(
    private readonly script: Array<
      RawSqlQueryResult<Record<string, unknown>> | Error
    >
  ) {}

  async execute<Row extends Record<string, unknown>>(
    query: Parameters<RawSqlExecutor["execute"]>[0]
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(new PgDialect().sqlToQuery(query).sql);
    const next = this.script.shift();
    if (next instanceof Error) throw next;
    if (next === undefined) throw new Error("Unexpected SQL call.");
    return next as RawSqlQueryResult<Row>;
  }

  async transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>
  ): Promise<TResult> {
    this.transactionCalls += 1;
    return work(this);
  }
}
