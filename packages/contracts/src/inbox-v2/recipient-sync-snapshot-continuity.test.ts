import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  calculateInboxV2CanonicalSha256,
  calculateInboxV2RecipientUpsertStateHash,
  calculateInboxV2SnapshotContextHash,
  calculateInboxV2SnapshotCumulativePageChainHash,
  calculateInboxV2SnapshotManifestDefinitionHash,
  calculateInboxV2SnapshotManifestHash,
  calculateInboxV2SnapshotPageHash,
  createInboxV2RecipientSyncContracts,
  INBOX_V2_RECIPIENT_SNAPSHOT_PAGE_SCHEMA_ID,
  inboxV2RecipientEntityResourceResolver,
  inboxV2RecipientValueHasNoTenantScopedReferences,
  inboxV2SnapshotManifestCoverageSchema,
  validateInboxV2SnapshotPageCursorClaims,
  validateInboxV2SnapshotStartAuthorization,
  verifyInboxV2RecipientUpsertStateHash
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
    verifyRecipientStateFingerprint: (change) =>
      verifyInboxV2RecipientUpsertStateHash(
        change as Parameters<typeof verifyInboxV2RecipientUpsertStateHash>[0],
        stateProtection
      )
  });
}

const tenantId = "tenant:snapshot-continuity";
const employeeId = "employee:snapshot-continuity";
const scopeId = "scope:snapshot-continuity";
const streamEpoch = "stream:epoch:snapshot-continuity";
const authorizationEpoch = "authorization:epoch-snapshot-continuity";
const evaluatedAt = "2026-07-11T09:00:00.000Z";
const snapshotIssuedAt = "2026-07-11T09:15:00.000Z";
const notAfter = "2026-07-11T10:00:00.000Z";
const tamperHash = calculateInboxV2CanonicalSha256({ tamper: true });
const stateHash = `sha256:${"1".repeat(64)}`;
const decisionHash = `sha256:${"2".repeat(64)}`;
const stateProtection = {
  tenantId,
  purpose: "recipient_state_integrity" as const,
  keyGeneration: "recipient-state-key:g1",
  key: new Uint8Array(32).fill(0x22)
};

const contracts = createTestRecipientSyncContracts({
  snapshotIndexScopeIds: ["core:employee-inbox"],
  projections: [
    {
      projectionTypeId: "core:snapshot-summary",
      entityTypeId: "core:conversation",
      stateSchemaId: "core:snapshot-summary",
      stateSchemaVersion: "v1",
      valueContextValidatorId: "core:test.snapshot-value-context",
      valueContextValidatorFingerprint: stateHash,
      authorizationRequirements: [
        {
          permissionId: "core:conversation.read",
          resourceScopeId: "core:conversation",
          resourceResolverId: "core:recipient-resource.entity",
          resourceResolverFingerprint: decisionHash,
          resolveResource: inboxV2RecipientEntityResourceResolver
        }
      ],
      valueSchema: z.object({ title: z.string().min(1) }).strict(),
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

function authorization() {
  return {
    tenantId,
    employee: employee(),
    value: authorizationEpoch,
    dependencies: {
      tenantRbacRevision: "1",
      employeeAccessRevision: "1",
      employeeInboxRelationRevision: "1",
      sharedAccessRevision: "1",
      resourceDependencies: [
        {
          resource: firstEntity,
          accessRevision: "1"
        },
        {
          resource: finalEntity,
          accessRevision: "1"
        }
      ],
      temporalBoundaryDigest: decisionHash
    },
    evaluatedAt,
    notAfter,
    nextAuthorizationBoundary: null
  };
}

function entity(entityId: string) {
  return {
    tenantId,
    entityTypeId: "core:conversation",
    entityId
  };
}

const firstEntity = entity("conversation:continuity-1");
const finalEntity = entity("conversation:continuity-2");

function upsert(entityId: string) {
  const entityKey = entity(entityId);
  const change = {
    recipientOrdinal: "1",
    sourceChangeOrdinal: "1",
    authorizationDecisionRefs: [
      {
        tenantId,
        id: `authorization-decision:${entityId}`,
        authorizationEpoch,
        principal: { kind: "employee" as const, employee: employee() },
        permissionId: "core:conversation.read",
        resourceScopeId: "core:conversation",
        resource: entityKey,
        resourceAccessRevision: "1",
        decisionRevision: "1",
        decisionHash,
        outcome: "allowed" as const,
        decidedAt: evaluatedAt,
        notAfter
      }
    ],
    kind: "upsert" as const,
    projectionTypeId: "core:snapshot-summary",
    entity: entityKey,
    revision: "1",
    lastChangedStreamPosition: "100",
    timeline: null,
    stateSchemaId: "core:snapshot-summary",
    stateSchemaVersion: "v1",
    value: { title: entityId }
  };
  return {
    ...change,
    stateHash: calculateInboxV2RecipientUpsertStateHash(change, stateProtection)
  };
}

function wireChange<T extends { authorizationDecisionRefs: unknown }>(
  change: T
): Omit<T, "authorizationDecisionRefs"> {
  const { authorizationDecisionRefs: _authorizationEvidence, ...wire } = change;
  return wire;
}

function resumeClaims() {
  return {
    tenantId,
    employee: employee(),
    scopeId,
    streamEpoch,
    syncGeneration: "1",
    authorizationEpoch,
    schemaVersion: "v2",
    resumeMode: "delta" as const,
    scannedThrough: "110",
    issuedAt: snapshotIssuedAt,
    notAfter
  };
}

function createSnapshotFixture() {
  const manifestDefinition = {
    recipientSyncSchemaVersion: "v2",
    completeness: "complete_for_scope" as const,
    registrations: [
      {
        projectionTypeId: "core:snapshot-summary",
        entityTypeId: "core:conversation",
        stateSchemaId: "core:snapshot-summary",
        stateSchemaVersion: "v1",
        valueContextValidator: {
          semanticId: "core:test.snapshot-value-context",
          fingerprint: stateHash
        },
        authorizationRequirements: [
          {
            permissionId: "core:conversation.read",
            resourceScopeId: "core:conversation",
            resourceResolver: {
              semanticId: "core:recipient-resource.entity",
              fingerprint: decisionHash
            }
          }
        ]
      }
    ],
    indexScopeIds: ["core:employee-inbox"]
  };
  const manifestDefinitionHash =
    calculateInboxV2SnapshotManifestDefinitionHash(manifestDefinition);
  const frozenContext = {
    tenantId,
    scopeId,
    snapshotId: "snapshot:snapshot-continuity",
    streamEpoch,
    syncGeneration: "1",
    authorizationEpoch,
    schemaVersion: "v2",
    snapshotCheckpoint: "110",
    snapshotIssuedAt,
    manifestDefinitionHash
  };
  const firstChange = upsert(firstEntity.entityId);
  const finalChange = upsert(finalEntity.entityId);
  const firstPositionInput = {
    ordinal: "1",
    afterExclusive: null,
    firstInclusive: firstEntity,
    throughInclusive: firstEntity,
    entityCount: "1",
    previousPageHash: null,
    previousCumulativeEntityCount: "0",
    cumulativeEntityCount: "1",
    previousCumulativePageChainHash: null
  };
  const firstPageHash = calculateInboxV2SnapshotPageHash({
    frozenContext,
    position: firstPositionInput,
    entities: [
      {
        projectionTypeId: firstChange.projectionTypeId,
        entity: firstChange.entity,
        revision: firstChange.revision,
        stateHash: firstChange.stateHash
      }
    ]
  });
  const firstChainHash = calculateInboxV2SnapshotCumulativePageChainHash({
    previousCumulativePageChainHash: null,
    pageHash: firstPageHash,
    cumulativeEntityCount: "1"
  });
  const finalPositionInput = {
    ordinal: "2",
    afterExclusive: firstEntity,
    firstInclusive: finalEntity,
    throughInclusive: finalEntity,
    entityCount: "1",
    previousPageHash: firstPageHash,
    previousCumulativeEntityCount: "1",
    cumulativeEntityCount: "2",
    previousCumulativePageChainHash: firstChainHash
  };
  const finalPageHash = calculateInboxV2SnapshotPageHash({
    frozenContext,
    position: finalPositionInput,
    entities: [
      {
        projectionTypeId: finalChange.projectionTypeId,
        entity: finalChange.entity,
        revision: finalChange.revision,
        stateHash: finalChange.stateHash
      }
    ]
  });
  const finalChainHash = calculateInboxV2SnapshotCumulativePageChainHash({
    previousCumulativePageChainHash: firstChainHash,
    pageHash: finalPageHash,
    cumulativeEntityCount: "2"
  });
  const coverage = {
    entityCount: "2",
    pageCount: "2",
    finalEntity,
    pageChainRootHash: finalChainHash
  };
  const manifestHash = calculateInboxV2SnapshotManifestHash({
    manifestDefinitionHash,
    coverage
  });
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
  const frozenResumeClaims = resumeClaims();
  const snapshotAuthorization = authorization();
  const snapshotContextInput = {
    tenantId,
    scope: scope(),
    snapshotId: "snapshot:snapshot-continuity",
    streamEpoch,
    syncGeneration: "1",
    authorization: snapshotAuthorization,
    schemaVersion: "v2",
    snapshotCheckpoint: "110",
    manifestHash,
    coverage,
    snapshotIssuedAt,
    resumeClaims: frozenResumeClaims
  };
  const snapshotContextHash =
    calculateInboxV2SnapshotContextHash(snapshotContextInput);
  const contextNow = "2026-07-11T09:20:00.000Z";
  const currentAuthorization = {
    ...authorization(),
    evaluatedAt: contextNow
  };
  const validationContext = {
    tenantId,
    employee: employee(),
    scopeId,
    snapshotId: "snapshot:snapshot-continuity",
    streamEpoch,
    syncGeneration: "1",
    frozenAuthorization: snapshotAuthorization,
    currentAuthorization,
    schemaVersion: "v2",
    snapshotCheckpoint: "110",
    manifestHash,
    snapshotContextHash,
    snapshotIssuedAt,
    coverage,
    resumeClaims: frozenResumeClaims,
    now: contextNow
  };
  const firstPage = {
    schemaId: INBOX_V2_RECIPIENT_SNAPSHOT_PAGE_SCHEMA_ID,
    schemaVersion: "v2",
    payload: {
      tenantId,
      streamEpoch,
      syncGeneration: "1",
      scopeId,
      scope: scope(),
      authorizationEpoch,
      authorizationNotAfter: notAfter,
      manifest,
      snapshotId: "snapshot:snapshot-continuity",
      snapshotCheckpoint: "110",
      snapshotContextHash,
      snapshotIssuedAt,
      resumeAfter: null,
      pageCursor: "cursor:snapshot:continuity:page-2",
      pagePosition: {
        ...firstPositionInput,
        pageHash: firstPageHash,
        cumulativePageChainHash: firstChainHash
      },
      finalCompletion: null,
      hasMore: true,
      entities: [wireChange(firstChange)]
    }
  };
  const finalPage = {
    schemaId: INBOX_V2_RECIPIENT_SNAPSHOT_PAGE_SCHEMA_ID,
    schemaVersion: "v2",
    payload: {
      tenantId,
      streamEpoch,
      syncGeneration: "1",
      scopeId,
      scope: scope(),
      authorizationEpoch,
      authorizationNotAfter: notAfter,
      manifest,
      snapshotId: "snapshot:snapshot-continuity",
      snapshotCheckpoint: "110",
      snapshotContextHash,
      snapshotIssuedAt,
      resumeAfter: "cursor:recipient:snapshot-continuity:resume",
      pageCursor: null,
      pagePosition: {
        ...finalPositionInput,
        pageHash: finalPageHash,
        cumulativePageChainHash: finalChainHash
      },
      finalCompletion: {
        snapshotId: "snapshot:snapshot-continuity",
        manifestHash,
        snapshotCheckpoint: "110",
        pageCount: "2",
        entityCount: "2",
        finalEntity,
        pageChainRootHash: finalChainHash
      },
      hasMore: false,
      entities: [wireChange(finalChange)]
    }
  };
  const pageCursorClaims = {
    tenantId,
    employee: employee(),
    scopeId,
    snapshotId: "snapshot:snapshot-continuity",
    streamEpoch,
    syncGeneration: "1",
    authorizationEpoch,
    schemaVersion: "v2",
    snapshotCheckpoint: "110",
    manifestHash,
    snapshotContextHash,
    nextPageOrdinal: "2",
    afterExclusive: firstEntity,
    acceptedPageHash: firstPageHash,
    acceptedCumulativeEntityCount: "1",
    acceptedCumulativePageChainHash: firstChainHash,
    issuedAt: snapshotIssuedAt,
    notAfter
  };
  return {
    coverage,
    manifest,
    authorizedManifest,
    validationContext,
    snapshotAuthorization,
    firstAuthorizedEntities: [firstChange],
    finalAuthorizedEntities: [finalChange],
    firstPage,
    finalPage,
    pageCursorClaims,
    manifestHash,
    snapshotContextHash,
    firstPageHash,
    firstChainHash,
    finalPageHash,
    finalChainHash
  };
}

const snapshotFixture = createSnapshotFixture();
const { firstChainHash, finalPageHash, finalChainHash } = snapshotFixture;

function pageCursorClaims() {
  return structuredClone(snapshotFixture.pageCursorClaims);
}

function validationContext(now = "2026-07-11T09:20:00.000Z") {
  const context = structuredClone(snapshotFixture.validationContext);
  return {
    ...context,
    currentAuthorization: {
      ...context.currentAuthorization,
      evaluatedAt: now
    },
    now
  };
}

function acceptedContinuation() {
  const result = validateInboxV2SnapshotPageCursorClaims({
    cursor: "cursor:snapshot:continuity:page-2",
    claims: pageCursorClaims(),
    current: validationContext()
  });
  if (result.kind !== "accepted") {
    throw new Error(`Expected accepted continuation, got ${result.errorCode}`);
  }
  return result;
}

function acceptedSnapshotStartAuthorization() {
  const context = validationContext();
  const result = validateInboxV2SnapshotStartAuthorization({
    snapshotContextHash: context.snapshotContextHash,
    frozenAuthorization: context.frozenAuthorization,
    snapshotIssuedAt,
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

function firstPage() {
  return structuredClone(snapshotFixture.firstPage);
}

function finalPage() {
  return structuredClone(snapshotFixture.finalPage);
}

function firstDelivery() {
  return {
    page: firstPage(),
    authorizedManifest: structuredClone(snapshotFixture.authorizedManifest),
    authorizedEntities: structuredClone(
      snapshotFixture.firstAuthorizedEntities
    ),
    frozenAuthorization: structuredClone(snapshotFixture.snapshotAuthorization),
    acceptedInput: {
      kind: "first_page" as const,
      inputCursor: null,
      authorizationProof: acceptedSnapshotStartAuthorization()
    },
    snapshotContext: validationContext(),
    resumeCursorMint: null,
    pageCursorMint: {
      cursor: "cursor:snapshot:continuity:page-2",
      claims: pageCursorClaims(),
      authorization: authorization()
    }
  };
}

function finalDelivery() {
  return {
    page: finalPage(),
    authorizedManifest: structuredClone(snapshotFixture.authorizedManifest),
    authorizedEntities: structuredClone(
      snapshotFixture.finalAuthorizedEntities
    ),
    frozenAuthorization: structuredClone(snapshotFixture.snapshotAuthorization),
    acceptedInput: {
      kind: "continuation" as const,
      proof: acceptedContinuation()
    },
    snapshotContext: validationContext(),
    resumeCursorMint: {
      cursor: "cursor:recipient:snapshot-continuity:resume",
      claims: resumeClaims(),
      authorization: authorization()
    },
    pageCursorMint: null
  };
}

describe("Inbox V2 snapshot pagination continuity", () => {
  it("rejects impossible frozen page coverage", () => {
    expect(
      inboxV2SnapshotManifestCoverageSchema.safeParse({
        entityCount: "0",
        pageCount: "2",
        finalEntity: null,
        pageChainRootHash: finalChainHash
      }).success
    ).toBe(false);
    expect(
      inboxV2SnapshotManifestCoverageSchema.safeParse({
        entityCount: "1",
        pageCount: "2",
        finalEntity,
        pageChainRootHash: finalChainHash
      }).success
    ).toBe(false);
  });

  it("accepts an exact first-to-final chain and emits resume only on completion", () => {
    const first = firstDelivery();
    const final = finalDelivery();

    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse(first).success
    ).toBe(true);
    expect(first.page.payload.resumeAfter).toBeNull();
    expect(first.resumeCursorMint).toBeNull();
    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse(final).success
    ).toBe(true);
    expect(final.page.payload.finalCompletion).not.toBeNull();
    expect(final.resumeCursorMint).not.toBeNull();
  });

  it("rejects skipped, repeated and mismatched continuation positions", () => {
    const skipped = structuredClone(finalDelivery());
    skipped.page.payload.pagePosition.ordinal = "3";
    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse(skipped).success
    ).toBe(false);

    const repeated = structuredClone(finalDelivery());
    repeated.page.payload.pagePosition.ordinal = "1";
    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse(repeated).success
    ).toBe(false);

    const implausibleOrdinal = structuredClone(finalDelivery());
    implausibleOrdinal.page.payload.pagePosition.ordinal = "50";
    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse(implausibleOrdinal)
        .success
    ).toBe(false);

    const wrongRange = structuredClone(finalDelivery());
    wrongRange.page.payload.pagePosition.afterExclusive = finalEntity;
    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse(wrongRange).success
    ).toBe(false);

    const wrongHash = structuredClone(finalDelivery());
    wrongHash.page.payload.pagePosition.previousPageHash = finalPageHash;
    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse(wrongHash).success
    ).toBe(false);

    const wrongCount = structuredClone(finalDelivery());
    wrongCount.page.payload.pagePosition.previousCumulativeEntityCount = "0";
    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse(wrongCount).success
    ).toBe(false);
  });

  it("rejects early finalization, partial resume and incomplete final coverage", () => {
    const first = firstDelivery();
    const final = finalDelivery();
    const partialResume = {
      ...first,
      page: {
        ...first.page,
        payload: {
          ...first.page.payload,
          resumeAfter: "cursor:recipient:snapshot-continuity:resume"
        }
      },
      resumeCursorMint: final.resumeCursorMint
    };
    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse(partialResume)
        .success
    ).toBe(false);

    const earlyFinal = {
      ...first,
      page: {
        ...first.page,
        payload: {
          ...first.page.payload,
          hasMore: false,
          pageCursor: null,
          resumeAfter: "cursor:recipient:snapshot-continuity:resume",
          finalCompletion: {
            ...finalPage().payload.finalCompletion!,
            pageCount: "1",
            entityCount: "1",
            finalEntity: firstEntity,
            pageChainRootHash: firstChainHash
          }
        }
      },
      pageCursorMint: null,
      resumeCursorMint: final.resumeCursorMint
    };
    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse(earlyFinal).success
    ).toBe(false);

    const missingCompletion = {
      ...final,
      page: {
        ...final.page,
        payload: { ...final.page.payload, finalCompletion: null }
      }
    };
    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse(missingCompletion)
        .success
    ).toBe(false);

    const truncated = structuredClone(finalDelivery());
    truncated.page.payload.finalCompletion!.entityCount = "1";
    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse(truncated).success
    ).toBe(false);
  });

  it("keeps interrupted pagination resumable only by its frozen page cursor", () => {
    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse(firstDelivery())
        .success
    ).toBe(true);
    expect(acceptedContinuation().kind).toBe("accepted");
    expect(
      validateInboxV2SnapshotPageCursorClaims({
        cursor: "cursor:snapshot:continuity:page-2",
        claims: pageCursorClaims(),
        current: validationContext(notAfter)
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "sync.cursor_expired",
      cursorAdvance: null
    });
  });

  it("rejects continuation against changed frozen manifest or resume context", () => {
    expect(
      validateInboxV2SnapshotPageCursorClaims({
        cursor: "cursor:snapshot:continuity:page-2",
        claims: pageCursorClaims(),
        current: {
          ...validationContext(),
          manifestHash: finalPageHash
        }
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "sync.cursor_invalid",
      cursorAdvance: null
    });

    expect(
      validateInboxV2SnapshotPageCursorClaims({
        cursor: "cursor:snapshot:continuity:page-2",
        claims: pageCursorClaims(),
        current: {
          ...validationContext(),
          resumeClaims: { ...resumeClaims(), scannedThrough: "109" }
        }
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "sync.cursor_invalid",
      cursorAdvance: null
    });
  });

  it("rejects expired, pre-snapshot and cryptographically tampered deliveries", () => {
    const expiredFirst = firstDelivery();
    expiredFirst.snapshotContext = validationContext(notAfter);
    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse(expiredFirst)
        .success
    ).toBe(false);

    const expiredFinal = finalDelivery();
    expiredFinal.snapshotContext = validationContext(notAfter);
    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse(expiredFinal)
        .success
    ).toBe(false);

    const preSnapshotFirst = firstDelivery();
    preSnapshotFirst.snapshotContext = validationContext(
      "2026-07-11T09:14:59.999Z"
    );
    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse(preSnapshotFirst)
        .success
    ).toBe(false);

    const preSnapshotFinal = finalDelivery();
    preSnapshotFinal.snapshotContext = validationContext(
      "2026-07-11T09:14:59.999Z"
    );
    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse(preSnapshotFinal)
        .success
    ).toBe(false);

    const tamperedManifest = firstDelivery();
    tamperedManifest.page.payload.manifest.manifestHash = tamperHash;
    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse(tamperedManifest)
        .success
    ).toBe(false);

    const tamperedPage = firstDelivery();
    tamperedPage.page.payload.pagePosition.pageHash = tamperHash;
    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse(tamperedPage)
        .success
    ).toBe(false);

    const tamperedContext = firstDelivery();
    tamperedContext.snapshotContext.snapshotContextHash = tamperHash;
    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse(tamperedContext)
        .success
    ).toBe(false);

    const richToWireMismatch = firstDelivery();
    const richManifest = richToWireMismatch.authorizedManifest as {
      manifestDefinitionHash: string;
      manifestHash: string;
      coverage: {
        entityCount: string;
        pageCount: string;
        finalEntity: typeof finalEntity;
        pageChainRootHash: string;
      };
    };
    richManifest.coverage.entityCount = "3";
    richManifest.manifestHash = calculateInboxV2SnapshotManifestHash({
      manifestDefinitionHash: richManifest.manifestDefinitionHash,
      coverage: richManifest.coverage
    });
    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse(richToWireMismatch)
        .success
    ).toBe(false);
  });

  it("rejects authorization revoked between snapshot creation and first-page send", () => {
    const context = validationContext();
    const dependencyChangedAuthorization = structuredClone(
      context.currentAuthorization
    );
    dependencyChangedAuthorization.dependencies.employeeAccessRevision = "2";
    expect(
      validateInboxV2SnapshotStartAuthorization({
        snapshotContextHash: context.snapshotContextHash,
        frozenAuthorization: context.frozenAuthorization,
        snapshotIssuedAt,
        current: {
          authorization: dependencyChangedAuthorization,
          now: context.now
        }
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "sync.scope_changed",
      cursorAdvance: null
    });

    const currentAuthorization = structuredClone(context.currentAuthorization);
    currentAuthorization.value = "authorization:epoch-revoked-before-send";
    currentAuthorization.dependencies.employeeAccessRevision = "2";
    const revokedInput = {
      snapshotContextHash: context.snapshotContextHash,
      frozenAuthorization: context.frozenAuthorization,
      snapshotIssuedAt,
      current: {
        authorization: currentAuthorization,
        now: context.now
      }
    };
    expect(validateInboxV2SnapshotStartAuthorization(revokedInput)).toEqual({
      kind: "rejected",
      errorCode: "sync.scope_changed",
      cursorAdvance: null
    });

    const first = firstDelivery();
    const forged = {
      ...first,
      acceptedInput: {
        ...first.acceptedInput,
        authorizationProof: {
          kind: "accepted" as const,
          snapshotContextHash: context.snapshotContextHash,
          currentAuthorization,
          checkedAt: context.now
        }
      }
    };
    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse(forged).success
    ).toBe(false);
  });
});
