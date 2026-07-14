import { z } from "zod";

import {
  inboxV2BigintCounterSchema,
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import { inboxV2EmployeeReferenceSchema, inboxV2TenantIdSchema } from "./ids";
import { inboxV2CatalogIdSchema } from "./catalog";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";
import {
  inboxV2ClientMutationIdSchema,
  inboxV2CorrelationIdSchema,
  inboxV2EntityOpaqueIdSchema,
  inboxV2EntityKeySchema,
  inboxV2InternalEntityReferenceSchema,
  inboxV2PayloadReferenceSchema,
  inboxV2PayloadRecordIdSchema,
  inboxV2RequestIdSchema,
  inboxV2Sha256DigestSchema
} from "./sync-primitives";
import { inboxV2TrustedServiceIdSchema } from "./participant-identity";
import {
  inboxV2DataClassIdSchema,
  inboxV2LifecycleHandlerIdSchema,
  inboxV2ProcessingPurposeIdSchema,
  inboxV2RetentionRuleIdSchema,
  inboxV2StorageRootIdSchema
} from "./data-lifecycle-primitives";
import {
  type InboxV2DataLifecycleRegistry,
  isInboxV2DataLifecycleRegistry
} from "./data-lifecycle-catalog";

export const INBOX_V2_SAFE_AUDIT_SCHEMA_ID =
  "core:inbox-v2.safe-audit" as const;
export const INBOX_V2_PRIVACY_EVIDENCE_SCHEMA_ID =
  "core:inbox-v2.privacy-evidence" as const;
export const INBOX_V2_PRIVACY_AUDIT_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

const minimizedAuditTokenSchema = (prefix: string) =>
  z
    .string()
    .min(prefix.length + 33)
    .max(prefix.length + 65)
    .regex(new RegExp(`^${prefix}:[a-f0-9]{32,64}$`, "u"));

export const inboxV2PrivacyEvidenceIdSchema =
  minimizedAuditTokenSchema("privacy-evidence");
export const inboxV2PrivacyAuditRequestIdSchema = minimizedAuditTokenSchema(
  "request"
).transform((value) => value as z.output<typeof inboxV2RequestIdSchema>);
export const inboxV2PrivacyAuditClientMutationIdSchema =
  minimizedAuditTokenSchema("mutation").transform(
    (value) => value as z.output<typeof inboxV2ClientMutationIdSchema>
  );
export const inboxV2PrivacyCorrelationIdSchema = minimizedAuditTokenSchema(
  "privacy-correlation"
).transform((value) => value as z.output<typeof inboxV2CorrelationIdSchema>);
export const inboxV2PrivacyEvidencePayloadRecordIdSchema =
  minimizedAuditTokenSchema("privacy-evidence-payload").transform(
    (value) => value as z.output<typeof inboxV2PayloadRecordIdSchema>
  );
export const inboxV2PrivacyEvidenceReferenceSchema =
  inboxV2EntityKeySchema.extend({
    entityTypeId: z.literal("core:privacy-evidence"),
    entityId: inboxV2PrivacyEvidenceIdSchema.transform(
      (value) => value as z.output<typeof inboxV2EntityOpaqueIdSchema>
    )
  });

const inboxV2PrivacyEvidencePayloadReferenceSchema =
  inboxV2PayloadReferenceSchema.extend({
    recordId: inboxV2PrivacyEvidencePayloadRecordIdSchema
  });

export const inboxV2AuditCategorySchema = z.enum([
  "domain_history",
  "privileged_security",
  "privacy",
  "platform",
  "denial_signal"
]);

export const inboxV2AuditActorSchema = z.discriminatedUnion("kind", [
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
    .strict(),
  z
    .object({
      kind: z.literal("platform_support"),
      supportActorId: minimizedAuditTokenSchema("platform-support-actor"),
      delegationId: minimizedAuditTokenSchema("support-delegation")
    })
    .strict()
]);

export const inboxV2AuthorizationAuditFacetSchema = z
  .object({
    permissionId: inboxV2CatalogIdSchema,
    resourceScopeId: inboxV2CatalogIdSchema,
    decisionRevision: inboxV2EntityRevisionSchema,
    decisionHash: inboxV2Sha256DigestSchema,
    outcome: z.enum(["allowed", "denied"])
  })
  .strict();

export const inboxV2PolicyAuditReferenceSchema = z
  .object({
    policyId: inboxV2CatalogIdSchema,
    policyRevision: inboxV2EntityRevisionSchema,
    governanceContextId: inboxV2CatalogIdSchema,
    governanceContextRevision: inboxV2EntityRevisionSchema,
    ruleId: inboxV2RetentionRuleIdSchema.nullable()
  })
  .strict();

export const inboxV2SafeAuditRecordSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    auditId: minimizedAuditTokenSchema("privacy-audit"),
    category: inboxV2AuditCategorySchema,
    actionId: inboxV2CatalogIdSchema,
    actor: inboxV2AuditActorSchema,
    effectiveActor: inboxV2AuditActorSchema,
    target: inboxV2InternalEntityReferenceSchema,
    authorizationFacets: z
      .array(inboxV2AuthorizationAuditFacetSchema)
      .min(1)
      .max(64),
    policy: inboxV2PolicyAuditReferenceSchema.nullable(),
    beforeRevision: inboxV2EntityRevisionSchema.nullable(),
    afterRevision: inboxV2EntityRevisionSchema.nullable(),
    reasonId: inboxV2CatalogIdSchema,
    requestId: inboxV2PrivacyAuditRequestIdSchema.nullable(),
    clientMutationId: inboxV2PrivacyAuditClientMutationIdSchema.nullable(),
    correlationId: inboxV2PrivacyCorrelationIdSchema,
    outcome: z.enum([
      "succeeded",
      "denied",
      "failed_retryable",
      "failed_terminal"
    ]),
    occurredAt: inboxV2TimestampSchema,
    expiresAt: inboxV2TimestampSchema,
    evidenceRef: inboxV2PrivacyEvidenceReferenceSchema.nullable(),
    previousAuditHash: inboxV2Sha256DigestSchema.nullable(),
    auditHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((record, context) => {
    const actors = [record.actor, record.effectiveActor];
    if (
      record.target.tenantId !== record.tenantId ||
      (record.evidenceRef !== null &&
        record.evidenceRef.tenantId !== record.tenantId) ||
      actors.some(
        (actor) =>
          actor.kind === "employee" &&
          actor.employee.tenantId !== record.tenantId
      ) ||
      !isInboxV2TimestampOrderValid(record.occurredAt, record.expiresAt) ||
      record.occurredAt === record.expiresAt ||
      (record.outcome === "denied" && record.afterRevision !== null) ||
      (record.outcome === "succeeded" &&
        record.authorizationFacets.some(
          (facet) => facet.outcome !== "allowed"
        )) ||
      (record.outcome === "denied" &&
        record.authorizationFacets.some(
          (facet) => facet.outcome !== "denied"
        )) ||
      new Set(
        record.authorizationFacets.map(
          (facet) =>
            `${facet.permissionId}\u0000${facet.resourceScopeId}\u0000${facet.decisionHash}`
        )
      ).size !== record.authorizationFacets.length
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Safe audit must be tenant-bound, finite and contain one unique minimized decision skeleton."
      });
    }
  });

export const inboxV2SafeAuditEnvelopeSchema = createInboxV2SchemaEnvelopeSchema(
  INBOX_V2_SAFE_AUDIT_SCHEMA_ID,
  INBOX_V2_PRIVACY_AUDIT_SCHEMA_VERSION,
  inboxV2SafeAuditRecordSchema
);

export const inboxV2PrivacyEvidenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    evidenceId: inboxV2PrivacyEvidenceIdSchema,
    evidenceTypeId: inboxV2CatalogIdSchema,
    dataClassId: inboxV2DataClassIdSchema,
    purposeId: inboxV2ProcessingPurposeIdSchema,
    rootId: inboxV2StorageRootIdSchema,
    target: inboxV2InternalEntityReferenceSchema,
    payload: inboxV2PrivacyEvidencePayloadReferenceSchema,
    encryptionProfileId: inboxV2CatalogIdSchema,
    lifecycleHandlerId: inboxV2LifecycleHandlerIdSchema,
    createdAt: inboxV2TimestampSchema,
    expiresAt: inboxV2TimestampSchema,
    revision: inboxV2EntityRevisionSchema
  })
  .strict()
  .superRefine((evidence, context) => {
    if (
      evidence.target.tenantId !== evidence.tenantId ||
      evidence.payload.tenantId !== evidence.tenantId ||
      !isInboxV2TimestampOrderValid(evidence.createdAt, evidence.expiresAt) ||
      evidence.createdAt === evidence.expiresAt
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Sensitive evidence must remain tenant-bound, encrypted by reference and finitely retained."
      });
    }
  });

export const inboxV2PrivacyEvidenceEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_PRIVACY_EVIDENCE_SCHEMA_ID,
    INBOX_V2_PRIVACY_AUDIT_SCHEMA_VERSION,
    inboxV2PrivacyEvidenceSchema
  );

export const inboxV2AuditAggregateSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    category: inboxV2AuditCategorySchema,
    bucketStartedAt: inboxV2TimestampSchema,
    bucketEndedAt: inboxV2TimestampSchema,
    count: inboxV2BigintCounterSchema,
    outcome: z.enum(["allowed", "denied", "failed"]),
    expiresAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((aggregate, context) => {
    if (
      !isInboxV2TimestampOrderValid(
        aggregate.bucketStartedAt,
        aggregate.bucketEndedAt
      ) ||
      !isInboxV2TimestampOrderValid(
        aggregate.bucketEndedAt,
        aggregate.expiresAt
      ) ||
      aggregate.bucketStartedAt === aggregate.bucketEndedAt ||
      aggregate.bucketEndedAt === aggregate.expiresAt
    ) {
      context.addIssue({
        code: "custom",
        message: "Audit aggregate requires one finite ordered time bucket."
      });
    }
  });

export type InboxV2SafeAuditRecord = z.infer<
  typeof inboxV2SafeAuditRecordSchema
>;
export type InboxV2PrivacyEvidence = z.infer<
  typeof inboxV2PrivacyEvidenceSchema
>;

const definedInboxV2PrivacyEvidence = new WeakSet<object>();

/** Runtime authenticity guard for executable sensitive evidence references. */
export function isInboxV2PrivacyEvidence(
  value: unknown
): value is InboxV2PrivacyEvidence {
  return (
    typeof value === "object" &&
    value !== null &&
    definedInboxV2PrivacyEvidence.has(value)
  );
}

/**
 * Registry-bound constructor for persistable sensitive evidence. The wire
 * schema protects shape and tenant/time fences; this constructor additionally
 * proves that class, purpose, root and lifecycle handler form one registered
 * data-use lineage in an authentic composed registry.
 */
export function defineInboxV2PrivacyEvidence(input: {
  evidence: z.input<typeof inboxV2PrivacyEvidenceSchema>;
  registry: InboxV2DataLifecycleRegistry;
}): InboxV2PrivacyEvidence {
  if (!isInboxV2DataLifecycleRegistry(input.registry)) {
    throw new Error(
      "Privacy evidence requires an authentic composed registry."
    );
  }

  const evidence = inboxV2PrivacyEvidenceSchema.parse(input.evidence);
  const dataClass = input.registry.dataClasses.find(
    (entry) => entry.id === evidence.dataClassId
  );
  const purpose = input.registry.processingPurposes.find(
    (entry) => entry.id === evidence.purposeId
  );
  const root = input.registry.storageRoots.find(
    (entry) => entry.id === evidence.rootId
  );
  const handler = input.registry.handlers.find(
    (entry) => entry.id === evidence.lifecycleHandlerId
  );

  if (dataClass === undefined) {
    throw new Error(
      `Unknown privacy-evidence data class ${evidence.dataClassId}.`
    );
  }
  if (purpose === undefined) {
    throw new Error(`Unknown privacy-evidence purpose ${evidence.purposeId}.`);
  }
  if (root === undefined) {
    throw new Error(
      `Unknown privacy-evidence storage root ${evidence.rootId}.`
    );
  }
  if (
    !dataClass.definition.allowedPurposeIds.includes(evidence.purposeId) ||
    root.definition.boundary !== "operated_data_plane" ||
    handler === undefined ||
    handler.definition.kind !== "lifecycle" ||
    !handler.definition.supportedRootKinds.includes(root.definition.kind) ||
    !handler.definition.supportedOperations.includes("persist") ||
    !handler.definition.checksTenantFence ||
    !handler.definition.checksRevisionFence
  ) {
    throw new Error(
      `Privacy evidence ${evidence.evidenceId} does not match its registered class/root lifecycle policy.`
    );
  }

  const declaredUse = input.registry.dataUses.find(
    (candidate) =>
      candidate.dataClassId === evidence.dataClassId &&
      candidate.storageRootId === evidence.rootId &&
      candidate.purposeIds.includes(evidence.purposeId) &&
      candidate.operations.includes("persist") &&
      candidate.lifecycleHandlerId === evidence.lifecycleHandlerId
  );
  if (declaredUse === undefined) {
    throw new Error(
      `Privacy evidence ${evidence.dataClassId}/${evidence.rootId}/${evidence.purposeId} has no registered exact data-use lineage.`
    );
  }

  const immutableEvidence = deepFreezePrivacyEvidence(evidence);
  definedInboxV2PrivacyEvidence.add(immutableEvidence);
  return immutableEvidence;
}

function deepFreezePrivacyEvidence<T>(
  value: T,
  seen = new WeakSet<object>()
): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) {
    deepFreezePrivacyEvidence(child, seen);
  }
  return Object.freeze(value);
}
