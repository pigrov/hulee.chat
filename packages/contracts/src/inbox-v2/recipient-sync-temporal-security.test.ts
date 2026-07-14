import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  calculateInboxV2SnapshotContextHash,
  calculateInboxV2SnapshotCumulativePageChainHash,
  calculateInboxV2SnapshotManifestDefinitionHash,
  calculateInboxV2SnapshotManifestHash,
  calculateInboxV2SnapshotPageHash,
  createInboxV2RecipientSyncContracts,
  INBOX_V2_REALTIME_ENVELOPE_SCHEMA_ID,
  INBOX_V2_RECIPIENT_SNAPSHOT_PAGE_SCHEMA_ID,
  INBOX_V2_RECIPIENT_SYNC_BATCH_SCHEMA_ID,
  inboxV2RecipientEntityResourceResolver,
  inboxV2RecipientValueHasNoTenantScopedReferences,
  validateInboxV2SnapshotPageCursorClaims,
  validateInboxV2SnapshotStartAuthorization,
  validateInboxV2SyncCursorClaims
} from "../index";
import type { InboxV2RecipientProjectionRegistration } from "../index";

function createTestRecipientSyncContracts<
  const TProjections extends readonly InboxV2RecipientProjectionRegistration[]
>(input: {
  projections: TProjections;
  snapshotIndexScopeIds: readonly string[];
}) {
  return createInboxV2RecipientSyncContracts({
    ...input,
    archivedV1Projections: input.projections,
    archivedV1SnapshotIndexScopeIds: input.snapshotIndexScopeIds,
    verifyRecipientStateFingerprint: () => false
  });
}

const tenantId = "tenant:temporal-security";
const employeeId = "employee:temporal-security";
const scopeId = "scope:temporal-security";
const streamEpoch = "stream:epoch:temporal-security";
const authorizationEpoch = "authorization:epoch-current";
const previousAuthorizationEpoch = "authorization:epoch-previous";
const evaluatedAt = "2026-07-11T09:00:00.000Z";
const boundary = "2026-07-11T10:00:00.000Z";
const snapshotNotAfter = "2026-07-11T11:00:00.000Z";
const issuedAt = "2026-07-11T09:10:00.000Z";
const hashA = `sha256:${"a".repeat(64)}`;
const hashB = `sha256:${"b".repeat(64)}`;

const contracts = createTestRecipientSyncContracts({
  snapshotIndexScopeIds: ["core:employee-inbox"],
  projections: [
    {
      projectionTypeId: "core:temporal-summary",
      entityTypeId: "core:conversation",
      stateSchemaId: "core:temporal-summary",
      stateSchemaVersion: "v1",
      valueContextValidatorId: "core:test.temporal-value-context",
      valueContextValidatorFingerprint: hashA,
      authorizationRequirements: [
        {
          permissionId: "core:conversation.read",
          resourceScopeId: "core:conversation",
          resourceResolverId: "core:recipient-resource.entity",
          resourceResolverFingerprint: hashB,
          resolveResource: inboxV2RecipientEntityResourceResolver
        }
      ],
      valueSchema: z.object({ title: z.string() }).strict(),
      validateValueContext: inboxV2RecipientValueHasNoTenantScopedReferences
    }
  ]
});

function employee() {
  return { tenantId, kind: "employee" as const, id: employeeId };
}

function scope() {
  return {
    id: scopeId,
    kind: "employee_inbox" as const,
    employee: employee()
  };
}

function authorization(
  value = authorizationEpoch,
  nextAuthorizationBoundary: string | null = boundary,
  authorizationEvaluatedAt = evaluatedAt
) {
  return {
    tenantId,
    employee: employee(),
    value,
    dependencies: {
      tenantRbacRevision: "1",
      employeeAccessRevision: "2",
      employeeInboxRelationRevision: "3",
      sharedAccessRevision: "4",
      resourceDependencies: [
        {
          resource: {
            tenantId,
            entityTypeId: "core:conversation",
            entityId: "conversation:temporal-security"
          },
          accessRevision: "1"
        }
      ],
      temporalBoundaryDigest: hashA
    },
    evaluatedAt: authorizationEvaluatedAt,
    notAfter: snapshotNotAfter,
    nextAuthorizationBoundary
  };
}

function inputClaims(notAfter = boundary) {
  return {
    tenantId,
    employee: employee(),
    scopeId,
    streamEpoch,
    syncGeneration: "1",
    authorizationEpoch,
    schemaVersion: "v2",
    resumeMode: "delta" as const,
    scannedThrough: "100",
    issuedAt,
    notAfter
  };
}

function cursorValidationContext() {
  const now = "2026-07-11T09:15:00.000Z";
  return {
    tenantId,
    employee: employee(),
    scopeId,
    streamEpoch,
    syncGeneration: "1",
    authorization: authorization(authorizationEpoch, boundary, now),
    supportedSchemaVersions: ["v2"],
    minRetainedTenantStreamPosition: "100",
    minReplayableRecipientPosition: "100",
    projectionCheckpoint: "110",
    tenantStreamHead: "112",
    now
  };
}

function acceptedInputCursor() {
  const accepted = validateInboxV2SyncCursorClaims({
    cursor: "cursor:recipient:100:accepted",
    claims: inputClaims(),
    current: cursorValidationContext()
  });
  if (accepted.kind !== "accepted") {
    throw new Error(`Expected accepted cursor, received ${accepted.errorCode}`);
  }
  return accepted;
}

function acceptedPreviousScopeCursor() {
  const accepted = validateInboxV2SyncCursorClaims({
    cursor: "cursor:recipient:100:previous-scope",
    claims: {
      ...inputClaims(snapshotNotAfter),
      authorizationEpoch: previousAuthorizationEpoch
    },
    current: {
      ...cursorValidationContext(),
      authorization: authorization(
        previousAuthorizationEpoch,
        null,
        cursorValidationContext().now
      )
    }
  });
  if (accepted.kind !== "accepted") {
    throw new Error(
      `Expected accepted previous-scope cursor, received ${accepted.errorCode}`
    );
  }
  return accepted;
}

function batchPayload(fromExclusive = "100", authorizationNotAfter = boundary) {
  return {
    tenantId,
    streamEpoch,
    syncGeneration: "1",
    scopeId,
    scope: scope(),
    authorizationEpoch,
    authorizationNotAfter,
    fromExclusive,
    scannedThrough: "105",
    projectionCheckpoint: "110",
    hasMore: true,
    cursor: "cursor:recipient:105:result",
    commits: []
  };
}

function outputCursorMint(
  notAfter = boundary,
  authorizationSnapshot = authorization(
    authorizationEpoch,
    boundary,
    cursorValidationContext().now
  ),
  cursorIssuedAt = cursorValidationContext().now
) {
  return {
    cursor: "cursor:recipient:105:result",
    claims: {
      ...inputClaims(notAfter),
      issuedAt: cursorIssuedAt,
      scannedThrough: "105"
    },
    authorization: authorizationSnapshot
  };
}

function delivery(fromExclusive = "100") {
  const accepted = acceptedInputCursor();
  const currentAuthorization = accepted.validationContext.authorization;
  const wireBatch = batchPayload(fromExclusive);
  return {
    batch: {
      schemaId: INBOX_V2_RECIPIENT_SYNC_BATCH_SCHEMA_ID,
      schemaVersion: "v2",
      payload: wireBatch
    },
    authorizedBatch: wireBatch,
    authorization: currentAuthorization,
    acceptedInputCursor: accepted,
    cursorMint: outputCursorMint(
      boundary,
      currentAuthorization,
      accepted.validationContext.now
    )
  };
}

function snapshotResumeClaims(notAfter = boundary) {
  return {
    ...inputClaims(notAfter),
    scannedThrough: "110"
  };
}

function createSnapshotFixture() {
  const manifestDefinition = {
    recipientSyncSchemaVersion: "v2",
    completeness: "complete_for_scope" as const,
    registrations: [
      {
        projectionTypeId: "core:temporal-summary",
        entityTypeId: "core:conversation",
        stateSchemaId: "core:temporal-summary",
        stateSchemaVersion: "v1",
        valueContextValidator: {
          semanticId: "core:test.temporal-value-context",
          fingerprint: hashA
        },
        authorizationRequirements: [
          {
            permissionId: "core:conversation.read",
            resourceScopeId: "core:conversation",
            resourceResolver: {
              semanticId: "core:recipient-resource.entity",
              fingerprint: hashB
            }
          }
        ]
      }
    ],
    indexScopeIds: ["core:employee-inbox"]
  };
  const manifestDefinitionHash =
    calculateInboxV2SnapshotManifestDefinitionHash(manifestDefinition);
  const positionInput = {
    ordinal: "1",
    afterExclusive: null,
    firstInclusive: null,
    throughInclusive: null,
    entityCount: "0",
    previousPageHash: null,
    previousCumulativeEntityCount: "0",
    cumulativeEntityCount: "0",
    previousCumulativePageChainHash: null
  };
  const pageHash = calculateInboxV2SnapshotPageHash({
    frozenContext: {
      tenantId,
      scopeId,
      snapshotId: "snapshot:temporal-security",
      streamEpoch,
      syncGeneration: "1",
      authorizationEpoch,
      schemaVersion: "v2",
      snapshotCheckpoint: "110",
      snapshotIssuedAt: issuedAt,
      manifestDefinitionHash
    },
    position: positionInput,
    entities: []
  });
  const pageChainRootHash = calculateInboxV2SnapshotCumulativePageChainHash({
    previousCumulativePageChainHash: null,
    pageHash,
    cumulativeEntityCount: "0"
  });
  const coverage = {
    entityCount: "0",
    pageCount: "1",
    finalEntity: null,
    pageChainRootHash
  };
  const manifestHash = calculateInboxV2SnapshotManifestHash({
    manifestDefinitionHash,
    coverage
  });
  const snapshotAuthorization = authorization();
  const resumeClaims = snapshotResumeClaims();
  const snapshotContextInput = {
    tenantId,
    scope: scope(),
    snapshotId: "snapshot:temporal-security",
    streamEpoch,
    syncGeneration: "1",
    authorization: snapshotAuthorization,
    schemaVersion: "v2",
    snapshotCheckpoint: "110",
    manifestHash,
    coverage,
    snapshotIssuedAt: issuedAt,
    resumeClaims
  };
  const snapshotContextHash =
    calculateInboxV2SnapshotContextHash(snapshotContextInput);
  const authorizedManifest = {
    completeness: manifestDefinition.completeness,
    registrations: manifestDefinition.registrations,
    indexScopeIds: manifestDefinition.indexScopeIds,
    manifestDefinitionHash,
    manifestHash,
    coverage
  };
  const manifest = {
    ...authorizedManifest,
    registrations: authorizedManifest.registrations.map(
      ({ authorizationRequirements: _authorizationRequirements, ...wire }) =>
        wire
    )
  };
  return {
    manifest,
    authorizedManifest,
    manifestHash,
    coverage,
    snapshotContextHash,
    resumeClaims,
    page: {
      schemaId: INBOX_V2_RECIPIENT_SNAPSHOT_PAGE_SCHEMA_ID,
      schemaVersion: "v2",
      payload: {
        tenantId,
        streamEpoch,
        syncGeneration: "1",
        scopeId,
        scope: scope(),
        authorizationEpoch,
        authorizationNotAfter: boundary,
        manifest,
        snapshotId: "snapshot:temporal-security",
        snapshotCheckpoint: "110",
        snapshotContextHash,
        snapshotIssuedAt: issuedAt,
        resumeAfter: "cursor:recipient:110:snapshot",
        pageCursor: null,
        pagePosition: {
          ...positionInput,
          pageHash,
          cumulativePageChainHash: pageChainRootHash
        },
        finalCompletion: {
          snapshotId: "snapshot:temporal-security",
          manifestHash,
          snapshotCheckpoint: "110",
          pageCount: "1",
          entityCount: "0",
          finalEntity: null,
          pageChainRootHash
        },
        hasMore: false,
        entities: []
      }
    },
    context: {
      tenantId,
      employee: employee(),
      scopeId,
      snapshotId: "snapshot:temporal-security",
      streamEpoch,
      syncGeneration: "1",
      frozenAuthorization: snapshotAuthorization,
      currentAuthorization: {
        ...authorization(),
        evaluatedAt: issuedAt
      },
      schemaVersion: "v2",
      snapshotCheckpoint: "110",
      manifestHash,
      snapshotContextHash,
      snapshotIssuedAt: issuedAt,
      coverage,
      resumeClaims,
      now: issuedAt
    }
  };
}

const snapshotFixture = createSnapshotFixture();

function snapshotPage() {
  return structuredClone(snapshotFixture.page);
}

function snapshotContext(now = issuedAt) {
  const context = structuredClone(snapshotFixture.context);
  return {
    ...context,
    currentAuthorization: {
      ...context.currentAuthorization,
      evaluatedAt: now
    },
    now
  };
}

function acceptedSnapshotStartAuthorization() {
  const context = snapshotContext();
  const result = validateInboxV2SnapshotStartAuthorization({
    snapshotContextHash: context.snapshotContextHash,
    frozenAuthorization: context.frozenAuthorization,
    snapshotIssuedAt: issuedAt,
    current: {
      authorization: context.currentAuthorization,
      now: context.now
    }
  });
  if (result.kind !== "accepted") {
    throw new Error(
      `Expected accepted snapshot start, got ${result.errorCode}`
    );
  }
  return result;
}

function snapshotResumeMint(notAfter = boundary) {
  return {
    cursor: "cursor:recipient:110:snapshot",
    claims: snapshotResumeClaims(notAfter),
    authorization: authorization()
  };
}

function decision(epoch = authorizationEpoch) {
  return {
    tenantId,
    id: `authorization-decision:${epoch}`,
    authorizationEpoch: epoch,
    principal: { kind: "employee" as const, employee: employee() },
    permissionId: "core:conversation.read",
    resourceScopeId: "core:conversation",
    resource: {
      tenantId,
      entityTypeId: "core:conversation",
      entityId: "conversation:temporal-security"
    },
    resourceAccessRevision: "1",
    decisionRevision: "1",
    decisionHash: hashA,
    outcome: "denied" as const,
    decidedAt: issuedAt,
    notAfter: boundary
  };
}

function scopeTransition() {
  return {
    kind: "scope_transition" as const,
    tenantId,
    streamEpoch,
    syncGeneration: "1",
    previousScopeId: scopeId,
    resultingScope: scope(),
    transitionCause: "revoke_or_narrow" as const,
    previousAuthorizationEpoch,
    resultingAuthorizationEpoch: authorizationEpoch,
    authorizationNotAfter: boundary,
    authorizationDecisionRefs: [decision()],
    transitionPosition: "111",
    scannedThrough: "111",
    projectionCheckpoint: "111",
    cursor: "cursor:recipient:111:transition",
    sseEventId: "cursor:recipient:111:transition",
    invalidations: [
      {
        recipientOrdinal: "1",
        sourceChangeOrdinal: "1",
        authorizationDecisionRefs: [decision()],
        kind: "security_purge" as const,
        scope: { kind: "recipient_scope" as const },
        reasonId: "core:authorization-revoked",
        accessTransitionToken: "audience-impact:temporal-security",
        resultingAuthorizationEpoch: authorizationEpoch
      }
    ],
    closeAfterDelivery: true as const,
    nextAction: "snapshot_required" as const
  };
}

describe("Inbox V2 recipient temporal authorization and cursor proof", () => {
  it("uses the nearest authorization boundary for claims, batches, snapshots and ready frames", () => {
    expect(
      validateInboxV2SyncCursorClaims({
        cursor: "cursor:recipient:100:accepted",
        claims: inputClaims(),
        current: cursorValidationContext()
      }).kind
    ).toBe("accepted");
    expect(
      validateInboxV2SyncCursorClaims({
        cursor: "cursor:recipient:100:too-long",
        claims: inputClaims(snapshotNotAfter),
        current: cursorValidationContext()
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "sync.scope_changed",
      cursorAdvance: null
    });

    expect(contracts.syncBatchSchema.safeParse(batchPayload()).success).toBe(
      true
    );
    expect(
      contracts.syncBatchSchema.safeParse(batchPayload("100", snapshotNotAfter))
        .success
    ).toBe(true);
    const mismatchedBatchDelivery = delivery();
    mismatchedBatchDelivery.batch.payload.authorizationNotAfter =
      snapshotNotAfter;
    mismatchedBatchDelivery.authorizedBatch.authorizationNotAfter =
      snapshotNotAfter;
    expect(
      contracts.syncBatchProducerDeliverySchema.safeParse(
        mismatchedBatchDelivery
      ).success
    ).toBe(false);

    const page = snapshotPage();
    expect(contracts.snapshotPageEnvelopeSchema.safeParse(page).success).toBe(
      true
    );
    expect(
      contracts.snapshotPageEnvelopeSchema.safeParse({
        ...page,
        payload: {
          ...page.payload,
          authorizationNotAfter: snapshotNotAfter
        }
      }).success
    ).toBe(true);

    const ready = {
      schemaId: INBOX_V2_REALTIME_ENVELOPE_SCHEMA_ID,
      schemaVersion: "v2",
      payload: {
        kind: "ready" as const,
        tenantId,
        streamEpoch,
        syncGeneration: "1",
        scope: scope(),
        authorizationEpoch,
        authorizationNotAfter: boundary,
        projectionCheckpoint: "109",
        tenantStreamHead: "110",
        lagPositions: "1",
        connectedAt: issuedAt
      }
    };
    expect(contracts.realtimeEnvelopeSchema.safeParse(ready).success).toBe(
      true
    );
    expect(
      contracts.realtimeReadyProducerDeliverySchema.safeParse({
        ready: ready.payload,
        authorization: authorization(authorizationEpoch, boundary, issuedAt)
      }).success
    ).toBe(true);
    expect(
      contracts.realtimeReadyProducerDeliverySchema.safeParse({
        ready: { ...ready.payload, authorizationNotAfter: snapshotNotAfter },
        authorization: authorization(authorizationEpoch, boundary, issuedAt)
      }).success
    ).toBe(false);
  });

  it("requires polling and SSE to carry the same accepted input-cursor delivery proof", () => {
    const pollingDelivery = delivery();
    expect(
      contracts.syncBatchProducerDeliverySchema.safeParse(pollingDelivery)
        .success
    ).toBe(true);

    expect(
      contracts.syncBatchProducerDeliverySchema.safeParse(delivery("101"))
        .success
    ).toBe(false);
    expect(
      contracts.syncBatchProducerDeliverySchema.safeParse(delivery("99"))
        .success
    ).toBe(false);

    const realtime = {
      schemaId: INBOX_V2_REALTIME_ENVELOPE_SCHEMA_ID,
      schemaVersion: "v2",
      payload: {
        kind: "delta" as const,
        batch: pollingDelivery.batch,
        sseEventId: pollingDelivery.batch.payload.cursor
      }
    };
    expect(contracts.realtimeEnvelopeSchema.safeParse(realtime).success).toBe(
      true
    );
    expect(
      contracts.realtimeEnvelopeSchema.safeParse({
        ...realtime,
        payload: {
          kind: "delta",
          delivery: pollingDelivery,
          sseEventId: pollingDelivery.batch.payload.cursor
        }
      }).success
    ).toBe(false);
  });

  it("accepts a final snapshot resume cursor under a later fresh authorization evaluation and emits only wire delta", () => {
    const page = snapshotPage();
    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse({
        page,
        authorizedManifest: snapshotFixture.authorizedManifest,
        authorizedEntities: [],
        frozenAuthorization: authorization(),
        acceptedInput: {
          kind: "first_page",
          inputCursor: null,
          authorizationProof: acceptedSnapshotStartAuthorization()
        },
        snapshotContext: snapshotContext(),
        resumeCursorMint: snapshotResumeMint(),
        pageCursorMint: null
      }).success
    ).toBe(true);

    const laterNow = "2026-07-11T09:30:00.000Z";
    const laterAuthorization = authorization(
      authorizationEpoch,
      boundary,
      laterNow
    );
    const acceptedResume = validateInboxV2SyncCursorClaims({
      cursor: "cursor:recipient:110:snapshot",
      claims: snapshotResumeClaims(),
      current: {
        tenantId,
        employee: employee(),
        scopeId,
        streamEpoch,
        syncGeneration: "1",
        authorization: laterAuthorization,
        supportedSchemaVersions: ["v2"],
        minRetainedTenantStreamPosition: "100",
        minReplayableRecipientPosition: "100",
        projectionCheckpoint: "111",
        tenantStreamHead: "111",
        now: laterNow
      }
    });
    expect(acceptedResume.kind).toBe("accepted");
    if (acceptedResume.kind !== "accepted") {
      return;
    }

    const resumedBatch = {
      tenantId,
      streamEpoch,
      syncGeneration: "1",
      scopeId,
      scope: scope(),
      authorizationEpoch,
      authorizationNotAfter: boundary,
      fromExclusive: "110",
      scannedThrough: "111",
      projectionCheckpoint: "111",
      hasMore: false,
      cursor: "cursor:recipient:111:after-snapshot",
      commits: []
    };
    const resumedEnvelope = {
      schemaId: INBOX_V2_RECIPIENT_SYNC_BATCH_SCHEMA_ID,
      schemaVersion: "v2",
      payload: resumedBatch
    };
    expect(
      contracts.syncBatchProducerDeliverySchema.safeParse({
        batch: resumedEnvelope,
        authorizedBatch: resumedBatch,
        authorization: laterAuthorization,
        acceptedInputCursor: acceptedResume,
        cursorMint: {
          cursor: resumedBatch.cursor,
          claims: {
            ...snapshotResumeClaims(),
            scannedThrough: "111",
            issuedAt: laterNow
          },
          authorization: laterAuthorization
        }
      }).success
    ).toBe(true);
    const realtime = {
      schemaId: INBOX_V2_REALTIME_ENVELOPE_SCHEMA_ID,
      schemaVersion: "v2",
      payload: {
        kind: "delta" as const,
        batch: resumedEnvelope,
        sseEventId: resumedBatch.cursor
      }
    };
    expect(contracts.realtimeEnvelopeSchema.safeParse(realtime).success).toBe(
      true
    );
    expect(JSON.stringify(realtime)).not.toContain('"authorization"');
    expect(JSON.stringify(realtime)).not.toContain('"claims"');
  });

  it("binds snapshot and scope-transition cursor mints to the same full snapshot", () => {
    const page = snapshotPage();
    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse({
        page,
        authorizedManifest: snapshotFixture.authorizedManifest,
        authorizedEntities: [],
        frozenAuthorization: authorization(),
        acceptedInput: {
          kind: "first_page",
          inputCursor: null,
          authorizationProof: acceptedSnapshotStartAuthorization()
        },
        snapshotContext: snapshotContext(),
        resumeCursorMint: snapshotResumeMint(),
        pageCursorMint: null
      }).success
    ).toBe(true);
    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse({
        page,
        authorizedManifest: snapshotFixture.authorizedManifest,
        authorizedEntities: [],
        frozenAuthorization: authorization(),
        acceptedInput: {
          kind: "first_page",
          inputCursor: null,
          authorizationProof: acceptedSnapshotStartAuthorization()
        },
        snapshotContext: snapshotContext(),
        resumeCursorMint: snapshotResumeMint(snapshotNotAfter),
        pageCursorMint: null
      }).success
    ).toBe(false);

    const transition = scopeTransition();
    const {
      authorizationDecisionRefs: _transitionEvidence,
      invalidations: authorizedInvalidations,
      ...wireTransitionBase
    } = transition;
    const wireTransition = {
      ...wireTransitionBase,
      invalidations: authorizedInvalidations.map((change) => {
        const {
          authorizationDecisionRefs: _invalidationEvidence,
          ...wireInvalidation
        } = change;
        return wireInvalidation;
      })
    };
    const producedAt = "2026-07-11T09:20:00.000Z";
    const resultingAuthorization = authorization(
      authorizationEpoch,
      boundary,
      producedAt
    );
    const transitionMint = {
      cursor: wireTransition.cursor,
      claims: {
        ...inputClaims(),
        issuedAt: producedAt,
        scannedThrough: "111",
        resumeMode: "snapshot_required" as const
      },
      authorization: resultingAuthorization
    };
    expect(
      contracts.scopeTransitionProducerDeliverySchema.safeParse({
        transition: wireTransition,
        authorizedTransition: transition,
        previousAuthorization: authorization(previousAuthorizationEpoch, null),
        resultingAuthorization,
        inputCursorProof: {
          kind: "accepted_for_scope_transition",
          inputCursor: "cursor:recipient:100:previous-scope",
          claims: acceptedPreviousScopeCursor().claims,
          verifiedAt: producedAt
        },
        cursorMint: transitionMint,
        producedAt
      }).success
    ).toBe(true);
    expect(
      contracts.scopeTransitionProducerDeliverySchema.safeParse({
        transition: {
          ...wireTransition,
          authorizationNotAfter: snapshotNotAfter
        },
        authorizedTransition: {
          ...transition,
          authorizationNotAfter: snapshotNotAfter
        },
        previousAuthorization: authorization(previousAuthorizationEpoch, null),
        resultingAuthorization,
        inputCursorProof: {
          kind: "accepted_for_scope_transition",
          inputCursor: "cursor:recipient:100:previous-scope",
          claims: acceptedPreviousScopeCursor().claims,
          verifiedAt: producedAt
        },
        cursorMint: transitionMint,
        producedAt
      }).success
    ).toBe(false);
  });

  it("validates snapshot page cursors against the exact authorization snapshot", () => {
    const continuationCoverage = {
      entityCount: "2",
      pageCount: "2",
      finalEntity: {
        tenantId,
        entityTypeId: "core:conversation",
        entityId: "conversation:conversation-2"
      },
      pageChainRootHash: hashB
    };
    const continuationResumeClaims = snapshotResumeClaims();
    const continuationContextHash = calculateInboxV2SnapshotContextHash({
      tenantId,
      scope: scope(),
      snapshotId: "snapshot:temporal-security",
      streamEpoch,
      syncGeneration: "1",
      authorization: authorization(),
      schemaVersion: "v2",
      snapshotCheckpoint: "110",
      manifestHash: snapshotFixture.manifestHash,
      coverage: continuationCoverage,
      snapshotIssuedAt: issuedAt,
      resumeClaims: continuationResumeClaims
    });
    const claims = {
      tenantId,
      employee: employee(),
      scopeId,
      snapshotId: "snapshot:temporal-security",
      streamEpoch,
      syncGeneration: "1",
      authorizationEpoch,
      schemaVersion: "v2",
      snapshotCheckpoint: "110",
      manifestHash: snapshotFixture.manifestHash,
      snapshotContextHash: continuationContextHash,
      nextPageOrdinal: "2",
      afterExclusive: {
        tenantId,
        entityTypeId: "core:conversation",
        entityId: "conversation:conversation-1"
      },
      acceptedPageHash: hashA,
      acceptedCumulativeEntityCount: "1",
      acceptedCumulativePageChainHash: hashA,
      issuedAt,
      notAfter: boundary
    };
    const current = {
      tenantId,
      employee: employee(),
      scopeId,
      snapshotId: "snapshot:temporal-security",
      streamEpoch,
      syncGeneration: "1",
      frozenAuthorization: authorization(),
      currentAuthorization: {
        ...authorization(),
        evaluatedAt: "2026-07-11T09:15:00.000Z"
      },
      schemaVersion: "v2",
      snapshotCheckpoint: "110",
      manifestHash: snapshotFixture.manifestHash,
      snapshotContextHash: continuationContextHash,
      snapshotIssuedAt: issuedAt,
      coverage: continuationCoverage,
      resumeClaims: continuationResumeClaims,
      now: "2026-07-11T09:15:00.000Z"
    };
    expect(
      validateInboxV2SnapshotPageCursorClaims({
        cursor: "cursor:snapshot:page-2",
        claims,
        current
      }).kind
    ).toBe("accepted");
    expect(
      validateInboxV2SnapshotPageCursorClaims({
        cursor: "cursor:snapshot:page-2",
        claims: { ...claims, notAfter: snapshotNotAfter },
        current
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "sync.scope_changed",
      cursorAdvance: null
    });
  });

  it("keeps archived v1 bytes in explicit read-only parsers only", () => {
    const archivedBatch = {
      schemaId: INBOX_V2_RECIPIENT_SYNC_BATCH_SCHEMA_ID,
      schemaVersion: "v1",
      payload: {
        ...batchPayload(),
        authorization: undefined
      }
    };
    delete (archivedBatch.payload as { authorization?: unknown }).authorization;
    expect(contracts.parseSyncBatchEnvelope(archivedBatch)).toEqual({
      kind: "rejected",
      errorCode: "sync.schema_unsupported",
      cursorAdvance: null
    });
    expect(contracts.parseArchivedV1SyncBatchEnvelope(archivedBatch).kind).toBe(
      "parsed"
    );

    const archivedPayload = structuredClone(snapshotPage().payload) as Record<
      string,
      unknown
    >;
    delete archivedPayload.authorization;
    delete archivedPayload.snapshotContextHash;
    delete archivedPayload.snapshotIssuedAt;
    delete archivedPayload.pagePosition;
    delete archivedPayload.finalCompletion;
    archivedPayload.manifest = {
      completeness: "complete_for_scope",
      registrations: [
        {
          projectionTypeId: "core:temporal-summary",
          entityTypeId: "core:conversation",
          stateSchemaId: "core:temporal-summary",
          stateSchemaVersion: "v1",
          authorizationRequirements: [
            {
              permissionId: "core:conversation.read",
              resourceScopeId: "core:conversation",
              resourceResolverId: "core:recipient-resource.entity"
            }
          ]
        }
      ],
      indexScopeIds: ["core:employee-inbox"],
      manifestHash: snapshotFixture.manifestHash
    };
    archivedPayload.pagePositionHash = null;
    const archivedPage = {
      schemaId: INBOX_V2_RECIPIENT_SNAPSHOT_PAGE_SCHEMA_ID,
      schemaVersion: "v1",
      payload: archivedPayload
    };
    expect(
      contracts.parseArchivedV1SnapshotPageEnvelope(archivedPage).kind
    ).toBe("parsed");

    const archivedReady = {
      schemaId: INBOX_V2_REALTIME_ENVELOPE_SCHEMA_ID,
      schemaVersion: "v1",
      payload: {
        kind: "ready" as const,
        tenantId,
        streamEpoch,
        syncGeneration: "1",
        scope: scope(),
        authorizationEpoch,
        authorizationNotAfter: boundary,
        projectionCheckpoint: "109",
        tenantStreamHead: "110",
        lagPositions: "1",
        connectedAt: issuedAt
      }
    };
    expect(contracts.parseArchivedV1RealtimeEnvelope(archivedReady).kind).toBe(
      "parsed"
    );
    expect(contracts.parseRealtimeEnvelope(archivedReady)).toEqual({
      kind: "rejected",
      errorCode: "sync.schema_unsupported",
      cursorAdvance: null
    });
  });
});
