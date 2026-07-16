import {
  inboxV2AdapterContractSnapshotSchema,
  inboxV2ClientContactReferenceSchema,
  inboxV2EmployeeReferenceSchema,
  inboxV2EntityRevisionSchema,
  inboxV2NormalizedInboundEventReferenceSchema,
  inboxV2SourceAccountReferenceSchema,
  inboxV2SourceConnectionReferenceSchema,
  inboxV2SourceIdentityClaimReferenceSchema,
  inboxV2SourceIdentityClaimVersionSchema,
  inboxV2SourceNormalizedEventForIdentityResolutionSchema,
  inboxV2SourceNormalizedIdentityObservationSchema,
  inboxV2TenantIdSchema,
  type InboxV2SourceExternalIdentity,
  type InboxV2SourceIdentityResolutionCandidate,
  type InboxV2SourceIdentityResolutionEvidence,
  type InboxV2SourceNormalizedIdentityObservation
} from "@hulee/contracts";
import {
  calculateInboxV2SourceIdentitySubjectlessFact,
  type ApplyInboxV2SourceIdentityAssessmentInput,
  type InboxV2SourceExternalIdentityRepository,
  type InboxV2SourceIdentityResolutionRepository,
  type PersistedInboxV2SourceIdentityAssessment
} from "@hulee/db";
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  createInboxV2SourceIdentityResolutionProcessor,
  createInboxV2TrustedSourceIdentityMaterializer,
  InboxV2SourceIdentityResolutionProcessorError,
  type InboxV2SourceIdentityAssessmentPlan,
  type InboxV2SourceIdentityAssessmentPlanner,
  type InboxV2SourceIdentityNamespaceDeriver,
  type InboxV2TrustedSourceIdentityMaterializer
} from "./source-identity-resolution-processor";

const tenantId = inboxV2TenantIdSchema.parse("tenant:alpha");
const t0 = "2026-07-17T07:00:00.000Z";
const t1 = "2026-07-17T07:01:00.000Z";
const t2 = "2026-07-17T07:02:00.000Z";
const t3 = "2026-07-17T07:03:00.000Z";
const safeEnvelopeHmacSha256 = `hmac-sha256:${"a".repeat(64)}`;
const sourceConnection = inboxV2SourceConnectionReferenceSchema.parse({
  tenantId,
  kind: "source_connection",
  id: "source_connection:synthetic-1"
});
const sourceAccount = inboxV2SourceAccountReferenceSchema.parse({
  tenantId,
  kind: "source_account",
  id: "source_account:synthetic-1"
});
const normalizedInboundEvent =
  inboxV2NormalizedInboundEventReferenceSchema.parse({
    tenantId,
    kind: "normalized_inbound_event",
    id: "normalized_inbound_event:event-1"
  });
const employee = inboxV2EmployeeReferenceSchema.parse({
  tenantId,
  kind: "employee",
  id: "employee:operator-1"
});
const clientContact = inboxV2ClientContactReferenceSchema.parse({
  tenantId,
  kind: "client_contact",
  id: "client_contact:contact-1"
});
const employeeClaim = inboxV2SourceIdentityClaimReferenceSchema.parse({
  tenantId,
  kind: "source_identity_claim",
  id: "source_identity_claim:employee-claim-1"
});
const clientContactClaim = inboxV2SourceIdentityClaimReferenceSchema.parse({
  tenantId,
  kind: "source_identity_claim",
  id: "source_identity_claim:contact-claim-1"
});
const claimVersion = inboxV2SourceIdentityClaimVersionSchema.parse("1");
const initialRevision = inboxV2EntityRevisionSchema.parse("1");
const claimedRevision = inboxV2EntityRevisionSchema.parse("2");
const adapterContract = inboxV2AdapterContractSnapshotSchema.parse({
  contractId: "module:synthetic:source-adapter",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "core:direct-messenger",
  loadedByTrustedServiceId: "core:source-runtime",
  loadedAt: t0
});

function observation(input: {
  key: string;
  subject: string;
  purpose?:
    | "message_author"
    | "action_actor"
    | "membership_subject"
    | "roster_member";
}): InboxV2SourceNormalizedIdentityObservation {
  return inboxV2SourceNormalizedIdentityObservationSchema.parse({
    observationKey: input.key,
    purpose: input.purpose ?? "message_author",
    identityDeclaration: {
      adapterContract,
      identityKind: "source_external_identity",
      realmId: "module:synthetic:sender-realm",
      realmVersion: "v1",
      canonicalizationVersion: "v1",
      objectKindId: "module:synthetic:provider-user",
      scopeKind: "source_account",
      decisionStrength: "safe_default"
    },
    realm: {
      realmId: "module:synthetic:sender-realm",
      realmVersion: "v1",
      canonicalizationVersion: "v1"
    },
    scope: { kind: "source_account", owner: sourceAccount },
    objectKindId: "module:synthetic:provider-user",
    observedExternalSubject: input.subject,
    canonicalExternalSubject: input.subject,
    stability: "stable",
    observedAt: t1
  });
}

function sourceEvent(
  observations: readonly InboxV2SourceNormalizedIdentityObservation[],
  input: {
    normalizedEventId?: string;
    rawEventId?: string;
  } = {}
) {
  const threadSubject = "Group-CaseSensitive-1";
  const eventNormalizedInboundEvent =
    inboxV2NormalizedInboundEventReferenceSchema.parse({
      tenantId,
      kind: "normalized_inbound_event",
      id: input.normalizedEventId ?? normalizedInboundEvent.id
    });
  return inboxV2SourceNormalizedEventForIdentityResolutionSchema.parse({
    tenantId,
    rawInboundEvent: {
      tenantId,
      kind: "raw_inbound_event",
      id: input.rawEventId ?? "raw_inbound_event:raw-1"
    },
    normalizedInboundEvent: eventNormalizedInboundEvent,
    sourceConnection,
    sourceAccount,
    domain: "core:inbox-v2.normalized-event-safe-envelope",
    schemaId: "core:inbox-v2.normalized-event-envelope",
    schemaVersion: "v1",
    safeEnvelopeHmacSha256,
    adapterContract,
    thread: {
      sourceConnection,
      sourceAccount,
      identityDeclaration: {
        adapterContract,
        identityKind: "external_thread",
        realmId: "module:synthetic:thread-realm",
        realmVersion: "v1",
        canonicalizationVersion: "v1",
        objectKindId: "module:synthetic:group",
        scopeKind: "source_account",
        decisionStrength: "safe_default"
      },
      key: {
        realm: {
          realmId: "module:synthetic:thread-realm",
          realmVersion: "v1",
          canonicalizationVersion: "v1"
        },
        scope: { kind: "source_account", owner: sourceAccount },
        objectKindId: "module:synthetic:group",
        canonicalExternalSubject: threadSubject
      },
      observedExternalSubject: threadSubject
    },
    identityObservations: observations,
    rosterObservation: null,
    recordedAt: t2
  });
}

function identityHead(
  input: Parameters<InboxV2SourceExternalIdentityRepository["findOrCreate"]>[0]
): InboxV2SourceExternalIdentity {
  if (input.canonicalExternalSubject === "employee") {
    return {
      ...input,
      resolution: { status: "claimed", activeClaim: employeeClaim },
      latestClaimVersion: claimVersion,
      revision: claimedRevision,
      updatedAt: t2
    };
  }
  if (input.canonicalExternalSubject === "contact") {
    return {
      ...input,
      resolution: { status: "claimed", activeClaim: clientContactClaim },
      latestClaimVersion: claimVersion,
      revision: claimedRevision,
      updatedAt: t2
    };
  }
  return {
    ...input,
    resolution: { status: "unresolved" },
    latestClaimVersion: null,
    revision: initialRevision,
    updatedAt: input.createdAt
  };
}

function identityRepository(input?: { conflict?: boolean }) {
  const records = new Map<string, InboxV2SourceExternalIdentity>();
  const recordsByScopedSubject = new Map<
    string,
    InboxV2SourceExternalIdentity
  >();
  const findOrCreate = vi.fn<
    InboxV2SourceExternalIdentityRepository["findOrCreate"]
  >(async (candidate) => {
    const existing = records.get(String(candidate.id));
    const existingByScopedSubject = recordsByScopedSubject.get(
      candidate.canonicalExternalSubject
    );
    const record =
      existing ?? existingByScopedSubject ?? identityHead(candidate);
    if (!existing && !existingByScopedSubject) {
      records.set(String(candidate.id), record);
      recordsByScopedSubject.set(candidate.canonicalExternalSubject, record);
    }
    return input?.conflict || (!existing && existingByScopedSubject)
      ? { kind: "scoped_key_conflict" as const, record }
      : {
          kind: existing ? ("already_exists" as const) : ("created" as const),
          record
        };
  });
  const findById = vi.fn(
    async ({ id }: { id: string }) => records.get(String(id)) ?? null
  );
  return {
    findOrCreate,
    findById,
    findRecord: (id: string) => records.get(id) ?? null,
    updateRecord(
      id: string,
      update: (
        record: InboxV2SourceExternalIdentity
      ) => InboxV2SourceExternalIdentity
    ) {
      const current = records.get(id);
      if (current === undefined) throw new Error("Test identity is missing.");
      const next = update(current);
      records.set(id, next);
      recordsByScopedSubject.set(next.canonicalExternalSubject, next);
    },
    deleteRecord(id: string) {
      const current = records.get(id);
      records.delete(id);
      if (current !== undefined) {
        recordsByScopedSubject.delete(current.canonicalExternalSubject);
      }
    },
    value: {
      findOrCreate,
      findById
    } satisfies InboxV2SourceExternalIdentityRepository
  };
}

function resolutionRepository(
  eventInput:
    | ReturnType<typeof sourceEvent>
    | readonly ReturnType<typeof sourceEvent>[],
  input?: {
    applyConflict?: boolean;
    persistenceMismatch?: boolean;
    failObservationKeyOnce?: string;
  }
) {
  const events = Array.isArray(eventInput) ? eventInput : [eventInput];
  const assessmentsByOperation = new Map<
    string,
    PersistedInboxV2SourceIdentityAssessment
  >();
  const currentAssessments = new Map<
    string,
    PersistedInboxV2SourceIdentityAssessment
  >();
  let persistedCount = 0;
  let failedConfiguredObservation = false;
  let identityLookup = (_id: string): InboxV2SourceExternalIdentity | null =>
    null;
  const readNormalizedEventForResolution = vi.fn(
    async ({ normalizedEventId }: { normalizedEventId: string }) =>
      events.find(
        (event) => event.normalizedInboundEvent.id === normalizedEventId
      ) ?? null
  );
  const findAssessmentByOperation = vi.fn(
    async ({ assessmentId, idempotencyKey }) => {
      const byId = assessmentsByOperation.get(assessmentId) ?? null;
      const byKey =
        [...assessmentsByOperation.values()].find(
          (assessment) => assessment.idempotencyKey === idempotencyKey
        ) ?? null;
      if (byId !== null && byKey !== null && byId !== byKey) {
        throw new Error("Test operation lookup conflict.");
      }
      return byId ?? byKey;
    }
  );
  const findCurrentAssessment = vi.fn(
    async ({ sourceExternalIdentityId }) =>
      currentAssessments.get(String(sourceExternalIdentityId)) ?? null
  );
  const applyAssessment = vi.fn(
    async (candidate: ApplyInboxV2SourceIdentityAssessmentInput) => {
      if (
        input?.applyConflict ||
        (input?.failObservationKeyOnce === candidate.observationKey &&
          !failedConfiguredObservation)
      ) {
        failedConfiguredObservation = true;
        return {
          kind: "version_conflict" as const,
          currentVersion: null,
          currentAssessmentId: null
        };
      }
      const existing = assessmentsByOperation.get(candidate.assessmentId);
      if (existing)
        return { kind: "already_applied" as const, assessment: existing };
      persistedCount += 1;
      const sourceExternalIdentity = identityLookup(
        String(candidate.sourceExternalIdentityId)
      );
      if (sourceExternalIdentity === null) {
        throw new Error("Test identity fixture is missing.");
      }
      const baseAssessment = persistedAssessment(
        candidate,
        sourceExternalIdentity
      );
      const assessment = input?.persistenceMismatch
        ? {
            ...baseAssessment,
            assessmentId: "source_identity_assessment:mismatch"
          }
        : baseAssessment;
      assessmentsByOperation.set(candidate.assessmentId, assessment);
      currentAssessments.set(
        String(candidate.sourceExternalIdentityId),
        assessment
      );
      return { kind: "applied" as const, assessment };
    }
  );
  return {
    applyAssessment,
    findAssessmentByOperation,
    findCurrentAssessment,
    persistedCount: () => persistedCount,
    setIdentityLookup(
      lookup: (id: string) => InboxV2SourceExternalIdentity | null
    ) {
      identityLookup = lookup;
    },
    value: {
      readNormalizedEventForResolution,
      findAssessmentByOperation,
      findCurrentAssessment,
      applyAssessment
    } satisfies InboxV2SourceIdentityResolutionRepository
  };
}

function persistedAssessment(
  input: ApplyInboxV2SourceIdentityAssessmentInput,
  sourceExternalIdentity: InboxV2SourceExternalIdentity
): PersistedInboxV2SourceIdentityAssessment {
  const outcome =
    input.assessment.outcome === "resolved_employee"
      ? "claimed_employee"
      : input.assessment.outcome === "resolved_client_contact"
        ? "claimed_client_contact"
        : input.assessment.outcome;
  const claim =
    input.assessment.outcome === "resolved_employee"
      ? {
          kind: "employee" as const,
          claimId: input.assessment.claim.id,
          claimVersion: input.assessment.claimVersion,
          employeeId: input.assessment.employee.id
        }
      : input.assessment.outcome === "resolved_client_contact"
        ? {
            kind: "client_contact" as const,
            claimId: input.assessment.claim.id,
            claimVersion: input.assessment.claimVersion,
            clientContactId: input.assessment.clientContact.id
          }
        : null;
  return {
    tenantId: input.tenantId,
    assessmentId: input.assessmentId,
    sourceExternalIdentityId: input.sourceExternalIdentityId,
    normalizedEventId: input.normalizedEventId,
    observationKey: input.observationKey,
    safeEnvelopeHmacSha256,
    previousAssessmentVersion: input.expectedAssessmentVersion,
    assessmentVersion: inboxV2EntityRevisionSchema.parse(
      input.expectedAssessmentVersion === null
        ? "1"
        : (BigInt(input.expectedAssessmentVersion) + 1n).toString()
    ),
    outcome,
    confidence: input.assessment.confidence,
    evidence: input.evidence,
    candidates: input.candidates,
    sourceExternalIdentityFact: calculateInboxV2SourceIdentitySubjectlessFact(
      sourceExternalIdentity
    ),
    assessment: input.assessment,
    assessmentDigestSha256: `sha256:${"b".repeat(64)}`,
    idempotencyKey: input.idempotencyKey,
    claim,
    assessedAt: input.assessment.assessedAt
  };
}

function adapterEvidence(
  source: InboxV2SourceNormalizedIdentityObservation,
  eventReference = normalizedInboundEvent
): InboxV2SourceIdentityResolutionEvidence {
  return {
    ordinal: 0,
    reference: {
      kind: "normalized_inbound_event",
      reference: eventReference
    },
    confidence: "verified",
    provenance: {
      kind: "adapter_observation",
      adapterContract,
      observationKey: source.observationKey
    },
    observedAt: source.observedAt
  };
}

function candidate(
  ordinal: number,
  target:
    | { kind: "employee"; employee: typeof employee }
    | { kind: "client_contact"; clientContact: typeof clientContact }
): InboxV2SourceIdentityResolutionCandidate {
  return {
    ordinal,
    target,
    confidence: "verified",
    evidenceOrdinals: [0]
  };
}

function planFor(
  source: InboxV2SourceNormalizedIdentityObservation,
  eventReference = normalizedInboundEvent
): InboxV2SourceIdentityAssessmentPlan {
  const evidence = [adapterEvidence(source, eventReference)];
  if (
    source.canonicalExternalSubject !== "conflicted" &&
    source.canonicalExternalSubject !== "employee" &&
    source.canonicalExternalSubject !== "contact"
  ) {
    return {
      evidence: [],
      candidates: [],
      assessment: {
        outcome: "unresolved",
        confidence: "none",
        reason: "no_candidate",
        evidenceOrdinals: [],
        candidateOrdinals: [],
        assessedAt: t3
      }
    };
  }
  if (source.canonicalExternalSubject === "conflicted") {
    return {
      evidence,
      candidates: [
        candidate(0, { kind: "employee", employee }),
        candidate(1, { kind: "client_contact", clientContact })
      ],
      assessment: {
        outcome: "conflicted",
        confidence: "verified",
        reason: "multiple_candidates",
        evidenceOrdinals: [0],
        candidateOrdinals: [0, 1],
        assessedAt: t3
      }
    };
  }
  if (source.canonicalExternalSubject === "employee") {
    return {
      evidence,
      candidates: [candidate(0, { kind: "employee", employee })],
      assessment: {
        outcome: "resolved_employee",
        confidence: "verified",
        evidenceOrdinals: [0],
        candidateOrdinal: 0,
        employee,
        claim: employeeClaim,
        claimVersion,
        assessedAt: t3
      }
    };
  }
  return {
    evidence,
    candidates: [candidate(0, { kind: "client_contact", clientContact })],
    assessment: {
      outcome: "resolved_client_contact",
      confidence: "verified",
      evidenceOrdinals: [0],
      candidateOrdinal: 0,
      clientContact,
      claim: clientContactClaim,
      claimVersion,
      assessedAt: t3
    }
  };
}

function planner(
  handler: InboxV2SourceIdentityAssessmentPlanner["plan"] = async ({
    observation: source,
    sourceEvent: event
  }) => planFor(source, event.normalizedInboundEvent)
) {
  const plan = vi.fn(handler);
  return {
    plan,
    value: { plan } satisfies InboxV2SourceIdentityAssessmentPlanner
  };
}

function identityNamespaceDeriver(
  secret: string,
  namespaceGeneration = "identity-namespace-v1",
  operationalWrappingKeyVersion = "kms-wrap-v1"
): InboxV2SourceIdentityNamespaceDeriver {
  // A wrapping-key rotation changes storage protection, not the stable identity
  // namespace secret or its derivation.
  void operationalWrappingKeyVersion;
  return {
    namespaceGeneration,
    deriveNamespaceHmacSha256(input) {
      return createHmac("sha256", secret)
        .update(JSON.stringify(input), "utf8")
        .digest("hex");
    }
  };
}

function createProcessor(input: {
  event: ReturnType<typeof sourceEvent>;
  identity?: ReturnType<typeof identityRepository>;
  resolution?: ReturnType<typeof resolutionRepository>;
  assessmentPlanner?: ReturnType<typeof planner>;
  materializer?: InboxV2TrustedSourceIdentityMaterializer;
}) {
  const identity = input.identity ?? identityRepository();
  const resolution = input.resolution ?? resolutionRepository(input.event);
  const assessmentPlanner = input.assessmentPlanner ?? planner();
  resolution.setIdentityLookup(identity.findRecord);
  return {
    identity,
    resolution,
    assessmentPlanner,
    processor: createInboxV2SourceIdentityResolutionProcessor({
      identityRepository: identity.value,
      resolutionRepository: resolution.value,
      assessmentPlanner: assessmentPlanner.value,
      materializer:
        input.materializer ??
        createInboxV2TrustedSourceIdentityMaterializer({
          trustedServiceId: "core:source-runtime",
          namespaceDeriver: identityNamespaceDeriver("tenant-secret-alpha")
        })
    })
  };
}

describe("Inbox V2 source identity resolution processor", () => {
  it("persists exactly one assessment for every distinct identity and returns all four outcomes", async () => {
    const event = sourceEvent([
      observation({ key: "observation-unresolved", subject: "unresolved" }),
      observation({ key: "observation-conflicted", subject: "conflicted" }),
      observation({ key: "observation-employee", subject: "employee" }),
      observation({ key: "observation-contact", subject: "contact" })
    ]);
    const fixture = createProcessor({ event });

    const result = await fixture.processor.process({
      tenantId,
      normalizedEventId: normalizedInboundEvent.id
    });

    expect(result.kind).toBe("completed");
    if (result.kind !== "completed") throw new Error("expected completion");
    expect(
      result.batch.resolutions.map((item) => item.assessment.outcome)
    ).toEqual([
      "unresolved",
      "conflicted",
      "resolved_employee",
      "resolved_client_contact"
    ]);
    expect(result.batch.observations).toHaveLength(4);
    expect(result.batch.deferredParticipantIntents).toHaveLength(4);
    expect(fixture.identity.findOrCreate).toHaveBeenCalledTimes(4);
    expect(fixture.assessmentPlanner.plan).toHaveBeenCalledTimes(4);
    expect(fixture.resolution.applyAssessment).toHaveBeenCalledTimes(4);
    expect(fixture.resolution.persistedCount()).toBe(4);
  });

  it("aggregates repeat observations of one stable identity into one assessment and one context-deferred intent", async () => {
    const event = sourceEvent([
      observation({ key: "author-repeat-1", subject: "unresolved" }),
      observation({
        key: "membership-repeat-2",
        subject: "unresolved",
        purpose: "membership_subject"
      })
    ]);
    const fixture = createProcessor({ event });

    const first = await fixture.processor.process({
      tenantId,
      normalizedEventId: normalizedInboundEvent.id
    });
    const replay = await fixture.processor.process({
      tenantId,
      normalizedEventId: normalizedInboundEvent.id
    });

    expect(first.kind).toBe("completed");
    expect(replay.kind).toBe("completed");
    if (first.kind !== "completed") throw new Error("expected completion");
    expect(first.batch.observations).toHaveLength(2);
    expect(first.batch.resolutions).toHaveLength(1);
    expect(first.batch.deferredParticipantIntents).toEqual([
      expect.objectContaining({
        membershipAuthority: "provider_evidence_required",
        inducingObservations: [
          expect.objectContaining({ observationKey: "author-repeat-1" }),
          expect.objectContaining({ observationKey: "membership-repeat-2" })
        ]
      })
    ]);
    expect(fixture.assessmentPlanner.plan).toHaveBeenCalledTimes(1);
    expect(fixture.resolution.applyAssessment).toHaveBeenCalledTimes(1);
    expect(fixture.resolution.persistedCount()).toBe(1);
  });

  it("replays an exact historical assessment after the identity head advances without replanning or writing", async () => {
    const firstEvent = sourceEvent(
      [observation({ key: "historical-author-1", subject: "unresolved" })],
      {
        normalizedEventId: "normalized_inbound_event:historical-1",
        rawEventId: "raw_inbound_event:historical-1"
      }
    );
    const secondEvent = sourceEvent(
      [observation({ key: "historical-author-2", subject: "unresolved" })],
      {
        normalizedEventId: "normalized_inbound_event:historical-2",
        rawEventId: "raw_inbound_event:historical-2"
      }
    );
    const identity = identityRepository();
    const resolution = resolutionRepository([firstEvent, secondEvent]);
    const assessmentPlanner = planner();
    const fixture = createProcessor({
      event: firstEvent,
      identity,
      resolution,
      assessmentPlanner
    });

    const first = await fixture.processor.process({
      tenantId,
      normalizedEventId: firstEvent.normalizedInboundEvent.id
    });
    const second = await fixture.processor.process({
      tenantId,
      normalizedEventId: secondEvent.normalizedInboundEvent.id
    });
    if (first.kind !== "completed") throw new Error("expected completion");
    const identityId = String(
      first.batch.observations[0]!.sourceExternalIdentityMaterialization.id
    );
    identity.updateRecord(identityId, (current) => ({
      ...current,
      resolution: { status: "claimed", activeClaim: employeeClaim },
      latestClaimVersion: claimVersion,
      revision: claimedRevision,
      updatedAt: t3
    }));
    const replay = await fixture.processor.process({
      tenantId,
      normalizedEventId: firstEvent.normalizedInboundEvent.id
    });

    expect(first).toMatchObject({
      kind: "completed",
      batch: {
        resolutions: [{ assessmentRevision: "1" }]
      }
    });
    expect(second).toMatchObject({
      kind: "completed",
      batch: {
        resolutions: [{ assessmentRevision: "2" }]
      }
    });
    expect(replay).toMatchObject({
      kind: "completed",
      batch: {
        resolutions: [
          {
            observation: { observationKey: "historical-author-1" },
            assessmentRevision: "1",
            sourceExternalIdentitySnapshot: {
              resolution: { status: "unresolved" },
              latestClaimVersion: null,
              revision: "1",
              updatedAt: t2
            }
          }
        ]
      }
    });
    expect(assessmentPlanner.plan).toHaveBeenCalledTimes(2);
    expect(resolution.applyAssessment).toHaveBeenCalledTimes(2);
    expect(identity.findOrCreate).toHaveBeenCalledTimes(2);
    expect(identity.findById).toHaveBeenCalledTimes(3);
    expect(resolution.persistedCount()).toBe(2);
  });

  it("fails closed when historical assessment rehydration cannot load its identity or its live subject drifts", async () => {
    const event = sourceEvent([
      observation({ key: "rehydrate-author-1", subject: "unresolved" })
    ]);

    const missingIdentity = identityRepository();
    const missingFixture = createProcessor({
      event,
      identity: missingIdentity
    });
    const missingFirst = await missingFixture.processor.process({
      tenantId,
      normalizedEventId: event.normalizedInboundEvent.id
    });
    if (missingFirst.kind !== "completed") {
      throw new Error("expected completion");
    }
    const missingId = String(
      missingFirst.batch.observations[0]!.sourceExternalIdentityMaterialization
        .id
    );
    missingIdentity.deleteRecord(missingId);
    await expect(
      missingFixture.processor.process({
        tenantId,
        normalizedEventId: event.normalizedInboundEvent.id
      })
    ).rejects.toMatchObject({
      code: "source.identity_assessment_persistence_mismatch"
    });
    expect(missingFixture.assessmentPlanner.plan).toHaveBeenCalledTimes(1);
    expect(missingFixture.resolution.applyAssessment).toHaveBeenCalledTimes(1);

    const driftIdentity = identityRepository();
    const driftFixture = createProcessor({ event, identity: driftIdentity });
    const driftFirst = await driftFixture.processor.process({
      tenantId,
      normalizedEventId: event.normalizedInboundEvent.id
    });
    if (driftFirst.kind !== "completed") throw new Error("expected completion");
    const driftId = String(
      driftFirst.batch.observations[0]!.sourceExternalIdentityMaterialization.id
    );
    driftIdentity.updateRecord(driftId, (current) => ({
      ...current,
      canonicalExternalSubject: "tampered-subject"
    }));
    await expect(
      driftFixture.processor.process({
        tenantId,
        normalizedEventId: event.normalizedInboundEvent.id
      })
    ).rejects.toMatchObject({
      code: "source.identity_assessment_persistence_mismatch"
    });
    expect(driftFixture.assessmentPlanner.plan).toHaveBeenCalledTimes(1);
    expect(driftFixture.resolution.applyAssessment).toHaveBeenCalledTimes(1);
  });

  it("derives opaque replay-stable IDs with the tenant key and resumes a partially completed batch idempotently", async () => {
    const opaqueSubject = "Raw-Subject-Must-Not-Leak-123";
    const firstObservation = observation({
      key: "restart-first-1",
      subject: opaqueSubject
    });
    const secondObservation = observation({
      key: "restart-second-2",
      subject: "second-subject"
    });
    const event = sourceEvent([firstObservation, secondObservation]);
    const keyA = createInboxV2TrustedSourceIdentityMaterializer({
      trustedServiceId: "core:source-runtime",
      namespaceDeriver: identityNamespaceDeriver("tenant-secret-a")
    });
    const keyAAfterWrappingKeyRotation =
      createInboxV2TrustedSourceIdentityMaterializer({
        trustedServiceId: "core:source-runtime",
        namespaceDeriver: identityNamespaceDeriver(
          "tenant-secret-a",
          "identity-namespace-v1",
          "kms-wrap-v2"
        )
      });
    const keyB = createInboxV2TrustedSourceIdentityMaterializer({
      trustedServiceId: "core:source-runtime",
      namespaceDeriver: identityNamespaceDeriver("tenant-secret-b")
    });
    const derivedA = keyA.materialize({
      sourceEvent: event,
      observation: firstObservation
    });
    const replayA = keyAAfterWrappingKeyRotation.materialize({
      sourceEvent: event,
      observation: firstObservation
    });
    const derivedB = keyB.materialize({
      sourceEvent: event,
      observation: firstObservation
    });
    expect(derivedA.id).toBe(replayA.id);
    expect(derivedA.materializationAuthority.authorizationToken).toBe(
      replayA.materializationAuthority.authorizationToken
    );
    expect(derivedA.id).not.toBe(derivedB.id);
    expect(derivedA.id).not.toContain(opaqueSubject);
    expect(derivedA.materializationAuthority.authorizationToken).not.toContain(
      opaqueSubject
    );

    const restartableRepository = resolutionRepository(event, {
      failObservationKeyOnce: "restart-second-2"
    });
    const fixture = createProcessor({
      event,
      resolution: restartableRepository,
      materializer: keyA
    });
    await expect(
      fixture.processor.process({
        tenantId,
        normalizedEventId: normalizedInboundEvent.id
      })
    ).rejects.toMatchObject({
      code: "source.identity_assessment_persistence_conflict",
      retryable: true
    });
    expect(restartableRepository.persistedCount()).toBe(1);

    await expect(
      fixture.processor.process({
        tenantId,
        normalizedEventId: normalizedInboundEvent.id
      })
    ).resolves.toMatchObject({
      kind: "completed",
      batch: { resolutions: expect.any(Array) }
    });
    expect(restartableRepository.persistedCount()).toBe(2);

    const sharedIdentityRepository = identityRepository();
    const oneObservationEvent = sourceEvent([firstObservation]);
    const initialNamespace = createProcessor({
      event: oneObservationEvent,
      identity: sharedIdentityRepository,
      materializer: keyA
    });
    await expect(
      initialNamespace.processor.process({
        tenantId,
        normalizedEventId: normalizedInboundEvent.id
      })
    ).resolves.toMatchObject({ kind: "completed" });

    const changedGeneration = createProcessor({
      event: oneObservationEvent,
      identity: sharedIdentityRepository,
      materializer: createInboxV2TrustedSourceIdentityMaterializer({
        trustedServiceId: "core:source-runtime",
        namespaceDeriver: identityNamespaceDeriver(
          "tenant-secret-a-v2",
          "identity-namespace-v2"
        )
      })
    });
    await expect(
      changedGeneration.processor.process({
        tenantId,
        normalizedEventId: normalizedInboundEvent.id
      })
    ).rejects.toMatchObject({
      code: "source.identity_materialization_conflict"
    });
  });

  it("fails closed on identity, optimistic-concurrency and persistence-echo conflicts", async () => {
    const event = sourceEvent([
      observation({ key: "conflict-source-1", subject: "unresolved" })
    ]);
    const identityConflict = createProcessor({
      event,
      identity: identityRepository({ conflict: true })
    });
    await expect(
      identityConflict.processor.process({
        tenantId,
        normalizedEventId: normalizedInboundEvent.id
      })
    ).rejects.toMatchObject({
      code: "source.identity_materialization_conflict",
      retryable: false
    });
    expect(identityConflict.assessmentPlanner.plan).not.toHaveBeenCalled();

    const versionRepository = resolutionRepository(event, {
      applyConflict: true
    });
    const versionConflict = createProcessor({
      event,
      resolution: versionRepository
    });
    await expect(
      versionConflict.processor.process({
        tenantId,
        normalizedEventId: normalizedInboundEvent.id
      })
    ).rejects.toMatchObject({
      code: "source.identity_assessment_persistence_conflict",
      retryable: true
    });

    const mismatch = createProcessor({
      event,
      resolution: resolutionRepository(event, { persistenceMismatch: true })
    });
    await expect(
      mismatch.processor.process({
        tenantId,
        normalizedEventId: normalizedInboundEvent.id
      })
    ).rejects.toMatchObject({
      code: "source.identity_assessment_persistence_mismatch"
    });
  });

  it("rejects structural materializers, mismatched trusted services and implicit single-admin bootstrap", async () => {
    const event = sourceEvent([
      observation({ key: "bootstrap-operator-1", subject: "unresolved" })
    ]);
    const fakeMaterializer = {
      materialize: vi.fn()
    } as unknown as InboxV2TrustedSourceIdentityMaterializer;
    expect(() =>
      createInboxV2SourceIdentityResolutionProcessor({
        identityRepository: identityRepository().value,
        resolutionRepository: resolutionRepository(event).value,
        assessmentPlanner: planner().value,
        materializer: fakeMaterializer
      })
    ).toThrowError(
      expect.objectContaining({
        code: "source.identity_materializer_untrusted"
      })
    );

    const wrongService = createProcessor({
      event,
      materializer: createInboxV2TrustedSourceIdentityMaterializer({
        trustedServiceId: "core:another-source-runtime",
        namespaceDeriver: identityNamespaceDeriver("tenant-secret-alpha")
      })
    });
    await expect(
      wrongService.processor.process({
        tenantId,
        normalizedEventId: normalizedInboundEvent.id
      })
    ).rejects.toMatchObject({
      code: "source.identity_materializer_service_mismatch"
    });
    expect(wrongService.identity.findOrCreate).not.toHaveBeenCalled();

    const automaticBootstrapPlan = planner(async ({ observation: source }) => ({
      evidence: [adapterEvidence(source)],
      candidates: [candidate(0, { kind: "employee", employee })],
      assessment: {
        outcome: "resolved_employee",
        confidence: "verified",
        evidenceOrdinals: [0],
        candidateOrdinal: 0,
        employee,
        claim: employeeClaim,
        claimVersion,
        assessedAt: t3
      }
    }));
    const bootstrap = createProcessor({
      event,
      assessmentPlanner: automaticBootstrapPlan
    });
    await expect(
      bootstrap.processor.process({
        tenantId,
        normalizedEventId: normalizedInboundEvent.id
      })
    ).rejects.toBeInstanceOf(InboxV2SourceIdentityResolutionProcessorError);
    await expect(
      bootstrap.processor.process({
        tenantId,
        normalizedEventId: normalizedInboundEvent.id
      })
    ).rejects.toMatchObject({
      code: "source.identity_assessment_plan_invalid"
    });
    expect(bootstrap.resolution.applyAssessment).not.toHaveBeenCalled();
  });

  it("has no Conversation, membership, RBAC, CRM, watcher, read-state or WorkItem dependency slot", () => {
    const event = sourceEvent([]);
    expect(() =>
      createInboxV2SourceIdentityResolutionProcessor({
        identityRepository: identityRepository().value,
        resolutionRepository: resolutionRepository(event).value,
        assessmentPlanner: planner().value,
        materializer: createInboxV2TrustedSourceIdentityMaterializer({
          trustedServiceId: "core:source-runtime",
          namespaceDeriver: identityNamespaceDeriver("tenant-secret-alpha")
        }),
        conversationRepository: {}
      } as never)
    ).toThrowError(/Unknown source identity resolver option/u);
  });
});
