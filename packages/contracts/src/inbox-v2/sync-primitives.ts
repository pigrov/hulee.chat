import { z } from "zod";

import type { Brand } from "../brand";
import { inboxV2AuthorizationEpochSchema } from "./authorization-epoch";
import { inboxV2CatalogIdSchema } from "./catalog";
import {
  inboxV2BigintCounterSchema,
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2ConversationReferenceSchema,
  inboxV2EmployeeReferenceSchema,
  inboxV2TenantIdSchema
} from "./ids";
import { inboxV2NamespacedIdSchema } from "./namespace";
import { inboxV2TrustedServiceIdSchema } from "./participant-identity";
import {
  inboxV2SchemaIdSchema,
  inboxV2SchemaVersionTokenSchema
} from "./schema-version";
import { inboxV2TimelineSequenceSchema } from "./timeline";

export type InboxV2TenantStreamPosition = Brand<
  string,
  "InboxV2TenantStreamPosition"
>;
export type InboxV2ProjectionCheckpoint = Brand<
  string,
  "InboxV2ProjectionCheckpoint"
>;
export type InboxV2SyncGeneration = Brand<string, "InboxV2SyncGeneration">;
export type InboxV2StreamEpoch = Brand<string, "InboxV2StreamEpoch">;
export type InboxV2SyncCursor = Brand<string, "InboxV2SyncCursor">;
export type InboxV2RecipientScopeId = Brand<string, "InboxV2RecipientScopeId">;
export type InboxV2AuthorizationDecisionId = Brand<
  string,
  "InboxV2AuthorizationDecisionId"
>;
export type InboxV2CommandId = Brand<string, "InboxV2CommandId">;
export type InboxV2RequestId = Brand<string, "InboxV2RequestId">;
export type InboxV2ClientMutationId = Brand<string, "InboxV2ClientMutationId">;
export type InboxV2TenantStreamCommitId = Brand<
  string,
  "InboxV2TenantStreamCommitId"
>;
export type InboxV2TenantStreamChangeId = Brand<
  string,
  "InboxV2TenantStreamChangeId"
>;
export type InboxV2CorrelationId = Brand<string, "InboxV2CorrelationId">;
export type InboxV2AudienceImpactId = Brand<string, "InboxV2AudienceImpactId">;
export type InboxV2SnapshotId = Brand<string, "InboxV2SnapshotId">;
export type InboxV2OutboxIntentId = Brand<string, "InboxV2OutboxIntentId">;
export type InboxV2ProjectionId = Brand<string, "InboxV2ProjectionId">;
export type InboxV2EntityTypeId = Brand<string, "InboxV2EntityTypeId">;
export type InboxV2EntityOpaqueId = Brand<string, "InboxV2EntityOpaqueId">;
export type InboxV2InternalOpaqueReference = Brand<
  string,
  "InboxV2InternalOpaqueReference"
>;
export type InboxV2PayloadRecordId = Brand<string, "InboxV2PayloadRecordId">;
export type InboxV2Sha256Digest = Brand<string, "InboxV2Sha256Digest">;
export type InboxV2RecipientStateFingerprint = Brand<
  string,
  "InboxV2RecipientStateFingerprint"
>;

const opaqueTokenSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~:-]*$/u);

export const inboxV2TenantStreamPositionSchema =
  inboxV2BigintCounterSchema.transform(
    (value) => value as unknown as InboxV2TenantStreamPosition
  );
export const inboxV2TenantStreamCommitPositionSchema =
  inboxV2EntityRevisionSchema.transform(
    (value) => value as unknown as InboxV2TenantStreamPosition
  );
export const inboxV2ProjectionCheckpointSchema =
  inboxV2BigintCounterSchema.transform(
    (value) => value as unknown as InboxV2ProjectionCheckpoint
  );
export const inboxV2SyncGenerationSchema =
  inboxV2EntityRevisionSchema.transform(
    (value) => value as unknown as InboxV2SyncGeneration
  );
export const inboxV2StreamEpochSchema = opaqueTokenSchema.transform(
  (value) => value as InboxV2StreamEpoch
);
export const inboxV2SyncCursorSchema = z
  .string()
  .min(16)
  .max(4_096)
  .regex(/^[A-Za-z0-9._~:+/=-]+$/u)
  .transform((value) => value as InboxV2SyncCursor);
export const inboxV2RecipientScopeIdSchema = opaqueTokenSchema.transform(
  (value) => value as InboxV2RecipientScopeId
);
export const inboxV2AuthorizationDecisionIdSchema = opaqueTokenSchema.transform(
  (value) => value as InboxV2AuthorizationDecisionId
);
export const inboxV2CommandIdSchema = opaqueTokenSchema.transform(
  (value) => value as InboxV2CommandId
);
export const inboxV2RequestIdSchema = opaqueTokenSchema.transform(
  (value) => value as InboxV2RequestId
);
export const inboxV2ClientMutationIdSchema = opaqueTokenSchema.transform(
  (value) => value as InboxV2ClientMutationId
);
export const inboxV2TenantStreamCommitIdSchema = opaqueTokenSchema.transform(
  (value) => value as InboxV2TenantStreamCommitId
);
export const inboxV2TenantStreamChangeIdSchema = opaqueTokenSchema.transform(
  (value) => value as InboxV2TenantStreamChangeId
);
export const inboxV2CorrelationIdSchema = opaqueTokenSchema.transform(
  (value) => value as InboxV2CorrelationId
);
export const inboxV2AudienceImpactIdSchema = opaqueTokenSchema.transform(
  (value) => value as InboxV2AudienceImpactId
);
export const inboxV2SnapshotIdSchema = opaqueTokenSchema.transform(
  (value) => value as InboxV2SnapshotId
);
export const inboxV2OutboxIntentIdSchema = opaqueTokenSchema.transform(
  (value) => value as InboxV2OutboxIntentId
);
export const inboxV2ProjectionIdSchema = inboxV2NamespacedIdSchema.transform(
  (value) => value as unknown as InboxV2ProjectionId
);
export const inboxV2EntityTypeIdSchema = inboxV2CatalogIdSchema.transform(
  (value) => value as unknown as InboxV2EntityTypeId
);
export const inboxV2EntityOpaqueIdSchema = opaqueTokenSchema.transform(
  (value) => value as InboxV2EntityOpaqueId
);
/**
 * Minimized internal reference used by audit/privacy metadata. It deliberately
 * cannot encode a phone number, email address, provider identifier or another
 * caller-selected business key. Producers resolve those values to an internal
 * entity first and emit only a random UUID-equivalent reference here.
 */
export const inboxV2InternalOpaqueReferenceSchema = z
  .string()
  .regex(/^internal-ref:[a-f0-9]{32,64}$/u)
  .transform((value) => value as InboxV2InternalOpaqueReference);
export const inboxV2PayloadRecordIdSchema = opaqueTokenSchema.transform(
  (value) => value as InboxV2PayloadRecordId
);
/**
 * Digest of a minimized canonical technical envelope/reference. Raw Message,
 * contact, provider or other low-entropy sensitive content is never a valid
 * preimage; retained dedupe after content expiry uses a separately governed
 * tenant-keyed HMAC with a finite key/purpose lifecycle (ADR 0015).
 */
export const inboxV2Sha256DigestSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/u)
  .transform((value) => value as InboxV2Sha256Digest);

/**
 * Opaque producer-side tenant-keyed HMAC fingerprint for recipient state.
 * The visible key-generation token supports finite rotation/purge; the key
 * and raw low-entropy value are never part of a DTO or public SHA oracle.
 */
export const inboxV2RecipientStateFingerprintSchema = z
  .string()
  .max(352)
  .regex(/^hmac-sha256:[A-Za-z0-9][A-Za-z0-9._~:-]{7,255}:[a-f0-9]{64}$/u)
  .transform((value) => value as InboxV2RecipientStateFingerprint);

export const inboxV2RecipientScopeSchema = z
  .object({
    id: inboxV2RecipientScopeIdSchema,
    kind: z.literal("employee_inbox"),
    employee: inboxV2EmployeeReferenceSchema
  })
  .strict();

export const inboxV2EntityKeySchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    entityTypeId: inboxV2EntityTypeIdSchema,
    entityId: inboxV2EntityOpaqueIdSchema
  })
  .strict();

/** Provider-neutral internal target/subject reference for minimized records. */
export const inboxV2InternalEntityReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    entityTypeId: inboxV2EntityTypeIdSchema.refine(
      (value) => String(value).startsWith("core:"),
      "Minimized target entity type must be provider-neutral and internal."
    ),
    entityId: inboxV2InternalOpaqueReferenceSchema.transform(
      (value) => value as unknown as InboxV2EntityOpaqueId
    )
  })
  .strict();

export const inboxV2AuthorizationDependencyVectorSchema = z
  .object({
    tenantRbacRevision: inboxV2EntityRevisionSchema,
    employeeAccessRevision: inboxV2EntityRevisionSchema,
    employeeInboxRelationRevision: inboxV2EntityRevisionSchema,
    sharedAccessRevision: inboxV2EntityRevisionSchema,
    resourceDependencies: z
      .array(
        z
          .object({
            resource: inboxV2EntityKeySchema,
            accessRevision: inboxV2EntityRevisionSchema
          })
          .strict()
      )
      .max(256),
    temporalBoundaryDigest: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((vector, context) => {
    const keys = vector.resourceDependencies.map(
      ({ resource }) =>
        `${resource.tenantId}\u0000${resource.entityTypeId}\u0000${resource.entityId}`
    );

    if (
      new Set(keys).size !== keys.length ||
      keys.some((key, index) => index > 0 && key <= keys[index - 1]!)
    ) {
      context.addIssue({
        code: "custom",
        path: ["resourceDependencies"],
        message:
          "Authorization resource dependencies must be unique and canonically sorted."
      });
    }
  });

export const inboxV2AuthorizationEpochSnapshotSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    employee: inboxV2EmployeeReferenceSchema,
    value: inboxV2AuthorizationEpochSchema,
    dependencies: inboxV2AuthorizationDependencyVectorSchema,
    evaluatedAt: inboxV2TimestampSchema,
    notAfter: inboxV2TimestampSchema,
    nextAuthorizationBoundary: inboxV2TimestampSchema.nullable()
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (
      snapshot.employee.tenantId !== snapshot.tenantId ||
      snapshot.dependencies.resourceDependencies.some(
        ({ resource }) => resource.tenantId !== snapshot.tenantId
      ) ||
      !isInboxV2TimestampOrderValid(snapshot.evaluatedAt, snapshot.notAfter) ||
      (snapshot.nextAuthorizationBoundary !== null &&
        (!isInboxV2TimestampOrderValid(
          snapshot.evaluatedAt,
          snapshot.nextAuthorizationBoundary
        ) ||
          !isInboxV2TimestampOrderValid(
            snapshot.nextAuthorizationBoundary,
            snapshot.notAfter
          )))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Authorization epoch must bind one tenant/employee and an ordered temporal boundary."
      });
    }
  });

export const inboxV2AuthorizationDecisionReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2AuthorizationDecisionIdSchema,
    authorizationEpoch: inboxV2AuthorizationEpochSchema,
    principal: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("employee"),
          employee: inboxV2EmployeeReferenceSchema
        })
        .strict(),
      z
        .object({
          kind: z.literal("trusted_service"),
          trustedServiceId: inboxV2TrustedServiceIdSchema
        })
        .strict()
    ]),
    permissionId: inboxV2CatalogIdSchema,
    resourceScopeId: inboxV2CatalogIdSchema,
    resource: inboxV2EntityKeySchema,
    resourceAccessRevision: inboxV2EntityRevisionSchema,
    decisionRevision: inboxV2EntityRevisionSchema,
    decisionHash: inboxV2Sha256DigestSchema,
    outcome: z.enum(["allowed", "denied"]),
    decidedAt: inboxV2TimestampSchema,
    notAfter: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((decision, context) => {
    if (
      !isInboxV2TimestampOrderValid(decision.decidedAt, decision.notAfter) ||
      decision.resource.tenantId !== decision.tenantId ||
      (decision.principal.kind === "employee" &&
        decision.principal.employee.tenantId !== decision.tenantId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["notAfter"],
        message: "Authorization decision cannot expire before it was made."
      });
    }
  });

export const inboxV2TimelinePositionContextSchema = z
  .object({
    conversation: inboxV2ConversationReferenceSchema,
    timelineSequence: inboxV2TimelineSequenceSchema
  })
  .strict();

export const inboxV2PayloadReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    recordId: inboxV2PayloadRecordIdSchema,
    schemaId: inboxV2SchemaIdSchema,
    schemaVersion: inboxV2SchemaVersionTokenSchema,
    digest: inboxV2Sha256DigestSchema
  })
  .strict();

export const inboxV2InvalidationScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("recipient_scope") }).strict(),
  z
    .object({
      kind: z.literal("projection"),
      projectionId: inboxV2ProjectionIdSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("conversation"),
      conversation: inboxV2ConversationReferenceSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("entity"),
      entity: inboxV2EntityKeySchema
    })
    .strict()
]);

export type InboxV2RecipientScope = z.infer<typeof inboxV2RecipientScopeSchema>;
export type InboxV2AuthorizationDependencyVector = z.infer<
  typeof inboxV2AuthorizationDependencyVectorSchema
>;
export type InboxV2AuthorizationEpochSnapshot = z.infer<
  typeof inboxV2AuthorizationEpochSnapshotSchema
>;
export type InboxV2AuthorizationDecisionReference = z.infer<
  typeof inboxV2AuthorizationDecisionReferenceSchema
>;
export type InboxV2EntityKey = z.infer<typeof inboxV2EntityKeySchema>;
export type InboxV2InternalEntityReference = z.infer<
  typeof inboxV2InternalEntityReferenceSchema
>;
export type InboxV2TimelinePositionContext = z.infer<
  typeof inboxV2TimelinePositionContextSchema
>;
export type InboxV2PayloadReference = z.infer<
  typeof inboxV2PayloadReferenceSchema
>;
export type InboxV2InvalidationScope = z.infer<
  typeof inboxV2InvalidationScopeSchema
>;
