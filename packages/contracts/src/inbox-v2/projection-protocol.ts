import { z } from "zod";

import { inboxV2TenantIdSchema } from "./ids";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION,
  inboxV2SchemaVersionTokenSchema
} from "./schema-version";
import {
  inboxV2ProjectionCheckpointSchema,
  inboxV2ProjectionIdSchema,
  inboxV2RecipientScopeIdSchema,
  inboxV2StreamEpochSchema,
  inboxV2SyncGenerationSchema,
  inboxV2TenantStreamCommitIdSchema,
  inboxV2TenantStreamCommitPositionSchema
} from "./sync-primitives";
import { INBOX_V2_TENANT_STREAM_SCHEMA_VERSION } from "./tenant-stream";

export const INBOX_V2_PROJECTION_CHECKPOINT_TRANSITION_SCHEMA_ID =
  "core:inbox-v2.projection-checkpoint-transition" as const;
export const INBOX_V2_PROJECTION_PROTOCOL_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

export const inboxV2ProjectionCheckpointHeadSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    projectionId: inboxV2ProjectionIdSchema,
    scopeId: inboxV2RecipientScopeIdSchema,
    streamEpoch: inboxV2StreamEpochSchema,
    syncGeneration: inboxV2SyncGenerationSchema,
    projectionSchemaVersion: inboxV2SchemaVersionTokenSchema,
    position: inboxV2ProjectionCheckpointSchema
  })
  .strict();

export const inboxV2ProjectionInputSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    streamEpoch: inboxV2StreamEpochSchema,
    commitId: inboxV2TenantStreamCommitIdSchema,
    commitSchemaVersion: inboxV2SchemaVersionTokenSchema,
    streamPosition: inboxV2TenantStreamCommitPositionSchema
  })
  .strict();

export const inboxV2ProjectionCheckpointTransitionSchema = z
  .object({
    before: inboxV2ProjectionCheckpointHeadSchema,
    input: inboxV2ProjectionInputSchema,
    disposition: z.enum(["applied", "irrelevant"]),
    after: inboxV2ProjectionCheckpointHeadSchema
  })
  .strict()
  .superRefine((transition, context) => {
    const { before, after, input } = transition;
    if (
      before.tenantId !== input.tenantId ||
      after.tenantId !== input.tenantId ||
      before.projectionId !== after.projectionId ||
      before.scopeId !== after.scopeId ||
      before.streamEpoch !== input.streamEpoch ||
      after.streamEpoch !== input.streamEpoch ||
      before.syncGeneration !== after.syncGeneration ||
      before.projectionSchemaVersion !== after.projectionSchemaVersion ||
      input.commitSchemaVersion !== INBOX_V2_TENANT_STREAM_SCHEMA_VERSION ||
      BigInt(input.streamPosition) !== BigInt(before.position) + 1n ||
      String(after.position) !== String(input.streamPosition)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Projection rows and checkpoint must atomically consume exactly the next tenant commit, including irrelevant commits."
      });
    }
  });

export const inboxV2ProjectionCheckpointTransitionEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_PROJECTION_CHECKPOINT_TRANSITION_SCHEMA_ID,
    INBOX_V2_PROJECTION_PROTOCOL_SCHEMA_VERSION,
    inboxV2ProjectionCheckpointTransitionSchema
  );

export const inboxV2ProjectionDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("duplicate") }).strict(),
  z.object({ kind: z.literal("apply") }).strict(),
  z.object({ kind: z.literal("advance_irrelevant") }).strict(),
  z
    .object({
      kind: z.literal("halt"),
      errorCode: z.enum([
        "projection.gap_detected",
        "projection.schema_unsupported",
        "projection.epoch_mismatch"
      ])
    })
    .strict()
]);

export function decideInboxV2ProjectionInput(input: {
  checkpoint: z.input<typeof inboxV2ProjectionCheckpointHeadSchema>;
  commit: z.input<typeof inboxV2ProjectionInputSchema>;
  relevance: "relevant" | "irrelevant" | "unsupported_mandatory_schema";
}): z.infer<typeof inboxV2ProjectionDecisionSchema> {
  const checkpoint = inboxV2ProjectionCheckpointHeadSchema.parse(
    input.checkpoint
  );
  const commit = inboxV2ProjectionInputSchema.parse(input.commit);

  if (
    checkpoint.tenantId !== commit.tenantId ||
    checkpoint.streamEpoch !== commit.streamEpoch
  ) {
    return { kind: "halt", errorCode: "projection.epoch_mismatch" };
  }

  const position = BigInt(commit.streamPosition);
  const current = BigInt(checkpoint.position);
  if (position <= current) {
    return { kind: "duplicate" };
  }
  if (position > current + 1n) {
    return { kind: "halt", errorCode: "projection.gap_detected" };
  }
  if (
    commit.commitSchemaVersion !== INBOX_V2_TENANT_STREAM_SCHEMA_VERSION ||
    input.relevance === "unsupported_mandatory_schema"
  ) {
    return { kind: "halt", errorCode: "projection.schema_unsupported" };
  }
  return input.relevance === "irrelevant"
    ? { kind: "advance_irrelevant" }
    : { kind: "apply" };
}

export type InboxV2ProjectionCheckpointHead = z.infer<
  typeof inboxV2ProjectionCheckpointHeadSchema
>;
export type InboxV2ProjectionCheckpointTransition = z.infer<
  typeof inboxV2ProjectionCheckpointTransitionSchema
>;
