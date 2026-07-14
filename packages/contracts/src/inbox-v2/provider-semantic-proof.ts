import { z } from "zod";

import { inboxV2CatalogIdSchema } from "./catalog";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2ExternalMessageReferenceRefSchema,
  inboxV2MessageProviderLifecycleOperationReferenceSchema,
  inboxV2MessageReactionTransitionReferenceSchema,
  inboxV2NormalizedInboundEventReferenceSchema,
  inboxV2OutboundRouteReferenceSchema,
  inboxV2SourceAccountReferenceSchema,
  inboxV2SourceExternalIdentityReferenceSchema,
  inboxV2SourceOccurrenceReferenceSchema,
  inboxV2SourceThreadBindingReferenceSchema,
  inboxV2TenantIdSchema
} from "./ids";
import {
  inboxV2AdapterContractSnapshotSchema,
  inboxV2RoutingTokenSchema,
  inboxV2RoutingTrustedServiceIdSchema
} from "./source-routing-primitives";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";

export const INBOX_V2_PROVIDER_SEMANTIC_PROOF_SCHEMA_ID =
  "core:inbox-v2.provider-semantic-proof" as const;
export const INBOX_V2_PROVIDER_OPERATION_RESULT_PROOF_SCHEMA_ID =
  "core:inbox-v2.provider-operation-result-proof" as const;
export const INBOX_V2_PROVIDER_SEMANTIC_ORDERING_HEAD_SCHEMA_ID =
  "core:inbox-v2.provider-semantic-ordering-head" as const;
export const INBOX_V2_PROVIDER_SEMANTIC_ORDERING_COMMIT_SCHEMA_ID =
  "core:inbox-v2.provider-semantic-ordering-commit" as const;
export const INBOX_V2_PROVIDER_SEMANTIC_PROOF_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

export const inboxV2ProviderSemanticIdSchema = inboxV2CatalogIdSchema;
export const inboxV2ProviderSemanticCapabilityIdSchema = inboxV2CatalogIdSchema;
export const inboxV2ProviderOrderingPositionSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/u);

export const inboxV2ProviderSemanticOrderingSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("monotonic_exact"),
        scopeToken: inboxV2RoutingTokenSchema,
        position: inboxV2ProviderOrderingPositionSchema,
        comparatorId: inboxV2CatalogIdSchema,
        comparatorRevision: inboxV2EntityRevisionSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("incomparable"),
        conflictToken: inboxV2RoutingTokenSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("unavailable"),
        reasonId: inboxV2CatalogIdSchema
      })
      .strict()
  ]
);

/**
 * Trusted, provider-neutral normalization proof. Provider-specific opcodes and
 * payloads stay in adapters; core persists the exact normalized semantic,
 * target, actor fidelity, capability revision and adapter contract used.
 */
export const inboxV2ProviderSemanticProofSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    normalizedInboundEvent: inboxV2NormalizedInboundEventReferenceSchema,
    externalMessageReference:
      inboxV2ExternalMessageReferenceRefSchema.nullable(),
    sourceOccurrence: inboxV2SourceOccurrenceReferenceSchema.nullable(),
    sourceAccount: inboxV2SourceAccountReferenceSchema,
    sourceThreadBinding: inboxV2SourceThreadBindingReferenceSchema,
    bindingGeneration: inboxV2EntityRevisionSchema,
    adapterContract: inboxV2AdapterContractSnapshotSchema,
    capabilityId: inboxV2ProviderSemanticCapabilityIdSchema,
    capabilityRevision: inboxV2EntityRevisionSchema,
    semanticId: inboxV2ProviderSemanticIdSchema,
    semanticRevision: inboxV2EntityRevisionSchema,
    actor: inboxV2SourceExternalIdentityReferenceSchema.nullable(),
    ordering: inboxV2ProviderSemanticOrderingSchema,
    declaredByTrustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
    proofToken: inboxV2RoutingTokenSchema,
    occurredAt: inboxV2TimestampSchema,
    recordedAt: inboxV2TimestampSchema,
    revision: z.literal("1")
  })
  .strict()
  .superRefine((proof, context) => {
    for (const [field, reference] of [
      ["normalizedInboundEvent", proof.normalizedInboundEvent],
      ["sourceAccount", proof.sourceAccount],
      ["sourceThreadBinding", proof.sourceThreadBinding]
    ] as const) {
      addTenantReferenceIssue(context, proof.tenantId, reference, [field]);
    }
    if (
      (proof.externalMessageReference === null) !==
      (proof.sourceOccurrence === null)
    ) {
      addIssue(
        context,
        ["externalMessageReference"],
        "Provider semantic proof carries an exact external target pair or an explicit aggregate target."
      );
    }
    if (
      proof.externalMessageReference !== null &&
      proof.sourceOccurrence !== null
    ) {
      addTenantReferenceIssue(
        context,
        proof.tenantId,
        proof.externalMessageReference,
        ["externalMessageReference"]
      );
      addTenantReferenceIssue(context, proof.tenantId, proof.sourceOccurrence, [
        "sourceOccurrence"
      ]);
    }
    if (proof.actor !== null) {
      addTenantReferenceIssue(context, proof.tenantId, proof.actor, ["actor"]);
    }
    if (
      proof.declaredByTrustedServiceId !==
      proof.adapterContract.loadedByTrustedServiceId
    ) {
      addIssue(
        context,
        ["declaredByTrustedServiceId"],
        "Provider semantic proof must be stamped by the trusted service that loaded the adapter contract."
      );
    }
    if (
      !isInboxV2TimestampOrderValid(proof.occurredAt, proof.recordedAt) ||
      !isInboxV2TimestampOrderValid(
        proof.adapterContract.loadedAt,
        proof.recordedAt
      )
    ) {
      addIssue(
        context,
        ["recordedAt"],
        "Provider semantic proof preserves occurrence/record and adapter-load chronology."
      );
    }
  });

/** Trusted normalized result of a Hulee-requested provider operation. */
export const inboxV2ProviderOperationResultProofSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    operation: z.union([
      inboxV2MessageProviderLifecycleOperationReferenceSchema,
      inboxV2MessageReactionTransitionReferenceSchema
    ]),
    outboundRoute: inboxV2OutboundRouteReferenceSchema,
    adapterContract: inboxV2AdapterContractSnapshotSchema,
    capabilityId: inboxV2ProviderSemanticCapabilityIdSchema,
    capabilityRevision: inboxV2EntityRevisionSchema,
    semanticId: inboxV2ProviderSemanticIdSchema,
    semanticRevision: inboxV2EntityRevisionSchema,
    resultState: z.enum([
      "accepted",
      "confirmed",
      "failed",
      "unsupported",
      "outcome_unknown"
    ]),
    declaredByTrustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
    resultToken: inboxV2RoutingTokenSchema,
    resultDigestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    recordedAt: inboxV2TimestampSchema,
    revision: z.literal("1")
  })
  .strict()
  .superRefine((proof, context) => {
    addTenantReferenceIssue(context, proof.tenantId, proof.operation, [
      "operation"
    ]);
    addTenantReferenceIssue(context, proof.tenantId, proof.outboundRoute, [
      "outboundRoute"
    ]);
    if (
      proof.declaredByTrustedServiceId !==
        proof.adapterContract.loadedByTrustedServiceId ||
      !isInboxV2TimestampOrderValid(
        proof.adapterContract.loadedAt,
        proof.recordedAt
      )
    ) {
      addIssue(
        context,
        ["declaredByTrustedServiceId"],
        "Provider operation result must be stamped by the pinned adapter runtime."
      );
    }
  });

export const inboxV2ProviderSemanticOrderingHeadSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    semanticFamilyId: inboxV2ProviderSemanticIdSchema,
    externalMessageReference: inboxV2ExternalMessageReferenceRefSchema,
    sourceAccount: inboxV2SourceAccountReferenceSchema,
    sourceThreadBinding: inboxV2SourceThreadBindingReferenceSchema,
    bindingGeneration: inboxV2EntityRevisionSchema,
    scopeToken: inboxV2RoutingTokenSchema,
    comparatorId: inboxV2CatalogIdSchema,
    comparatorRevision: inboxV2EntityRevisionSchema,
    position: inboxV2ProviderOrderingPositionSchema,
    normalizedInboundEvent: inboxV2NormalizedInboundEventReferenceSchema,
    proofToken: inboxV2RoutingTokenSchema,
    revision: inboxV2EntityRevisionSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((head, context) => {
    for (const [field, reference] of [
      ["externalMessageReference", head.externalMessageReference],
      ["sourceAccount", head.sourceAccount],
      ["sourceThreadBinding", head.sourceThreadBinding],
      ["normalizedInboundEvent", head.normalizedInboundEvent]
    ] as const) {
      addTenantReferenceIssue(context, head.tenantId, reference, [field]);
    }
  });

/**
 * CAS proof for the unique (tenant, external message, semantic family) head.
 * Provider event time is never used for conflict resolution: adapters normalize
 * a comparable provider position, otherwise the action must not be applied.
 */
export const inboxV2ProviderSemanticOrderingCommitSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    semanticFamilyId: inboxV2ProviderSemanticIdSchema,
    before: inboxV2ProviderSemanticOrderingHeadSchema.nullable(),
    proof: inboxV2ProviderSemanticProofSchema,
    after: inboxV2ProviderSemanticOrderingHeadSchema,
    committedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((commit, context) => {
    const { before, proof, after } = commit;
    const ordering = proof.ordering;
    if (
      ordering.kind !== "monotonic_exact" ||
      proof.externalMessageReference === null ||
      proof.sourceOccurrence === null
    ) {
      addIssue(
        context,
        ["proof", "ordering"],
        "A semantic head can advance only from an exact monotonically ordered provider event."
      );
      return;
    }
    const expectedRevision =
      before === null ? 1n : BigInt(before.revision) + 1n;
    if (
      commit.tenantId !== proof.tenantId ||
      commit.tenantId !== after.tenantId ||
      commit.semanticFamilyId !== after.semanticFamilyId ||
      after.externalMessageReference.id !== proof.externalMessageReference.id ||
      after.sourceAccount.id !== proof.sourceAccount.id ||
      after.sourceThreadBinding.id !== proof.sourceThreadBinding.id ||
      after.bindingGeneration !== proof.bindingGeneration ||
      after.scopeToken !== ordering.scopeToken ||
      after.comparatorId !== ordering.comparatorId ||
      after.comparatorRevision !== ordering.comparatorRevision ||
      after.position !== ordering.position ||
      after.normalizedInboundEvent.id !== proof.normalizedInboundEvent.id ||
      after.proofToken !== proof.proofToken ||
      BigInt(after.revision) !== expectedRevision ||
      after.updatedAt !== commit.committedAt ||
      Date.parse(proof.recordedAt) > Date.parse(commit.committedAt)
    ) {
      addIssue(
        context,
        ["after"],
        "Semantic ordering CAS must materialize the exact incoming proof and contiguous head revision."
      );
    }
    if (
      before !== null &&
      (before.tenantId !== commit.tenantId ||
        before.semanticFamilyId !== commit.semanticFamilyId ||
        before.externalMessageReference.id !==
          proof.externalMessageReference.id ||
        before.scopeToken !== ordering.scopeToken ||
        before.comparatorId !== ordering.comparatorId ||
        before.comparatorRevision !== ordering.comparatorRevision ||
        BigInt(ordering.position) <= BigInt(before.position) ||
        Date.parse(before.updatedAt) > Date.parse(commit.committedAt))
    ) {
      addIssue(
        context,
        ["before"],
        "Incoming provider position must strictly advance the exact current semantic-family head on the same comparator scale."
      );
    }
  });

export const inboxV2ProviderSemanticProofEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_PROVIDER_SEMANTIC_PROOF_SCHEMA_ID,
    INBOX_V2_PROVIDER_SEMANTIC_PROOF_SCHEMA_VERSION,
    inboxV2ProviderSemanticProofSchema
  );
export const inboxV2ProviderOperationResultProofEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_PROVIDER_OPERATION_RESULT_PROOF_SCHEMA_ID,
    INBOX_V2_PROVIDER_SEMANTIC_PROOF_SCHEMA_VERSION,
    inboxV2ProviderOperationResultProofSchema
  );
export const inboxV2ProviderSemanticOrderingHeadEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_PROVIDER_SEMANTIC_ORDERING_HEAD_SCHEMA_ID,
    INBOX_V2_PROVIDER_SEMANTIC_PROOF_SCHEMA_VERSION,
    inboxV2ProviderSemanticOrderingHeadSchema
  );
export const inboxV2ProviderSemanticOrderingCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_PROVIDER_SEMANTIC_ORDERING_COMMIT_SCHEMA_ID,
    INBOX_V2_PROVIDER_SEMANTIC_PROOF_SCHEMA_VERSION,
    inboxV2ProviderSemanticOrderingCommitSchema
  );

export type InboxV2ProviderSemanticProof = z.infer<
  typeof inboxV2ProviderSemanticProofSchema
>;
export type InboxV2ProviderOperationResultProof = z.infer<
  typeof inboxV2ProviderOperationResultProofSchema
>;
export type InboxV2ProviderSemanticOrderingHead = z.infer<
  typeof inboxV2ProviderSemanticOrderingHeadSchema
>;
export type InboxV2ProviderSemanticOrderingCommit = z.infer<
  typeof inboxV2ProviderSemanticOrderingCommitSchema
>;

function addTenantReferenceIssue(
  context: z.RefinementCtx,
  tenantId: string,
  reference: { tenantId: string },
  path: PropertyKey[]
): void {
  if (reference.tenantId !== tenantId) {
    addIssue(context, path, "Provider proof references must share one tenant.");
  }
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
