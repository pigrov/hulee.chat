import {
  calculateInboxV2CanonicalSha256,
  canonicalizeInboxV2Json,
  inboxV2EntityRevisionSchema,
  inboxV2NormalizedInboundEventIdSchema,
  inboxV2RoutingTokenSchema,
  inboxV2RoutingTrustedServiceIdSchema,
  inboxV2SourceExternalIdentityIdSchema,
  inboxV2SourceExternalIdentitySchema,
  inboxV2SourceIdentityAssessmentSchema,
  inboxV2SourceIdentityClaimIdSchema,
  inboxV2SourceIdentityMaterializationSnapshotSchema,
  inboxV2SourceIdentityObservationRecordSchema,
  inboxV2SourceIdentityResolutionBatchSchema,
  inboxV2SourceIdentityResolutionCandidateSchema,
  inboxV2SourceIdentityResolutionEvidenceSchema,
  inboxV2SourceIdentityResolutionRecordSchema,
  inboxV2SourceNormalizedEventForIdentityResolutionSchema,
  inboxV2TenantIdSchema,
  type InboxV2DeferredParticipantIntent,
  type InboxV2EntityRevision,
  type InboxV2SourceExternalIdentity,
  type InboxV2SourceIdentityAssessment,
  type InboxV2SourceIdentityObservationRecord,
  type InboxV2SourceIdentityResolutionBatch,
  type InboxV2SourceIdentityResolutionCandidate,
  type InboxV2SourceIdentityResolutionEvidence,
  type InboxV2SourceNormalizedEventForIdentityResolution,
  type InboxV2SourceNormalizedIdentityObservation
} from "@hulee/contracts";
import {
  calculateInboxV2SourceIdentitySubjectlessFact,
  type InboxV2SourceExternalIdentityRepository,
  type InboxV2SourceIdentityResolutionRepository,
  type PersistedInboxV2SourceIdentityAssessment
} from "@hulee/db";

const PROCESSOR_OPTION_KEYS = new Set([
  "identityRepository",
  "resolutionRepository",
  "materializer",
  "assessmentPlanner"
]);
const trustedMaterializers = new WeakSet<object>();

export type InboxV2SourceIdentityAssessmentPlan = Readonly<{
  evidence: readonly InboxV2SourceIdentityResolutionEvidence[];
  candidates: readonly InboxV2SourceIdentityResolutionCandidate[];
  assessment: InboxV2SourceIdentityAssessment;
}>;

export type InboxV2SourceIdentityAssessmentPlanner = Readonly<{
  plan(input: {
    sourceEvent: InboxV2SourceNormalizedEventForIdentityResolution;
    observation: InboxV2SourceNormalizedIdentityObservation;
    identity: InboxV2SourceExternalIdentity;
    currentAssessment: PersistedInboxV2SourceIdentityAssessment | null;
  }): Promise<InboxV2SourceIdentityAssessmentPlan>;
}>;

export type InboxV2TrustedSourceIdentityMaterializer = Readonly<{
  materialize(input: {
    sourceEvent: InboxV2SourceNormalizedEventForIdentityResolution;
    observation: InboxV2SourceNormalizedIdentityObservation;
  }): Parameters<InboxV2SourceExternalIdentityRepository["findOrCreate"]>[0];
}>;

export type InboxV2SourceIdentityNamespaceDeriver = Readonly<{
  /**
   * Long-lived tenant identity namespace generation. Operational KMS or key
   * wrapping rotation must preserve this derivation; generation changes require
   * an explicit identity migration.
   */
  namespaceGeneration: string;
  deriveNamespaceHmacSha256(input: {
    tenantId: string;
    trustedServiceId: string;
    namespaceGeneration: string;
    purpose: "source_identity_id" | "materialization_authorization";
    canonicalPreimage: string;
  }): string;
}>;

export type InboxV2SourceIdentityResolutionProcessorOptions = Readonly<{
  identityRepository: InboxV2SourceExternalIdentityRepository;
  resolutionRepository: InboxV2SourceIdentityResolutionRepository;
  materializer: InboxV2TrustedSourceIdentityMaterializer;
  assessmentPlanner: InboxV2SourceIdentityAssessmentPlanner;
}>;

export type InboxV2SourceIdentityResolutionProcessResult =
  | Readonly<{ kind: "normalized_event_not_found" }>
  | Readonly<{
      kind: "completed";
      batch: InboxV2SourceIdentityResolutionBatch;
    }>;

export type InboxV2SourceIdentityResolutionProcessor = Readonly<{
  process(input: {
    tenantId: string;
    normalizedEventId: string;
  }): Promise<InboxV2SourceIdentityResolutionProcessResult>;
}>;

export type InboxV2SourceIdentityResolutionProcessorErrorCode =
  | "source.identity_materializer_untrusted"
  | "source.identity_materializer_service_mismatch"
  | "source.identity_materialization_conflict"
  | "source.identity_assessment_plan_invalid"
  | "source.identity_assessment_persistence_conflict"
  | "source.identity_assessment_persistence_mismatch";

export class InboxV2SourceIdentityResolutionProcessorError extends Error {
  readonly code: InboxV2SourceIdentityResolutionProcessorErrorCode;
  readonly retryable: boolean;

  constructor(
    code: InboxV2SourceIdentityResolutionProcessorErrorCode,
    options: { cause?: unknown; retryable?: boolean } = {}
  ) {
    super(
      code,
      options.cause === undefined ? undefined : { cause: options.cause }
    );
    this.name = "InboxV2SourceIdentityResolutionProcessorError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

/**
 * Wraps an opaque, server-owned tenant key deriver in the structural capability
 * accepted by this processor. The WeakSet prevents accidental structural
 * substitution; possession and isolation of the tenant HMAC key are the trust
 * root. Neither the key nor an unkeyed subject digest crosses this boundary.
 */
export function createInboxV2TrustedSourceIdentityMaterializer(input: {
  trustedServiceId: string;
  namespaceDeriver: InboxV2SourceIdentityNamespaceDeriver;
}): InboxV2TrustedSourceIdentityMaterializer {
  const trustedServiceId = inboxV2RoutingTrustedServiceIdSchema.parse(
    input.trustedServiceId
  );
  const namespaceGeneration = inboxV2RoutingTokenSchema.parse(
    input.namespaceDeriver.namespaceGeneration
  );
  const materializer: InboxV2TrustedSourceIdentityMaterializer = Object.freeze({
    materialize({ sourceEvent, observation }) {
      if (
        sourceEvent.adapterContract.loadedByTrustedServiceId !==
          trustedServiceId ||
        observation.identityDeclaration.adapterContract
          .loadedByTrustedServiceId !== trustedServiceId
      ) {
        throw processorError("source.identity_materializer_service_mismatch");
      }

      const stability =
        observation.stability === "stable"
          ? ({ kind: "stable" } as const)
          : ({
              kind: "observation_ephemeral" as const,
              observation: sourceEvent.normalizedInboundEvent,
              observationKey: observation.observationKey
            } as const);
      const identityPreimage = canonicalizeInboxV2Json({
        domain: "core:inbox-v2.source-external-identity-key",
        version: "v1",
        tenantId: sourceEvent.tenantId,
        trustedServiceId,
        namespaceGeneration,
        realm: observation.realm,
        objectKindId: observation.objectKindId,
        scope: observation.scope,
        canonicalExternalSubject: observation.canonicalExternalSubject,
        stability
      });
      const digest = deriveTenantDigest(input.namespaceDeriver, {
        tenantId: sourceEvent.tenantId,
        trustedServiceId,
        namespaceGeneration,
        purpose: "source_identity_id",
        canonicalPreimage: identityPreimage
      });
      const authorizationDigest = deriveTenantDigest(input.namespaceDeriver, {
        tenantId: sourceEvent.tenantId,
        trustedServiceId,
        namespaceGeneration,
        purpose: "materialization_authorization",
        canonicalPreimage: canonicalizeInboxV2Json({
          domain: "core:inbox-v2.source-identity-materialization-authorization",
          version: "v1",
          tenantId: sourceEvent.tenantId,
          trustedServiceId,
          namespaceGeneration,
          sourceExternalIdentityDigest: digest
        })
      });
      const materializedAt = sourceEvent.recordedAt;

      return {
        tenantId: sourceEvent.tenantId,
        id: inboxV2SourceExternalIdentityIdSchema.parse(
          `source_external_identity:${digest}`
        ),
        realm: {
          realmId: observation.realm.realmId,
          version: observation.realm.realmVersion,
          canonicalizationVersion: observation.realm.canonicalizationVersion
        },
        objectKindId: observation.objectKindId,
        scope: observation.scope,
        identityDeclaration: observation.identityDeclaration,
        materializationAuthority: {
          kind: "trusted_service",
          tenantId: sourceEvent.tenantId,
          trustedServiceId,
          authorizationToken: `identity-materialization:${namespaceGeneration}:${authorizationDigest}`,
          authorizedAt: materializedAt
        },
        materializedAt,
        canonicalExternalSubject: observation.canonicalExternalSubject,
        stability,
        createdAt: materializedAt
      };
    }
  });
  trustedMaterializers.add(materializer);
  return materializer;
}

/**
 * Resolves one authenticated SRC-003 normalized envelope. This boundary owns
 * only source identities, append-only assessments and deferred participant
 * intents. Conversation selection, membership, RBAC, CRM, watchers, read state
 * and WorkItems are deliberately absent from its dependency surface. Each
 * repository operation is independently transactional; deterministic keyed
 * identity IDs and per-event assessment idempotency keys make a partially
 * completed batch restartable, and no batch is returned for publication until
 * every distinct identity has completed.
 */
export function createInboxV2SourceIdentityResolutionProcessor(
  options: InboxV2SourceIdentityResolutionProcessorOptions
): InboxV2SourceIdentityResolutionProcessor {
  assertExactOptions(options);
  if (!trustedMaterializers.has(options.materializer as object)) {
    throw processorError("source.identity_materializer_untrusted");
  }

  return Object.freeze({
    async process(input) {
      const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
      const normalizedEventId = inboxV2NormalizedInboundEventIdSchema.parse(
        input.normalizedEventId
      );
      const loaded =
        await options.resolutionRepository.readNormalizedEventForResolution({
          tenantId,
          normalizedEventId
        });
      if (loaded === null) return { kind: "normalized_event_not_found" };
      const sourceEvent =
        inboxV2SourceNormalizedEventForIdentityResolutionSchema.parse(loaded);

      const observations: InboxV2SourceIdentityObservationRecord[] = [];
      const observationsByIdentity = new Map<
        string,
        {
          identity: InboxV2SourceExternalIdentity;
          observation: InboxV2SourceNormalizedIdentityObservation;
          records: InboxV2SourceIdentityObservationRecord[];
        }
      >();
      const historicalAssessmentsByIdentity = new Map<
        string,
        PersistedInboxV2SourceIdentityAssessment | null
      >();

      for (const observation of sourceEvent.identityObservations) {
        const materialization = options.materializer.materialize({
          sourceEvent,
          observation
        });
        const identityId = String(materialization.id);
        const existingGroup = observationsByIdentity.get(identityId);
        let historical = historicalAssessmentsByIdentity.get(identityId);
        let identity = existingGroup?.identity;
        if (existingGroup === undefined) {
          const operation = buildAssessmentOperation({
            tenantId,
            normalizedEventId,
            sourceExternalIdentityId: materialization.id
          });
          historical =
            await options.resolutionRepository.findAssessmentByOperation({
              tenantId,
              ...operation
            });
          historicalAssessmentsByIdentity.set(identityId, historical);
          identity =
            historical === null
              ? await materializeIdentity(
                  options.identityRepository,
                  materialization
                )
              : await rehydratePersistedAssessmentIdentity({
                  repository: options.identityRepository,
                  materialization,
                  persisted: historical
                });
        }
        if (identity === undefined) {
          throw processorError(
            "source.identity_assessment_persistence_mismatch"
          );
        }

        const record = buildObservationRecord(
          sourceEvent,
          observation,
          identity
        );
        observations.push(record);
        const group = observationsByIdentity.get(identityId);
        if (group === undefined) {
          observationsByIdentity.set(identityId, {
            identity,
            observation,
            records: [record]
          });
        } else {
          if (
            canonicalizeInboxV2Json(group.identity) !==
            canonicalizeInboxV2Json(identity)
          ) {
            throw processorError("source.identity_materialization_conflict");
          }
          group.records.push(record);
        }
      }

      const resolutions = [];
      for (const group of observationsByIdentity.values()) {
        const { assessmentId, idempotencyKey } = buildAssessmentOperation({
          tenantId,
          normalizedEventId,
          sourceExternalIdentityId: group.identity.id
        });
        const historical =
          historicalAssessmentsByIdentity.get(String(group.identity.id)) ??
          null;
        if (historical !== null) {
          if (
            historical.assessmentId !== assessmentId ||
            historical.idempotencyKey !== idempotencyKey ||
            historical.tenantId !== tenantId ||
            historical.sourceExternalIdentityId !== group.identity.id ||
            historical.normalizedEventId !== normalizedEventId ||
            historical.observationKey !== group.observation.observationKey ||
            historical.safeEnvelopeHmacSha256 !==
              sourceEvent.safeEnvelopeHmacSha256
          ) {
            throw processorError(
              "source.identity_assessment_persistence_mismatch"
            );
          }
          resolutions.push(
            parseResolutionRecord({
              tenantId,
              observation: group.records[0]!,
              identity: group.identity,
              previousAssessmentRevision: historical.previousAssessmentVersion,
              assessmentRevision: historical.assessmentVersion,
              evidence: historical.evidence,
              candidates: historical.candidates,
              assessment: historical.assessment
            })
          );
          continue;
        }
        const current =
          await options.resolutionRepository.findCurrentAssessment({
            tenantId,
            sourceExternalIdentityId: group.identity.id
          });
        const replay = current?.assessmentId === assessmentId;
        if (replay) {
          if (
            current.idempotencyKey !== idempotencyKey ||
            current.tenantId !== tenantId ||
            current.sourceExternalIdentityId !== group.identity.id ||
            current.normalizedEventId !== normalizedEventId ||
            current.observationKey !== group.observation.observationKey ||
            current.safeEnvelopeHmacSha256 !==
              sourceEvent.safeEnvelopeHmacSha256
          ) {
            throw processorError(
              "source.identity_assessment_persistence_mismatch"
            );
          }
          const replayIdentity = await rehydratePersistedAssessmentIdentity({
            repository: options.identityRepository,
            materialization: options.materializer.materialize({
              sourceEvent,
              observation: group.observation
            }),
            persisted: current
          });
          resolutions.push(
            parseResolutionRecord({
              tenantId,
              observation: group.records[0]!,
              identity: replayIdentity,
              previousAssessmentRevision: current.previousAssessmentVersion,
              assessmentRevision: current.assessmentVersion,
              evidence: current.evidence,
              candidates: current.candidates,
              assessment: current.assessment
            })
          );
          continue;
        }
        const assessmentIdentity = group.identity;
        const plan = await options.assessmentPlanner.plan({
          sourceEvent,
          observation: group.observation,
          identity: assessmentIdentity,
          currentAssessment: current
        });
        const evidence = plan.evidence.map((item) =>
          inboxV2SourceIdentityResolutionEvidenceSchema.parse(item)
        );
        const candidates = plan.candidates.map((item) =>
          inboxV2SourceIdentityResolutionCandidateSchema.parse(item)
        );
        const assessment = inboxV2SourceIdentityAssessmentSchema.parse(
          plan.assessment
        );

        const expectedAssessmentVersion = current?.assessmentVersion ?? null;
        const nextAssessmentVersion = incrementRevision(
          expectedAssessmentVersion
        );
        const plannedRecord = parseResolutionRecord({
          tenantId,
          observation: group.records[0]!,
          identity: assessmentIdentity,
          previousAssessmentRevision: expectedAssessmentVersion,
          assessmentRevision: nextAssessmentVersion,
          evidence,
          candidates,
          assessment
        });

        const persisted = await options.resolutionRepository.applyAssessment({
          tenantId,
          normalizedEventId,
          observationKey: group.observation.observationKey,
          sourceExternalIdentityId: group.identity.id,
          assessmentId,
          idempotencyKey,
          expectedAssessmentVersion,
          evidence,
          candidates,
          assessment
        });
        if (
          persisted.kind !== "applied" &&
          persisted.kind !== "already_applied"
        ) {
          throw processorError(
            "source.identity_assessment_persistence_conflict",
            persisted.kind === "version_conflict"
          );
        }
        if (
          persisted.assessment.assessmentId !== assessmentId ||
          persisted.assessment.idempotencyKey !== idempotencyKey ||
          persisted.assessment.sourceExternalIdentityId !== group.identity.id ||
          persisted.assessment.normalizedEventId !== normalizedEventId ||
          persisted.assessment.observationKey !==
            group.observation.observationKey ||
          persisted.assessment.safeEnvelopeHmacSha256 !==
            sourceEvent.safeEnvelopeHmacSha256 ||
          canonicalizeInboxV2Json(persisted.assessment.evidence) !==
            canonicalizeInboxV2Json(evidence) ||
          canonicalizeInboxV2Json(persisted.assessment.candidates) !==
            canonicalizeInboxV2Json(candidates) ||
          canonicalizeInboxV2Json(persisted.assessment.assessment) !==
            canonicalizeInboxV2Json(assessment)
        ) {
          throw processorError(
            "source.identity_assessment_persistence_mismatch"
          );
        }

        const persistedIdentity = await rehydratePersistedAssessmentIdentity({
          repository: options.identityRepository,
          materialization: options.materializer.materialize({
            sourceEvent,
            observation: group.observation
          }),
          persisted: persisted.assessment
        });
        const record = parseResolutionRecord({
          tenantId,
          observation: group.records[0]!,
          identity: persistedIdentity,
          previousAssessmentRevision:
            persisted.assessment.previousAssessmentVersion,
          assessmentRevision: persisted.assessment.assessmentVersion,
          evidence: persisted.assessment.evidence,
          candidates: persisted.assessment.candidates,
          assessment: persisted.assessment.assessment
        });
        if (
          persisted.kind === "applied" &&
          canonicalizeInboxV2Json(record) !==
            canonicalizeInboxV2Json(plannedRecord)
        ) {
          throw processorError(
            "source.identity_assessment_persistence_mismatch"
          );
        }
        resolutions.push(record);
      }

      const completedAt = latestTimestamp([
        sourceEvent.recordedAt,
        ...resolutions.map((resolution) => resolution.assessment.assessedAt)
      ]);
      const deferredParticipantIntents = [
        ...observationsByIdentity.values()
      ].map((group) =>
        buildDeferredParticipantIntent(sourceEvent, group.records, completedAt)
      );
      const batch = inboxV2SourceIdentityResolutionBatchSchema.parse({
        tenantId,
        sourceEvent,
        observations,
        resolutions,
        deferredParticipantIntents,
        completedAt
      });
      return { kind: "completed", batch };
    }
  });
}

function buildObservationRecord(
  sourceEvent: InboxV2SourceNormalizedEventForIdentityResolution,
  observation: InboxV2SourceNormalizedIdentityObservation,
  identity: InboxV2SourceExternalIdentity
): InboxV2SourceIdentityObservationRecord {
  const sourceExternalIdentityMaterialization =
    inboxV2SourceIdentityMaterializationSnapshotSchema.parse({
      tenantId: identity.tenantId,
      id: identity.id,
      realm: identity.realm,
      objectKindId: identity.objectKindId,
      scope: identity.scope,
      identityDeclaration: identity.identityDeclaration,
      materializationAuthority: identity.materializationAuthority,
      materializedAt: identity.materializedAt,
      canonicalExternalSubject: identity.canonicalExternalSubject,
      stability: identity.stability,
      createdAt: identity.createdAt
    });
  return inboxV2SourceIdentityObservationRecordSchema.parse({
    tenantId: sourceEvent.tenantId,
    normalizedInboundEvent: sourceEvent.normalizedInboundEvent,
    observationKey: observation.observationKey,
    purpose: observation.purpose,
    sourceConnection: sourceEvent.sourceConnection,
    sourceAccount: sourceEvent.sourceAccount,
    adapterContract: sourceEvent.adapterContract,
    safeEnvelopeHmacSha256: sourceEvent.safeEnvelopeHmacSha256,
    observedExternalSubject: observation.observedExternalSubject,
    sourceExternalIdentityMaterialization,
    observedAt: observation.observedAt,
    recordedAt: sourceEvent.recordedAt,
    revision: "1"
  });
}

async function materializeIdentity(
  repository: InboxV2SourceExternalIdentityRepository,
  input: Parameters<InboxV2SourceExternalIdentityRepository["findOrCreate"]>[0]
): Promise<InboxV2SourceExternalIdentity> {
  const materialized = await repository.findOrCreate(input);
  if (
    materialized.kind !== "created" &&
    materialized.kind !== "already_exists"
  ) {
    throw processorError("source.identity_materialization_conflict");
  }
  return materialized.record;
}

async function rehydratePersistedAssessmentIdentity(input: {
  repository: InboxV2SourceExternalIdentityRepository;
  materialization: Parameters<
    InboxV2SourceExternalIdentityRepository["findOrCreate"]
  >[0];
  persisted: PersistedInboxV2SourceIdentityAssessment;
}): Promise<InboxV2SourceExternalIdentity> {
  const live = await input.repository.findById({
    tenantId: input.materialization.tenantId,
    id: input.materialization.id
  });
  if (live === null) {
    throw processorError("source.identity_assessment_persistence_mismatch");
  }

  const expectedImmutableDerivation = {
    tenantId: input.materialization.tenantId,
    id: input.materialization.id,
    realm: input.materialization.realm,
    objectKindId: input.materialization.objectKindId,
    scope: input.materialization.scope,
    identityDeclaration: input.materialization.identityDeclaration,
    canonicalExternalSubject: input.materialization.canonicalExternalSubject,
    stability: input.materialization.stability,
    materializationAuthority: {
      kind: input.materialization.materializationAuthority.kind,
      tenantId: input.materialization.materializationAuthority.tenantId,
      trustedServiceId:
        input.materialization.materializationAuthority.trustedServiceId,
      authorizationToken:
        input.materialization.materializationAuthority.authorizationToken
    }
  };
  const liveImmutableDerivation = {
    tenantId: live.tenantId,
    id: live.id,
    realm: live.realm,
    objectKindId: live.objectKindId,
    scope: live.scope,
    identityDeclaration: live.identityDeclaration,
    canonicalExternalSubject: live.canonicalExternalSubject,
    stability: live.stability,
    materializationAuthority: {
      kind: live.materializationAuthority.kind,
      tenantId: live.materializationAuthority.tenantId,
      trustedServiceId: live.materializationAuthority.trustedServiceId,
      authorizationToken: live.materializationAuthority.authorizationToken
    }
  };
  const liveFact = calculateInboxV2SourceIdentitySubjectlessFact(live);
  if (
    input.persisted.tenantId !== live.tenantId ||
    input.persisted.sourceExternalIdentityId !== live.id ||
    canonicalizeInboxV2Json(expectedImmutableDerivation) !==
      canonicalizeInboxV2Json(liveImmutableDerivation) ||
    input.persisted.sourceExternalIdentityFact.materializationDigestSha256 !==
      liveFact.materializationDigestSha256 ||
    input.persisted.sourceExternalIdentityFact.materializedAt !==
      live.materializedAt
  ) {
    throw processorError("source.identity_assessment_persistence_mismatch");
  }

  const fact = input.persisted.sourceExternalIdentityFact;
  let resolution: InboxV2SourceExternalIdentity["resolution"];
  if (fact.resolutionStatus === "claimed") {
    if (
      input.persisted.claim === null ||
      String(input.persisted.claim.claimVersion) !==
        String(fact.latestClaimVersion) ||
      !persistedClaimMatchesAssessment(input.persisted)
    ) {
      throw processorError("source.identity_assessment_persistence_mismatch");
    }
    resolution = {
      status: "claimed",
      activeClaim: {
        tenantId: live.tenantId,
        kind: "source_identity_claim",
        id: inboxV2SourceIdentityClaimIdSchema.parse(
          input.persisted.claim.claimId
        )
      }
    };
  } else {
    if (input.persisted.claim !== null) {
      throw processorError("source.identity_assessment_persistence_mismatch");
    }
    resolution = { status: fact.resolutionStatus };
  }

  try {
    return inboxV2SourceExternalIdentitySchema.parse({
      ...live,
      resolution,
      latestClaimVersion: fact.latestClaimVersion,
      revision: fact.identityRevision,
      updatedAt: fact.identityUpdatedAt
    });
  } catch (cause) {
    throw new InboxV2SourceIdentityResolutionProcessorError(
      "source.identity_assessment_persistence_mismatch",
      { cause }
    );
  }
}

function persistedClaimMatchesAssessment(
  persisted: PersistedInboxV2SourceIdentityAssessment
): boolean {
  const claim = persisted.claim;
  const assessment = persisted.assessment;
  if (claim === null) return false;
  if (assessment.outcome === "resolved_employee") {
    return (
      claim.kind === "employee" &&
      claim.claimId === assessment.claim.id &&
      String(claim.claimVersion) === String(assessment.claimVersion) &&
      claim.employeeId === assessment.employee.id
    );
  }
  if (assessment.outcome === "resolved_client_contact") {
    return (
      claim.kind === "client_contact" &&
      claim.claimId === assessment.claim.id &&
      String(claim.claimVersion) === String(assessment.claimVersion) &&
      claim.clientContactId === assessment.clientContact.id
    );
  }
  return false;
}

function buildAssessmentOperation(input: {
  tenantId: string;
  normalizedEventId: string;
  sourceExternalIdentityId: string;
}): Readonly<{ assessmentId: string; idempotencyKey: string }> {
  const operationDigest = String(
    calculateInboxV2CanonicalSha256({
      domain: "core:inbox-v2.source-identity-resolution-operation",
      version: "v1",
      tenantId: input.tenantId,
      normalizedEventId: input.normalizedEventId,
      sourceExternalIdentityId: input.sourceExternalIdentityId
    })
  ).slice("sha256:".length);
  return Object.freeze({
    assessmentId: `source_identity_assessment:${operationDigest}`,
    idempotencyKey: `source:v2:identity-resolution:${operationDigest}`
  });
}

function parseResolutionRecord(input: {
  tenantId: string;
  observation: InboxV2SourceIdentityObservationRecord;
  identity: InboxV2SourceExternalIdentity;
  previousAssessmentRevision: InboxV2EntityRevision | null;
  assessmentRevision: InboxV2EntityRevision;
  evidence: readonly InboxV2SourceIdentityResolutionEvidence[];
  candidates: readonly InboxV2SourceIdentityResolutionCandidate[];
  assessment: InboxV2SourceIdentityAssessment;
}) {
  try {
    return inboxV2SourceIdentityResolutionRecordSchema.parse({
      tenantId: input.tenantId,
      observation: input.observation,
      sourceExternalIdentitySnapshot: input.identity,
      previousAssessmentRevision: input.previousAssessmentRevision,
      assessmentRevision: input.assessmentRevision,
      evidence: input.evidence,
      candidates: input.candidates,
      assessment: input.assessment
    });
  } catch (cause) {
    throw new InboxV2SourceIdentityResolutionProcessorError(
      "source.identity_assessment_plan_invalid",
      { cause }
    );
  }
}

function buildDeferredParticipantIntent(
  sourceEvent: InboxV2SourceNormalizedEventForIdentityResolution,
  records: readonly InboxV2SourceIdentityObservationRecord[],
  recordedAt: string
): InboxV2DeferredParticipantIntent {
  const identity = records[0]!.sourceExternalIdentityMaterialization;
  return {
    key: {
      tenantId: sourceEvent.tenantId,
      externalThreadKey: sourceEvent.thread.key,
      sourceExternalIdentity: {
        tenantId: sourceEvent.tenantId,
        kind: "source_external_identity",
        id: identity.id
      }
    },
    externalThreadContext: sourceEvent.thread,
    inducingObservations: records.map((record) => ({
      normalizedInboundEvent: sourceEvent.normalizedInboundEvent,
      safeEnvelopeHmacSha256: sourceEvent.safeEnvelopeHmacSha256,
      observationKey: record.observationKey,
      purpose: record.purpose
    })),
    membershipAuthority: records.some(
      (record) =>
        record.purpose === "membership_subject" ||
        record.purpose === "roster_member"
    )
      ? "provider_evidence_required"
      : "none",
    recordedAt,
    revision: "1"
  };
}

function incrementRevision(
  revision: InboxV2EntityRevision | null
): InboxV2EntityRevision {
  const next = (revision === null ? 1n : BigInt(revision) + 1n).toString();
  return inboxV2EntityRevisionSchema.parse(next);
}

function latestTimestamp(timestamps: readonly string[]): string {
  return timestamps.reduce((latest, candidate) =>
    Date.parse(candidate) > Date.parse(latest) ? candidate : latest
  );
}

function deriveTenantDigest(
  deriver: InboxV2SourceIdentityNamespaceDeriver,
  input: Parameters<
    InboxV2SourceIdentityNamespaceDeriver["deriveNamespaceHmacSha256"]
  >[0]
): string {
  const digest = deriver.deriveNamespaceHmacSha256(input);
  if (!/^[a-f0-9]{64}$/u.test(digest)) {
    throw new TypeError(
      "Tenant source identity key deriver must return a lowercase HMAC-SHA256 digest."
    );
  }
  return digest;
}

function assertExactOptions(
  options: InboxV2SourceIdentityResolutionProcessorOptions
): void {
  for (const key of Object.keys(options)) {
    if (!PROCESSOR_OPTION_KEYS.has(key)) {
      throw new TypeError(`Unknown source identity resolver option: ${key}`);
    }
  }
}

function processorError(
  code: InboxV2SourceIdentityResolutionProcessorErrorCode,
  retryable = false
): InboxV2SourceIdentityResolutionProcessorError {
  return new InboxV2SourceIdentityResolutionProcessorError(code, {
    retryable
  });
}
