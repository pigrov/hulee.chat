import {
  calculateInboxV2CanonicalSha256,
  decideInboxV2ProjectionInput,
  inboxV2ApplyProjectionContiguousInputSchema,
  inboxV2ApplyProjectionContiguousResultSchema,
  inboxV2CompareAndSetRetainedPrefixInputSchema,
  inboxV2CompareAndSetRetainedPrefixResultSchema,
  inboxV2CutoverProjectionGenerationInputSchema,
  inboxV2CutoverProjectionGenerationResultSchema,
  inboxV2InitializeProjectionGenerationInputSchema,
  inboxV2InitializeProjectionGenerationResultSchema,
  inboxV2LoadProjectionGenerationInputSchema,
  inboxV2LoadProjectionGenerationResultSchema,
  inboxV2NamespacedIdSchema,
  inboxV2ProjectionCheckpointTransitionSchema,
  inboxV2ProjectionGenerationSnapshotSchema,
  inboxV2RetainedPrefixStateSchema,
  type InboxV2ApplyProjectionContiguousInput,
  type InboxV2ApplyProjectionContiguousResult,
  type InboxV2CompareAndSetRetainedPrefixInput,
  type InboxV2CompareAndSetRetainedPrefixResult,
  type InboxV2CutoverProjectionGenerationInput,
  type InboxV2CutoverProjectionGenerationResult,
  type InboxV2InitializeProjectionGenerationInput,
  type InboxV2InitializeProjectionGenerationResult,
  type InboxV2LoadProjectionGenerationInput,
  type InboxV2LoadProjectionGenerationResult,
  type InboxV2ProjectionCheckpointTransition,
  type InboxV2ProjectionGenerationSnapshot,
  type InboxV2ProjectionRepositoryPort,
  type InboxV2RetainedPrefixRepositoryPort,
  type InboxV2RetainedPrefixState
} from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

export type InboxV2RepositoryProjectionTransactionExecutor = RawSqlExecutor & {
  transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>
  ): Promise<TResult>;
};

export type InboxV2ProjectionRowApplyContext = Readonly<{
  executor: RawSqlExecutor;
  generation: InboxV2ProjectionGenerationSnapshot;
  transition: InboxV2ProjectionCheckpointTransition;
}>;

/** Must persist only projection-owned rows through the supplied transaction. */
/** DB-only work executed inside the same transaction as checkpoint advance. */
export type InboxV2ProjectionRowApplyCallback = (
  context: InboxV2ProjectionRowApplyContext
) => Promise<void>;

export type CreateSqlInboxV2RepositoryProjectionOptions = Readonly<{
  applyProjectionRows: InboxV2ProjectionRowApplyCallback;
}>;

export type CreateSqlInboxV2RepositoryRetainedPrefixOptions = Readonly<{
  tenantStreamRetentionReasonId: string;
}>;

type ProjectionSnapshotRow = Record<string, unknown> & {
  tenant_id: unknown;
  projection_id: unknown;
  scope_id: unknown;
  generation: unknown;
  stream_epoch: unknown;
  projection_schema_version: unknown;
  generation_state: unknown;
  min_retained_position: unknown;
  generation_revision: unknown;
  initialized_at: unknown;
  activated_at: unknown;
  retired_at: unknown;
  generation_updated_at: unknown;
  checkpoint_position: unknown;
  last_commit_id: unknown;
  checkpoint_revision: unknown;
  checkpoint_created_at: unknown;
  checkpoint_updated_at: unknown;
};

type ProjectionHeadRow = Record<string, unknown> & {
  tenant_id: unknown;
  projection_id: unknown;
  scope_id: unknown;
  current_generation: unknown;
  stream_epoch: unknown;
  projection_schema_version: unknown;
  revision: unknown;
  created_at: unknown;
  updated_at: unknown;
};

type TenantStreamHeadRow = Record<string, unknown> & {
  tenant_id: unknown;
  stream_epoch: unknown;
  last_position: unknown;
  min_retained_position: unknown;
  revision: unknown;
  created_at: unknown;
  updated_at: unknown;
  db_now: unknown;
};

type TenantStreamRetentionAdvanceRow = TenantStreamHeadRow & {
  id: unknown;
  pruned_commit_count: unknown;
};

type CheckpointUpdateRow = Record<string, unknown> & {
  tenant_id: unknown;
  projection_id: unknown;
  scope_id: unknown;
  generation: unknown;
  stream_epoch: unknown;
  position: unknown;
  last_commit_id: unknown;
  revision: unknown;
  updated_at: unknown;
};

type MutationIdentityRow = Record<string, unknown> & {
  tenant_id: unknown;
  id: unknown;
};

type MappedProjectionSnapshot = Readonly<{
  snapshot: InboxV2ProjectionGenerationSnapshot;
  generationRevision: string;
  checkpointRevision: string;
  generationUpdatedAt: string;
  checkpointUpdatedAt: string;
  lastCommitId: string | null;
}>;

type MappedProjectionHead = Readonly<{
  tenantId: string;
  projectionId: string;
  scopeId: string;
  currentGeneration: string;
  streamEpoch: string;
  projectionSchemaVersion: string;
  revision: string;
  createdAt: string;
  updatedAt: string;
}>;

export class InboxV2RepositoryProjectionPersistenceInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InboxV2RepositoryProjectionPersistenceInvariantError";
  }
}

export function createSqlInboxV2RepositoryProjection(
  executor: InboxV2RepositoryProjectionTransactionExecutor | HuleeDatabase,
  options: CreateSqlInboxV2RepositoryProjectionOptions
): InboxV2ProjectionRepositoryPort {
  if (typeof options.applyProjectionRows !== "function") {
    throw new TypeError("Projection row apply callback is required.");
  }
  const transactionExecutor =
    executor as unknown as InboxV2RepositoryProjectionTransactionExecutor;

  return Object.freeze({
    initializeGeneration(
      rawInput: Readonly<InboxV2InitializeProjectionGenerationInput>
    ) {
      const input =
        inboxV2InitializeProjectionGenerationInputSchema.parse(rawInput);
      return transactionExecutor.transaction((transaction) =>
        initializeProjectionGeneration(transaction, input)
      );
    },

    loadGeneration(rawInput: Readonly<InboxV2LoadProjectionGenerationInput>) {
      const input = inboxV2LoadProjectionGenerationInputSchema.parse(rawInput);
      return transactionExecutor.transaction((transaction) =>
        loadProjectionGeneration(transaction, input)
      );
    },

    applyContiguous(rawInput: Readonly<InboxV2ApplyProjectionContiguousInput>) {
      const input = inboxV2ApplyProjectionContiguousInputSchema.parse(rawInput);
      return transactionExecutor.transaction((transaction) =>
        applyProjectionContiguous(
          transaction,
          input,
          options.applyProjectionRows
        )
      );
    },

    cutoverGeneration(
      rawInput: Readonly<InboxV2CutoverProjectionGenerationInput>
    ) {
      const input =
        inboxV2CutoverProjectionGenerationInputSchema.parse(rawInput);
      return transactionExecutor.transaction((transaction) =>
        cutoverProjectionGeneration(transaction, input)
      );
    }
  });
}

export function createSqlInboxV2RepositoryRetainedPrefix(
  executor: InboxV2RepositoryProjectionTransactionExecutor | HuleeDatabase,
  options: CreateSqlInboxV2RepositoryRetainedPrefixOptions
): InboxV2RetainedPrefixRepositoryPort {
  const reasonId = inboxV2NamespacedIdSchema.parse(
    options.tenantStreamRetentionReasonId
  );
  const transactionExecutor =
    executor as unknown as InboxV2RepositoryProjectionTransactionExecutor;

  return Object.freeze({
    compareAndSetRetainedPrefix(
      rawInput: Readonly<InboxV2CompareAndSetRetainedPrefixInput>
    ) {
      const input =
        inboxV2CompareAndSetRetainedPrefixInputSchema.parse(rawInput);
      return transactionExecutor.transaction((transaction) =>
        input.owner.kind === "tenant_stream"
          ? compareAndSetTenantStreamRetainedPrefix(
              transaction,
              input,
              reasonId
            )
          : compareAndSetProjectionRetainedPrefix(transaction, input)
      );
    }
  });
}

async function initializeProjectionGeneration(
  transaction: RawSqlExecutor,
  input: InboxV2InitializeProjectionGenerationInput
): Promise<InboxV2InitializeProjectionGenerationResult> {
  const existing = await selectProjectionSnapshot(transaction, input, true);
  if (existing !== null) return classifyExistingInitialization(input, existing);

  const streamHead = singleRow(
    await transaction.execute<TenantStreamHeadRow>(
      buildSelectTenantStreamHeadSql(input.context.tenantId, "share")
    ),
    "projection initialization tenant stream head"
  );
  if (streamHead === null) {
    return parseInitializeResult({
      outcome: "conflict",
      facet: "generation_identity",
      current: null
    });
  }
  const mappedStream = mapTenantStreamHeadRow(
    streamHead,
    input.context.tenantId
  );
  if (mappedStream.streamEpoch !== input.streamEpoch) {
    return parseInitializeResult({
      outcome: "conflict",
      facet: "generation_identity",
      current: null
    });
  }
  if (BigInt(input.initialPosition) > BigInt(mappedStream.lastPosition)) {
    return parseInitializeResult({
      outcome: "conflict",
      facet: "checkpoint",
      current: null
    });
  }
  if (
    BigInt(input.minRetainedPosition) < BigInt(mappedStream.minRetainedPosition)
  ) {
    return parseInitializeResult({
      outcome: "conflict",
      facet: "retained_prefix",
      current: null
    });
  }

  if (input.initialState === "active") {
    const current = await selectCurrentProjectionSnapshot(transaction, input);
    if (current !== null) {
      return parseInitializeResult({
        outcome: "conflict",
        facet: "active_generation",
        current: current.snapshot
      });
    }
  }

  const insertedGeneration = await transaction.execute<MutationIdentityRow>(
    buildInsertProjectionGenerationSql(input)
  );
  if (insertedGeneration.rows.length === 0) {
    const raced = await selectProjectionSnapshot(transaction, input, true);
    if (raced !== null) return classifyExistingInitialization(input, raced);
    const current = await selectCurrentProjectionSnapshot(transaction, input);
    return parseInitializeResult({
      outcome: "conflict",
      facet: current === null ? "generation_identity" : "active_generation",
      current: current?.snapshot ?? null
    });
  }
  assertMutationIdentity(
    exactlyOneRow(insertedGeneration.rows, "projection generation insert"),
    input.context.tenantId,
    input.syncGeneration,
    "projection generation insert"
  );

  assertMutationIdentity(
    exactlyOneRow(
      (
        await transaction.execute<MutationIdentityRow>(
          buildInsertProjectionCheckpointSql(input)
        )
      ).rows,
      "projection checkpoint insert"
    ),
    input.context.tenantId,
    input.syncGeneration,
    "projection checkpoint insert"
  );

  if (input.initialState === "active") {
    assertMutationIdentity(
      exactlyOneRow(
        (
          await transaction.execute<MutationIdentityRow>(
            buildInsertProjectionHeadSql(input)
          )
        ).rows,
        "projection head insert"
      ),
      input.context.tenantId,
      input.syncGeneration,
      "projection head insert"
    );
  }

  const initialized = await selectProjectionSnapshot(transaction, input, false);
  if (initialized === null) {
    throw invariantError("Initialized projection generation disappeared.");
  }
  return parseInitializeResult({
    outcome: "initialized",
    snapshot: initialized.snapshot
  });
}

async function loadProjectionGeneration(
  transaction: RawSqlExecutor,
  input: InboxV2LoadProjectionGenerationInput
): Promise<InboxV2LoadProjectionGenerationResult> {
  const current = await selectProjectionSnapshot(transaction, input, false);
  return inboxV2LoadProjectionGenerationResultSchema.parse(
    current === null
      ? { outcome: "not_found", tenantId: input.context.tenantId }
      : { outcome: "found", snapshot: current.snapshot }
  );
}

async function applyProjectionContiguous(
  transaction: RawSqlExecutor,
  input: InboxV2ApplyProjectionContiguousInput,
  applyRows: InboxV2ProjectionRowApplyCallback
): Promise<InboxV2ApplyProjectionContiguousResult> {
  const current = await selectProjectionSnapshot(transaction, input, true);
  if (current === null) {
    return parseApplyResult({
      outcome: "generation_not_found",
      tenantId: input.context.tenantId,
      projectionId: input.projectionId,
      scopeId: input.scopeId,
      syncGeneration: input.syncGeneration
    });
  }

  const checkpoint = current.snapshot.checkpoint;
  const conflictBase = {
    tenantId: input.context.tenantId,
    projectionId: input.projectionId,
    scopeId: input.scopeId,
    syncGeneration: input.syncGeneration,
    currentCheckpoint: checkpoint.position
  } as const;
  if (current.snapshot.generation.state === "retired") {
    return parseApplyResult({
      outcome: "generation_retired",
      ...conflictBase
    });
  }
  if (current.snapshot.generation.streamEpoch !== input.input.streamEpoch) {
    return parseApplyResult({ outcome: "epoch_mismatch", ...conflictBase });
  }

  const decision = decideInboxV2ProjectionInput({
    checkpoint,
    commit: input.input,
    relevance: input.relevance
  });
  if (decision.kind === "duplicate") {
    return parseApplyResult({
      outcome: "duplicate",
      ...conflictBase,
      receivedPosition: input.input.streamPosition
    });
  }
  if (decision.kind === "halt") {
    if (decision.errorCode === "projection.gap_detected") {
      return parseApplyResult({
        outcome: "gap_detected",
        ...conflictBase,
        expectedPosition: String(BigInt(checkpoint.position) + 1n),
        observedPosition: input.input.streamPosition
      });
    }
    return parseApplyResult({
      outcome:
        decision.errorCode === "projection.epoch_mismatch"
          ? "epoch_mismatch"
          : "schema_unsupported",
      ...conflictBase
    });
  }
  if (input.expectedCheckpoint !== checkpoint.position) {
    return parseApplyResult({
      outcome: "checkpoint_conflict",
      ...conflictBase
    });
  }

  const disposition =
    decision.kind === "apply" ? ("applied" as const) : ("irrelevant" as const);
  const transition = inboxV2ProjectionCheckpointTransitionSchema.parse({
    before: checkpoint,
    input: input.input,
    disposition,
    after: { ...checkpoint, position: input.input.streamPosition }
  });
  if (decision.kind === "apply") {
    await applyRows({
      executor: transaction,
      generation: current.snapshot,
      transition
    });
  }

  const updated = exactlyOneRow(
    (
      await transaction.execute<CheckpointUpdateRow>(
        buildAdvanceProjectionCheckpointSql(input, current)
      )
    ).rows,
    "projection checkpoint advance"
  );
  assertCheckpointUpdate(updated, input, current);
  return parseApplyResult({
    outcome: decision.kind === "apply" ? "applied" : "advanced_irrelevant",
    transition
  });
}

async function cutoverProjectionGeneration(
  transaction: RawSqlExecutor,
  input: InboxV2CutoverProjectionGenerationInput
): Promise<InboxV2CutoverProjectionGenerationResult> {
  const headRow = singleRow(
    await transaction.execute<ProjectionHeadRow>(
      buildSelectProjectionHeadSql(input, true)
    ),
    "projection cutover head"
  );
  const head =
    headRow === null
      ? null
      : mapProjectionHeadRow(headRow, input.context.tenantId, input);

  if (head?.currentGeneration === input.candidateGeneration) {
    const active = await selectProjectionSnapshot(
      transaction,
      { ...input, syncGeneration: input.candidateGeneration },
      true
    );
    if (active === null || active.snapshot.generation.state !== "active") {
      throw invariantError(
        "Projection head points to a non-active generation."
      );
    }
    return parseCutoverResult({
      outcome: "already_cut_over",
      active: active.snapshot
    });
  }

  if ((head?.currentGeneration ?? null) !== input.expectedActiveGeneration) {
    return parseCutoverResult({
      outcome: "active_generation_conflict",
      currentActiveGeneration: head?.currentGeneration ?? null
    });
  }

  const candidate = await selectProjectionSnapshot(
    transaction,
    { ...input, syncGeneration: input.candidateGeneration },
    true
  );
  if (candidate === null || candidate.snapshot.generation.state !== "shadow") {
    return parseCutoverResult({ outcome: "candidate_not_found" });
  }
  if (
    candidate.snapshot.checkpoint.position !== input.expectedCandidateCheckpoint
  ) {
    return parseCutoverResult({
      outcome: "candidate_checkpoint_conflict",
      currentCheckpoint: candidate.snapshot.checkpoint.position
    });
  }

  let previousActive: MappedProjectionSnapshot | null = null;
  if (head !== null) {
    previousActive = await selectProjectionSnapshot(
      transaction,
      { ...input, syncGeneration: head.currentGeneration },
      true
    );
    if (
      previousActive === null ||
      previousActive.snapshot.generation.state !== "active"
    ) {
      throw invariantError("Projection head lost its active generation.");
    }
  }
  const requiredThroughPosition = String(
    previousActive === null
      ? BigInt(input.requiredThroughPosition)
      : maxBigint(
          BigInt(input.requiredThroughPosition),
          BigInt(previousActive.snapshot.checkpoint.position)
        )
  );
  if (
    BigInt(candidate.snapshot.checkpoint.position) <
    BigInt(requiredThroughPosition)
  ) {
    return parseCutoverResult({
      outcome: "candidate_not_ready",
      currentCheckpoint: candidate.snapshot.checkpoint.position,
      requiredThroughPosition
    });
  }

  if (previousActive !== null) {
    assertMutationIdentity(
      exactlyOneRow(
        (
          await transaction.execute<MutationIdentityRow>(
            buildRetireProjectionGenerationSql(input, previousActive)
          )
        ).rows,
        "projection generation retirement"
      ),
      input.context.tenantId,
      previousActive.snapshot.generation.syncGeneration,
      "projection generation retirement"
    );
  }

  assertMutationIdentity(
    exactlyOneRow(
      (
        await transaction.execute<MutationIdentityRow>(
          buildActivateProjectionGenerationSql(input, candidate)
        )
      ).rows,
      "projection generation activation"
    ),
    input.context.tenantId,
    input.candidateGeneration,
    "projection generation activation"
  );

  const headMutation =
    head === null
      ? buildInsertCutoverProjectionHeadSql(input, candidate)
      : buildAdvanceProjectionHeadSql(input, candidate, head);
  assertMutationIdentity(
    exactlyOneRow(
      (await transaction.execute<MutationIdentityRow>(headMutation)).rows,
      "projection head cutover"
    ),
    input.context.tenantId,
    input.candidateGeneration,
    "projection head cutover"
  );

  const active = await selectProjectionSnapshot(
    transaction,
    { ...input, syncGeneration: input.candidateGeneration },
    false
  );
  if (active === null || active.snapshot.generation.state !== "active") {
    throw invariantError("Activated projection generation did not persist.");
  }
  return parseCutoverResult({
    outcome: "cut_over",
    previousActive: previousActive?.snapshot ?? null,
    active: active.snapshot
  });
}

function maxBigint(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

async function compareAndSetTenantStreamRetainedPrefix(
  transaction: RawSqlExecutor,
  input: InboxV2CompareAndSetRetainedPrefixInput,
  reasonId: string
): Promise<InboxV2CompareAndSetRetainedPrefixResult> {
  if (input.owner.kind !== "tenant_stream") {
    throw invariantError("Tenant stream retained-prefix owner is required.");
  }
  const row = singleRow(
    await transaction.execute<TenantStreamHeadRow>(
      buildSelectTenantStreamHeadSql(input.context.tenantId, "update")
    ),
    "tenant stream retained-prefix head"
  );
  if (row === null) return retainedNotFound(input);
  const mapped = mapTenantStreamHeadRow(row, input.context.tenantId);
  if (mapped.streamEpoch !== input.owner.streamEpoch) {
    return retainedNotFound(input);
  }
  const current = mapTenantStreamRetainedState(input, mapped);
  const preflight = classifyRetainedPrefixCas(input, current);
  if (preflight !== null) return preflight;
  const effectiveChangedAt = timestampText(
    row.db_now,
    "tenant stream retained-prefix DB clock"
  );
  const effectiveInput: InboxV2CompareAndSetRetainedPrefixInput = {
    ...input,
    changedAt: effectiveChangedAt
  };

  const expectedPrunedCount =
    BigInt(input.nextMinRetainedPosition) -
    (BigInt(input.expectedMinRetainedPosition) > 1n
      ? BigInt(input.expectedMinRetainedPosition)
      : 1n);
  const resultingRevision = String(BigInt(input.expectedRevision) + 1n);
  const advanceHash = calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.tenant-stream-retention-advance",
    hashVersion: "v1",
    tenantId: input.context.tenantId,
    streamEpoch: input.owner.streamEpoch,
    fromPosition: input.expectedMinRetainedPosition,
    toPosition: input.nextMinRetainedPosition,
    expectedHeadRevision: input.expectedRevision,
    resultingHeadRevision: resultingRevision,
    mandatoryCheckpointFloor: input.mandatoryCheckpointFloor,
    prunedCommitCount: expectedPrunedCount.toString(),
    reasonId,
    occurredAt: effectiveChangedAt
  });
  const advancedRow = exactlyOneRow(
    (
      await transaction.execute<TenantStreamRetentionAdvanceRow>(
        buildAdvanceTenantStreamRetainedPrefixSql({
          input: effectiveInput,
          reasonId,
          advanceHash
        })
      )
    ).rows,
    "tenant stream retained-prefix atomic advance"
  );
  assertMutationIdentity(
    advancedRow,
    input.context.tenantId,
    input.nextMinRetainedPosition,
    "tenant stream retained-prefix atomic advance"
  );
  const prunedCommitCount = bigintText(
    advancedRow.pruned_commit_count,
    "tenant stream pruned commit count"
  );
  if (BigInt(prunedCommitCount) !== expectedPrunedCount) {
    throw invariantError(
      "Tenant stream atomic advance returned an incoherent commit count."
    );
  }
  const updated = mapTenantStreamHeadRow(advancedRow, input.context.tenantId);
  if (
    updated.streamEpoch !== input.owner.streamEpoch ||
    updated.minRetainedPosition !== input.nextMinRetainedPosition ||
    updated.revision !== resultingRevision
  ) {
    throw invariantError(
      "Tenant stream retained-prefix CAS returned stale state."
    );
  }
  return parseRetainedResult({
    outcome: "advanced",
    current: mapTenantStreamRetainedState(input, updated)
  });
}

async function compareAndSetProjectionRetainedPrefix(
  transaction: RawSqlExecutor,
  input: InboxV2CompareAndSetRetainedPrefixInput
): Promise<InboxV2CompareAndSetRetainedPrefixResult> {
  if (input.owner.kind !== "projection_generation") {
    throw invariantError("Projection retained-prefix owner is required.");
  }
  const snapshot = await selectProjectionSnapshot(
    transaction,
    {
      context: input.context,
      projectionId: input.owner.projectionId,
      scopeId: input.owner.scopeId,
      syncGeneration: input.owner.syncGeneration
    },
    true
  );
  if (
    snapshot === null ||
    snapshot.snapshot.generation.streamEpoch !== input.owner.streamEpoch
  ) {
    return retainedNotFound(input);
  }
  const current = mapProjectionRetainedState(input, snapshot);
  const preflight = classifyRetainedPrefixCas(input, current);
  if (preflight !== null) return preflight;

  const updatedRow = exactlyOneRow(
    (
      await transaction.execute<ProjectionSnapshotRow>(
        buildAdvanceProjectionRetainedPrefixSql(input)
      )
    ).rows,
    "projection retained-prefix advance"
  );
  const updated = mapProjectionSnapshotRow(
    updatedRow,
    input.context.tenantId,
    input.owner
  );
  if (
    String(updated.snapshot.generation.minRetainedPosition) !==
      String(input.nextMinRetainedPosition) ||
    updated.generationRevision !== String(BigInt(input.expectedRevision) + 1n)
  ) {
    throw invariantError(
      "Projection retained-prefix CAS returned stale state."
    );
  }
  return parseRetainedResult({
    outcome: "advanced",
    current: mapProjectionRetainedState(input, updated)
  });
}

function classifyExistingInitialization(
  input: InboxV2InitializeProjectionGenerationInput,
  current: MappedProjectionSnapshot
): InboxV2InitializeProjectionGenerationResult {
  const generation = current.snapshot.generation;
  const checkpoint = current.snapshot.checkpoint;
  let facet:
    | "generation_identity"
    | "active_generation"
    | "checkpoint"
    | "retained_prefix"
    | null = null;
  if (
    generation.streamEpoch !== input.streamEpoch ||
    generation.projectionSchemaVersion !== input.projectionSchemaVersion ||
    generation.state !== input.initialState ||
    generation.initializedAt !== input.initializedAt
  ) {
    facet = "generation_identity";
  } else if (generation.minRetainedPosition !== input.minRetainedPosition) {
    facet = "retained_prefix";
  } else if (checkpoint.position !== input.initialPosition) {
    facet = "checkpoint";
  }
  return parseInitializeResult(
    facet === null
      ? { outcome: "already_initialized", snapshot: current.snapshot }
      : { outcome: "conflict", facet, current: current.snapshot }
  );
}

function classifyRetainedPrefixCas(
  input: InboxV2CompareAndSetRetainedPrefixInput,
  current: InboxV2RetainedPrefixState
): InboxV2CompareAndSetRetainedPrefixResult | null {
  if (
    BigInt(current.minRetainedPosition) >= BigInt(input.nextMinRetainedPosition)
  ) {
    return parseRetainedResult({ outcome: "already_applied", current });
  }
  if (
    current.revision !== input.expectedRevision ||
    current.minRetainedPosition !== input.expectedMinRetainedPosition
  ) {
    return parseRetainedResult({ outcome: "conflict", current });
  }
  const effectiveFloor =
    BigInt(input.mandatoryCheckpointFloor) < BigInt(current.headPosition)
      ? input.mandatoryCheckpointFloor
      : current.headPosition;
  if (BigInt(input.nextMinRetainedPosition) > BigInt(effectiveFloor)) {
    return parseRetainedResult({
      outcome: "checkpoint_blocked",
      current,
      mandatoryCheckpointFloor: effectiveFloor
    });
  }
  return null;
}

async function selectProjectionSnapshot(
  executor: RawSqlExecutor,
  input: Readonly<{
    context: Readonly<{ tenantId: string }>;
    projectionId: string;
    scopeId: string;
    syncGeneration: string;
  }>,
  lock: boolean
): Promise<MappedProjectionSnapshot | null> {
  const row = singleRow(
    await executor.execute<ProjectionSnapshotRow>(
      buildSelectProjectionSnapshotSql(input, lock)
    ),
    "projection generation snapshot"
  );
  return row === null
    ? null
    : mapProjectionSnapshotRow(row, input.context.tenantId, input);
}

async function selectCurrentProjectionSnapshot(
  executor: RawSqlExecutor,
  input: Readonly<{
    context: Readonly<{ tenantId: string }>;
    projectionId: string;
    scopeId: string;
  }>
): Promise<MappedProjectionSnapshot | null> {
  const headRow = singleRow(
    await executor.execute<ProjectionHeadRow>(
      buildSelectProjectionHeadSql(input, true)
    ),
    "current projection head"
  );
  if (headRow === null) return null;
  const head = mapProjectionHeadRow(headRow, input.context.tenantId, input);
  return selectProjectionSnapshot(
    executor,
    { ...input, syncGeneration: head.currentGeneration },
    true
  );
}

export function buildSelectProjectionSnapshotSql(
  input: Readonly<{
    context: Readonly<{ tenantId: string }>;
    projectionId: string;
    scopeId: string;
    syncGeneration: string;
  }>,
  lock: boolean
): SQL {
  const lockClause = lock
    ? sql`for update of generation_row, checkpoint_row`
    : sql``;
  return sql`
    select
      generation_row.tenant_id,
      generation_row.projection_id,
      generation_row.scope_id,
      generation_row.generation,
      generation_row.stream_epoch,
      generation_row.projection_schema_version,
      generation_row.state as generation_state,
      generation_row.min_retained_position,
      generation_row.revision as generation_revision,
      generation_row.created_at as initialized_at,
      generation_row.activated_at,
      generation_row.retired_at,
      generation_row.updated_at as generation_updated_at,
      checkpoint_row.position as checkpoint_position,
      checkpoint_row.last_commit_id,
      checkpoint_row.revision as checkpoint_revision,
      checkpoint_row.created_at as checkpoint_created_at,
      checkpoint_row.updated_at as checkpoint_updated_at
    from inbox_v2_projection_generations generation_row
    join inbox_v2_projection_checkpoints checkpoint_row
      on checkpoint_row.tenant_id = generation_row.tenant_id
     and checkpoint_row.projection_id = generation_row.projection_id
     and checkpoint_row.scope_id = generation_row.scope_id
     and checkpoint_row.generation = generation_row.generation
     and checkpoint_row.stream_epoch = generation_row.stream_epoch
    where generation_row.tenant_id = ${input.context.tenantId}
      and generation_row.projection_id = ${input.projectionId}
      and generation_row.scope_id = ${input.scopeId}
      and generation_row.generation = ${input.syncGeneration}
    ${lockClause}
  `;
}

export function buildSelectProjectionHeadSql(
  input: Readonly<{
    context: Readonly<{ tenantId: string }>;
    projectionId: string;
    scopeId: string;
  }>,
  lock: boolean
): SQL {
  const lockClause = lock ? sql`for update` : sql``;
  return sql`
    select tenant_id, projection_id, scope_id, current_generation,
           stream_epoch, projection_schema_version, revision,
           created_at, updated_at
    from inbox_v2_projection_heads
    where tenant_id = ${input.context.tenantId}
      and projection_id = ${input.projectionId}
      and scope_id = ${input.scopeId}
    ${lockClause}
  `;
}

export function buildSelectTenantStreamHeadSql(
  tenantId: string,
  lock: "share" | "update"
): SQL {
  const lockClause = lock === "share" ? sql`for share` : sql`for update`;
  return sql`
    select tenant_id, stream_epoch, last_position, min_retained_position,
           revision, created_at, updated_at,
           clock_timestamp() as db_now
    from inbox_v2_tenant_stream_heads
    where tenant_id = ${tenantId}
    ${lockClause}
  `;
}

function buildInsertProjectionGenerationSql(
  input: InboxV2InitializeProjectionGenerationInput
): SQL {
  const activatedAt =
    input.initialState === "active" ? input.initializedAt : null;
  return sql`
    insert into inbox_v2_projection_generations (
      tenant_id, projection_id, scope_id, generation, stream_epoch,
      projection_schema_version, state, min_retained_position, revision,
      created_at, activated_at, retired_at, updated_at
    ) values (
      ${input.context.tenantId}, ${input.projectionId}, ${input.scopeId},
      ${input.syncGeneration}, ${input.streamEpoch},
      ${input.projectionSchemaVersion}, ${input.initialState},
      ${input.minRetainedPosition}, 1, ${input.initializedAt},
      ${activatedAt}, null, ${input.initializedAt}
    )
    on conflict do nothing
    returning tenant_id, generation as id
  `;
}

function buildInsertProjectionCheckpointSql(
  input: InboxV2InitializeProjectionGenerationInput
): SQL {
  return sql`
    insert into inbox_v2_projection_checkpoints (
      tenant_id, projection_id, scope_id, generation, stream_epoch,
      position, last_commit_id, revision, created_at, updated_at
    ) values (
      ${input.context.tenantId}, ${input.projectionId}, ${input.scopeId},
      ${input.syncGeneration}, ${input.streamEpoch}, ${input.initialPosition},
      null, 1, ${input.initializedAt}, ${input.initializedAt}
    )
    returning tenant_id, generation as id
  `;
}

function buildInsertProjectionHeadSql(
  input: InboxV2InitializeProjectionGenerationInput
): SQL {
  return sql`
    insert into inbox_v2_projection_heads (
      tenant_id, projection_id, scope_id, current_generation, stream_epoch,
      projection_schema_version, revision, created_at, updated_at
    ) values (
      ${input.context.tenantId}, ${input.projectionId}, ${input.scopeId},
      ${input.syncGeneration}, ${input.streamEpoch},
      ${input.projectionSchemaVersion}, 1, ${input.initializedAt},
      ${input.initializedAt}
    )
    returning tenant_id, current_generation as id
  `;
}

function buildAdvanceProjectionCheckpointSql(
  input: InboxV2ApplyProjectionContiguousInput,
  current: MappedProjectionSnapshot
): SQL {
  return sql`
    update inbox_v2_projection_checkpoints
    set position = ${input.input.streamPosition},
        last_commit_id = ${input.input.commitId},
        revision = revision + 1,
        updated_at = greatest(updated_at, clock_timestamp())
    where tenant_id = ${input.context.tenantId}
      and projection_id = ${input.projectionId}
      and scope_id = ${input.scopeId}
      and generation = ${input.syncGeneration}
      and stream_epoch = ${input.input.streamEpoch}
      and position = ${current.snapshot.checkpoint.position}
      and revision = ${current.checkpointRevision}
    returning tenant_id, projection_id, scope_id, generation, stream_epoch,
              position, last_commit_id, revision, updated_at
  `;
}

function buildRetireProjectionGenerationSql(
  input: InboxV2CutoverProjectionGenerationInput,
  current: MappedProjectionSnapshot
): SQL {
  return sql`
    update inbox_v2_projection_generations
    set state = 'retired', retired_at = ${input.cutoverAt},
        revision = revision + 1, updated_at = ${input.cutoverAt}
    where tenant_id = ${input.context.tenantId}
      and projection_id = ${input.projectionId}
      and scope_id = ${input.scopeId}
      and generation = ${current.snapshot.generation.syncGeneration}
      and state = 'active'
      and revision = ${current.generationRevision}
    returning tenant_id, generation as id
  `;
}

function buildActivateProjectionGenerationSql(
  input: InboxV2CutoverProjectionGenerationInput,
  candidate: MappedProjectionSnapshot
): SQL {
  return sql`
    update inbox_v2_projection_generations
    set state = 'active', activated_at = ${input.cutoverAt},
        revision = revision + 1, updated_at = ${input.cutoverAt}
    where tenant_id = ${input.context.tenantId}
      and projection_id = ${input.projectionId}
      and scope_id = ${input.scopeId}
      and generation = ${input.candidateGeneration}
      and stream_epoch = ${candidate.snapshot.generation.streamEpoch}
      and state = 'shadow'
      and revision = ${candidate.generationRevision}
    returning tenant_id, generation as id
  `;
}

function buildAdvanceProjectionHeadSql(
  input: InboxV2CutoverProjectionGenerationInput,
  candidate: MappedProjectionSnapshot,
  head: MappedProjectionHead
): SQL {
  return sql`
    update inbox_v2_projection_heads
    set current_generation = ${input.candidateGeneration},
        stream_epoch = ${candidate.snapshot.generation.streamEpoch},
        projection_schema_version =
          ${candidate.snapshot.generation.projectionSchemaVersion},
        revision = revision + 1,
        updated_at = ${input.cutoverAt}
    where tenant_id = ${input.context.tenantId}
      and projection_id = ${input.projectionId}
      and scope_id = ${input.scopeId}
      and current_generation = ${head.currentGeneration}
      and revision = ${head.revision}
    returning tenant_id, current_generation as id
  `;
}

function buildInsertCutoverProjectionHeadSql(
  input: InboxV2CutoverProjectionGenerationInput,
  candidate: MappedProjectionSnapshot
): SQL {
  return sql`
    insert into inbox_v2_projection_heads (
      tenant_id, projection_id, scope_id, current_generation, stream_epoch,
      projection_schema_version, revision, created_at, updated_at
    ) values (
      ${input.context.tenantId}, ${input.projectionId}, ${input.scopeId},
      ${input.candidateGeneration},
      ${candidate.snapshot.generation.streamEpoch},
      ${candidate.snapshot.generation.projectionSchemaVersion},
      1, ${input.cutoverAt}, ${input.cutoverAt}
    )
    returning tenant_id, current_generation as id
  `;
}

function buildAdvanceTenantStreamRetainedPrefixSql(input: {
  input: InboxV2CompareAndSetRetainedPrefixInput;
  reasonId: string;
  advanceHash: string;
}): SQL {
  if (input.input.owner.kind !== "tenant_stream") {
    throw invariantError("Tenant stream retained-prefix owner is required.");
  }
  return sql`
    select tenant_id, stream_epoch, last_position, min_retained_position,
           revision, created_at, updated_at, pruned_commit_count,
           to_position as id
      from public.inbox_v2_advance_tenant_stream_retained_prefix_v1(
        ${input.input.context.tenantId},
        ${input.input.owner.streamEpoch},
        ${input.input.expectedMinRetainedPosition},
        ${input.input.nextMinRetainedPosition},
        ${input.input.expectedRevision},
        ${input.input.mandatoryCheckpointFloor},
        ${input.reasonId},
        ${input.advanceHash},
        ${input.input.changedAt}
      )
  `;
}

function buildAdvanceProjectionRetainedPrefixSql(
  input: InboxV2CompareAndSetRetainedPrefixInput
): SQL {
  if (input.owner.kind !== "projection_generation") {
    throw invariantError("Projection retained-prefix owner is required.");
  }
  return sql`
    update inbox_v2_projection_generations generation_row
    set min_retained_position = ${input.nextMinRetainedPosition},
        revision = generation_row.revision + 1,
        updated_at = ${input.changedAt}
    from inbox_v2_projection_checkpoints checkpoint_row
    where generation_row.tenant_id = ${input.context.tenantId}
      and generation_row.projection_id = ${input.owner.projectionId}
      and generation_row.scope_id = ${input.owner.scopeId}
      and generation_row.generation = ${input.owner.syncGeneration}
      and generation_row.stream_epoch = ${input.owner.streamEpoch}
      and generation_row.revision = ${input.expectedRevision}
      and generation_row.min_retained_position =
          ${input.expectedMinRetainedPosition}
      and checkpoint_row.tenant_id = generation_row.tenant_id
      and checkpoint_row.projection_id = generation_row.projection_id
      and checkpoint_row.scope_id = generation_row.scope_id
      and checkpoint_row.generation = generation_row.generation
      and checkpoint_row.stream_epoch = generation_row.stream_epoch
      and ${input.nextMinRetainedPosition} <= checkpoint_row.position
      and ${input.nextMinRetainedPosition} <=
          ${input.mandatoryCheckpointFloor}
    returning
      generation_row.tenant_id,
      generation_row.projection_id,
      generation_row.scope_id,
      generation_row.generation,
      generation_row.stream_epoch,
      generation_row.projection_schema_version,
      generation_row.state as generation_state,
      generation_row.min_retained_position,
      generation_row.revision as generation_revision,
      generation_row.created_at as initialized_at,
      generation_row.activated_at,
      generation_row.retired_at,
      generation_row.updated_at as generation_updated_at,
      checkpoint_row.position as checkpoint_position,
      checkpoint_row.last_commit_id,
      checkpoint_row.revision as checkpoint_revision,
      checkpoint_row.created_at as checkpoint_created_at,
      checkpoint_row.updated_at as checkpoint_updated_at
  `;
}

function mapProjectionSnapshotRow(
  row: ProjectionSnapshotRow,
  expectedTenantId: string,
  expected?: Readonly<{
    projectionId?: string;
    scopeId?: string;
    syncGeneration?: string;
    streamEpoch?: string;
  }>
): MappedProjectionSnapshot {
  const tenantId = textValue(row.tenant_id, "projection tenant");
  assertTenant(tenantId, expectedTenantId);
  const projectionId = textValue(row.projection_id, "projection id");
  const scopeId = textValue(row.scope_id, "projection scope");
  const syncGeneration = bigintText(row.generation, "projection generation");
  const streamEpoch = textValue(row.stream_epoch, "projection stream epoch");
  if (
    (expected?.projectionId !== undefined &&
      projectionId !== expected.projectionId) ||
    (expected?.scopeId !== undefined && scopeId !== expected.scopeId) ||
    (expected?.syncGeneration !== undefined &&
      syncGeneration !== expected.syncGeneration) ||
    (expected?.streamEpoch !== undefined &&
      streamEpoch !== expected.streamEpoch)
  ) {
    throw invariantError(
      "Projection snapshot identity changed during mapping."
    );
  }
  const generationRevision = bigintText(
    row.generation_revision,
    "projection generation revision"
  );
  const checkpointRevision = bigintText(
    row.checkpoint_revision,
    "projection checkpoint revision"
  );
  const generationUpdatedAt = timestampText(
    row.generation_updated_at,
    "projection generation updatedAt"
  );
  const checkpointUpdatedAt = timestampText(
    row.checkpoint_updated_at,
    "projection checkpoint updatedAt"
  );
  const projectionSchemaVersion = textValue(
    row.projection_schema_version,
    "projection schema version"
  );
  const checkpointPosition = bigintText(
    row.checkpoint_position,
    "projection checkpoint"
  );
  const lastCommitId =
    row.last_commit_id === null
      ? null
      : textValue(row.last_commit_id, "projection last commit");
  if (
    BigInt(checkpointRevision) < 1n ||
    (checkpointPosition === "0" && lastCommitId !== null) ||
    Date.parse(checkpointUpdatedAt) <
      Date.parse(
        timestampText(
          row.checkpoint_created_at,
          "projection checkpoint createdAt"
        )
      ) ||
    Date.parse(generationUpdatedAt) <
      Date.parse(timestampText(row.initialized_at, "projection initializedAt"))
  ) {
    throw invariantError(
      "Projection checkpoint persistence row is incoherent."
    );
  }
  const snapshot = inboxV2ProjectionGenerationSnapshotSchema.parse({
    generation: {
      tenantId,
      projectionId,
      scopeId,
      streamEpoch,
      syncGeneration,
      projectionSchemaVersion,
      state: row.generation_state,
      minRetainedPosition: bigintText(
        row.min_retained_position,
        "projection minimum retained position"
      ),
      revision: generationRevision,
      initializedAt: timestampText(
        row.initialized_at,
        "projection initializedAt"
      ),
      activatedAt:
        row.activated_at === null
          ? null
          : timestampText(row.activated_at, "projection activatedAt"),
      retiredAt:
        row.retired_at === null
          ? null
          : timestampText(row.retired_at, "projection retiredAt")
    },
    checkpoint: {
      tenantId,
      projectionId,
      scopeId,
      streamEpoch,
      syncGeneration,
      projectionSchemaVersion,
      position: checkpointPosition
    }
  });
  return {
    snapshot,
    generationRevision,
    checkpointRevision,
    generationUpdatedAt,
    checkpointUpdatedAt,
    lastCommitId
  };
}

function mapProjectionHeadRow(
  row: ProjectionHeadRow,
  expectedTenantId: string,
  expected: Readonly<{ projectionId: string; scopeId: string }>
): MappedProjectionHead {
  const tenantId = textValue(row.tenant_id, "projection head tenant");
  assertTenant(tenantId, expectedTenantId);
  const projectionId = textValue(row.projection_id, "projection head id");
  const scopeId = textValue(row.scope_id, "projection head scope");
  if (projectionId !== expected.projectionId || scopeId !== expected.scopeId) {
    throw invariantError("Projection head identity changed during mapping.");
  }
  return {
    tenantId,
    projectionId,
    scopeId,
    currentGeneration: bigintText(
      row.current_generation,
      "projection current generation"
    ),
    streamEpoch: textValue(row.stream_epoch, "projection head stream epoch"),
    projectionSchemaVersion: textValue(
      row.projection_schema_version,
      "projection head schema version"
    ),
    revision: bigintText(row.revision, "projection head revision"),
    createdAt: timestampText(row.created_at, "projection head createdAt"),
    updatedAt: timestampText(row.updated_at, "projection head updatedAt")
  };
}

function mapTenantStreamHeadRow(
  row: TenantStreamHeadRow,
  expectedTenantId: string
): Readonly<{
  tenantId: string;
  streamEpoch: string;
  lastPosition: string;
  minRetainedPosition: string;
  revision: string;
  createdAt: string;
  updatedAt: string;
}> {
  const tenantId = textValue(row.tenant_id, "tenant stream tenant");
  assertTenant(tenantId, expectedTenantId);
  return {
    tenantId,
    streamEpoch: textValue(row.stream_epoch, "tenant stream epoch"),
    lastPosition: bigintText(row.last_position, "tenant stream head position"),
    minRetainedPosition: bigintText(
      row.min_retained_position,
      "tenant stream minimum retained position"
    ),
    revision: bigintText(row.revision, "tenant stream revision"),
    createdAt: timestampText(row.created_at, "tenant stream createdAt"),
    updatedAt: timestampText(row.updated_at, "tenant stream updatedAt")
  };
}

function mapTenantStreamRetainedState(
  input: InboxV2CompareAndSetRetainedPrefixInput,
  row: Readonly<{
    streamEpoch: string;
    lastPosition: string;
    minRetainedPosition: string;
    revision: string;
    updatedAt: string;
  }>
): InboxV2RetainedPrefixState {
  return inboxV2RetainedPrefixStateSchema.parse({
    tenantId: input.context.tenantId,
    owner: { kind: "tenant_stream", streamEpoch: row.streamEpoch },
    minRetainedPosition: row.minRetainedPosition,
    headPosition: row.lastPosition,
    revision: row.revision,
    updatedAt: row.updatedAt
  });
}

function mapProjectionRetainedState(
  input: InboxV2CompareAndSetRetainedPrefixInput,
  current: MappedProjectionSnapshot
): InboxV2RetainedPrefixState {
  if (input.owner.kind !== "projection_generation") {
    throw invariantError("Projection retained-prefix owner is required.");
  }
  return inboxV2RetainedPrefixStateSchema.parse({
    tenantId: input.context.tenantId,
    owner: input.owner,
    minRetainedPosition: current.snapshot.generation.minRetainedPosition,
    headPosition: current.snapshot.checkpoint.position,
    revision: current.generationRevision,
    updatedAt: current.generationUpdatedAt
  });
}

function assertCheckpointUpdate(
  row: CheckpointUpdateRow,
  input: InboxV2ApplyProjectionContiguousInput,
  before: MappedProjectionSnapshot
): void {
  const tenantId = textValue(row.tenant_id, "checkpoint update tenant");
  assertTenant(tenantId, input.context.tenantId);
  if (
    textValue(row.projection_id, "checkpoint update projection") !==
      input.projectionId ||
    textValue(row.scope_id, "checkpoint update scope") !== input.scopeId ||
    bigintText(row.generation, "checkpoint update generation") !==
      input.syncGeneration ||
    textValue(row.stream_epoch, "checkpoint update epoch") !==
      input.input.streamEpoch ||
    bigintText(row.position, "checkpoint update position") !==
      input.input.streamPosition ||
    textValue(row.last_commit_id, "checkpoint update commit") !==
      input.input.commitId ||
    bigintText(row.revision, "checkpoint update revision") !==
      String(BigInt(before.checkpointRevision) + 1n)
  ) {
    throw invariantError(
      "Projection checkpoint advance returned incoherent state."
    );
  }
  timestampText(row.updated_at, "checkpoint update updatedAt");
}

function assertMutationIdentity(
  row: MutationIdentityRow,
  expectedTenantId: string,
  expectedId: string,
  label: string
): void {
  const tenantId = textValue(row.tenant_id, `${label} tenant`);
  assertTenant(tenantId, expectedTenantId);
  if (bigintText(row.id, `${label} id`) !== expectedId) {
    throw invariantError(`${label} returned a different identity.`);
  }
}

function retainedNotFound(
  input: InboxV2CompareAndSetRetainedPrefixInput
): InboxV2CompareAndSetRetainedPrefixResult {
  return parseRetainedResult({
    outcome: "not_found",
    tenantId: input.context.tenantId,
    owner: input.owner
  });
}

function parseInitializeResult(
  value: unknown
): InboxV2InitializeProjectionGenerationResult {
  return inboxV2InitializeProjectionGenerationResultSchema.parse(value);
}

function parseApplyResult(
  value: unknown
): InboxV2ApplyProjectionContiguousResult {
  return inboxV2ApplyProjectionContiguousResultSchema.parse(value);
}

function parseCutoverResult(
  value: unknown
): InboxV2CutoverProjectionGenerationResult {
  return inboxV2CutoverProjectionGenerationResultSchema.parse(value);
}

function parseRetainedResult(
  value: unknown
): InboxV2CompareAndSetRetainedPrefixResult {
  return inboxV2CompareAndSetRetainedPrefixResultSchema.parse(value);
}

function exactlyOneRow<TRow>(rows: readonly TRow[], label: string): TRow {
  if (rows.length !== 1 || rows[0] === undefined) {
    throw invariantError(`${label} did not return exactly one row.`);
  }
  return rows[0];
}

function singleRow<TRow>(
  result: RawSqlQueryResult<TRow>,
  label: string
): TRow | null {
  if (result.rows.length > 1) {
    throw invariantError(`${label} returned more than one row.`);
  }
  return result.rows[0] ?? null;
}

function textValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invariantError(`${label} is not a non-empty database string.`);
  }
  return value;
}

function bigintText(value: unknown, label: string): string {
  if (typeof value === "number") {
    throw invariantError(`${label} was decoded as a lossy JavaScript number.`);
  }
  if (typeof value !== "string" && typeof value !== "bigint") {
    throw invariantError(`${label} is not a PostgreSQL bigint.`);
  }
  const parsed = String(value);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(parsed)) {
    throw invariantError(`${label} is not a non-negative PostgreSQL bigint.`);
  }
  return parsed;
}

function timestampText(value: unknown, label: string): string {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;
  if (date === null || Number.isNaN(date.getTime())) {
    throw invariantError(`${label} is not a PostgreSQL timestamp.`);
  }
  return date.toISOString();
}

function assertTenant(actualTenantId: string, expectedTenantId: string): void {
  if (actualTenantId !== expectedTenantId) {
    throw new CoreError("tenant.boundary_violation");
  }
}

function invariantError(
  message: string
): InboxV2RepositoryProjectionPersistenceInvariantError {
  return new InboxV2RepositoryProjectionPersistenceInvariantError(message);
}
