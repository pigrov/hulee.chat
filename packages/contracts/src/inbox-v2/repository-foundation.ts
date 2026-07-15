import { z } from "zod";

import {
  inboxV2BigintCounterSchema,
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import { inboxV2TenantIdSchema } from "./ids";
import { inboxV2NamespacedIdSchema } from "./namespace";
import {
  inboxV2ProjectionCheckpointHeadSchema,
  inboxV2ProjectionCheckpointTransitionSchema,
  inboxV2ProjectionInputSchema
} from "./projection-protocol";
import { calculateInboxV2CanonicalSha256 } from "./recipient-sync-hash";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION,
  inboxV2SchemaVersionTokenSchema
} from "./schema-version";
import {
  inboxV2OutboxIntentIdSchema,
  inboxV2PayloadReferenceSchema,
  inboxV2ProjectionCheckpointSchema,
  inboxV2ProjectionIdSchema,
  inboxV2RecipientScopeIdSchema,
  inboxV2Sha256DigestSchema,
  inboxV2StreamEpochSchema,
  inboxV2SyncGenerationSchema,
  inboxV2TenantStreamCommitPositionSchema,
  inboxV2TenantStreamPositionSchema
} from "./sync-primitives";
import {
  inboxV2TenantStreamChangeSchema,
  inboxV2TenantStreamCommitSchema,
  inboxV2TenantStreamHeadSchema
} from "./tenant-stream";

export const INBOX_V2_REPOSITORY_FOUNDATION_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;
export const INBOX_V2_TENANT_STREAM_SNAPSHOT_SCHEMA_ID =
  "core:inbox-v2.repository-tenant-stream-snapshot" as const;
export const INBOX_V2_TENANT_STREAM_REPLAY_PAGE_SCHEMA_ID =
  "core:inbox-v2.repository-tenant-stream-replay-page" as const;
export const INBOX_V2_PROJECTION_GENERATION_SCHEMA_ID =
  "core:inbox-v2.repository-projection-generation" as const;
export const INBOX_V2_RETAINED_PREFIX_SCHEMA_ID =
  "core:inbox-v2.repository-retained-prefix" as const;
export const INBOX_V2_OUTBOX_WORK_ITEM_SCHEMA_ID =
  "core:inbox-v2.repository-outbox-work-item" as const;

const repositoryBatchLimitSchema = z.number().int().min(1).max(1_000);
const leaseDurationSecondsSchema = z.number().int().min(1).max(300);
const retryAfterSecondsSchema = z.number().int().min(1).max(86_400);

/**
 * Mandatory context for every foundation repository operation. Tenant is never
 * inferred from a persisted row, cursor, lease token or caller-selected ID.
 */
export const inboxV2RepositoryTenantContextSchema = z
  .object({ tenantId: inboxV2TenantIdSchema })
  .strict();

export const inboxV2TenantStreamSnapshotSchema = inboxV2TenantStreamHeadSchema
  .extend({ capturedAt: inboxV2TimestampSchema })
  .strict();

export const inboxV2TenantStreamSnapshotEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_TENANT_STREAM_SNAPSHOT_SCHEMA_ID,
    INBOX_V2_REPOSITORY_FOUNDATION_SCHEMA_VERSION,
    inboxV2TenantStreamSnapshotSchema
  );

export const inboxV2LoadTenantStreamSnapshotInputSchema = z
  .object({ context: inboxV2RepositoryTenantContextSchema })
  .strict();

export const inboxV2LoadTenantStreamSnapshotResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("found"),
        tenantId: inboxV2TenantIdSchema,
        snapshot: inboxV2TenantStreamSnapshotSchema
      })
      .strict()
      .superRefine((result, context) => {
        if (result.snapshot.tenantId !== result.tenantId) {
          addIssue(
            context,
            ["snapshot", "tenantId"],
            "Tenant stream snapshot must belong to the result tenant."
          );
        }
      }),
    z
      .object({
        outcome: z.literal("not_found"),
        tenantId: inboxV2TenantIdSchema
      })
      .strict()
  ]
);

export const inboxV2ReplayTenantStreamInputSchema = z
  .object({
    context: inboxV2RepositoryTenantContextSchema,
    streamEpoch: inboxV2StreamEpochSchema,
    afterPosition: inboxV2TenantStreamPositionSchema,
    throughPosition: inboxV2TenantStreamPositionSchema,
    limit: repositoryBatchLimitSchema
  })
  .strict()
  .superRefine((input, context) => {
    if (BigInt(input.throughPosition) < BigInt(input.afterPosition)) {
      addIssue(
        context,
        ["throughPosition"],
        "Replay upper bound cannot precede its exclusive cursor."
      );
    }
  });

/** One immutable commit with the exact canonical change order it owns. */
export const inboxV2TenantStreamReplayCommitSchema = z
  .object({
    commit: inboxV2TenantStreamCommitSchema,
    changes: z.array(inboxV2TenantStreamChangeSchema).min(1).max(1_000)
  })
  .strict()
  .superRefine((entry, context) => {
    const changeIds = entry.changes.map((change) => change.reference.changeId);
    if (!sameStringArray(changeIds, entry.commit.changeIds)) {
      addIssue(
        context,
        ["changes"],
        "Replay changes must exactly match the commit change manifest."
      );
    }
    for (const [index, change] of entry.changes.entries()) {
      if (
        change.reference.tenantId !== entry.commit.tenantId ||
        change.reference.commitId !== entry.commit.id ||
        change.reference.streamPosition !== entry.commit.position ||
        BigInt(change.reference.ordinal) !== BigInt(index + 1)
      ) {
        addIssue(
          context,
          ["changes", index],
          "Replay changes must be contiguous, one-based and bound to the exact commit."
        );
      }
    }
  });

export const inboxV2TenantStreamReplayPageSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    streamEpoch: inboxV2StreamEpochSchema,
    snapshotPosition: inboxV2TenantStreamPositionSchema,
    minRetainedPosition: inboxV2TenantStreamPositionSchema,
    fromExclusive: inboxV2TenantStreamPositionSchema,
    throughInclusive: inboxV2TenantStreamPositionSchema,
    scannedThrough: inboxV2TenantStreamPositionSchema,
    limit: repositoryBatchLimitSchema,
    commits: z.array(inboxV2TenantStreamReplayCommitSchema).max(1_000),
    hasMore: z.boolean(),
    nextAfterPosition: inboxV2TenantStreamPositionSchema.nullable()
  })
  .strict()
  .superRefine((page, context) => {
    const from = BigInt(page.fromExclusive);
    const through = BigInt(page.throughInclusive);
    const snapshot = BigInt(page.snapshotPosition);
    const minimum = BigInt(page.minRetainedPosition);
    const scanned = BigInt(page.scannedThrough);
    if (
      through < from ||
      through > snapshot ||
      scanned < from ||
      scanned > through
    ) {
      addIssue(
        context,
        [],
        "Replay bounds must stay inside the captured tenant stream snapshot."
      );
    }
    const earliestResumeCursor = minimum > 0n ? minimum - 1n : 0n;
    if (from < earliestResumeCursor) {
      addIssue(
        context,
        ["fromExclusive"],
        "Replay cursor requires positions below the retained tenant stream prefix."
      );
    }
    let expected = from + 1n;
    for (const [index, entry] of page.commits.entries()) {
      if (
        entry.commit.tenantId !== page.tenantId ||
        entry.commit.streamEpoch !== page.streamEpoch ||
        BigInt(entry.commit.position) !== expected
      ) {
        addIssue(
          context,
          ["commits", index],
          "Replay commits must be tenant-local and position-contiguous."
        );
      }
      expected += 1n;
    }
    const expectedScanned =
      page.commits.length === 0
        ? from
        : BigInt(page.commits[page.commits.length - 1]!.commit.position);
    if (scanned !== expectedScanned) {
      addIssue(
        context,
        ["scannedThrough"],
        "Replay scanned-through position must equal its final returned commit."
      );
    }
    if (
      page.hasMore !== scanned < through ||
      page.commits.length > page.limit ||
      (page.hasMore && page.commits.length !== page.limit) ||
      (page.hasMore
        ? page.nextAfterPosition !== page.scannedThrough
        : page.nextAfterPosition !== null)
    ) {
      addIssue(
        context,
        ["hasMore"],
        "Replay continuation metadata must describe the exact bounded page."
      );
    }
  });

export const inboxV2TenantStreamReplayPageEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_TENANT_STREAM_REPLAY_PAGE_SCHEMA_ID,
    INBOX_V2_REPOSITORY_FOUNDATION_SCHEMA_VERSION,
    inboxV2TenantStreamReplayPageSchema
  );

export const inboxV2ReplayTenantStreamResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("page"),
        page: inboxV2TenantStreamReplayPageSchema
      })
      .strict(),
    z
      .object({
        outcome: z.literal("not_found"),
        tenantId: inboxV2TenantIdSchema
      })
      .strict(),
    z
      .object({
        outcome: z.literal("epoch_mismatch"),
        tenantId: inboxV2TenantIdSchema,
        currentStreamEpoch: inboxV2StreamEpochSchema
      })
      .strict(),
    z
      .object({
        outcome: z.literal("cursor_expired"),
        tenantId: inboxV2TenantIdSchema,
        minRetainedPosition: inboxV2TenantStreamPositionSchema
      })
      .strict(),
    z
      .object({
        outcome: z.literal("cursor_future"),
        tenantId: inboxV2TenantIdSchema,
        lastPosition: inboxV2TenantStreamPositionSchema
      })
      .strict(),
    z
      .object({
        outcome: z.literal("gap_detected"),
        tenantId: inboxV2TenantIdSchema,
        expectedPosition: inboxV2TenantStreamCommitPositionSchema,
        observedPosition: inboxV2TenantStreamCommitPositionSchema
      })
      .strict()
      .superRefine((result, context) => {
        if (
          BigInt(result.observedPosition) <= BigInt(result.expectedPosition)
        ) {
          addIssue(
            context,
            ["observedPosition"],
            "Observed gap position must be above the expected position."
          );
        }
      })
  ]
);

export interface InboxV2TenantStreamRepositoryPort {
  loadSnapshot(
    input: Readonly<InboxV2LoadTenantStreamSnapshotInput>
  ): Promise<InboxV2LoadTenantStreamSnapshotResult>;
  replayBounded(
    input: Readonly<InboxV2ReplayTenantStreamInput>
  ): Promise<InboxV2ReplayTenantStreamResult>;
}

export const inboxV2ProjectionGenerationStateSchema = z.enum([
  "shadow",
  "active",
  "retired"
]);

export const inboxV2ProjectionGenerationSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    projectionId: inboxV2ProjectionIdSchema,
    scopeId: inboxV2RecipientScopeIdSchema,
    streamEpoch: inboxV2StreamEpochSchema,
    syncGeneration: inboxV2SyncGenerationSchema,
    projectionSchemaVersion: inboxV2SchemaVersionTokenSchema,
    state: inboxV2ProjectionGenerationStateSchema,
    minRetainedPosition: inboxV2ProjectionCheckpointSchema,
    revision: inboxV2EntityRevisionSchema,
    initializedAt: inboxV2TimestampSchema,
    activatedAt: inboxV2TimestampSchema.nullable(),
    retiredAt: inboxV2TimestampSchema.nullable()
  })
  .strict()
  .superRefine((generation, context) => {
    const invalidLifecycleTimestamps =
      (generation.state === "shadow" &&
        (generation.activatedAt !== null || generation.retiredAt !== null)) ||
      (generation.state === "active" &&
        (generation.activatedAt === null || generation.retiredAt !== null)) ||
      (generation.state === "retired" &&
        (generation.activatedAt === null || generation.retiredAt === null));
    if (
      invalidLifecycleTimestamps ||
      (generation.activatedAt !== null &&
        !isInboxV2TimestampOrderValid(
          generation.initializedAt,
          generation.activatedAt
        )) ||
      (generation.retiredAt !== null &&
        (!isInboxV2TimestampOrderValid(
          generation.initializedAt,
          generation.retiredAt
        ) ||
          (generation.activatedAt !== null &&
            !isInboxV2TimestampOrderValid(
              generation.activatedAt,
              generation.retiredAt
            ))))
    ) {
      addIssue(
        context,
        ["state"],
        "Projection generation state and lifecycle timestamps must agree."
      );
    }
  });

export const inboxV2ProjectionGenerationEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_PROJECTION_GENERATION_SCHEMA_ID,
    INBOX_V2_REPOSITORY_FOUNDATION_SCHEMA_VERSION,
    inboxV2ProjectionGenerationSchema
  );

export const inboxV2ProjectionGenerationSnapshotSchema = z
  .object({
    generation: inboxV2ProjectionGenerationSchema,
    checkpoint: inboxV2ProjectionCheckpointHeadSchema
  })
  .strict()
  .superRefine((snapshot, context) => {
    const generation = snapshot.generation;
    const checkpoint = snapshot.checkpoint;
    if (
      checkpoint.tenantId !== generation.tenantId ||
      checkpoint.projectionId !== generation.projectionId ||
      checkpoint.scopeId !== generation.scopeId ||
      checkpoint.streamEpoch !== generation.streamEpoch ||
      checkpoint.syncGeneration !== generation.syncGeneration ||
      checkpoint.projectionSchemaVersion !==
        generation.projectionSchemaVersion ||
      BigInt(generation.minRetainedPosition) > BigInt(checkpoint.position)
    ) {
      addIssue(
        context,
        ["checkpoint"],
        "Projection checkpoint must identify the generation and retain no position above it."
      );
    }
  });

export const inboxV2InitializeProjectionGenerationInputSchema = z
  .object({
    context: inboxV2RepositoryTenantContextSchema,
    projectionId: inboxV2ProjectionIdSchema,
    scopeId: inboxV2RecipientScopeIdSchema,
    streamEpoch: inboxV2StreamEpochSchema,
    syncGeneration: inboxV2SyncGenerationSchema,
    projectionSchemaVersion: inboxV2SchemaVersionTokenSchema,
    initialPosition: inboxV2ProjectionCheckpointSchema,
    minRetainedPosition: inboxV2ProjectionCheckpointSchema,
    initialState: z.enum(["shadow", "active"]),
    initializedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((input, context) => {
    if (BigInt(input.minRetainedPosition) > BigInt(input.initialPosition)) {
      addIssue(
        context,
        ["minRetainedPosition"],
        "Projection retained prefix cannot start above its checkpoint."
      );
    }
  });

export const inboxV2InitializeProjectionGenerationResultSchema =
  z.discriminatedUnion("outcome", [
    z
      .object({
        outcome: z.literal("initialized"),
        snapshot: inboxV2ProjectionGenerationSnapshotSchema
      })
      .strict(),
    z
      .object({
        outcome: z.literal("already_initialized"),
        snapshot: inboxV2ProjectionGenerationSnapshotSchema
      })
      .strict(),
    z
      .object({
        outcome: z.literal("conflict"),
        facet: z.enum([
          "generation_identity",
          "active_generation",
          "checkpoint",
          "retained_prefix"
        ]),
        current: inboxV2ProjectionGenerationSnapshotSchema.nullable()
      })
      .strict()
  ]);

export const inboxV2LoadProjectionGenerationInputSchema = z
  .object({
    context: inboxV2RepositoryTenantContextSchema,
    projectionId: inboxV2ProjectionIdSchema,
    scopeId: inboxV2RecipientScopeIdSchema,
    syncGeneration: inboxV2SyncGenerationSchema
  })
  .strict();

export const inboxV2LoadProjectionGenerationResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("found"),
        snapshot: inboxV2ProjectionGenerationSnapshotSchema
      })
      .strict(),
    z
      .object({
        outcome: z.literal("not_found"),
        tenantId: inboxV2TenantIdSchema
      })
      .strict()
  ]
);

export const inboxV2ApplyProjectionContiguousInputSchema = z
  .object({
    context: inboxV2RepositoryTenantContextSchema,
    projectionId: inboxV2ProjectionIdSchema,
    scopeId: inboxV2RecipientScopeIdSchema,
    syncGeneration: inboxV2SyncGenerationSchema,
    expectedCheckpoint: inboxV2ProjectionCheckpointSchema,
    input: inboxV2ProjectionInputSchema,
    relevance: z.enum([
      "relevant",
      "irrelevant",
      "unsupported_mandatory_schema"
    ])
  })
  .strict()
  .superRefine((operation, context) => {
    if (operation.input.tenantId !== operation.context.tenantId) {
      addIssue(
        context,
        ["input", "tenantId"],
        "Projection input must belong to the explicit repository tenant."
      );
    }
  });

const projectionCheckpointConflictShape = {
  tenantId: inboxV2TenantIdSchema,
  projectionId: inboxV2ProjectionIdSchema,
  scopeId: inboxV2RecipientScopeIdSchema,
  syncGeneration: inboxV2SyncGenerationSchema,
  currentCheckpoint: inboxV2ProjectionCheckpointSchema
} as const;

export const inboxV2ApplyProjectionContiguousResultSchema =
  z.discriminatedUnion("outcome", [
    z
      .object({
        outcome: z.enum(["applied", "advanced_irrelevant"]),
        transition: inboxV2ProjectionCheckpointTransitionSchema
      })
      .strict()
      .superRefine((result, context) => {
        const expectedDisposition =
          result.outcome === "applied" ? "applied" : "irrelevant";
        if (result.transition.disposition !== expectedDisposition) {
          addIssue(
            context,
            ["transition", "disposition"],
            "Projection result must match its persisted checkpoint disposition."
          );
        }
      }),
    z
      .object({
        outcome: z.literal("duplicate"),
        ...projectionCheckpointConflictShape,
        receivedPosition: inboxV2TenantStreamCommitPositionSchema
      })
      .strict()
      .superRefine((result, context) => {
        if (
          BigInt(result.receivedPosition) > BigInt(result.currentCheckpoint)
        ) {
          addIssue(
            context,
            ["receivedPosition"],
            "Duplicate projection input cannot be newer than the checkpoint."
          );
        }
      }),
    z
      .object({
        outcome: z.literal("gap_detected"),
        ...projectionCheckpointConflictShape,
        expectedPosition: inboxV2TenantStreamCommitPositionSchema,
        observedPosition: inboxV2TenantStreamCommitPositionSchema
      })
      .strict()
      .superRefine((result, context) => {
        if (
          BigInt(result.expectedPosition) !==
            BigInt(result.currentCheckpoint) + 1n ||
          BigInt(result.observedPosition) <= BigInt(result.expectedPosition)
        ) {
          addIssue(
            context,
            ["observedPosition"],
            "Projection gap must name checkpoint plus one and a higher observed position."
          );
        }
      }),
    z
      .object({
        outcome: z.literal("checkpoint_conflict"),
        ...projectionCheckpointConflictShape
      })
      .strict(),
    z
      .object({
        outcome: z.literal("generation_not_found"),
        tenantId: inboxV2TenantIdSchema,
        projectionId: inboxV2ProjectionIdSchema,
        scopeId: inboxV2RecipientScopeIdSchema,
        syncGeneration: inboxV2SyncGenerationSchema
      })
      .strict(),
    z
      .object({
        outcome: z.enum([
          "epoch_mismatch",
          "schema_unsupported",
          "generation_retired"
        ]),
        ...projectionCheckpointConflictShape
      })
      .strict()
  ]);

export const inboxV2CutoverProjectionGenerationInputSchema = z
  .object({
    context: inboxV2RepositoryTenantContextSchema,
    projectionId: inboxV2ProjectionIdSchema,
    scopeId: inboxV2RecipientScopeIdSchema,
    expectedActiveGeneration: inboxV2SyncGenerationSchema.nullable(),
    candidateGeneration: inboxV2SyncGenerationSchema,
    expectedCandidateCheckpoint: inboxV2ProjectionCheckpointSchema,
    requiredThroughPosition: inboxV2ProjectionCheckpointSchema,
    cutoverAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((input, context) => {
    if (input.expectedActiveGeneration === input.candidateGeneration) {
      addIssue(
        context,
        ["candidateGeneration"],
        "Projection cutover candidate must differ from the expected active generation."
      );
    }
    if (
      BigInt(input.expectedCandidateCheckpoint) <
      BigInt(input.requiredThroughPosition)
    ) {
      addIssue(
        context,
        ["expectedCandidateCheckpoint"],
        "Projection cutover candidate must cover the required position."
      );
    }
  });

export const inboxV2CutoverProjectionGenerationResultSchema =
  z.discriminatedUnion("outcome", [
    z
      .object({
        outcome: z.literal("cut_over"),
        previousActive: inboxV2ProjectionGenerationSnapshotSchema.nullable(),
        active: inboxV2ProjectionGenerationSnapshotSchema
      })
      .strict(),
    z
      .object({
        outcome: z.literal("already_cut_over"),
        active: inboxV2ProjectionGenerationSnapshotSchema
      })
      .strict(),
    z
      .object({
        outcome: z.literal("active_generation_conflict"),
        currentActiveGeneration: inboxV2SyncGenerationSchema.nullable()
      })
      .strict(),
    z.object({ outcome: z.literal("candidate_not_found") }).strict(),
    z
      .object({
        outcome: z.literal("candidate_checkpoint_conflict"),
        currentCheckpoint: inboxV2ProjectionCheckpointSchema
      })
      .strict(),
    z
      .object({
        outcome: z.literal("candidate_not_ready"),
        currentCheckpoint: inboxV2ProjectionCheckpointSchema,
        requiredThroughPosition: inboxV2ProjectionCheckpointSchema
      })
      .strict()
      .superRefine((result, context) => {
        if (
          BigInt(result.currentCheckpoint) >=
          BigInt(result.requiredThroughPosition)
        ) {
          addIssue(
            context,
            ["currentCheckpoint"],
            "A not-ready cutover candidate must be behind the required position."
          );
        }
      })
  ]);

export interface InboxV2ProjectionRepositoryPort {
  initializeGeneration(
    input: Readonly<InboxV2InitializeProjectionGenerationInput>
  ): Promise<InboxV2InitializeProjectionGenerationResult>;
  loadGeneration(
    input: Readonly<InboxV2LoadProjectionGenerationInput>
  ): Promise<InboxV2LoadProjectionGenerationResult>;
  applyContiguous(
    input: Readonly<InboxV2ApplyProjectionContiguousInput>
  ): Promise<InboxV2ApplyProjectionContiguousResult>;
  cutoverGeneration(
    input: Readonly<InboxV2CutoverProjectionGenerationInput>
  ): Promise<InboxV2CutoverProjectionGenerationResult>;
}

export const inboxV2RetainedPrefixOwnerSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("tenant_stream"),
      streamEpoch: inboxV2StreamEpochSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("projection_generation"),
      projectionId: inboxV2ProjectionIdSchema,
      scopeId: inboxV2RecipientScopeIdSchema,
      streamEpoch: inboxV2StreamEpochSchema,
      syncGeneration: inboxV2SyncGenerationSchema
    })
    .strict()
]);

export const inboxV2RetainedPrefixStateSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    owner: inboxV2RetainedPrefixOwnerSchema,
    minRetainedPosition: inboxV2TenantStreamPositionSchema,
    headPosition: inboxV2TenantStreamPositionSchema,
    revision: inboxV2EntityRevisionSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((state, context) => {
    if (BigInt(state.minRetainedPosition) > BigInt(state.headPosition)) {
      addIssue(
        context,
        ["minRetainedPosition"],
        "Retained prefix cannot advance more than one position beyond the head."
      );
    }
  });

export const inboxV2RetainedPrefixEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_RETAINED_PREFIX_SCHEMA_ID,
    INBOX_V2_REPOSITORY_FOUNDATION_SCHEMA_VERSION,
    inboxV2RetainedPrefixStateSchema
  );

export const inboxV2CompareAndSetRetainedPrefixInputSchema = z
  .object({
    context: inboxV2RepositoryTenantContextSchema,
    owner: inboxV2RetainedPrefixOwnerSchema,
    expectedRevision: inboxV2EntityRevisionSchema,
    expectedMinRetainedPosition: inboxV2TenantStreamPositionSchema,
    nextMinRetainedPosition: inboxV2TenantStreamPositionSchema,
    mandatoryCheckpointFloor: inboxV2TenantStreamPositionSchema,
    changedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((input, context) => {
    const expected = BigInt(input.expectedMinRetainedPosition);
    const next = BigInt(input.nextMinRetainedPosition);
    const floor = BigInt(input.mandatoryCheckpointFloor);
    if (next <= expected) {
      addIssue(
        context,
        ["nextMinRetainedPosition"],
        "Retained-prefix CAS must strictly advance its minimum."
      );
    }
    if (next > floor) {
      addIssue(
        context,
        ["mandatoryCheckpointFloor"],
        "Retained-prefix CAS cannot prune past a mandatory checkpoint."
      );
    }
  });

export const inboxV2CompareAndSetRetainedPrefixResultSchema =
  z.discriminatedUnion("outcome", [
    z
      .object({
        outcome: z.literal("advanced"),
        current: inboxV2RetainedPrefixStateSchema
      })
      .strict(),
    z
      .object({
        outcome: z.literal("already_applied"),
        current: inboxV2RetainedPrefixStateSchema
      })
      .strict(),
    z
      .object({
        outcome: z.literal("conflict"),
        current: inboxV2RetainedPrefixStateSchema
      })
      .strict(),
    z
      .object({
        outcome: z.literal("checkpoint_blocked"),
        current: inboxV2RetainedPrefixStateSchema,
        mandatoryCheckpointFloor: inboxV2TenantStreamPositionSchema
      })
      .strict()
      .superRefine((result, context) => {
        if (
          BigInt(result.current.minRetainedPosition) >
          BigInt(result.mandatoryCheckpointFloor)
        ) {
          addIssue(
            context,
            ["current"],
            "Checkpoint-blocked state cannot already be beyond the checkpoint floor."
          );
        }
      }),
    z
      .object({
        outcome: z.literal("not_found"),
        tenantId: inboxV2TenantIdSchema,
        owner: inboxV2RetainedPrefixOwnerSchema
      })
      .strict()
  ]);

export interface InboxV2RetainedPrefixRepositoryPort {
  compareAndSetRetainedPrefix(
    input: Readonly<InboxV2CompareAndSetRetainedPrefixInput>
  ): Promise<InboxV2CompareAndSetRetainedPrefixResult>;
}

export const inboxV2OutboxWorkerIdSchema = inboxV2NamespacedIdSchema;
export const inboxV2OutboxLeaseTokenSchema = z
  .string()
  .min(32)
  .max(512)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~:-]*$/u);

export function calculateInboxV2OutboxLeaseTokenHash(
  leaseToken: string
): string {
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.outbox-lease-token",
    hashVersion: "v1",
    leaseToken: inboxV2OutboxLeaseTokenSchema.parse(leaseToken)
  });
}

/** Persisted lease contains only the token digest; the raw capability is transient. */
export const inboxV2OutboxPersistedLeaseSchema = z
  .object({
    workerId: inboxV2OutboxWorkerIdSchema,
    leaseTokenHash: inboxV2Sha256DigestSchema,
    leaseRevision: inboxV2EntityRevisionSchema,
    claimedAt: inboxV2TimestampSchema,
    expiresAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((lease, context) => {
    if (!isInboxV2TimestampOrderValid(lease.claimedAt, lease.expiresAt)) {
      addIssue(
        context,
        ["expiresAt"],
        "Outbox lease expiry cannot precede its claim."
      );
    }
  });

export const inboxV2OutboxRetryResultSchema = z
  .object({
    kind: z.literal("retry"),
    resultHash: inboxV2Sha256DigestSchema,
    errorCode: inboxV2NamespacedIdSchema,
    retryAvailableAt: inboxV2TimestampSchema,
    recordedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((result, context) => {
    if (
      !isInboxV2TimestampOrderValid(result.recordedAt, result.retryAvailableAt)
    ) {
      addIssue(
        context,
        ["retryAvailableAt"],
        "Retry availability cannot precede the persisted retry result."
      );
    }
  });

export const inboxV2OutboxTerminalResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("processed"),
      resultHash: inboxV2Sha256DigestSchema,
      resultReference: inboxV2PayloadReferenceSchema.nullable(),
      finalizedAt: inboxV2TimestampSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("dead"),
      resultHash: inboxV2Sha256DigestSchema,
      errorCode: inboxV2NamespacedIdSchema,
      resultReference: inboxV2PayloadReferenceSchema.nullable(),
      finalizedAt: inboxV2TimestampSchema
    })
    .strict()
]);

export const inboxV2OutboxWorkStateSchema = z.enum([
  "pending",
  "leased",
  "processed",
  "dead"
]);

export const inboxV2OutboxWorkItemSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    intentId: inboxV2OutboxIntentIdSchema,
    state: inboxV2OutboxWorkStateSchema,
    attemptCount: inboxV2BigintCounterSchema,
    availableAt: inboxV2TimestampSchema.nullable(),
    lease: inboxV2OutboxPersistedLeaseSchema.nullable(),
    lastRetryResult: inboxV2OutboxRetryResultSchema.nullable(),
    terminalResult: inboxV2OutboxTerminalResultSchema.nullable(),
    revision: inboxV2EntityRevisionSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((work, context) => {
    const leased = work.state === "leased";
    const terminal = work.state === "processed" || work.state === "dead";
    if (leased !== (work.lease !== null)) {
      addIssue(
        context,
        ["lease"],
        "Only leased outbox work may retain a persisted lease digest."
      );
    }
    if (terminal !== (work.terminalResult !== null)) {
      addIssue(
        context,
        ["terminalResult"],
        "Only terminal outbox work has a terminal result."
      );
    }
    if (
      terminal !== (work.availableAt === null) ||
      (work.terminalResult !== null && work.terminalResult.kind !== work.state)
    ) {
      addIssue(
        context,
        ["state"],
        "Outbox availability and terminal result must match work state."
      );
    }
    if (work.state !== "pending" && BigInt(work.attemptCount) === 0n) {
      addIssue(
        context,
        ["attemptCount"],
        "Claimed or finalized outbox work must have at least one attempt."
      );
    }
    if (
      work.lease !== null &&
      !isInboxV2TimestampOrderValid(work.lease.claimedAt, work.updatedAt)
    ) {
      addIssue(
        context,
        ["updatedAt"],
        "Outbox work cannot be older than its current lease."
      );
    }
    if (
      work.lastRetryResult !== null &&
      (!isInboxV2TimestampOrderValid(
        work.lastRetryResult.recordedAt,
        work.updatedAt
      ) ||
        (work.state === "pending" &&
          work.availableAt !== work.lastRetryResult.retryAvailableAt))
    ) {
      addIssue(
        context,
        ["lastRetryResult"],
        "Pending retry state must retain its exact retry availability and ordering."
      );
    }
    if (
      work.terminalResult !== null &&
      !isInboxV2TimestampOrderValid(
        work.terminalResult.finalizedAt,
        work.updatedAt
      )
    ) {
      addIssue(
        context,
        ["updatedAt"],
        "Outbox work cannot be older than its terminal result."
      );
    }
    const references = [work.terminalResult?.resultReference ?? null].filter(
      (reference) => reference !== null
    );
    if (references.some((reference) => reference.tenantId !== work.tenantId)) {
      addIssue(
        context,
        ["terminalResult", "resultReference"],
        "Outbox result reference must belong to the work tenant."
      );
    }
  });

export const inboxV2OutboxWorkItemEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_OUTBOX_WORK_ITEM_SCHEMA_ID,
    INBOX_V2_REPOSITORY_FOUNDATION_SCHEMA_VERSION,
    inboxV2OutboxWorkItemSchema
  );

export const inboxV2ClaimOutboxInputSchema = z
  .object({
    context: inboxV2RepositoryTenantContextSchema,
    workerId: inboxV2OutboxWorkerIdSchema,
    leaseDurationSeconds: leaseDurationSecondsSchema,
    batchSize: repositoryBatchLimitSchema
  })
  .strict();

export const inboxV2OutboxClaimSchema = z
  .object({
    claimKind: z.enum(["initial", "reclaimed"]),
    work: inboxV2OutboxWorkItemSchema,
    leaseToken: inboxV2OutboxLeaseTokenSchema
  })
  .strict()
  .superRefine((claim, context) => {
    if (
      claim.work.state !== "leased" ||
      claim.work.lease === null ||
      claim.work.lease.leaseTokenHash !==
        calculateInboxV2OutboxLeaseTokenHash(claim.leaseToken)
    ) {
      addIssue(
        context,
        ["leaseToken"],
        "Transient claim token must match the persisted lease digest."
      );
    }
  });

export const inboxV2ClaimOutboxResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("claimed"),
      tenantId: inboxV2TenantIdSchema,
      workerId: inboxV2OutboxWorkerIdSchema,
      batchSize: repositoryBatchLimitSchema,
      claims: z.array(inboxV2OutboxClaimSchema).min(1).max(1_000)
    })
    .strict()
    .superRefine((result, context) => {
      const ids = new Set<string>();
      if (result.claims.length > result.batchSize) {
        addIssue(
          context,
          ["claims"],
          "Claim result cannot exceed the requested batch size."
        );
      }
      for (const [index, claim] of result.claims.entries()) {
        if (
          claim.work.tenantId !== result.tenantId ||
          claim.work.lease?.workerId !== result.workerId ||
          ids.has(String(claim.work.intentId))
        ) {
          addIssue(
            context,
            ["claims", index],
            "Claim batch must contain unique tenant-local work leased by its worker."
          );
        }
        ids.add(String(claim.work.intentId));
      }
    }),
  z
    .object({
      outcome: z.literal("empty"),
      tenantId: inboxV2TenantIdSchema,
      workerId: inboxV2OutboxWorkerIdSchema,
      batchSize: repositoryBatchLimitSchema
    })
    .strict()
]);

export const inboxV2RenewOutboxLeaseInputSchema = z
  .object({
    context: inboxV2RepositoryTenantContextSchema,
    intentId: inboxV2OutboxIntentIdSchema,
    workerId: inboxV2OutboxWorkerIdSchema,
    leaseToken: inboxV2OutboxLeaseTokenSchema,
    expectedLeaseRevision: inboxV2EntityRevisionSchema,
    leaseDurationSeconds: leaseDurationSecondsSchema
  })
  .strict();

const outboxLeaseFailureSchemas = [
  z
    .object({
      outcome: z.literal("not_found"),
      tenantId: inboxV2TenantIdSchema,
      intentId: inboxV2OutboxIntentIdSchema
    })
    .strict(),
  z
    .object({
      outcome: z.literal("not_leased"),
      tenantId: inboxV2TenantIdSchema,
      intentId: inboxV2OutboxIntentIdSchema,
      currentState: inboxV2OutboxWorkStateSchema
    })
    .strict(),
  z
    .object({
      outcome: z.literal("stale_token"),
      tenantId: inboxV2TenantIdSchema,
      intentId: inboxV2OutboxIntentIdSchema,
      currentLeaseRevision: inboxV2EntityRevisionSchema
    })
    .strict(),
  z
    .object({
      outcome: z.literal("lease_expired"),
      tenantId: inboxV2TenantIdSchema,
      intentId: inboxV2OutboxIntentIdSchema,
      currentLeaseRevision: inboxV2EntityRevisionSchema
    })
    .strict(),
  z
    .object({
      outcome: z.literal("lease_revision_conflict"),
      tenantId: inboxV2TenantIdSchema,
      intentId: inboxV2OutboxIntentIdSchema,
      currentLeaseRevision: inboxV2EntityRevisionSchema
    })
    .strict()
] as const;

export const inboxV2RenewOutboxLeaseResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("renewed"),
        work: inboxV2OutboxWorkItemSchema
      })
      .strict()
      .superRefine((result, context) => {
        if (result.work.state !== "leased") {
          addIssue(
            context,
            ["work", "state"],
            "Renewed outbox work must remain leased."
          );
        }
      }),
    ...outboxLeaseFailureSchemas
  ]
);

export const inboxV2OutboxFinalizeInstructionSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("retry"),
        resultHash: inboxV2Sha256DigestSchema,
        errorCode: inboxV2NamespacedIdSchema,
        retryAfterSeconds: retryAfterSecondsSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("processed"),
        resultHash: inboxV2Sha256DigestSchema,
        resultReference: inboxV2PayloadReferenceSchema.nullable()
      })
      .strict(),
    z
      .object({
        kind: z.literal("dead"),
        resultHash: inboxV2Sha256DigestSchema,
        errorCode: inboxV2NamespacedIdSchema,
        resultReference: inboxV2PayloadReferenceSchema.nullable()
      })
      .strict()
  ]
);

export const inboxV2FinalizeOutboxInputSchema = z
  .object({
    context: inboxV2RepositoryTenantContextSchema,
    intentId: inboxV2OutboxIntentIdSchema,
    workerId: inboxV2OutboxWorkerIdSchema,
    leaseToken: inboxV2OutboxLeaseTokenSchema,
    expectedLeaseRevision: inboxV2EntityRevisionSchema,
    instruction: inboxV2OutboxFinalizeInstructionSchema
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.instruction.kind !== "retry" &&
      input.instruction.resultReference !== null &&
      input.instruction.resultReference.tenantId !== input.context.tenantId
    ) {
      addIssue(
        context,
        ["instruction", "resultReference"],
        "Outbox finalize result reference must belong to the explicit tenant."
      );
    }
  });

export const inboxV2FinalizeOutboxResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("retry_scheduled"),
        work: inboxV2OutboxWorkItemSchema
      })
      .strict()
      .superRefine((result, context) => {
        if (
          result.work.state !== "pending" ||
          result.work.lastRetryResult === null
        ) {
          addIssue(
            context,
            ["work"],
            "Retry finalization must return pending work with its persisted result."
          );
        }
      }),
    z
      .object({
        outcome: z.literal("processed"),
        work: inboxV2OutboxWorkItemSchema
      })
      .strict()
      .superRefine((result, context) => {
        if (result.work.state !== "processed") {
          addIssue(
            context,
            ["work", "state"],
            "Processed finalization must return processed work."
          );
        }
      }),
    z
      .object({
        outcome: z.literal("dead"),
        work: inboxV2OutboxWorkItemSchema
      })
      .strict()
      .superRefine((result, context) => {
        if (result.work.state !== "dead") {
          addIssue(
            context,
            ["work", "state"],
            "Dead finalization must return dead work."
          );
        }
      }),
    // Reserved for INB2-SRC-009 same-lease terminal replay. DB-007 clears the
    // lease on terminal finalize and therefore returns `not_leased` with the
    // terminal currentState instead of claiming an unauthenticated replay.
    z
      .object({
        outcome: z.literal("already_finalized"),
        work: inboxV2OutboxWorkItemSchema
      })
      .strict()
      .superRefine((result, context) => {
        if (result.work.state !== "processed" && result.work.state !== "dead") {
          addIssue(
            context,
            ["work", "state"],
            "Already-finalized work must be terminal."
          );
        }
      }),
    ...outboxLeaseFailureSchemas
  ]
);

export interface InboxV2OutboxWorkRepositoryPort {
  claimAvailable(
    input: Readonly<InboxV2ClaimOutboxInput>
  ): Promise<InboxV2ClaimOutboxResult>;
  renewLease(
    input: Readonly<InboxV2RenewOutboxLeaseInput>
  ): Promise<InboxV2RenewOutboxLeaseResult>;
  finalize(
    input: Readonly<InboxV2FinalizeOutboxInput>
  ): Promise<InboxV2FinalizeOutboxResult>;
}

export type InboxV2RepositoryTenantContext = z.infer<
  typeof inboxV2RepositoryTenantContextSchema
>;
export type InboxV2TenantStreamSnapshot = z.infer<
  typeof inboxV2TenantStreamSnapshotSchema
>;
export type InboxV2LoadTenantStreamSnapshotInput = z.infer<
  typeof inboxV2LoadTenantStreamSnapshotInputSchema
>;
export type InboxV2LoadTenantStreamSnapshotResult = z.infer<
  typeof inboxV2LoadTenantStreamSnapshotResultSchema
>;
export type InboxV2ReplayTenantStreamInput = z.infer<
  typeof inboxV2ReplayTenantStreamInputSchema
>;
export type InboxV2TenantStreamReplayCommit = z.infer<
  typeof inboxV2TenantStreamReplayCommitSchema
>;
export type InboxV2TenantStreamReplayPage = z.infer<
  typeof inboxV2TenantStreamReplayPageSchema
>;
export type InboxV2ReplayTenantStreamResult = z.infer<
  typeof inboxV2ReplayTenantStreamResultSchema
>;
export type InboxV2ProjectionGeneration = z.infer<
  typeof inboxV2ProjectionGenerationSchema
>;
export type InboxV2ProjectionGenerationSnapshot = z.infer<
  typeof inboxV2ProjectionGenerationSnapshotSchema
>;
export type InboxV2InitializeProjectionGenerationInput = z.infer<
  typeof inboxV2InitializeProjectionGenerationInputSchema
>;
export type InboxV2InitializeProjectionGenerationResult = z.infer<
  typeof inboxV2InitializeProjectionGenerationResultSchema
>;
export type InboxV2LoadProjectionGenerationInput = z.infer<
  typeof inboxV2LoadProjectionGenerationInputSchema
>;
export type InboxV2LoadProjectionGenerationResult = z.infer<
  typeof inboxV2LoadProjectionGenerationResultSchema
>;
export type InboxV2ApplyProjectionContiguousInput = z.infer<
  typeof inboxV2ApplyProjectionContiguousInputSchema
>;
export type InboxV2ApplyProjectionContiguousResult = z.infer<
  typeof inboxV2ApplyProjectionContiguousResultSchema
>;
export type InboxV2CutoverProjectionGenerationInput = z.infer<
  typeof inboxV2CutoverProjectionGenerationInputSchema
>;
export type InboxV2CutoverProjectionGenerationResult = z.infer<
  typeof inboxV2CutoverProjectionGenerationResultSchema
>;
export type InboxV2RetainedPrefixOwner = z.infer<
  typeof inboxV2RetainedPrefixOwnerSchema
>;
export type InboxV2RetainedPrefixState = z.infer<
  typeof inboxV2RetainedPrefixStateSchema
>;
export type InboxV2CompareAndSetRetainedPrefixInput = z.infer<
  typeof inboxV2CompareAndSetRetainedPrefixInputSchema
>;
export type InboxV2CompareAndSetRetainedPrefixResult = z.infer<
  typeof inboxV2CompareAndSetRetainedPrefixResultSchema
>;
export type InboxV2OutboxPersistedLease = z.infer<
  typeof inboxV2OutboxPersistedLeaseSchema
>;
export type InboxV2OutboxWorkItem = z.infer<typeof inboxV2OutboxWorkItemSchema>;
export type InboxV2OutboxClaim = z.infer<typeof inboxV2OutboxClaimSchema>;
export type InboxV2ClaimOutboxInput = z.infer<
  typeof inboxV2ClaimOutboxInputSchema
>;
export type InboxV2ClaimOutboxResult = z.infer<
  typeof inboxV2ClaimOutboxResultSchema
>;
export type InboxV2RenewOutboxLeaseInput = z.infer<
  typeof inboxV2RenewOutboxLeaseInputSchema
>;
export type InboxV2RenewOutboxLeaseResult = z.infer<
  typeof inboxV2RenewOutboxLeaseResultSchema
>;
export type InboxV2OutboxFinalizeInstruction = z.infer<
  typeof inboxV2OutboxFinalizeInstructionSchema
>;
export type InboxV2FinalizeOutboxInput = z.infer<
  typeof inboxV2FinalizeOutboxInputSchema
>;
export type InboxV2FinalizeOutboxResult = z.infer<
  typeof inboxV2FinalizeOutboxResultSchema
>;

export type InboxV2RepositoryFoundationPorts = Readonly<{
  tenantStream: InboxV2TenantStreamRepositoryPort;
  projection: InboxV2ProjectionRepositoryPort;
  retainedPrefix: InboxV2RetainedPrefixRepositoryPort;
  outbox: InboxV2OutboxWorkRepositoryPort;
}>;

function sameStringArray(
  left: readonly unknown[],
  right: readonly unknown[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => String(value) === String(right[index]))
  );
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
