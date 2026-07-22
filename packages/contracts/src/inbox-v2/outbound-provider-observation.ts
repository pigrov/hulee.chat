import { z } from "zod";

import {
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2ExternalMessageIdentityDeclarationSchema,
  inboxV2ExternalReferencePortabilitySchema,
  inboxV2ExternalMessageReferenceSchema,
  inboxV2ProviderTimestampSchema,
  inboxV2ProviderReferenceKindIdSchema,
  inboxV2SourceOccurrenceResolutionCommitSchema,
  inboxV2SourceOccurrenceDescriptorSchema,
  inboxV2SourceOccurrenceSchema
} from "./external-message-reference";
import { inboxV2OutboundDispatchContentPlanSchema } from "./file-object";
import {
  inboxV2OutboundDispatchArtifactResolutionIdSchema,
  inboxV2OutboundDispatchAttemptReferenceSchema,
  inboxV2OutboundProviderObservationIdSchema,
  inboxV2SourceOccurrenceReferenceSchema,
  inboxV2TenantIdSchema
} from "./ids";
import { inboxV2MessageTransportAssociationCommitSchema } from "./message-transport";
import {
  inboxV2OutboundDispatchArtifactAssociationCommitSchema,
  inboxV2OutboundDispatchArtifactReferenceLinkSchema,
  inboxV2OutboundDispatchArtifactSchema,
  inboxV2OutboundDispatchAttemptCommitSchema,
  inboxV2OutboundDispatchAttemptSchema,
  inboxV2OutboundDispatchReconciliationCommitSchema,
  inboxV2OutboundDispatchSchema,
  type InboxV2OutboundDispatch,
  type InboxV2OutboundDispatchArtifact,
  type InboxV2OutboundDispatchAttempt
} from "./outbound-dispatch";
import { inboxV2OutboundRouteSchema } from "./outbound-route";
import { calculateInboxV2CanonicalSha256 } from "./recipient-sync-hash";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";
import { inboxV2SourceOccurrenceMaterializationCommitSchema } from "./source-occurrence-materialization";
import {
  inboxV2OpaqueProviderSubjectSchema,
  inboxV2RoutingTokenSchema,
  inboxV2RoutingTrustedServiceIdSchema
} from "./source-routing-primitives";
import { inboxV2Sha256DigestSchema } from "./sync-primitives";

export const INBOX_V2_OUTBOUND_PROVIDER_OBSERVATION_SCHEMA_ID =
  "core:inbox-v2.outbound-provider-observation" as const;
export const INBOX_V2_OUTBOUND_DISPATCH_ARTIFACT_RESOLUTION_SCHEMA_ID =
  "core:inbox-v2.outbound-dispatch-artifact-resolution" as const;
export const INBOX_V2_OUTBOUND_PROVIDER_SETTLEMENT_COMMIT_SCHEMA_ID =
  "core:inbox-v2.outbound-provider-settlement-commit" as const;
export const INBOX_V2_OUTBOUND_PROVIDER_OBSERVATION_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

/**
 * Provider response/echo evidence never represents new customer activity or an
 * instruction to call a provider. Literal values make downstream projectors
 * fail closed instead of trusting mutable classification flags.
 */
export const inboxV2OutboundProviderObservationEffectDispositionSchema = z
  .object({
    countsAsCustomerInbound: z.literal(false),
    createsUnread: z.literal(false),
    createsWorkItem: z.literal(false),
    requiresProviderIo: z.literal(false),
    createsOutboundDispatch: z.literal(false),
    notificationEligible: z.literal(false)
  })
  .strict();

export const INBOX_V2_OUTBOUND_PROVIDER_OBSERVATION_EFFECT_DISPOSITION =
  Object.freeze({
    countsAsCustomerInbound: false,
    createsUnread: false,
    createsWorkItem: false,
    requiresProviderIo: false,
    createsOutboundDispatch: false,
    notificationEligible: false
  } as const);

/**
 * Adapter-facing accepted-result detail. It contains only provider-owned facts;
 * canonical SourceOccurrence/ExternalMessageReference IDs and tenant routing
 * are deliberately derived by the trusted core from the fenced route/attempt.
 */
export const inboxV2OutboundProviderResponseObservationDescriptorSchema = z
  .object({
    artifactOrdinal: z.number().int().min(1).max(64),
    canonicalExternalSubject: inboxV2OpaqueProviderSubjectSchema,
    messageIdentityDeclaration: inboxV2ExternalMessageIdentityDeclarationSchema,
    occurrenceDescriptor: inboxV2SourceOccurrenceDescriptorSchema,
    providerTimestamps: z.array(inboxV2ProviderTimestampSchema).max(16),
    referencePortability: inboxV2ExternalReferencePortabilitySchema,
    observedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((descriptor, context) => {
    if (
      !sameAdapterSurface(
        descriptor.messageIdentityDeclaration.adapterContract,
        descriptor.occurrenceDescriptor.adapterContract
      ) ||
      !sameAdapterSurface(
        descriptor.messageIdentityDeclaration.adapterContract,
        descriptor.referencePortability.adapterContract
      )
    ) {
      addIssue(
        context,
        ["messageIdentityDeclaration", "adapterContract"],
        "Provider response identity, occurrence detail and portability must use one exact adapter surface."
      );
    }
  });

export const inboxV2OutboundProviderObservationEvidenceSchema =
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("provider_response_attempt"),
        artifactOrdinal: z.number().int().min(1).max(64),
        outboundDispatchAttempt: inboxV2OutboundDispatchAttemptReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("provider_echo_correlation"),
        artifactOrdinal: z.number().int().min(1).max(64),
        providerReferenceKindId: inboxV2ProviderReferenceKindIdSchema,
        correlationToken: inboxV2RoutingTokenSchema
      })
      .strict()
  ]);

/**
 * One immutable normalized provider observation for one exact provider-side
 * artifact. The SourceOccurrence is bounded canonical detail, not a required
 * persistence FK: provider responses can be recorded durably before canonical
 * occurrence materialization. Raw provider bodies are never part of this DTO.
 */
export const inboxV2OutboundProviderObservationSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2OutboundProviderObservationIdSchema,
    artifact: inboxV2OutboundDispatchArtifactSchema,
    dispatch: inboxV2OutboundDispatchSchema,
    route: inboxV2OutboundRouteSchema,
    attempt: inboxV2OutboundDispatchAttemptSchema,
    sourceOccurrence: inboxV2SourceOccurrenceSchema,
    sourceOccurrenceDetailDigestSha256: inboxV2Sha256DigestSchema,
    evidence: inboxV2OutboundProviderObservationEvidenceSchema,
    effectDisposition:
      inboxV2OutboundProviderObservationEffectDispositionSchema,
    observedByTrustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
    recordedAt: inboxV2TimestampSchema,
    revision: z.literal("1")
  })
  .strict()
  .superRefine((observation, context) => {
    addObservationIssues(observation, context);
  });

/** Append-only effective result; the immutable original artifact never mutates. */
export const inboxV2OutboundDispatchArtifactResolutionSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2OutboundDispatchArtifactResolutionIdSchema,
    observation: inboxV2OutboundProviderObservationSchema,
    artifactOrdinal: z.number().int().min(1).max(64),
    fromState: z.enum(["accepted", "outcome_unknown"]),
    effectiveState: z.literal("accepted"),
    effectiveArtifact: inboxV2OutboundDispatchArtifactSchema,
    resolvedByTrustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
    resolvedAt: inboxV2TimestampSchema,
    revision: z.literal("1")
  })
  .strict()
  .superRefine((resolution, context) => {
    addArtifactResolutionIssues(resolution, context);
  });

/** One canonical effective resolution per immutable provider artifact. */
export const inboxV2OutboundProviderArtifactResolutionDispositionSchema =
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("create"),
        resolution: inboxV2OutboundDispatchArtifactResolutionSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("reuse_existing"),
        existingResolution: inboxV2OutboundDispatchArtifactResolutionSchema
      })
      .strict()
  ]);

export const inboxV2OutboundProviderOccurrenceMaterializationSchema =
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("provider_response"),
        commit: inboxV2SourceOccurrenceMaterializationCommitSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("provider_echo"),
        persistedSourceOccurrence: inboxV2SourceOccurrenceSchema,
        verifiedByTrustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
        verifiedAt: inboxV2TimestampSchema
      })
      .strict()
  ]);

export const inboxV2OutboundProviderArtifactAssociationDispositionSchema =
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("create"),
        commit: inboxV2OutboundDispatchArtifactAssociationCommitSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("reuse_existing"),
        existingLink: inboxV2OutboundDispatchArtifactReferenceLinkSchema
      })
      .strict()
  ]);

export const inboxV2OutboundProviderArtifactCoverageSchema = z
  .object({
    contentPlan: inboxV2OutboundDispatchContentPlanSchema,
    resolutions: z
      .array(inboxV2OutboundDispatchArtifactResolutionSchema)
      .min(1)
      .max(64)
  })
  .strict();

export const inboxV2OutboundProviderSettlementTransitionSchema =
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("retain_dispatch_state"),
        dispatch: inboxV2OutboundDispatchSchema,
        attempt: inboxV2OutboundDispatchAttemptSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("complete_pending_attempt"),
        attemptCommit: inboxV2OutboundDispatchAttemptCommitSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("reconcile_outcome_unknown"),
        reconciliationCommit: inboxV2OutboundDispatchReconciliationCommitSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("already_accepted"),
        dispatch: inboxV2OutboundDispatchSchema,
        attempt: inboxV2OutboundDispatchAttemptSchema
      })
      .strict()
  ]);

/**
 * Exact per-slot correlation plus optional aggregate dispatch settlement.
 * Partial split evidence resolves its own occurrence but retains the dispatch;
 * only complete artifact coverage may accept the whole attempt/dispatch.
 */
export const inboxV2OutboundProviderSettlementCommitSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    observation: inboxV2OutboundProviderObservationSchema,
    artifactResolution:
      inboxV2OutboundProviderArtifactResolutionDispositionSchema,
    artifactCoverage: inboxV2OutboundProviderArtifactCoverageSchema,
    occurrenceMaterialization:
      inboxV2OutboundProviderOccurrenceMaterializationSchema,
    occurrenceResolution: inboxV2SourceOccurrenceResolutionCommitSchema,
    externalMessageReference: inboxV2ExternalMessageReferenceSchema,
    artifactAssociation:
      inboxV2OutboundProviderArtifactAssociationDispositionSchema,
    messageTransportAssociation: inboxV2MessageTransportAssociationCommitSchema,
    transition: inboxV2OutboundProviderSettlementTransitionSchema,
    settledByTrustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
    settledAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((commit, context) => {
    addSettlementIssues(commit, context);
  });

export const inboxV2OutboundProviderObservationEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_OUTBOUND_PROVIDER_OBSERVATION_SCHEMA_ID,
    INBOX_V2_OUTBOUND_PROVIDER_OBSERVATION_SCHEMA_VERSION,
    inboxV2OutboundProviderObservationSchema
  );
export const inboxV2OutboundDispatchArtifactResolutionEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_OUTBOUND_DISPATCH_ARTIFACT_RESOLUTION_SCHEMA_ID,
    INBOX_V2_OUTBOUND_PROVIDER_OBSERVATION_SCHEMA_VERSION,
    inboxV2OutboundDispatchArtifactResolutionSchema
  );
export const inboxV2OutboundProviderSettlementCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_OUTBOUND_PROVIDER_SETTLEMENT_COMMIT_SCHEMA_ID,
    INBOX_V2_OUTBOUND_PROVIDER_OBSERVATION_SCHEMA_VERSION,
    inboxV2OutboundProviderSettlementCommitSchema
  );

export type InboxV2OutboundProviderObservationEffectDisposition = z.infer<
  typeof inboxV2OutboundProviderObservationEffectDispositionSchema
>;
export type InboxV2OutboundProviderResponseObservationDescriptor = z.infer<
  typeof inboxV2OutboundProviderResponseObservationDescriptorSchema
>;
export type InboxV2OutboundProviderObservationEvidence = z.infer<
  typeof inboxV2OutboundProviderObservationEvidenceSchema
>;
export type InboxV2OutboundProviderObservation = z.infer<
  typeof inboxV2OutboundProviderObservationSchema
>;
export type InboxV2OutboundDispatchArtifactResolution = z.infer<
  typeof inboxV2OutboundDispatchArtifactResolutionSchema
>;
export type InboxV2OutboundProviderArtifactResolutionDisposition = z.infer<
  typeof inboxV2OutboundProviderArtifactResolutionDispositionSchema
>;
export type InboxV2OutboundProviderOccurrenceMaterialization = z.infer<
  typeof inboxV2OutboundProviderOccurrenceMaterializationSchema
>;
export type InboxV2OutboundProviderArtifactAssociationDisposition = z.infer<
  typeof inboxV2OutboundProviderArtifactAssociationDispositionSchema
>;
export type InboxV2OutboundProviderArtifactCoverage = z.infer<
  typeof inboxV2OutboundProviderArtifactCoverageSchema
>;
export type InboxV2OutboundProviderSettlementTransition = z.infer<
  typeof inboxV2OutboundProviderSettlementTransitionSchema
>;
export type InboxV2OutboundProviderSettlementCommit = z.infer<
  typeof inboxV2OutboundProviderSettlementCommitSchema
>;

const inboxV2OutboundProviderObservationIdentitySchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    attempt: inboxV2OutboundDispatchAttemptReferenceSchema,
    artifactOrdinal: z.number().int().min(1).max(64),
    sourceOccurrence: inboxV2SourceOccurrenceReferenceSchema,
    evidenceKind: z.enum([
      "provider_response_attempt",
      "provider_echo_correlation"
    ])
  })
  .strict()
  .superRefine((identity, context) => {
    if (
      identity.attempt.tenantId !== identity.tenantId ||
      identity.sourceOccurrence.tenantId !== identity.tenantId
    ) {
      addIssue(
        context,
        ["tenantId"],
        "Observation identity attempt and occurrence must belong to its tenant."
      );
    }
  });

export type InboxV2OutboundProviderObservationIdentity = z.input<
  typeof inboxV2OutboundProviderObservationIdentitySchema
>;

/** Stable replay identity; adapters never choose canonical Message/reference IDs. */
export function deriveInboxV2OutboundProviderObservationId(
  input: InboxV2OutboundProviderObservationIdentity
) {
  const identity =
    inboxV2OutboundProviderObservationIdentitySchema.parse(input);
  const digest = calculateInboxV2CanonicalSha256({
    domain: INBOX_V2_OUTBOUND_PROVIDER_OBSERVATION_SCHEMA_ID,
    hashVersion: INBOX_V2_OUTBOUND_PROVIDER_OBSERVATION_SCHEMA_VERSION,
    identity
  });
  return inboxV2OutboundProviderObservationIdSchema.parse(
    `outbound_provider_observation:${digest.slice("sha256:".length)}`
  );
}

export function calculateInboxV2OutboundProviderSourceOccurrenceDetailDigest(
  sourceOccurrence: z.input<typeof inboxV2SourceOccurrenceSchema>
) {
  const detail = inboxV2SourceOccurrenceSchema.parse(sourceOccurrence);
  return inboxV2Sha256DigestSchema.parse(
    calculateInboxV2CanonicalSha256({
      domain: "core:inbox-v2.outbound-provider-source-occurrence-detail",
      hashVersion: INBOX_V2_OUTBOUND_PROVIDER_OBSERVATION_SCHEMA_VERSION,
      detail
    })
  );
}

/**
 * Integrity digest for the complete immutable observation snapshot retained by
 * the settlement handoff. IDs alone cannot reconstruct the dispatch/attempt
 * state that was observed before a later response/echo wins the race.
 */
export function calculateInboxV2OutboundProviderObservationDetailDigest(
  observation: z.input<typeof inboxV2OutboundProviderObservationSchema>
) {
  const detail = inboxV2OutboundProviderObservationSchema.parse(observation);
  return inboxV2Sha256DigestSchema.parse(
    calculateInboxV2CanonicalSha256({
      domain: "core:inbox-v2.outbound-provider-observation-detail",
      hashVersion: INBOX_V2_OUTBOUND_PROVIDER_OBSERVATION_SCHEMA_VERSION,
      detail
    })
  );
}

function addObservationIssues(
  observation: InboxV2OutboundProviderObservation,
  context: z.RefinementCtx
): void {
  const { artifact, dispatch, route, attempt, sourceOccurrence, evidence } =
    observation;
  const attemptReference = referenceOf(attempt);
  const dispatchReference = referenceOf(dispatch);
  const routeReference = referenceOf(route);

  if (
    observation.tenantId !== artifact.tenantId ||
    observation.tenantId !== dispatch.tenantId ||
    observation.tenantId !== route.tenantId ||
    observation.tenantId !== attempt.tenantId ||
    observation.tenantId !== sourceOccurrence.tenantId
  ) {
    addIssue(
      context,
      ["tenantId"],
      "Provider observation, artifact, route, attempt and occurrence must belong to one tenant."
    );
  }

  if (
    (artifact.state !== "accepted" && artifact.state !== "outcome_unknown") ||
    artifact.ordinal !== evidence.artifactOrdinal ||
    !sameReference(artifact.dispatch, dispatchReference) ||
    !sameReference(artifact.route, routeReference) ||
    !sameReference(artifact.attempt, attemptReference) ||
    !sameReference(attempt.dispatch, dispatchReference) ||
    !sameReference(attempt.route, routeReference) ||
    !sameReference(dispatch.route, routeReference)
  ) {
    addIssue(
      context,
      ["artifact"],
      "Provider observation must preserve one accepted-or-unknown artifact ordinal and its exact attempt-to-dispatch-to-route chain."
    );
  }

  const parsedOccurrence =
    inboxV2SourceOccurrenceSchema.safeParse(sourceOccurrence);
  if (
    parsedOccurrence.success &&
    observation.sourceOccurrenceDetailDigestSha256 !==
      calculateInboxV2OutboundProviderSourceOccurrenceDetailDigest(
        parsedOccurrence.data
      )
  ) {
    addIssue(
      context,
      ["sourceOccurrenceDetailDigestSha256"],
      "SourceOccurrence detail digest must match its canonical bounded observation detail."
    );
  }

  if (
    !sameAdapterSurface(
      route.adapterContract,
      attempt.retrySafety.adapterContract
    ) ||
    !sameAdapterSurface(
      route.adapterContract,
      sourceOccurrence.messageIdentityDeclaration.adapterContract
    ) ||
    !sameAdapterSurface(
      route.adapterContract,
      sourceOccurrence.descriptor.adapterContract
    )
  ) {
    addIssue(
      context,
      ["route", "adapterContract"],
      "Provider observation must use the exact immutable adapter surface pinned by the route and attempt."
    );
  }

  if (
    !sameReference(
      route.externalThread,
      sourceOccurrence.messageKey.externalThread
    ) ||
    !sameReference(
      route.externalThread,
      sourceOccurrence.bindingContext.externalThread
    )
  ) {
    addIssue(
      context,
      ["sourceOccurrence", "bindingContext", "externalThread"],
      "Provider observation must target the exact outbound route thread."
    );
  }

  const exactSameRouteFence =
    sameReference(
      sourceOccurrence.bindingContext.sourceAccount,
      route.sourceAccount
    ) &&
    sameReference(
      sourceOccurrence.bindingContext.sourceThreadBinding,
      route.sourceThreadBinding
    ) &&
    sourceOccurrence.bindingContext.bindingGeneration ===
      route.bindingFence.bindingGeneration;
  const authoritativeProviderWideEcho =
    evidence.kind === "provider_echo_correlation" &&
    sourceOccurrence.origin.kind === "provider_echo" &&
    sourceOccurrence.messageKey.scope.kind === "provider_thread" &&
    sourceOccurrence.messageIdentityDeclaration.scopeKind ===
      "provider_thread" &&
    sourceOccurrence.messageIdentityDeclaration.decisionStrength ===
      "authoritative";
  if (!exactSameRouteFence && !authoritativeProviderWideEcho) {
    addIssue(
      context,
      ["sourceOccurrence", "bindingContext", "sourceAccount"],
      "Cross-account correlation is allowed only for an authoritative provider-thread echo; otherwise the exact route account and binding generation are required."
    );
  }

  if (
    sourceOccurrence.resolution.state !== "pending" ||
    sourceOccurrence.revision !== "1" ||
    sourceOccurrence.createdAt !== sourceOccurrence.updatedAt ||
    sourceOccurrence.direction !== "outbound" ||
    sourceOccurrence.providerActor !== null
  ) {
    addIssue(
      context,
      ["sourceOccurrence"],
      "Provider truth must enter as one initial pending outbound occurrence without a provider actor."
    );
  }

  if (
    observation.observedByTrustedServiceId !==
      route.adapterContract.loadedByTrustedServiceId ||
    observation.observedByTrustedServiceId !==
      sourceOccurrence.messageIdentityDeclaration.adapterContract
        .loadedByTrustedServiceId
  ) {
    addIssue(
      context,
      ["observedByTrustedServiceId"],
      "Only the trusted runtime pinned by the adapter contract may declare provider truth."
    );
  }

  if (
    !isInboxV2TimestampOrderValid(attempt.openedAt, artifact.createdAt) ||
    !isInboxV2TimestampOrderValid(
      attempt.openedAt,
      sourceOccurrence.observedAt
    ) ||
    !isInboxV2TimestampOrderValid(
      sourceOccurrence.observedAt,
      observation.recordedAt
    ) ||
    !isInboxV2TimestampOrderValid(artifact.createdAt, observation.recordedAt) ||
    sourceOccurrence.recordedAt !== observation.recordedAt ||
    sourceOccurrence.createdAt !== observation.recordedAt
  ) {
    addIssue(
      context,
      ["recordedAt"],
      "Provider observation must be recorded after its durable attempt and exact provider occurrence."
    );
  }

  addObservationLifecycleIssues(context, dispatch, attempt);
  addObservationEvidenceIssues(context, observation);
}

function addObservationLifecycleIssues(
  context: z.RefinementCtx,
  dispatch: InboxV2OutboundDispatch,
  attempt: InboxV2OutboundDispatchAttempt
): void {
  const attemptReference = referenceOf(attempt);
  const commonHeadValid =
    dispatch.attemptCount === attempt.attemptNumber &&
    sameNullableReference(dispatch.lastAttempt, attemptReference);
  const stateValid =
    (attempt.outcome.kind === "pending" &&
      dispatch.state === "attempting" &&
      sameNullableReference(dispatch.activeAttempt, attemptReference) &&
      dispatch.updatedAt === attempt.openedAt) ||
    (attempt.outcome.kind === "outcome_unknown" &&
      dispatch.state === "outcome_unknown" &&
      dispatch.activeAttempt === null &&
      dispatch.updatedAt === attempt.outcome.completedAt) ||
    (attempt.outcome.kind === "accepted" &&
      dispatch.state === "accepted" &&
      dispatch.activeAttempt === null &&
      dispatch.updatedAt === attempt.outcome.completedAt);
  if (!commonHeadValid || !stateValid) {
    addIssue(
      context,
      ["dispatch"],
      "Observation accepts only the exact pending, outcome-unknown or already-accepted dispatch head for its attempt."
    );
  }
}

function addObservationEvidenceIssues(
  context: z.RefinementCtx,
  observation: InboxV2OutboundProviderObservation
): void {
  const { sourceOccurrence, evidence, attempt, route } = observation;
  if (evidence.kind === "provider_response_attempt") {
    if (
      sourceOccurrence.origin.kind !== "provider_response" ||
      !sameReference(evidence.outboundDispatchAttempt, referenceOf(attempt)) ||
      !sameReference(
        sourceOccurrence.origin.outboundDispatchAttempt,
        referenceOf(attempt)
      ) ||
      !sameReference(
        sourceOccurrence.origin.sourceAccount,
        route.sourceAccount
      ) ||
      !sameReference(
        sourceOccurrence.bindingContext.sourceAccount,
        route.sourceAccount
      ) ||
      !sameReference(
        sourceOccurrence.bindingContext.sourceThreadBinding,
        route.sourceThreadBinding
      )
    ) {
      addIssue(
        context,
        ["evidence"],
        "Provider response evidence must cite the exact attempt and its exact route account/binding."
      );
    }
    return;
  }

  const hasExactProviderReference =
    sourceOccurrence.descriptor.providerReferences.some(
      (reference) =>
        String(reference.kindId) === String(evidence.providerReferenceKindId) &&
        reference.subject === evidence.correlationToken
    );
  if (
    sourceOccurrence.origin.kind !== "provider_echo" ||
    attempt.retrySafety.providerCorrelationToken === null ||
    attempt.retrySafety.providerCorrelationToken !==
      evidence.correlationToken ||
    !hasExactProviderReference
  ) {
    addIssue(
      context,
      ["evidence"],
      "Provider echo evidence requires the exact attempt correlation token in an exact provider reference."
    );
  }
}

function addArtifactResolutionIssues(
  resolution: InboxV2OutboundDispatchArtifactResolution,
  context: z.RefinementCtx
): void {
  const { observation, effectiveArtifact } = resolution;
  const original = observation.artifact;
  if (
    resolution.tenantId !== observation.tenantId ||
    resolution.tenantId !== effectiveArtifact.tenantId ||
    resolution.artifactOrdinal !== observation.evidence.artifactOrdinal ||
    resolution.artifactOrdinal !== original.ordinal ||
    resolution.artifactOrdinal !== effectiveArtifact.ordinal ||
    resolution.fromState !== original.state ||
    (original.state !== "accepted" && original.state !== "outcome_unknown") ||
    effectiveArtifact.state !== "accepted" ||
    effectiveArtifact.diagnostic !== null ||
    !sameArtifactIdentity(original, effectiveArtifact) ||
    (original.state === "accepted" &&
      !sameValue(original, effectiveArtifact)) ||
    resolution.resolvedByTrustedServiceId !==
      observation.observedByTrustedServiceId ||
    !isInboxV2TimestampOrderValid(observation.recordedAt, resolution.resolvedAt)
  ) {
    addIssue(
      context,
      ["effectiveArtifact"],
      "Artifact resolution is append-only accepted evidence for the exact immutable accepted-or-unknown artifact slot."
    );
  }
}

function addSettlementIssues(
  commit: InboxV2OutboundProviderSettlementCommit,
  context: z.RefinementCtx
): void {
  const { observation, occurrenceResolution } = commit;
  const artifactResolution = selectedArtifactResolution(commit);
  const transportAssociation = commit.messageTransportAssociation;
  const createsArtifactResolution = commit.artifactResolution.kind === "create";
  const resolutionMatchesCurrentObservation = createsArtifactResolution
    ? sameValue(artifactResolution.observation, observation)
    : sameValue(
        artifactResolution.observation.artifact,
        observation.artifact
      ) &&
      sameReference(
        artifactResolution.observation.dispatch,
        observation.dispatch
      ) &&
      sameReference(artifactResolution.observation.route, observation.route) &&
      sameReference(
        artifactResolution.observation.attempt,
        observation.attempt
      );

  if (
    commit.tenantId !== observation.tenantId ||
    commit.tenantId !== artifactResolution.tenantId ||
    commit.tenantId !== occurrenceResolution.tenantId ||
    commit.tenantId !== commit.externalMessageReference.tenantId ||
    commit.tenantId !== transportAssociation.tenantId ||
    !resolutionMatchesCurrentObservation
  ) {
    addIssue(
      context,
      ["artifactResolution"],
      "Provider settlement must create the current observation resolution or reuse the one canonical resolution of the exact same immutable artifact."
    );
  }

  const coverage = validateCoverage(commit, context);
  const transitionResult = settlementTransitionResult(
    commit,
    coverage.complete,
    context
  );
  if (transitionResult === null) return;

  addOccurrenceMaterializationIssues(context, commit, transitionResult);
  if (
    !sameValue(occurrenceResolution.before, observation.sourceOccurrence) ||
    occurrenceResolution.after.resolution.state !== "resolved" ||
    occurrenceResolution.resolvedReference === null ||
    !sameValue(
      occurrenceResolution.resolvedReference,
      commit.externalMessageReference
    ) ||
    !sameValue(
      transportAssociation.sourceOccurrence,
      occurrenceResolution.after
    ) ||
    !sameValue(
      transportAssociation.externalMessageReference,
      commit.externalMessageReference
    )
  ) {
    addIssue(
      context,
      ["occurrenceResolution"],
      "Settlement must resolve the exact observed occurrence to one ExternalMessageReference used by the Message transport association."
    );
  }

  addArtifactAssociationIssues(context, commit, transitionResult);
  const expectedRole =
    observation.evidence.kind === "provider_response_attempt"
      ? "provider_response"
      : "provider_echo";
  if (
    transportAssociation.link.role !== expectedRole ||
    transportAssociation.link.externalMessageReference.id !==
      commit.externalMessageReference.id ||
    transportAssociation.link.sourceOccurrence.id !==
      occurrenceResolution.after.id ||
    transportAssociation.message.id !== observation.dispatch.message.id ||
    transportAssociation.messageOriginProof.kind !== "hulee_outbound" ||
    !sameValue(
      transportAssociation.messageOriginProof.outboundRoute,
      observation.route
    )
  ) {
    addIssue(
      context,
      ["messageTransportAssociation"],
      "Every distinct provider response/echo occurrence must add its exact role to the existing Hulee outbound Message."
    );
  }

  if (
    commit.settledByTrustedServiceId !==
      observation.observedByTrustedServiceId ||
    commit.settledByTrustedServiceId !==
      observation.route.adapterContract.loadedByTrustedServiceId ||
    occurrenceResolution.resolver.trustedServiceId !==
      commit.settledByTrustedServiceId ||
    occurrenceResolution.changedAt !== commit.settledAt ||
    transportAssociation.committedAt !== commit.settledAt ||
    (createsArtifactResolution
      ? artifactResolution.resolvedAt !== commit.settledAt
      : !isInboxV2TimestampOrderValid(
          artifactResolution.resolvedAt,
          commit.settledAt
        )) ||
    !isInboxV2TimestampOrderValid(observation.recordedAt, commit.settledAt)
  ) {
    addIssue(
      context,
      ["settledAt"],
      "One pinned trusted runtime and one commit boundary must settle the occurrence, effective artifact and Message association."
    );
  }

  addSettlementCrossAccountIssues(context, commit);
}

function validateCoverage(
  commit: InboxV2OutboundProviderSettlementCommit,
  context: z.RefinementCtx
): { complete: boolean } {
  const { contentPlan, resolutions } = commit.artifactCoverage;
  const observation = commit.observation;
  const plannedOrdinals = contentPlan.artifacts.map(
    (artifact) => artifact.ordinal
  );
  const resolvedOrdinals = resolutions.map(
    (resolution) => resolution.artifactOrdinal
  );
  const resolvedArtifactIds = resolutions.map(
    (resolution) => resolution.effectiveArtifact.id
  );
  const uniqueResolved = new Set(resolvedOrdinals);
  const uniqueResolvedArtifacts = new Set(resolvedArtifactIds);
  const complete =
    uniqueResolved.size === resolvedOrdinals.length &&
    resolvedOrdinals.length === plannedOrdinals.length &&
    plannedOrdinals.every((ordinal) => uniqueResolved.has(ordinal));
  const currentIncluded = resolutions.some((resolution) =>
    sameValue(resolution, selectedArtifactResolution(commit))
  );
  const commonScope = resolutions.every(
    (resolution) =>
      sameReference(resolution.observation.dispatch, observation.dispatch) &&
      sameReference(resolution.observation.route, observation.route) &&
      sameReference(resolution.observation.attempt, observation.attempt) &&
      plannedOrdinals.includes(resolution.artifactOrdinal) &&
      isInboxV2TimestampOrderValid(resolution.resolvedAt, commit.settledAt)
  );
  if (
    contentPlan.tenantId !== commit.tenantId ||
    !sameReference(contentPlan.dispatch, observation.dispatch) ||
    !sameReference(contentPlan.message, observation.dispatch.message) ||
    !sameReference(contentPlan.route, observation.route) ||
    !sameReference(
      contentPlan.binding,
      observation.route.sourceThreadBinding
    ) ||
    !sameAdapterSurface(
      contentPlan.adapterContract,
      observation.route.adapterContract
    ) ||
    uniqueResolved.size !== resolvedOrdinals.length ||
    uniqueResolvedArtifacts.size !== resolvedArtifactIds.length ||
    !currentIncluded ||
    !commonScope
  ) {
    addIssue(
      context,
      ["artifactCoverage"],
      "Artifact coverage must contain unique persisted effective resolutions from the exact content plan, dispatch, route and attempt."
    );
  }
  return { complete };
}

function settlementTransitionResult(
  commit: InboxV2OutboundProviderSettlementCommit,
  completeCoverage: boolean,
  context: z.RefinementCtx
): Readonly<{
  dispatch: InboxV2OutboundDispatch;
  attempt: InboxV2OutboundDispatchAttempt;
}> | null {
  const { observation, transition, settledAt } = commit;
  if (transition.kind === "retain_dispatch_state") {
    const retainedTransportIsExactObservation =
      sameValue(transition.dispatch, observation.dispatch) &&
      sameValue(transition.attempt, observation.attempt);
    const retainedTransportIsMonotonicUnknown =
      pendingObservationToOutcomeUnknownTransportValid(
        observation,
        transition.dispatch,
        transition.attempt
      );
    if (
      completeCoverage ||
      (!retainedTransportIsExactObservation &&
        !retainedTransportIsMonotonicUnknown) ||
      (transition.attempt.outcome.kind !== "pending" &&
        transition.attempt.outcome.kind !== "outcome_unknown" &&
        !(
          transition.attempt.outcome.kind === "accepted" &&
          transition.dispatch.state === "accepted"
        ))
    ) {
      addIssue(
        context,
        ["transition"],
        "Partial artifact evidence may retain only its exact current transport head or an exact monotonic pending-to-outcome-unknown descendant; complete coverage must settle it."
      );
      return null;
    }
    return {
      dispatch: transition.dispatch,
      attempt: transition.attempt
    };
  }

  if (!completeCoverage && transition.kind !== "already_accepted") {
    addIssue(
      context,
      ["artifactCoverage"],
      "The whole attempt/dispatch cannot become accepted before every planned artifact has exact accepted resolution evidence."
    );
    return null;
  }

  if (transition.kind === "complete_pending_attempt") {
    const attemptCommit = transition.attemptCommit;
    if (
      attemptCommit.kind !== "complete_attempt" ||
      observation.attempt.outcome.kind !== "pending" ||
      !sameValue(attemptCommit.dispatchBefore, observation.dispatch) ||
      !sameValue(attemptCommit.attemptBefore, observation.attempt) ||
      attemptCommit.completionSource !== "provider_observation" ||
      attemptCommit.attemptAfter.outcome.kind !== "accepted" ||
      attemptCommit.attemptAfter.outcome.completedAt !== settledAt ||
      attemptCommit.completedByTrustedServiceId !==
        observation.observedByTrustedServiceId ||
      attemptCommit.dispatchAfter.state !== "accepted"
    ) {
      addIssue(
        context,
        ["transition"],
        "A pending attempt may close only once as accepted through complete exact provider-observation coverage."
      );
      return null;
    }
    return {
      dispatch: attemptCommit.dispatchAfter,
      attempt: attemptCommit.attemptAfter
    };
  }

  if (transition.kind === "reconcile_outcome_unknown") {
    const reconciliation = transition.reconciliationCommit;
    const decision = reconciliation.decision;
    const reconciliationStartsFromObservation =
      observation.attempt.outcome.kind === "outcome_unknown" &&
      sameValue(reconciliation.dispatchBefore, observation.dispatch) &&
      sameValue(decision.unknownAttempt, observation.attempt);
    const reconciliationStartsFromMonotonicUnknown =
      pendingObservationToOutcomeUnknownTransportValid(
        observation,
        reconciliation.dispatchBefore,
        decision.unknownAttempt
      );
    if (
      (!reconciliationStartsFromObservation &&
        !reconciliationStartsFromMonotonicUnknown) ||
      !sameValue(decision.routeSnapshot, observation.route) ||
      decision.result.state !== "accepted" ||
      decision.decidedBy.kind !== "trusted_service" ||
      decision.decidedBy.trustedServiceId !==
        observation.observedByTrustedServiceId ||
      decision.decidedAt !== settledAt ||
      reconciliation.dispatchAfter.state !== "accepted"
    ) {
      addIssue(
        context,
        ["transition"],
        "An unknown attempt may settle only through an exact trusted accepted reconciliation decision and complete coverage."
      );
      return null;
    }
    return {
      dispatch: reconciliation.dispatchAfter,
      attempt: decision.unknownAttempt
    };
  }

  if (
    transition.dispatch.state !== "accepted" ||
    !sameDispatchIdentity(transition.dispatch, observation.dispatch) ||
    !sameAttemptIdentity(transition.attempt, observation.attempt) ||
    transition.dispatch.attemptCount !== transition.attempt.attemptNumber ||
    transition.dispatch.activeAttempt !== null ||
    !sameNullableReference(
      transition.dispatch.lastAttempt,
      referenceOf(transition.attempt)
    ) ||
    !alreadyAcceptedTransportProgressionValid(
      observation.dispatch,
      transition.dispatch,
      observation.attempt,
      transition.attempt
    ) ||
    !isInboxV2TimestampOrderValid(transition.dispatch.updatedAt, settledAt)
  ) {
    addIssue(
      context,
      ["transition"],
      "No-op settlement requires the exact already-accepted dispatch and its unchanged or previously accepted attempt head."
    );
    return null;
  }
  return { dispatch: transition.dispatch, attempt: transition.attempt };
}

function addOccurrenceMaterializationIssues(
  context: z.RefinementCtx,
  settlement: InboxV2OutboundProviderSettlementCommit,
  finalTransport: Readonly<{
    dispatch: InboxV2OutboundDispatch;
    attempt: InboxV2OutboundDispatchAttempt;
  }>
): void {
  const { observation, occurrenceMaterialization, settledAt } = settlement;
  if (observation.evidence.kind === "provider_response_attempt") {
    const proofTransport = providerResponseMaterializationTransport(
      settlement,
      finalTransport
    );
    if (
      occurrenceMaterialization.kind !== "provider_response" ||
      !sameValue(
        occurrenceMaterialization.commit.occurrence,
        observation.sourceOccurrence
      ) ||
      occurrenceMaterialization.commit.bindingMaterialization.kind !==
        "existing" ||
      !sameValue(
        occurrenceMaterialization.commit.outboundDispatchAttempt,
        proofTransport.attempt
      ) ||
      !sameValue(
        occurrenceMaterialization.commit.outboundDispatch,
        proofTransport.dispatch
      ) ||
      !sameValue(
        occurrenceMaterialization.commit.outboundRoute,
        observation.route
      ) ||
      occurrenceMaterialization.commit.authority.trustedServiceId !==
        settlement.settledByTrustedServiceId
    ) {
      addIssue(
        context,
        ["occurrenceMaterialization"],
        "Provider response settlement must first materialize its exact deferred occurrence against the existing outbound route/binding snapshots."
      );
    }
    return;
  }

  if (
    occurrenceMaterialization.kind !== "provider_echo" ||
    !sameValue(
      occurrenceMaterialization.persistedSourceOccurrence,
      observation.sourceOccurrence
    ) ||
    occurrenceMaterialization.verifiedByTrustedServiceId !==
      settlement.settledByTrustedServiceId ||
    occurrenceMaterialization.verifiedAt !== settledAt
  ) {
    addIssue(
      context,
      ["occurrenceMaterialization"],
      "Provider echo settlement requires the exact already-materialized pending occurrence proof."
    );
  }
}

function providerResponseMaterializationTransport(
  settlement: InboxV2OutboundProviderSettlementCommit,
  finalTransport: Readonly<{
    dispatch: InboxV2OutboundDispatch;
    attempt: InboxV2OutboundDispatchAttempt;
  }>
): Readonly<{
  dispatch: InboxV2OutboundDispatch;
  attempt: InboxV2OutboundDispatchAttempt;
}> {
  const transition = settlement.transition;
  if (
    transition.kind === "already_accepted" ||
    transition.kind === "retain_dispatch_state"
  ) {
    return finalTransport;
  }
  if (transition.kind === "reconcile_outcome_unknown") {
    return {
      dispatch: transition.reconciliationCommit.dispatchBefore,
      attempt: transition.reconciliationCommit.decision.unknownAttempt
    };
  }
  return {
    dispatch: settlement.observation.dispatch,
    attempt: settlement.observation.attempt
  };
}

function addArtifactAssociationIssues(
  context: z.RefinementCtx,
  settlement: InboxV2OutboundProviderSettlementCommit,
  finalState: Readonly<{
    dispatch: InboxV2OutboundDispatch;
    attempt: InboxV2OutboundDispatchAttempt;
  }>
): void {
  const { artifactAssociation, occurrenceResolution } = settlement;
  const artifactResolution = selectedArtifactResolution(settlement);
  const effectiveArtifact = artifactResolution.effectiveArtifact;
  if (artifactAssociation.kind === "create") {
    const association = artifactAssociation.commit;
    const evidenceMatches =
      settlement.observation.evidence.kind === "provider_response_attempt"
        ? association.link.associationEvidence.kind ===
          "provider_response_attempt"
        : association.link.associationEvidence.kind ===
            "provider_echo_correlation" &&
          association.link.associationEvidence.providerReferenceKindId ===
            settlement.observation.evidence.providerReferenceKindId &&
          association.link.associationEvidence.correlationToken ===
            settlement.observation.evidence.correlationToken;
    if (
      !sameValue(association.artifact, effectiveArtifact) ||
      !sameValue(association.route, settlement.observation.route) ||
      !sameValue(association.dispatch, finalState.dispatch) ||
      !sameValue(association.attempt, finalState.attempt) ||
      !sameValue(association.occurrenceResolution, occurrenceResolution) ||
      association.link.externalMessageReference.id !==
        settlement.externalMessageReference.id ||
      !evidenceMatches
    ) {
      addIssue(
        context,
        ["artifactAssociation"],
        "Creating an artifact link requires the exact effectively accepted artifact, current occurrence and provider evidence."
      );
    }
    return;
  }

  const link = artifactAssociation.existingLink;
  if (
    !sameReference(link.artifact, effectiveArtifact) ||
    !sameReference(link.dispatch, finalState.dispatch) ||
    !sameReference(link.route, settlement.observation.route) ||
    !sameReference(link.attempt, finalState.attempt) ||
    !sameReference(
      link.externalThread,
      settlement.observation.route.externalThread
    ) ||
    link.externalMessageReference.id !==
      settlement.externalMessageReference.id ||
    link.linkedAt > settlement.settledAt
  ) {
    addIssue(
      context,
      ["artifactAssociation", "existingLink"],
      "Reused artifact association must already target the same artifact and canonical ExternalMessageReference; the new occurrence still gets its own Message transport link."
    );
  }
}

function selectedArtifactResolution(
  settlement: InboxV2OutboundProviderSettlementCommit
): InboxV2OutboundDispatchArtifactResolution {
  return settlement.artifactResolution.kind === "create"
    ? settlement.artifactResolution.resolution
    : settlement.artifactResolution.existingResolution;
}

function addSettlementCrossAccountIssues(
  context: z.RefinementCtx,
  commit: InboxV2OutboundProviderSettlementCommit
): void {
  const { observation, messageTransportAssociation: association } = commit;
  if (
    sameReference(
      observation.route.sourceAccount,
      observation.sourceOccurrence.bindingContext.sourceAccount
    )
  ) {
    return;
  }
  const mapping = association.externalThreadMapping.thread;
  if (
    observation.evidence.kind !== "provider_echo_correlation" ||
    mapping.key.scope.kind !== "provider" ||
    mapping.identityDeclaration.scopeKind !== "provider" ||
    mapping.identityDeclaration.decisionStrength !== "authoritative"
  ) {
    addIssue(
      context,
      ["messageTransportAssociation", "externalThreadMapping"],
      "Cross-account settlement requires the authoritative provider-wide ExternalThread mapping."
    );
  }
}

function alreadyAcceptedAttemptProgressionValid(
  before: InboxV2OutboundDispatchAttempt,
  after: InboxV2OutboundDispatchAttempt
): boolean {
  // Response and echo may independently observe acceptance for the same
  // immutable attempt. The first committed acceptance owns the canonical
  // completion timestamp; a later observation may still attach its distinct
  // occurrence without rewriting that attempt head.
  if (before.outcome.kind === "accepted") {
    return (
      after.outcome.kind === "accepted" && after.revision === before.revision
    );
  }
  if (before.outcome.kind === "outcome_unknown")
    return sameValue(before, after);
  return (
    before.outcome.kind === "pending" &&
    after.outcome.kind === "accepted" &&
    (after.completionSource === "provider_result" ||
      after.completionSource === "provider_observation") &&
    BigInt(after.revision) === BigInt(before.revision) + 1n
  );
}

function alreadyAcceptedTransportProgressionValid(
  beforeDispatch: InboxV2OutboundDispatch,
  afterDispatch: InboxV2OutboundDispatch,
  beforeAttempt: InboxV2OutboundDispatchAttempt,
  afterAttempt: InboxV2OutboundDispatchAttempt
): boolean {
  if (
    alreadyAcceptedAttemptProgressionValid(beforeAttempt, afterAttempt) &&
    alreadyAcceptedDispatchProgressionValid(beforeDispatch, afterDispatch)
  ) {
    return true;
  }
  return (
    beforeDispatch.state === "attempting" &&
    beforeAttempt.outcome.kind === "pending" &&
    afterDispatch.state === "accepted" &&
    afterAttempt.outcome.kind === "outcome_unknown" &&
    (afterAttempt.completionSource === "provider_result" ||
      afterAttempt.completionSource === "lease_expired") &&
    BigInt(afterAttempt.revision) === BigInt(beforeAttempt.revision) + 1n &&
    BigInt(afterDispatch.revision) === BigInt(beforeDispatch.revision) + 2n
  );
}

function pendingObservationToOutcomeUnknownTransportValid(
  observation: InboxV2OutboundProviderObservation,
  dispatch: InboxV2OutboundDispatch,
  attempt: InboxV2OutboundDispatchAttempt
): boolean {
  const beforeDispatch = observation.dispatch;
  const beforeAttempt = observation.attempt;
  return (
    beforeDispatch.state === "attempting" &&
    beforeAttempt.outcome.kind === "pending" &&
    sameDispatchIdentity(beforeDispatch, dispatch) &&
    sameAttemptIdentity(beforeAttempt, attempt) &&
    dispatch.state === "outcome_unknown" &&
    attempt.outcome.kind === "outcome_unknown" &&
    (attempt.completionSource === "provider_result" ||
      attempt.completionSource === "lease_expired") &&
    dispatch.attemptCount === beforeDispatch.attemptCount &&
    dispatch.activeAttempt === null &&
    sameNullableReference(dispatch.lastAttempt, referenceOf(attempt)) &&
    BigInt(dispatch.revision) === BigInt(beforeDispatch.revision) + 1n &&
    BigInt(attempt.revision) === BigInt(beforeAttempt.revision) + 1n &&
    isInboxV2TimestampOrderValid(beforeDispatch.updatedAt, dispatch.updatedAt)
  );
}

function alreadyAcceptedDispatchProgressionValid(
  before: InboxV2OutboundDispatch,
  after: InboxV2OutboundDispatch
): boolean {
  return (
    BigInt(after.revision) ===
    BigInt(before.revision) + (before.state === "accepted" ? 0n : 1n)
  );
}

function sameArtifactIdentity(
  left: InboxV2OutboundDispatchArtifact,
  right: InboxV2OutboundDispatchArtifact
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.id === right.id &&
    sameReference(left.dispatch, right.dispatch) &&
    sameReference(left.route, right.route) &&
    sameReference(left.attempt, right.attempt) &&
    left.ordinal === right.ordinal &&
    left.createdAt === right.createdAt &&
    left.revision === right.revision
  );
}

function sameDispatchIdentity(
  left: InboxV2OutboundDispatch,
  right: InboxV2OutboundDispatch
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.id === right.id &&
    sameReference(left.message, right.message) &&
    sameReference(left.route, right.route) &&
    sameNullableReferenceOrNull(
      left.multiSendOperation,
      right.multiSendOperation
    ) &&
    left.createdAt === right.createdAt
  );
}

function sameAttemptIdentity(
  left: InboxV2OutboundDispatchAttempt,
  right: InboxV2OutboundDispatchAttempt
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.id === right.id &&
    sameReference(left.dispatch, right.dispatch) &&
    sameReference(left.route, right.route) &&
    left.attemptNumber === right.attemptNumber &&
    left.claimToken === right.claimToken &&
    sameValue(left.retrySafety, right.retrySafety) &&
    left.leaseExpiresAt === right.leaseExpiresAt &&
    left.openedAt === right.openedAt
  );
}

function referenceOf(value: { tenantId: string; id: string }) {
  return { tenantId: value.tenantId, id: value.id };
}

function sameReference(
  left: { tenantId: string; id: string },
  right: { tenantId: string; id: string }
): boolean {
  return (
    left.tenantId === right.tenantId && String(left.id) === String(right.id)
  );
}

function sameNullableReference(
  left: { tenantId: string; id: string } | null,
  right: { tenantId: string; id: string }
): boolean {
  return left !== null && sameReference(left, right);
}

function sameNullableReferenceOrNull(
  left: { tenantId: string; id: string } | null,
  right: { tenantId: string; id: string } | null
): boolean {
  return left === null
    ? right === null
    : right !== null && sameReference(left, right);
}

function sameAdapterSurface(
  left: {
    contractId: string;
    contractVersion: string;
    declarationRevision: string;
    surfaceId: string;
    loadedByTrustedServiceId: string;
    loadedAt: string;
  },
  right: {
    contractId: string;
    contractVersion: string;
    declarationRevision: string;
    surfaceId: string;
    loadedByTrustedServiceId: string;
    loadedAt: string;
  }
): boolean {
  return sameValue(left, right);
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addIssue(
  context: z.RefinementCtx,
  path: readonly PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path: [...path], message });
}
