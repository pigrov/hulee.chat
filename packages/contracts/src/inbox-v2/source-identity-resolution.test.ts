import { describe, expect, it } from "vitest";

import {
  INBOX_V2_DEFERRED_PARTICIPANT_INTENT_SCHEMA_ID,
  INBOX_V2_SOURCE_IDENTITY_OBSERVATION_RECORD_SCHEMA_ID,
  INBOX_V2_SOURCE_IDENTITY_RESOLUTION_BATCH_SCHEMA_ID,
  INBOX_V2_SOURCE_IDENTITY_RESOLUTION_RECORD_SCHEMA_ID,
  inboxV2DeferredParticipantIntentEnvelopeSchema,
  inboxV2DeferredParticipantIntentSchema,
  inboxV2SourceIdentityAssessmentSchema,
  inboxV2SourceIdentityMaterializationSnapshotSchema,
  inboxV2SourceIdentityObservationRecordEnvelopeSchema,
  inboxV2SourceIdentityObservationRecordSchema,
  inboxV2SourceIdentityResolutionBatchEnvelopeSchema,
  inboxV2SourceIdentityResolutionBatchSchema,
  inboxV2SourceIdentityResolutionRecordEnvelopeSchema,
  inboxV2SourceIdentityResolutionRecordSchema,
  inboxV2SourceNormalizedEventForIdentityResolutionSchema,
  inboxV2SourceNormalizedIdentityObservationSchema
} from "../index";

const tenantId = "tenant:alpha";
const otherTenantId = "tenant:beta";
const t0 = "2026-07-17T07:00:00.000Z";
const t1 = "2026-07-17T07:01:00.000Z";
const t2 = "2026-07-17T07:02:00.000Z";
const t3 = "2026-07-17T07:03:00.000Z";
const t4 = "2026-07-17T07:04:00.000Z";
const t5 = "2026-07-17T07:05:00.000Z";
const safeEnvelopeHmacSha256 = `hmac-sha256:${"a".repeat(64)}`;

const sourceConnection = {
  tenantId,
  kind: "source_connection",
  id: "source_connection:synthetic-1"
} as const;
const sourceAccount = {
  tenantId,
  kind: "source_account",
  id: "source_account:synthetic-1"
} as const;
const rawInboundEvent = {
  tenantId,
  kind: "raw_inbound_event",
  id: "raw_inbound_event:raw-1"
} as const;
const normalizedInboundEvent = {
  tenantId,
  kind: "normalized_inbound_event",
  id: "normalized_inbound_event:event-1"
} as const;
const employee = {
  tenantId,
  kind: "employee",
  id: "employee:operator-1"
} as const;
const clientContact = {
  tenantId,
  kind: "client_contact",
  id: "client_contact:contact-1"
} as const;
const employeeClaim = {
  tenantId,
  kind: "source_identity_claim",
  id: "source_identity_claim:employee-claim-1"
} as const;
const clientContactClaim = {
  tenantId,
  kind: "source_identity_claim",
  id: "source_identity_claim:contact-claim-1"
} as const;

const adapterContract = {
  contractId: "module:synthetic:source-adapter",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "core:direct-messenger",
  loadedByTrustedServiceId: "core:source-runtime",
  loadedAt: t0
} as const;

function senderDeclaration() {
  return {
    adapterContract,
    identityKind: "source_external_identity" as const,
    realmId: "module:synthetic:sender-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic:provider-user",
    scopeKind: "source_account" as const,
    decisionStrength: "safe_default" as const
  };
}

function threadDeclaration(scopeKind: "source_account" | "provider") {
  return {
    adapterContract,
    identityKind: "external_thread" as const,
    realmId: "module:synthetic:thread-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic:group",
    scopeKind,
    decisionStrength:
      scopeKind === "provider"
        ? ("authoritative" as const)
        : ("safe_default" as const)
  };
}

function normalizedIdentityObservation(input: {
  observationKey?: string;
  purpose?:
    | "message_author"
    | "action_actor"
    | "membership_subject"
    | "roster_member";
  subject?: string;
  stability?: "stable" | "observation_ephemeral";
}) {
  const subject = input.subject ?? "User-CaseSensitive-Å";
  return {
    observationKey: input.observationKey ?? "author-0001",
    purpose: input.purpose ?? ("message_author" as const),
    identityDeclaration: senderDeclaration(),
    realm: {
      realmId: "module:synthetic:sender-realm",
      realmVersion: "v1",
      canonicalizationVersion: "v1"
    },
    scope: { kind: "source_account" as const, owner: sourceAccount },
    objectKindId: "module:synthetic:provider-user",
    observedExternalSubject: subject,
    canonicalExternalSubject: subject,
    stability: input.stability ?? ("stable" as const),
    observedAt: t1
  };
}

function externalThreadContext(input: {
  subject?: string;
  scopeKind?: "source_account" | "provider";
  connection?: Readonly<{
    tenantId: string;
    kind: "source_connection";
    id: string;
  }>;
  account?: Readonly<{
    tenantId: string;
    kind: "source_account";
    id: string;
  }>;
}) {
  const subject = input.subject ?? "Group-CaseSensitive-Å";
  const scopeKind = input.scopeKind ?? "source_account";
  const connection = input.connection ?? sourceConnection;
  const account = input.account ?? sourceAccount;
  return {
    sourceConnection: connection,
    sourceAccount: account,
    identityDeclaration: threadDeclaration(scopeKind),
    key: {
      realm: {
        realmId: "module:synthetic:thread-realm",
        realmVersion: "v1",
        canonicalizationVersion: "v1"
      },
      scope:
        scopeKind === "provider"
          ? ({ kind: "provider" } as const)
          : ({ kind: "source_account", owner: account } as const),
      objectKindId: "module:synthetic:group",
      canonicalExternalSubject: subject
    },
    observedExternalSubject: subject
  };
}

function normalizedSourceEvent(input: {
  observations?: ReturnType<typeof normalizedIdentityObservation>[];
  thread?: ReturnType<typeof externalThreadContext>;
  rosterObservation?: ReturnType<typeof rosterObservation> | null;
}) {
  return {
    tenantId,
    rawInboundEvent,
    normalizedInboundEvent,
    sourceConnection,
    sourceAccount,
    domain: "core:inbox-v2.normalized-event-safe-envelope" as const,
    schemaId: "core:inbox-v2.normalized-event-envelope" as const,
    schemaVersion: "v1" as const,
    safeEnvelopeHmacSha256,
    adapterContract,
    thread: input.thread ?? externalThreadContext({}),
    identityObservations: input.observations ?? [
      normalizedIdentityObservation({})
    ],
    rosterObservation: input.rosterObservation ?? null,
    recordedAt: t2
  };
}

function rosterObservation(
  observationKey = "roster-0001",
  completeness: "unknown" | "partial" | "complete" = "complete"
) {
  return {
    completeness,
    authority: "authoritative" as const,
    omissionPolicy: "close_missing" as const,
    ordering: {
      kind: "adapter_monotonic" as const,
      scopeToken: "roster-scope-0001",
      comparatorId: "module:synthetic:roster-position",
      comparatorRevision: "1",
      position: "1"
    },
    members: [
      {
        identityObservationKey: observationKey,
        state: "present" as const,
        normalizedRole: "member" as const
      }
    ],
    observedAt: t1
  };
}

function materializationSnapshot(
  source: ReturnType<typeof normalizedIdentityObservation>,
  identityId = "source_external_identity:identity-1"
) {
  return {
    tenantId,
    id: identityId,
    realm: {
      realmId: source.realm.realmId,
      version: source.realm.realmVersion,
      canonicalizationVersion: source.realm.canonicalizationVersion
    },
    objectKindId: source.objectKindId,
    scope: source.scope,
    identityDeclaration: source.identityDeclaration,
    materializationAuthority: {
      kind: "trusted_service" as const,
      tenantId,
      trustedServiceId: "core:source-runtime",
      authorizationToken: "materialize-identity-0001",
      authorizedAt: t2
    },
    materializedAt: t2,
    canonicalExternalSubject: source.canonicalExternalSubject,
    stability:
      source.stability === "stable"
        ? ({ kind: "stable" } as const)
        : ({
            kind: "observation_ephemeral" as const,
            observation: normalizedInboundEvent,
            observationKey: source.observationKey
          } as const),
    createdAt: t2
  };
}

function durableObservation(
  source = normalizedIdentityObservation({}),
  identityId?: string
) {
  return {
    tenantId,
    normalizedInboundEvent,
    observationKey: source.observationKey,
    purpose: source.purpose,
    sourceConnection,
    sourceAccount,
    adapterContract,
    safeEnvelopeHmacSha256,
    observedExternalSubject: source.observedExternalSubject,
    sourceExternalIdentityMaterialization: materializationSnapshot(
      source,
      identityId
    ),
    observedAt: source.observedAt,
    recordedAt: t2,
    revision: "1" as const
  };
}

function identityHead(
  observation: ReturnType<typeof durableObservation>,
  input: {
    resolution:
      | { status: "unresolved" }
      | { status: "conflicted" }
      | {
          status: "claimed";
          activeClaim: typeof employeeClaim | typeof clientContactClaim;
        };
    latestClaimVersion: string | null;
  }
) {
  return {
    ...observation.sourceExternalIdentityMaterialization,
    resolution: input.resolution,
    latestClaimVersion: input.latestClaimVersion,
    revision: input.latestClaimVersion === null ? "1" : "2",
    updatedAt: input.latestClaimVersion === null ? t2 : t3
  };
}

function adapterEvidence(
  observation: ReturnType<typeof durableObservation>,
  confidence: "weak" | "strong" | "verified" = "verified"
) {
  return {
    ordinal: 0,
    reference: {
      kind: "normalized_inbound_event" as const,
      reference: normalizedInboundEvent
    },
    confidence,
    provenance: {
      kind: "adapter_observation" as const,
      adapterContract,
      observationKey: observation.observationKey
    },
    observedAt: observation.observedAt
  };
}

function policyEvidence() {
  return {
    ordinal: 1,
    reference: {
      kind: "normalized_inbound_event" as const,
      reference: normalizedInboundEvent
    },
    confidence: "strong" as const,
    provenance: {
      kind: "tenant_policy" as const,
      policyId: "core:source-identity-resolution",
      policyVersion: "v1",
      ruleId: "core:verified-contact-match",
      ruleVersion: "v1",
      evaluatedByTrustedServiceId: "core:source-runtime"
    },
    observedAt: t1
  };
}

function unresolvedResolution(
  observation = durableObservation(normalizedIdentityObservation({}))
) {
  return {
    tenantId,
    observation,
    sourceExternalIdentitySnapshot: identityHead(observation, {
      resolution: { status: "unresolved" },
      latestClaimVersion: null
    }),
    previousAssessmentRevision: null,
    assessmentRevision: "1",
    evidence: [],
    candidates: [],
    assessment: {
      outcome: "unresolved" as const,
      confidence: "none" as const,
      reason: "no_candidate" as const,
      evidenceOrdinals: [],
      candidateOrdinals: [],
      assessedAt: t3
    }
  };
}

function weakResolution(observation: ReturnType<typeof durableObservation>) {
  const evidence = adapterEvidence(observation, "weak");
  return {
    ...unresolvedResolution(observation),
    evidence: [evidence],
    candidates: [
      {
        ordinal: 0,
        target: { kind: "employee" as const, employee },
        confidence: "weak" as const,
        evidenceOrdinals: [0]
      }
    ],
    assessment: {
      outcome: "unresolved" as const,
      confidence: "weak" as const,
      reason: "insufficient_confidence" as const,
      evidenceOrdinals: [0],
      candidateOrdinals: [0],
      assessedAt: t3
    }
  };
}

function conflictedResolution(
  observation: ReturnType<typeof durableObservation>
) {
  return {
    tenantId,
    observation,
    sourceExternalIdentitySnapshot: identityHead(observation, {
      resolution: { status: "unresolved" },
      latestClaimVersion: null
    }),
    previousAssessmentRevision: null,
    assessmentRevision: "1",
    evidence: [adapterEvidence(observation), policyEvidence()],
    candidates: [
      {
        ordinal: 0,
        target: { kind: "employee" as const, employee },
        confidence: "verified" as const,
        evidenceOrdinals: [0]
      },
      {
        ordinal: 1,
        target: { kind: "client_contact" as const, clientContact },
        confidence: "strong" as const,
        evidenceOrdinals: [1]
      }
    ],
    assessment: {
      outcome: "conflicted" as const,
      confidence: "verified" as const,
      reason: "multiple_candidates" as const,
      evidenceOrdinals: [0, 1],
      candidateOrdinals: [0, 1],
      assessedAt: t3
    }
  };
}

function employeeResolution(
  observation: ReturnType<typeof durableObservation>
) {
  return {
    tenantId,
    observation,
    sourceExternalIdentitySnapshot: identityHead(observation, {
      resolution: { status: "claimed", activeClaim: employeeClaim },
      latestClaimVersion: "1"
    }),
    previousAssessmentRevision: null,
    assessmentRevision: "1",
    evidence: [adapterEvidence(observation)],
    candidates: [
      {
        ordinal: 0,
        target: { kind: "employee" as const, employee },
        confidence: "verified" as const,
        evidenceOrdinals: [0]
      }
    ],
    assessment: {
      outcome: "resolved_employee" as const,
      confidence: "verified" as const,
      evidenceOrdinals: [0],
      candidateOrdinal: 0,
      employee,
      claim: employeeClaim,
      claimVersion: "1",
      assessedAt: t3
    }
  };
}

function clientContactResolution(
  observation: ReturnType<typeof durableObservation>
) {
  return {
    tenantId,
    observation,
    sourceExternalIdentitySnapshot: identityHead(observation, {
      resolution: {
        status: "claimed",
        activeClaim: clientContactClaim
      },
      latestClaimVersion: "1"
    }),
    previousAssessmentRevision: null,
    assessmentRevision: "1",
    evidence: [adapterEvidence(observation)],
    candidates: [
      {
        ordinal: 0,
        target: { kind: "client_contact" as const, clientContact },
        confidence: "verified" as const,
        evidenceOrdinals: [0]
      }
    ],
    assessment: {
      outcome: "resolved_client_contact" as const,
      confidence: "verified" as const,
      evidenceOrdinals: [0],
      candidateOrdinal: 0,
      clientContact,
      claim: clientContactClaim,
      claimVersion: "1",
      assessedAt: t3
    }
  };
}

function deferredIntent(input: {
  thread?: ReturnType<typeof externalThreadContext>;
  observations: ReturnType<typeof durableObservation>[];
}) {
  const thread = input.thread ?? externalThreadContext({});
  const identity = input.observations[0]!.sourceExternalIdentityMaterialization;
  const needsMembershipEvidence = input.observations.some(
    (observation) =>
      observation.purpose === "membership_subject" ||
      observation.purpose === "roster_member"
  );
  return {
    key: {
      tenantId,
      externalThreadKey: thread.key,
      sourceExternalIdentity: {
        tenantId,
        kind: "source_external_identity" as const,
        id: identity.id
      }
    },
    externalThreadContext: thread,
    inducingObservations: input.observations.map((observation) => ({
      normalizedInboundEvent,
      safeEnvelopeHmacSha256,
      observationKey: observation.observationKey,
      purpose: observation.purpose
    })),
    membershipAuthority: needsMembershipEvidence
      ? ("provider_evidence_required" as const)
      : ("none" as const),
    recordedAt: t4,
    revision: "1" as const
  };
}

function unresolvedBatch() {
  const sourceObservation = normalizedIdentityObservation({});
  const observation = durableObservation(sourceObservation);
  const sourceEvent = normalizedSourceEvent({
    observations: [sourceObservation]
  });
  return {
    tenantId,
    sourceEvent,
    observations: [observation],
    resolutions: [unresolvedResolution(observation)],
    deferredParticipantIntents: [
      deferredIntent({
        thread: sourceEvent.thread,
        observations: [observation]
      })
    ],
    completedAt: t5
  };
}

describe("Inbox V2 source identity resolution contracts", () => {
  it("exports strict v1 envelopes for every durable contract", () => {
    const batch = unresolvedBatch();
    const observation = batch.observations[0]!;
    const resolution = batch.resolutions[0]!;
    const intent = batch.deferredParticipantIntents[0]!;

    expect(
      inboxV2SourceIdentityObservationRecordEnvelopeSchema.parse({
        schemaId: INBOX_V2_SOURCE_IDENTITY_OBSERVATION_RECORD_SCHEMA_ID,
        schemaVersion: "v1",
        payload: observation
      }).schemaId
    ).toBe(INBOX_V2_SOURCE_IDENTITY_OBSERVATION_RECORD_SCHEMA_ID);
    expect(
      inboxV2SourceIdentityResolutionRecordEnvelopeSchema.parse({
        schemaId: INBOX_V2_SOURCE_IDENTITY_RESOLUTION_RECORD_SCHEMA_ID,
        schemaVersion: "v1",
        payload: resolution
      }).schemaId
    ).toBe(INBOX_V2_SOURCE_IDENTITY_RESOLUTION_RECORD_SCHEMA_ID);
    expect(
      inboxV2SourceIdentityResolutionBatchEnvelopeSchema.parse({
        schemaId: INBOX_V2_SOURCE_IDENTITY_RESOLUTION_BATCH_SCHEMA_ID,
        schemaVersion: "v1",
        payload: batch
      }).schemaId
    ).toBe(INBOX_V2_SOURCE_IDENTITY_RESOLUTION_BATCH_SCHEMA_ID);
    expect(
      inboxV2DeferredParticipantIntentEnvelopeSchema.parse({
        schemaId: INBOX_V2_DEFERRED_PARTICIPANT_INTENT_SCHEMA_ID,
        schemaVersion: "v1",
        payload: intent
      }).schemaId
    ).toBe(INBOX_V2_DEFERRED_PARTICIPANT_INTENT_SCHEMA_ID);
    expect(
      inboxV2SourceIdentityObservationRecordEnvelopeSchema.safeParse({
        schemaId: INBOX_V2_SOURCE_IDENTITY_OBSERVATION_RECORD_SCHEMA_ID,
        schemaVersion: "v1",
        payload: observation,
        authResource: "must-not-exist"
      }).success
    ).toBe(false);
  });

  it("preserves opaque case and Unicode composition without core canonicalization", () => {
    const composed = normalizedIdentityObservation({
      subject: "User-Å-Case"
    });
    const decomposed = normalizedIdentityObservation({
      observationKey: "author-0002",
      subject: "User-Å-Case"
    });

    expect(
      inboxV2SourceNormalizedIdentityObservationSchema.parse(composed)
        .canonicalExternalSubject
    ).toBe("User-Å-Case");
    expect(
      inboxV2SourceNormalizedIdentityObservationSchema.parse(decomposed)
        .canonicalExternalSubject
    ).toBe("User-Å-Case");
    expect(composed.canonicalExternalSubject).not.toBe(
      decomposed.canonicalExternalSubject
    );
    expect(
      inboxV2SourceNormalizedIdentityObservationSchema.safeParse({
        ...composed,
        canonicalExternalSubject: "user-å-case"
      }).success
    ).toBe(false);

    const projection = normalizedSourceEvent({ observations: [composed] });
    expect(
      inboxV2SourceNormalizedEventForIdentityResolutionSchema.parse(projection)
        .thread.key.canonicalExternalSubject
    ).toBe("Group-CaseSensitive-Å");
    expect(
      inboxV2SourceNormalizedEventForIdentityResolutionSchema.safeParse({
        ...projection,
        safeEnvelopeHmacSha256: `hmac-sha256:${"A".repeat(64)}`
      }).success
    ).toBe(false);
  });

  it("keeps stable and observation-ephemeral materialization immutable and exact", () => {
    const stableSource = normalizedIdentityObservation({});
    const stable = durableObservation(stableSource);
    expect(inboxV2SourceIdentityObservationRecordSchema.parse(stable)).toEqual(
      stable
    );
    expect(
      inboxV2SourceIdentityMaterializationSnapshotSchema.safeParse({
        ...stable.sourceExternalIdentityMaterialization,
        resolution: { status: "claimed", activeClaim: employeeClaim }
      }).success
    ).toBe(false);

    const ephemeralSource = normalizedIdentityObservation({
      observationKey: "ephemeral-0001",
      stability: "observation_ephemeral"
    });
    const ephemeral = durableObservation(
      ephemeralSource,
      "source_external_identity:ephemeral-1"
    );
    expect(
      inboxV2SourceIdentityObservationRecordSchema.safeParse(ephemeral).success
    ).toBe(true);
    expect(
      inboxV2SourceIdentityObservationRecordSchema.safeParse({
        ...ephemeral,
        sourceExternalIdentityMaterialization: {
          ...ephemeral.sourceExternalIdentityMaterialization,
          stability: {
            ...ephemeral.sourceExternalIdentityMaterialization.stability,
            observationKey: "ephemeral-9999"
          }
        }
      }).success
    ).toBe(false);
  });

  it("accepts unresolved, conflicted and exact Employee/ClientContact outcomes", () => {
    const observation = durableObservation(normalizedIdentityObservation({}));
    const records = [
      unresolvedResolution(observation),
      weakResolution(observation),
      conflictedResolution(observation),
      employeeResolution(observation),
      clientContactResolution(observation)
    ];

    for (const record of records) {
      expect(
        inboxV2SourceIdentityResolutionRecordSchema.safeParse(record).success
      ).toBe(true);
    }

    const secondRevision = {
      ...employeeResolution(observation),
      previousAssessmentRevision: "1",
      assessmentRevision: "2"
    };
    expect(
      inboxV2SourceIdentityResolutionRecordSchema.safeParse(secondRevision)
        .success
    ).toBe(true);
  });

  it("rejects non-deterministic evidence, confidence and first-match selection", () => {
    const observation = durableObservation(normalizedIdentityObservation({}));
    const weak = weakResolution(observation);
    expect(
      inboxV2SourceIdentityResolutionRecordSchema.safeParse({
        ...weak,
        candidates: weak.candidates.map((candidate) => ({
          ...candidate,
          confidence: "verified"
        }))
      }).success
    ).toBe(false);

    const conflicted = conflictedResolution(observation);
    expect(
      inboxV2SourceIdentityResolutionRecordSchema.safeParse({
        ...conflicted,
        evidence: conflicted.evidence.map((evidence, index) =>
          index === 1
            ? {
                ...evidence,
                reference: conflicted.evidence[0]!.reference,
                provenance: conflicted.evidence[0]!.provenance
              }
            : evidence
        )
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceIdentityResolutionRecordSchema.safeParse({
        ...conflicted,
        candidates: conflicted.candidates.map((candidate, index) =>
          index === 1
            ? { ...candidate, target: conflicted.candidates[0]!.target }
            : candidate
        )
      }).success
    ).toBe(false);

    const resolved = employeeResolution(observation);
    expect(
      inboxV2SourceIdentityResolutionRecordSchema.safeParse({
        ...resolved,
        candidates: [...resolved.candidates, conflicted.candidates[1]!]
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceIdentityResolutionRecordSchema.safeParse({
        ...resolved,
        assessment: { ...resolved.assessment, evidenceOrdinals: [] }
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceIdentityResolutionRecordSchema.safeParse({
        ...resolved,
        evidence: resolved.evidence.map((evidence) => ({
          ...evidence,
          reference: {
            ...evidence.reference,
            reference: {
              ...normalizedInboundEvent,
              id: "normalized_inbound_event:unrelated"
            }
          }
        }))
      }).success
    ).toBe(false);
  });

  it("maps every observation once and aggregates one intent/assessment per identity", () => {
    const authorSource = normalizedIdentityObservation({
      observationKey: "author-0001",
      purpose: "message_author"
    });
    const rosterSource = normalizedIdentityObservation({
      observationKey: "roster-0001",
      purpose: "roster_member"
    });
    const author = durableObservation(authorSource);
    const roster = durableObservation(rosterSource);
    const sourceEvent = normalizedSourceEvent({
      observations: [authorSource, rosterSource],
      rosterObservation: rosterObservation(rosterSource.observationKey)
    });
    const intent = deferredIntent({
      thread: sourceEvent.thread,
      observations: [author, roster]
    });
    const batch = {
      tenantId,
      sourceEvent,
      observations: [author, roster],
      resolutions: [unresolvedResolution(author)],
      deferredParticipantIntents: [intent],
      completedAt: t5
    };

    expect(
      inboxV2SourceIdentityResolutionBatchSchema.safeParse(batch).success
    ).toBe(true);
    expect(intent.membershipAuthority).toBe("provider_evidence_required");
    expect(
      inboxV2SourceIdentityResolutionBatchSchema.safeParse({
        ...batch,
        observations: [author]
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceIdentityResolutionBatchSchema.safeParse({
        ...batch,
        resolutions: [
          unresolvedResolution(author),
          unresolvedResolution(roster)
        ]
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceIdentityResolutionBatchSchema.safeParse({
        ...batch,
        deferredParticipantIntents: [
          deferredIntent({
            thread: sourceEvent.thread,
            observations: [author]
          })
        ]
      }).success
    ).toBe(false);
  });

  it("keys participants by the exact stable group key, not sender or adapter load", () => {
    const observation = durableObservation(normalizedIdentityObservation({}));
    const composedGroup = externalThreadContext({
      subject: "Group-Å",
      scopeKind: "provider"
    });
    const decomposedGroup = externalThreadContext({
      subject: "Group-Å",
      scopeKind: "provider"
    });
    const composedIntent = deferredIntent({
      thread: composedGroup,
      observations: [observation]
    });
    const decomposedIntent = deferredIntent({
      thread: decomposedGroup,
      observations: [observation]
    });

    expect(
      inboxV2DeferredParticipantIntentSchema.safeParse(composedIntent).success
    ).toBe(true);
    expect(
      inboxV2DeferredParticipantIntentSchema.safeParse(decomposedIntent).success
    ).toBe(true);
    expect(composedIntent.key).not.toEqual(decomposedIntent.key);

    const secondConnection = {
      ...sourceConnection,
      id: "source_connection:synthetic-2"
    } as const;
    const secondAccount = {
      ...sourceAccount,
      id: "source_account:synthetic-2"
    } as const;
    const sameProviderGroupFromSecondAccount = externalThreadContext({
      subject: "Group-Å",
      scopeKind: "provider",
      connection: secondConnection,
      account: secondAccount
    });
    const secondAccountIntent = deferredIntent({
      thread: sameProviderGroupFromSecondAccount,
      observations: [observation]
    });
    expect(secondAccountIntent.key).toEqual(composedIntent.key);
    expect(secondAccountIntent.externalThreadContext).not.toEqual(
      composedIntent.externalThreadContext
    );
  });

  it("keeps roster evidence advisory until later binding-specific materialization", () => {
    const rosterSource = normalizedIdentityObservation({
      observationKey: "roster-0001",
      purpose: "roster_member"
    });
    const rosterRecord = durableObservation(rosterSource);
    const intent = deferredIntent({ observations: [rosterRecord] });
    expect(
      inboxV2DeferredParticipantIntentSchema.safeParse(intent).success
    ).toBe(true);
    expect(
      inboxV2DeferredParticipantIntentSchema.safeParse({
        ...intent,
        membershipAuthority: "none"
      }).success
    ).toBe(false);

    const authorIntent = deferredIntent({
      observations: [durableObservation(normalizedIdentityObservation({}))]
    });
    expect(authorIntent.membershipAuthority).toBe("none");
    expect(
      inboxV2DeferredParticipantIntentSchema.safeParse({
        ...authorIntent,
        membershipAuthority: "provider_evidence_required"
      }).success
    ).toBe(false);

    const partialClose = normalizedSourceEvent({
      observations: [rosterSource],
      rosterObservation: rosterObservation(
        rosterSource.observationKey,
        "partial"
      )
    });
    expect(
      inboxV2SourceNormalizedEventForIdentityResolutionSchema.safeParse(
        partialClose
      ).success
    ).toBe(false);
  });

  it("rejects tenant escapes, time inversions and hidden side effects", () => {
    const batch = unresolvedBatch();
    const observation = batch.observations[0]!;
    const resolution = batch.resolutions[0]!;
    const intent = batch.deferredParticipantIntents[0]!;

    expect(
      inboxV2SourceIdentityResolutionRecordSchema.safeParse({
        ...resolution,
        candidates: [
          {
            ordinal: 0,
            target: {
              kind: "employee",
              employee: { ...employee, tenantId: otherTenantId }
            },
            confidence: "weak",
            evidenceOrdinals: [0]
          }
        ]
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceIdentityObservationRecordSchema.safeParse({
        ...observation,
        recordedAt: t0
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceIdentityResolutionBatchSchema.safeParse({
        ...batch,
        completedAt: t2
      }).success
    ).toBe(false);

    expect(
      inboxV2SourceIdentityObservationRecordSchema.safeParse({
        ...observation,
        account: { id: "account:implicit" },
        client: { id: "client:implicit" }
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceIdentityResolutionRecordSchema.safeParse({
        ...resolution,
        rbacGrant: { permission: "inbox.admin" },
        watcher: true
      }).success
    ).toBe(false);
    expect(
      inboxV2DeferredParticipantIntentSchema.safeParse({
        ...intent,
        conversation: { id: "conversation:implicit" },
        sourceThreadBinding: { id: "source_thread_binding:implicit" },
        readState: "read",
        workItem: { id: "work_item:implicit" }
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceIdentityAssessmentSchema.safeParse({
        ...resolution.assessment,
        authResource: "employee-session"
      }).success
    ).toBe(false);
  });
});
