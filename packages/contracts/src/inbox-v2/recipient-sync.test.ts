import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  calculateInboxV2RecipientUpsertStateHash,
  calculateInboxV2SnapshotContextHash,
  calculateInboxV2SnapshotCumulativePageChainHash,
  calculateInboxV2SnapshotManifestDefinitionHash,
  calculateInboxV2SnapshotManifestHash,
  calculateInboxV2SnapshotPageHash,
  createInboxV2RecipientSyncContracts,
  decideInboxV2EntityChangeApplication,
  decideInboxV2SecurityPurgeApplication,
  defineInboxV2RecipientProjection,
  INBOX_V2_MAX_RECIPIENT_VALUE_BYTES,
  INBOX_V2_REALTIME_ENVELOPE_SCHEMA_ID,
  INBOX_V2_RECIPIENT_SNAPSHOT_PAGE_SCHEMA_ID,
  INBOX_V2_RECIPIENT_SYNC_BATCH_SCHEMA_ID,
  inboxV2ConversationReferenceSchema,
  inboxV2MessageReferenceSchema,
  inboxV2RecipientEntityResourceResolver,
  inboxV2RecipientTimelineConversationResourceResolver,
  inboxV2RecipientValueHasNoTenantScopedReferences,
  inboxV2SyncCursorErrorCodeSchema,
  validateInboxV2SnapshotPageCursorClaims,
  validateInboxV2SnapshotStartAuthorization,
  validateInboxV2SyncCursorClaims,
  verifyInboxV2RecipientUpsertStateHash
} from "../index";
import type { InboxV2RecipientProjectionRegistration } from "../index";
import type {
  InboxV2RecipientAuthorizationResourceContext,
  InboxV2RecipientProjectionValueContext
} from "../index";

const tenantId = "tenant:tenant-1";
const streamEpoch = "stream:epoch:0001";
const authorizationEpoch = "authorization:epoch-0001";
const nextAuthorizationEpoch = "authorization:epoch-0002";
const decidedAt = "2026-07-11T09:00:00.000Z";
const authorizationEvaluatedAt = "2026-07-11T08:59:00.000Z";
const notAfter = "2026-07-11T10:00:00.000Z";
const hashA = `sha256:${"a".repeat(64)}`;
const hashB = `sha256:${"b".repeat(64)}`;
const stateFingerprintA = `hmac-sha256:recipient-state-key:g1:${"a".repeat(64)}`;
const stateFingerprintB = `hmac-sha256:recipient-state-key:g1:${"b".repeat(64)}`;
const stateProtection = {
  tenantId,
  purpose: "recipient_state_integrity" as const,
  keyGeneration: "recipient-state-key:g1",
  key: new Uint8Array(32).fill(0x11)
};

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
const testValueContextDescriptor = {
  valueContextValidatorId: "core:test.recipient-value-context",
  valueContextValidatorFingerprint: hashA
} as const;
const valueSchema = z
  .object({
    kind: z.literal("conversation_summary"),
    title: z.string().min(1)
  })
  .strict();
const contracts = createTestRecipientSyncContracts({
  snapshotIndexScopeIds: ["core:employee-inbox"],
  projections: [
    {
      projectionTypeId: "core:conversation-summary",
      entityTypeId: "core:conversation",
      stateSchemaId: "core:conversation-summary",
      stateSchemaVersion: "v1",
      ...testValueContextDescriptor,
      authorizationRequirements: [
        {
          permissionId: "core:conversation.read",
          resourceScopeId: "core:conversation",
          resourceResolverId: "core:recipient-resource.entity",
          resourceResolverFingerprint: hashB,
          resolveResource: inboxV2RecipientEntityResourceResolver
        }
      ],
      valueSchema,
      validateValueContext: inboxV2RecipientValueHasNoTenantScopedReferences
    }
  ]
});

function scope(id = "scope:employee-1") {
  return {
    id,
    kind: "employee_inbox" as const,
    employee: {
      tenantId,
      kind: "employee" as const,
      id: "employee:employee-1"
    }
  };
}

function authorizationSnapshot(
  epoch = authorizationEpoch,
  evaluatedAt = authorizationEvaluatedAt
) {
  return {
    tenantId,
    employee: scope().employee,
    value: epoch,
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
            entityId: "conversation:conversation-1"
          },
          accessRevision: "2"
        },
        {
          resource: {
            tenantId,
            entityTypeId: "core:staff-note",
            entityId: "staff_note:staff-1"
          },
          accessRevision: "2"
        }
      ],
      temporalBoundaryDigest: hashA
    },
    evaluatedAt,
    notAfter,
    nextAuthorizationBoundary: null
  };
}

function decision(
  epoch = authorizationEpoch,
  outcome: "allowed" | "denied" = "allowed"
) {
  return {
    tenantId,
    id: `authorization-decision:${epoch}`,
    authorizationEpoch: epoch,
    principal: { kind: "employee" as const, employee: scope().employee },
    permissionId: "core:conversation.read",
    resourceScopeId: "core:conversation",
    resource: {
      tenantId,
      entityTypeId: "core:conversation",
      entityId: "conversation:conversation-1"
    },
    resourceAccessRevision: "2",
    decisionRevision: "1",
    decisionHash: hashA,
    outcome,
    decidedAt,
    notAfter
  };
}

function resourceDecision(input: {
  id: string;
  permissionId: string;
  resourceScopeId: string;
  resource: { tenantId: string; entityTypeId: string; entityId: string };
  epoch?: string;
  outcome?: "allowed" | "denied";
}) {
  return {
    ...decision(input.epoch ?? authorizationEpoch, input.outcome ?? "allowed"),
    id: input.id,
    permissionId: input.permissionId,
    resourceScopeId: input.resourceScopeId,
    resource: input.resource
  };
}

function upsert(lastChangedStreamPosition = "90", epoch = authorizationEpoch) {
  const change = {
    recipientOrdinal: "1",
    sourceChangeOrdinal: "1",
    authorizationDecisionRefs: [decision(epoch)],
    kind: "upsert" as const,
    projectionTypeId: "core:conversation-summary",
    entity: {
      tenantId,
      entityTypeId: "core:conversation",
      entityId: "conversation:conversation-1"
    },
    revision: "3",
    lastChangedStreamPosition,
    timeline: null,
    stateSchemaId: "core:conversation-summary",
    stateSchemaVersion: "v1",
    value: { kind: "conversation_summary" as const, title: "Support" }
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

function recipientCommit(position: string, mutation: string) {
  return {
    commitId: `commit:commit-${position}`,
    streamPosition: position,
    clientMutationIds: [mutation],
    recipientChangeCount: "1",
    commitCompleteness: "complete" as const,
    changes: [wireChange(upsert("90"))]
  };
}

function authorizedRecipientCommit(position: string, mutation: string) {
  return {
    ...recipientCommit(position, mutation),
    changes: [upsert("90")]
  };
}

function batch(input?: {
  fromExclusive?: string;
  scannedThrough?: string;
  commits?: ReturnType<typeof recipientCommit>[];
  epoch?: string;
}) {
  const fromExclusive = input?.fromExclusive ?? "100";
  const scannedThrough = input?.scannedThrough ?? "110";
  const epoch = input?.epoch ?? authorizationEpoch;
  return {
    tenantId,
    streamEpoch,
    syncGeneration: "1",
    scopeId: "scope:employee-1",
    scope: scope(),
    authorizationEpoch: epoch,
    authorizationNotAfter: notAfter,
    fromExclusive,
    scannedThrough,
    projectionCheckpoint: scannedThrough,
    hasMore: false,
    cursor: `cursor:recipient:${scannedThrough}:0001`,
    commits: input?.commits ?? [
      recipientCommit("104", "mutation:mutation-104"),
      recipientCommit("109", "mutation:mutation-109")
    ]
  };
}

function authorizedBatch(input?: {
  fromExclusive?: string;
  scannedThrough?: string;
  commits?: ReturnType<typeof authorizedRecipientCommit>[];
  epoch?: string;
}) {
  const fromExclusive = input?.fromExclusive ?? "100";
  const scannedThrough = input?.scannedThrough ?? "110";
  const epoch = input?.epoch ?? authorizationEpoch;
  return {
    tenantId,
    streamEpoch,
    syncGeneration: "1",
    scopeId: "scope:employee-1",
    scope: scope(),
    authorizationEpoch: epoch,
    authorizationNotAfter: notAfter,
    fromExclusive,
    scannedThrough,
    projectionCheckpoint: scannedThrough,
    hasMore: false,
    cursor: `cursor:recipient:${scannedThrough}:0001`,
    commits: input?.commits ?? [
      authorizedRecipientCommit("104", "mutation:mutation-104"),
      authorizedRecipientCommit("109", "mutation:mutation-109")
    ]
  };
}

function batchEnvelope<TValue = ReturnType<typeof batch>>(
  value: TValue = batch() as TValue
) {
  return {
    schemaId: INBOX_V2_RECIPIENT_SYNC_BATCH_SCHEMA_ID,
    schemaVersion: "v2",
    payload: value
  };
}

function syncCursorMint(
  cursor: string,
  scannedThrough: string,
  resumeMode: "delta" | "snapshot_required" = "delta",
  epoch = authorizationEpoch,
  issuedAt = decidedAt,
  authorization: unknown = authorizationSnapshot(epoch)
) {
  return {
    cursor,
    claims: {
      tenantId,
      employee: scope().employee,
      scopeId: scope().id,
      streamEpoch,
      syncGeneration: "1",
      authorizationEpoch: epoch,
      schemaVersion: "v2",
      resumeMode,
      scannedThrough,
      issuedAt,
      notAfter
    },
    authorization
  };
}

function acceptedInputCursor(
  fromExclusive = "100",
  epoch = authorizationEpoch
) {
  const proof = validateInboxV2SyncCursorClaims({
    cursor: `cursor:accepted-input:${fromExclusive}:${epoch}`,
    claims: {
      tenantId,
      employee: scope().employee,
      scopeId: scope().id,
      streamEpoch,
      syncGeneration: "1",
      authorizationEpoch: epoch,
      schemaVersion: "v2",
      resumeMode: "delta",
      scannedThrough: fromExclusive,
      issuedAt: decidedAt,
      notAfter
    },
    current: {
      tenantId,
      employee: scope().employee,
      scopeId: scope().id,
      streamEpoch,
      syncGeneration: "1",
      authorization: authorizationSnapshot(epoch, "2026-07-11T09:30:00.000Z"),
      supportedSchemaVersions: ["v2"],
      minRetainedTenantStreamPosition: "0",
      minReplayableRecipientPosition: "0",
      projectionCheckpoint: "1000",
      tenantStreamHead: "1000",
      now: "2026-07-11T09:30:00.000Z"
    }
  });
  if (proof.kind !== "accepted") {
    throw new Error(`Expected accepted cursor proof, got ${proof.errorCode}`);
  }
  return proof;
}

function createSnapshotFixture(hasMore = true) {
  const snapshotChange = upsert("90");
  const snapshotEntity = snapshotChange.entity;
  const finalEntity = hasMore
    ? {
        tenantId,
        entityTypeId: "core:conversation",
        entityId: "conversation:conversation-2"
      }
    : upsert().entity;
  const manifestDefinition = {
    recipientSyncSchemaVersion: "v2",
    completeness: "complete_for_scope" as const,
    registrations: [
      {
        projectionTypeId: "core:conversation-summary",
        entityTypeId: "core:conversation",
        stateSchemaId: "core:conversation-summary",
        stateSchemaVersion: "v1",
        valueContextValidator: {
          semanticId: testValueContextDescriptor.valueContextValidatorId,
          fingerprint:
            testValueContextDescriptor.valueContextValidatorFingerprint
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
    firstInclusive: snapshotEntity,
    throughInclusive: snapshotEntity,
    entityCount: "1",
    previousPageHash: null,
    previousCumulativeEntityCount: "0",
    cumulativeEntityCount: "1",
    previousCumulativePageChainHash: null
  };
  const calculatedPageHash = calculateInboxV2SnapshotPageHash({
    frozenContext: {
      tenantId,
      scopeId: scope().id,
      snapshotId: "snapshot:snapshot-1",
      streamEpoch,
      syncGeneration: "1",
      authorizationEpoch,
      schemaVersion: "v2",
      snapshotCheckpoint: "110",
      snapshotIssuedAt: decidedAt,
      manifestDefinitionHash
    },
    position: positionInput,
    entities: [
      {
        projectionTypeId: snapshotChange.projectionTypeId,
        entity: snapshotChange.entity,
        revision: snapshotChange.revision,
        stateHash: snapshotChange.stateHash
      }
    ]
  });
  const cumulativePageChainHash =
    calculateInboxV2SnapshotCumulativePageChainHash({
      previousCumulativePageChainHash: null,
      pageHash: calculatedPageHash,
      cumulativeEntityCount: "1"
    });
  const coverage = {
    entityCount: hasMore ? "2" : "1",
    pageCount: hasMore ? "2" : "1",
    finalEntity,
    pageChainRootHash: hasMore ? hashB : cumulativePageChainHash
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
  const resumeClaims = syncCursorMint(
    "cursor:recipient:110:snapshot-resume",
    "110"
  ).claims;
  const snapshotAuthorization = authorizationSnapshot();
  const snapshotContextInput = {
    tenantId,
    scope: scope(),
    snapshotId: "snapshot:snapshot-1",
    streamEpoch,
    syncGeneration: "1",
    authorization: snapshotAuthorization,
    schemaVersion: "v2",
    snapshotCheckpoint: "110",
    manifestHash,
    coverage,
    snapshotIssuedAt: decidedAt,
    resumeClaims
  };
  const snapshotContextHash =
    calculateInboxV2SnapshotContextHash(snapshotContextInput);
  const page = {
    schemaId: INBOX_V2_RECIPIENT_SNAPSHOT_PAGE_SCHEMA_ID,
    schemaVersion: "v2",
    payload: {
      tenantId,
      streamEpoch,
      syncGeneration: "1",
      scopeId: scope().id,
      scope: scope(),
      authorizationEpoch,
      authorizationNotAfter: notAfter,
      manifest,
      snapshotId: "snapshot:snapshot-1",
      snapshotCheckpoint: "110",
      snapshotContextHash,
      snapshotIssuedAt: decidedAt,
      resumeAfter: hasMore ? null : "cursor:recipient:110:snapshot-resume",
      pageCursor: hasMore ? "cursor:snapshot:page-2" : null,
      pagePosition: {
        ...positionInput,
        pageHash: calculatedPageHash,
        cumulativePageChainHash
      },
      finalCompletion: hasMore
        ? null
        : {
            snapshotId: "snapshot:snapshot-1",
            manifestHash,
            snapshotCheckpoint: "110",
            pageCount: "1",
            entityCount: "1",
            finalEntity: snapshotEntity,
            pageChainRootHash: cumulativePageChainHash
          },
      hasMore,
      entities: [wireChange(snapshotChange)]
    }
  };
  const snapshotContext = {
    tenantId,
    employee: scope().employee,
    scopeId: scope().id,
    snapshotId: "snapshot:snapshot-1",
    streamEpoch,
    syncGeneration: "1",
    frozenAuthorization: snapshotAuthorization,
    currentAuthorization: {
      ...authorizationSnapshot(),
      evaluatedAt: "2026-07-11T09:30:00.000Z"
    },
    schemaVersion: "v2",
    snapshotCheckpoint: "110",
    manifestHash,
    snapshotContextHash,
    snapshotIssuedAt: decidedAt,
    coverage,
    resumeClaims,
    now: "2026-07-11T09:30:00.000Z"
  };
  return {
    page,
    manifest,
    authorizedManifest,
    snapshotContext,
    snapshotAuthorization,
    authorizedEntities: [snapshotChange],
    calculatedPageHash
  };
}

function snapshotPage(hasMore = true) {
  return createSnapshotFixture(hasMore).page;
}

function snapshotDelivery(hasMore = true) {
  const fixture = createSnapshotFixture(hasMore);
  const page = fixture.page;
  const authorizationProof = validateInboxV2SnapshotStartAuthorization({
    snapshotContextHash: page.payload.snapshotContextHash,
    frozenAuthorization: fixture.snapshotAuthorization,
    snapshotIssuedAt: page.payload.snapshotIssuedAt,
    current: {
      authorization: fixture.snapshotContext.currentAuthorization,
      now: fixture.snapshotContext.now
    }
  });
  if (authorizationProof.kind !== "accepted") {
    throw new Error(
      `Expected accepted snapshot start, got ${authorizationProof.errorCode}`
    );
  }
  return {
    page,
    authorizedManifest: fixture.authorizedManifest,
    authorizedEntities: fixture.authorizedEntities,
    frozenAuthorization: fixture.snapshotAuthorization,
    acceptedInput: {
      kind: "first_page" as const,
      inputCursor: null,
      authorizationProof
    },
    snapshotContext: fixture.snapshotContext,
    resumeCursorMint: hasMore
      ? null
      : syncCursorMint("cursor:recipient:110:snapshot-resume", "110"),
    pageCursorMint: hasMore
      ? {
          cursor: page.payload.pageCursor,
          claims: {
            tenantId,
            employee: scope().employee,
            scopeId: scope().id,
            snapshotId: page.payload.snapshotId,
            streamEpoch,
            syncGeneration: "1",
            authorizationEpoch,
            schemaVersion: "v2",
            snapshotCheckpoint: "110",
            manifestHash: page.payload.manifest.manifestHash,
            snapshotContextHash: page.payload.snapshotContextHash,
            nextPageOrdinal: "2",
            afterExclusive: page.payload.entities[0]!.entity,
            acceptedPageHash: fixture.calculatedPageHash,
            acceptedCumulativeEntityCount: "1",
            acceptedCumulativePageChainHash:
              page.payload.pagePosition.cumulativePageChainHash,
            issuedAt: decidedAt,
            notAfter
          },
          authorization: authorizationSnapshot()
        }
      : null
  };
}

const archivedV1SyncBatchBytes =
  '{"schemaId":"core:inbox-v2.recipient-sync-batch","schemaVersion":"v1","payload":{"tenantId":"tenant:tenant-1","streamEpoch":"stream:epoch:0001","syncGeneration":"1","scopeId":"scope:employee-1","scope":{"id":"scope:employee-1","kind":"employee_inbox","employee":{"tenantId":"tenant:tenant-1","kind":"employee","id":"employee:employee-1"}},"authorizationEpoch":"authorization:epoch-0001","authorizationNotAfter":"2026-07-11T10:00:00.000Z","fromExclusive":"100","scannedThrough":"110","projectionCheckpoint":"110","hasMore":false,"cursor":"cursor:recipient:110:archived-v1","commits":[]}}';
const archivedV1SnapshotBytes =
  '{"schemaId":"core:inbox-v2.recipient-snapshot-page","schemaVersion":"v1","payload":{"tenantId":"tenant:tenant-1","streamEpoch":"stream:epoch:0001","syncGeneration":"1","scopeId":"scope:employee-1","scope":{"id":"scope:employee-1","kind":"employee_inbox","employee":{"tenantId":"tenant:tenant-1","kind":"employee","id":"employee:employee-1"}},"authorizationEpoch":"authorization:epoch-0001","authorizationNotAfter":"2026-07-11T10:00:00.000Z","manifest":{"completeness":"complete_for_scope","registrations":[{"entityTypeId":"core:conversation","projectionTypeId":"core:conversation-summary","stateSchemaId":"core:conversation-summary","stateSchemaVersion":"v1","authorizationRequirements":[{"permissionId":"core:conversation.read","resourceScopeId":"core:conversation","resourceResolverId":"core:recipient-resource.entity"}]}],"indexScopeIds":["core:employee-inbox"],"manifestHash":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},"snapshotId":"snapshot:snapshot-1","snapshotCheckpoint":"110","resumeAfter":"cursor:recipient:110:snapshot-resume","pageCursor":null,"pagePositionHash":null,"hasMore":false,"entities":[]}}';
const archivedV1RealtimeBytes =
  '{"schemaId":"core:inbox-v2.realtime-envelope","schemaVersion":"v1","payload":{"kind":"ready","tenantId":"tenant:tenant-1","streamEpoch":"stream:epoch:0001","syncGeneration":"1","scope":{"id":"scope:employee-1","kind":"employee_inbox","employee":{"tenantId":"tenant:tenant-1","kind":"employee","id":"employee:employee-1"}},"authorizationEpoch":"authorization:epoch-0001","authorizationNotAfter":"2026-07-11T10:00:00.000Z","projectionCheckpoint":"109","tenantStreamHead":"110","lagPositions":"1","connectedAt":"2026-07-11T09:00:00.000Z"}}';

function invalidate(epoch = nextAuthorizationEpoch) {
  return {
    recipientOrdinal: "1",
    sourceChangeOrdinal: "1",
    authorizationDecisionRefs: [decision(epoch, "denied")],
    kind: "security_purge" as const,
    scope: { kind: "recipient_scope" as const },
    reasonId: "core:authorization-revoked",
    accessTransitionToken: "audience-impact:impact-1",
    resultingAuthorizationEpoch: epoch
  };
}

const producerOnlyWireKeys = new Set([
  "authorization",
  "authorizationRequirements",
  "previousAuthorization",
  "resultingAuthorization",
  "frozenAuthorization",
  "currentAuthorization",
  "dependencies",
  "claims",
  "validationContext",
  "cursorMint",
  "authorizationDecisionRefs",
  "delivery",
  "authorizedBatch",
  "authorizedEntities",
  "authorizedTransition",
  "acceptedInputCursor",
  "acceptedInput",
  "inputCursorProof",
  "resumeCursorMint",
  "pageCursorMint"
]);

function findProducerOnlyWireKeys(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findProducerOnlyWireKeys(item, `${path}[${index}]`)
    );
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, nested]) => [
      ...(producerOnlyWireKeys.has(key) ? [`${path}.${key}`] : []),
      ...findProducerOnlyWireKeys(nested, `${path}.${key}`)
    ]
  );
}

describe("Inbox V2 recipient sync", () => {
  it("advances through filtered positions without requiring visible contiguity", () => {
    const visible = batch();
    expect(contracts.syncBatchSchema.safeParse(visible).success).toBe(true);
    expect(visible.commits.map((commit) => commit.streamPosition)).toEqual([
      "104",
      "109"
    ]);

    const hiddenOnly = batch({
      fromExclusive: "110",
      scannedThrough: "120",
      commits: []
    });
    expect(contracts.syncBatchSchema.safeParse(hiddenOnly).success).toBe(true);
    expect(hiddenOnly.commits).toEqual([]);
  });

  it("rejects split, out-of-order and non-durable recipient commits", () => {
    const split = batch();
    split.commits[0]!.recipientChangeCount = "2";
    expect(contracts.syncBatchSchema.safeParse(split).success).toBe(false);

    const outOfOrder = batch({
      commits: [
        recipientCommit("109", "mutation:mutation-109"),
        recipientCommit("104", "mutation:mutation-104")
      ]
    });
    expect(contracts.syncBatchSchema.safeParse(outOfOrder).success).toBe(false);

    const aheadOfProjection = batch();
    aheadOfProjection.projectionCheckpoint = "109";
    expect(contracts.syncBatchSchema.safeParse(aheadOfProjection).success).toBe(
      false
    );
  });

  it("allows an access grant to reveal an older unchanged entity revision", () => {
    const grant = batch({
      fromExclusive: "103",
      scannedThrough: "104",
      commits: [recipientCommit("104", "mutation:access-grant")]
    });
    grant.commits[0]!.changes[0] = {
      ...wireChange(upsert("80")),
      sourceChangeOrdinal: "2"
    };
    expect(contracts.syncBatchSchema.safeParse(grant).success).toBe(true);

    const deniedChange = upsert("80");
    deniedChange.authorizationDecisionRefs = [
      decision(authorizationEpoch, "denied")
    ];
    const deniedAuthorizedBatch = authorizedBatch({
      fromExclusive: "103",
      scannedThrough: "104",
      commits: [authorizedRecipientCommit("104", "mutation:denied")]
    });
    deniedAuthorizedBatch.commits[0]!.changes[0] = deniedChange;
    const accepted = acceptedInputCursor("103");
    const currentAuthorization = accepted.validationContext.authorization;
    expect(
      contracts.syncBatchProducerDeliverySchema.safeParse({
        batch: batchEnvelope({
          ...deniedAuthorizedBatch,
          commits: deniedAuthorizedBatch.commits.map((commit) => ({
            ...commit,
            changes: commit.changes.map((change) => wireChange(change))
          }))
        }),
        authorizedBatch: deniedAuthorizedBatch,
        authorization: currentAuthorization,
        acceptedInputCursor: accepted,
        cursorMint: syncCursorMint(
          deniedAuthorizedBatch.cursor,
          deniedAuthorizedBatch.scannedThrough,
          "delta",
          authorizationEpoch,
          accepted.validationContext.now,
          currentAuthorization
        )
      }).success
    ).toBe(false);
  });

  it("never accepts bigint positions as JavaScript numbers", () => {
    expect(
      contracts.syncBatchSchema.safeParse({
        ...batch(),
        scannedThrough: 110
      }).success
    ).toBe(false);

    const moreAvailable = batch();
    moreAvailable.projectionCheckpoint = "111";
    expect(contracts.syncBatchSchema.safeParse(moreAvailable).success).toBe(
      false
    );
    moreAvailable.hasMore = true;
    expect(contracts.syncBatchSchema.safeParse(moreAvailable).success).toBe(
      true
    );
    const falseMore = batch();
    falseMore.hasMore = true;
    expect(contracts.syncBatchSchema.safeParse(falseMore).success).toBe(false);
  });

  it("requires a registered bounded projection schema for recipient values", () => {
    expect(() =>
      createTestRecipientSyncContracts({
        snapshotIndexScopeIds: ["core:employee-inbox"],
        projections: [
          {
            projectionTypeId: "core:unsafe-projection",
            entityTypeId: "core:conversation",
            stateSchemaId: "core:unsafe-projection",
            stateSchemaVersion: "v1",
            ...testValueContextDescriptor,
            authorizationRequirements: [
              {
                permissionId: "core:conversation.read",
                resourceScopeId: "core:conversation",
                resourceResolverId: "core:recipient-resource.entity",
                resourceResolverFingerprint: hashB,
                resolveResource: inboxV2RecipientEntityResourceResolver
              }
            ],
            valueSchema: z.unknown(),
            validateValueContext:
              inboxV2RecipientValueHasNoTenantScopedReferences
          }
        ]
      })
    ).toThrow(/closed registered schema/u);
    expect(() =>
      createTestRecipientSyncContracts({
        snapshotIndexScopeIds: ["core:employee-inbox"],
        projections: [
          {
            projectionTypeId: "core:conversation-summary-a",
            entityTypeId: "core:conversation",
            stateSchemaId: "core:conversation-summary-a",
            stateSchemaVersion: "v1",
            ...testValueContextDescriptor,
            authorizationRequirements: [
              {
                permissionId: "core:conversation.read",
                resourceScopeId: "core:conversation",
                resourceResolverId: "core:recipient-resource.entity",
                resourceResolverFingerprint: hashB,
                resolveResource: inboxV2RecipientEntityResourceResolver
              }
            ],
            valueSchema,
            validateValueContext:
              inboxV2RecipientValueHasNoTenantScopedReferences
          },
          {
            projectionTypeId: "core:conversation-summary-b",
            entityTypeId: "core:conversation",
            stateSchemaId: "core:conversation-summary-b",
            stateSchemaVersion: "v1",
            ...testValueContextDescriptor,
            authorizationRequirements: [
              {
                permissionId: "core:conversation.read",
                resourceScopeId: "core:conversation",
                resourceResolverId: "core:recipient-resource.entity",
                resourceResolverFingerprint: hashB,
                resolveResource: inboxV2RecipientEntityResourceResolver
              }
            ],
            valueSchema,
            validateValueContext:
              inboxV2RecipientValueHasNoTenantScopedReferences
          }
        ]
      })
    ).toThrow(/unique projection and entity types/u);
    expect(() =>
      createTestRecipientSyncContracts({
        snapshotIndexScopeIds: ["core:employee-inbox"],
        projections: [
          {
            projectionTypeId: "core:nested-unsafe-projection",
            entityTypeId: "core:conversation",
            stateSchemaId: "core:nested-unsafe-projection",
            stateSchemaVersion: "v1",
            ...testValueContextDescriptor,
            authorizationRequirements: [
              {
                permissionId: "core:conversation.read",
                resourceScopeId: "core:conversation",
                resourceResolverId: "core:recipient-resource.entity",
                resourceResolverFingerprint: hashB,
                resolveResource: inboxV2RecipientEntityResourceResolver
              }
            ],
            valueSchema: z.object({ data: z.unknown() }).strict(),
            validateValueContext:
              inboxV2RecipientValueHasNoTenantScopedReferences
          }
        ]
      })
    ).toThrow(/closed registered schema/u);

    const wrongSchema = batch();
    wrongSchema.commits[0]!.changes[0] = {
      ...wrongSchema.commits[0]!.changes[0]!,
      stateSchemaId: "core:unknown-projection"
    };
    expect(contracts.syncBatchSchema.safeParse(wrongSchema).success).toBe(
      false
    );

    const unsafeContracts = createTestRecipientSyncContracts({
      snapshotIndexScopeIds: ["core:employee-inbox"],
      projections: [
        {
          projectionTypeId: "core:unsafe-projection",
          entityTypeId: "core:conversation",
          stateSchemaId: "core:unsafe-projection",
          stateSchemaVersion: "v1",
          ...testValueContextDescriptor,
          authorizationRequirements: [
            {
              permissionId: "core:conversation.read",
              resourceScopeId: "core:conversation",
              resourceResolverId: "core:recipient-resource.entity",
              resourceResolverFingerprint: hashB,
              resolveResource: inboxV2RecipientEntityResourceResolver
            }
          ],
          valueSchema: z.object({ providerPayload: z.string() }).strict(),
          validateValueContext: inboxV2RecipientValueHasNoTenantScopedReferences
        }
      ]
    });
    const unsafeChange = {
      ...upsert(),
      stateSchemaId: "core:unsafe-projection",
      value: { providerPayload: "raw" }
    };
    expect(
      unsafeContracts.entityChangeSchema.safeParse(unsafeChange).success
    ).toBe(false);

    expect(
      contracts.entityChangeSchema.safeParse({
        ...upsert(),
        value: {
          kind: "conversation_summary",
          title: "x".repeat(INBOX_V2_MAX_RECIPIENT_VALUE_BYTES + 1)
        }
      }).success
    ).toBe(false);

    const largeChange = {
      ...wireChange(upsert()),
      value: {
        kind: "conversation_summary" as const,
        title: "x".repeat(900_000)
      }
    };
    const oversized = batch({
      fromExclusive: "103",
      scannedThrough: "104",
      commits: [recipientCommit("104", "mutation:oversized")]
    });
    oversized.commits[0]!.changes = Array.from({ length: 5 }, (_, index) => ({
      ...largeChange,
      recipientOrdinal: String(index + 1),
      sourceChangeOrdinal: String(index + 1)
    }));
    oversized.commits[0]!.recipientChangeCount = "5";
    expect(contracts.syncBatchSchema.safeParse(oversized).success).toBe(false);
  });

  it("classifies stale, duplicate, replacement and equal-revision conflict", () => {
    const current = {
      revision: "3",
      operation: "tombstone" as const,
      stateHash: hashA
    };
    expect(
      decideInboxV2EntityChangeApplication({
        current,
        incoming: {
          revision: "2",
          operation: "upsert",
          stateHash: stateFingerprintB
        }
      })
    ).toEqual({ kind: "stale" });
    expect(
      decideInboxV2EntityChangeApplication({ current, incoming: current })
    ).toEqual({ kind: "duplicate" });
    expect(
      decideInboxV2EntityChangeApplication({
        current,
        incoming: { ...current, stateHash: hashB }
      })
    ).toEqual({
      kind: "conflict",
      errorCode: "sync.revision_conflict"
    });
    expect(
      decideInboxV2EntityChangeApplication({
        current,
        incoming: {
          revision: "4",
          operation: "upsert",
          stateHash: stateFingerprintB
        }
      })
    ).toEqual({ kind: "apply" });
    expect(
      decideInboxV2EntityChangeApplication({
        current: {
          revision: "5",
          operation: "invalidate",
          stateHash: stateFingerprintA,
          invalidationHash: hashB
        },
        incoming: {
          revision: "5",
          operation: "upsert",
          stateHash: stateFingerprintA
        }
      })
    ).toEqual({ kind: "apply" });
    expect(
      decideInboxV2EntityChangeApplication({
        current: {
          revision: "5",
          operation: "upsert",
          stateHash: stateFingerprintA
        },
        incoming: {
          revision: "5",
          operation: "invalidate",
          stateHash: stateFingerprintA,
          invalidationHash: hashB
        }
      })
    ).toEqual({ kind: "duplicate" });
    expect(
      decideInboxV2SecurityPurgeApplication({
        activeAuthorizationEpoch: authorizationEpoch,
        previousAuthorizationEpoch: authorizationEpoch,
        resultingAuthorizationEpoch: nextAuthorizationEpoch
      })
    ).toEqual({ kind: "purge" });
  });

  it("dispatches heterogeneous registered projections in O(1) with authorization conjunctions", () => {
    const messageValueSchema = z
      .object({
        kind: z.literal("message_summary"),
        message: inboxV2MessageReferenceSchema,
        conversation: inboxV2ConversationReferenceSchema,
        text: z.string().max(2_000)
      })
      .strict();
    const staffNoteValueSchema = z
      .object({
        kind: z.literal("staff_note_summary"),
        excerpt: z.string().max(500)
      })
      .strict();
    const multiContracts = createTestRecipientSyncContracts({
      snapshotIndexScopeIds: ["core:employee-inbox"],
      projections: [
        defineInboxV2RecipientProjection({
          projectionTypeId: "core:message-summary",
          entityTypeId: "core:message",
          stateSchemaId: "core:message-summary",
          stateSchemaVersion: "v1",
          ...testValueContextDescriptor,
          authorizationRequirements: [
            {
              permissionId: "core:conversation.read",
              resourceScopeId: "core:conversation",
              resourceResolverId: "core:recipient-resource.value-conversation",
              resourceResolverFingerprint: hashB,
              resolveResource: ({
                value,
                timeline
              }: InboxV2RecipientAuthorizationResourceContext<
                z.output<typeof messageValueSchema>
              >) => {
                const conversation =
                  value?.conversation ?? timeline?.conversation;
                return conversation === undefined
                  ? null
                  : {
                      tenantId: conversation.tenantId,
                      entityTypeId: "core:conversation",
                      entityId: conversation.id
                    };
              }
            }
          ],
          valueSchema: messageValueSchema,
          validateValueContext: ({
            entity,
            timeline,
            value
          }: InboxV2RecipientProjectionValueContext<
            z.output<typeof messageValueSchema>
          >) =>
            timeline !== null &&
            value.message.tenantId === entity.tenantId &&
            String(value.message.id) === String(entity.entityId) &&
            value.conversation.tenantId === entity.tenantId &&
            value.conversation.tenantId === timeline.conversation.tenantId &&
            value.conversation.id === timeline.conversation.id
        }),
        {
          projectionTypeId: "core:staff-note-summary",
          entityTypeId: "core:staff-note",
          stateSchemaId: "core:staff-note-summary",
          stateSchemaVersion: "v1",
          ...testValueContextDescriptor,
          authorizationRequirements: [
            {
              permissionId: "core:staff-note.read",
              resourceScopeId: "core:staff-note",
              resourceResolverId: "module:staff:resource.entity",
              resourceResolverFingerprint: hashB,
              resolveResource: inboxV2RecipientEntityResourceResolver
            },
            {
              permissionId: "core:conversation.read",
              resourceScopeId: "core:conversation",
              resourceResolverId:
                "core:recipient-resource.timeline-conversation",
              resourceResolverFingerprint: hashB,
              resolveResource:
                inboxV2RecipientTimelineConversationResourceResolver
            }
          ],
          valueSchema: staffNoteValueSchema,
          validateValueContext: inboxV2RecipientValueHasNoTenantScopedReferences
        }
      ]
    });
    const conversationResource = {
      tenantId,
      entityTypeId: "core:conversation",
      entityId: "conversation:conversation-1"
    };
    const timeline = {
      conversation: {
        tenantId,
        kind: "conversation" as const,
        id: "conversation:conversation-1"
      },
      timelineSequence: "10"
    };
    const messageEntity = {
      tenantId,
      entityTypeId: "core:message",
      entityId: "message:message-1"
    };
    const staffEntity = {
      tenantId,
      entityTypeId: "core:staff-note",
      entityId: "staff_note:staff-1"
    };
    const messageChangeState = {
      recipientOrdinal: "1",
      sourceChangeOrdinal: "1",
      authorizationDecisionRefs: [
        resourceDecision({
          id: "authorization-decision:message-conversation",
          permissionId: "core:conversation.read",
          resourceScopeId: "core:conversation",
          resource: conversationResource
        })
      ],
      kind: "upsert" as const,
      projectionTypeId: "core:message-summary",
      entity: messageEntity,
      revision: "2",
      lastChangedStreamPosition: "104",
      timeline,
      stateSchemaId: "core:message-summary",
      stateSchemaVersion: "v1",
      value: {
        kind: "message_summary" as const,
        message: {
          tenantId,
          kind: "message" as const,
          id: "message:message-1"
        },
        conversation: timeline.conversation,
        text: "Hello"
      }
    };
    const messageChange = {
      ...messageChangeState,
      stateHash: calculateInboxV2RecipientUpsertStateHash(
        messageChangeState,
        stateProtection
      )
    };
    const staffChangeState = {
      recipientOrdinal: "2",
      sourceChangeOrdinal: "3",
      authorizationDecisionRefs: [
        resourceDecision({
          id: "authorization-decision:staff-conversation",
          permissionId: "core:conversation.read",
          resourceScopeId: "core:conversation",
          resource: conversationResource
        }),
        resourceDecision({
          id: "authorization-decision:staff-entity",
          permissionId: "core:staff-note.read",
          resourceScopeId: "core:staff-note",
          resource: staffEntity
        })
      ],
      kind: "upsert" as const,
      projectionTypeId: "core:staff-note-summary",
      entity: staffEntity,
      revision: "4",
      lastChangedStreamPosition: "104",
      timeline,
      stateSchemaId: "core:staff-note-summary",
      stateSchemaVersion: "v1",
      value: { kind: "staff_note_summary" as const, excerpt: "Internal" }
    };
    const staffChange = {
      ...staffChangeState,
      stateHash: calculateInboxV2RecipientUpsertStateHash(
        staffChangeState,
        stateProtection
      )
    };
    const heterogeneousBatch = {
      ...batch({ fromExclusive: "103", scannedThrough: "104", commits: [] }),
      commits: [
        {
          commitId: "commit:commit-104",
          streamPosition: "104",
          clientMutationIds: ["mutation:heterogeneous"],
          recipientChangeCount: "2",
          commitCompleteness: "complete" as const,
          changes: [wireChange(messageChange), wireChange(staffChange)]
        }
      ]
    };
    const parsed = multiContracts.syncBatchSchema.safeParse(heterogeneousBatch);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.commits[0]!.changes[0]!.kind).toBe("upsert");
    }

    const downgradedCommit = {
      ...heterogeneousBatch.commits[0]!,
      changes: [structuredClone(messageChange), structuredClone(staffChange)]
    };
    downgradedCommit.changes[1]!.authorizationDecisionRefs.pop();
    const acceptedHeterogeneous = acceptedInputCursor("103");
    const heterogeneousAuthorization =
      acceptedHeterogeneous.validationContext.authorization;
    expect(
      multiContracts.syncBatchProducerDeliverySchema.safeParse({
        batch: batchEnvelope(heterogeneousBatch),
        authorizedBatch: {
          ...heterogeneousBatch,
          commits: [downgradedCommit]
        },
        authorization: heterogeneousAuthorization,
        acceptedInputCursor: acceptedHeterogeneous,
        cursorMint: syncCursorMint(
          heterogeneousBatch.cursor,
          heterogeneousBatch.scannedThrough,
          "delta",
          authorizationEpoch,
          acceptedHeterogeneous.validationContext.now,
          heterogeneousAuthorization
        )
      }).success
    ).toBe(false);
    const unknownProjection = structuredClone(heterogeneousBatch);
    unknownProjection.commits[0]!.changes[0]!.projectionTypeId =
      "module:unknown:projection";
    expect(
      multiContracts.syncBatchSchema.safeParse(unknownProjection).success
    ).toBe(false);
  });

  it("keeps archived v1 read-only and rejects unsupported forward versions without cursor advance", () => {
    const archived = JSON.parse(archivedV1SyncBatchBytes) as unknown;
    expect(archivedV1SyncBatchBytes).toContain('"schemaVersion":"v1"');
    expect(contracts.parseSyncBatchEnvelope(archived)).toEqual({
      kind: "rejected",
      errorCode: "sync.schema_unsupported",
      cursorAdvance: null
    });
    expect(contracts.parseArchivedV1SyncBatchEnvelope(archived).kind).toBe(
      "parsed"
    );
    expect(contracts.parseSyncBatchEnvelope(batchEnvelope()).kind).toBe(
      "parsed"
    );

    expect(
      contracts.parseSyncBatchEnvelope({
        ...batchEnvelope(),
        schemaVersion: "v3"
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "sync.schema_unsupported",
      cursorAdvance: null
    });
    expect(
      contracts.parseArchivedV1SyncBatchEnvelope({
        ...(archived as Record<string, unknown>),
        payload: {
          ...((archived as { payload: Record<string, unknown> }).payload ?? {}),
          unknownRequiredField: true
        }
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "sync.envelope_invalid",
      cursorAdvance: null
    });
    expect(
      contracts.parseSnapshotPageEnvelope({
        ...snapshotPage(),
        schemaVersion: "v3"
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "sync.schema_unsupported",
      cursorAdvance: null
    });
    expect(
      contracts.parseRealtimeEnvelope({
        schemaId: INBOX_V2_REALTIME_ENVELOPE_SCHEMA_ID,
        schemaVersion: "v3",
        payload: { kind: "ready" }
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "sync.schema_unsupported",
      cursorAdvance: null
    });
    expect(
      contracts.parseArchivedV1SnapshotPageEnvelope(
        JSON.parse(archivedV1SnapshotBytes) as unknown
      ).kind
    ).toBe("parsed");
    expect(
      contracts.parseArchivedV1RealtimeEnvelope(
        JSON.parse(archivedV1RealtimeBytes) as unknown
      ).kind
    ).toBe("parsed");
    expect(
      contracts.parseSnapshotPageEnvelope(
        JSON.parse(archivedV1SnapshotBytes) as unknown
      )
    ).toEqual({
      kind: "rejected",
      errorCode: "sync.schema_unsupported",
      cursorAdvance: null
    });
    expect(
      contracts.parseRealtimeEnvelope(
        JSON.parse(archivedV1RealtimeBytes) as unknown
      )
    ).toEqual({
      kind: "rejected",
      errorCode: "sync.schema_unsupported",
      cursorAdvance: null
    });
  });

  it("uses the exact same batch for polling and SSE delta delivery", () => {
    const polling = batchEnvelope();
    const accepted = acceptedInputCursor(
      polling.payload.fromExclusive,
      polling.payload.authorizationEpoch
    );
    const currentAuthorization = accepted.validationContext.authorization;
    const delivery = {
      batch: polling,
      authorizedBatch: authorizedBatch(),
      authorization: currentAuthorization,
      acceptedInputCursor: accepted,
      cursorMint: syncCursorMint(
        polling.payload.cursor,
        polling.payload.scannedThrough,
        "delta",
        polling.payload.authorizationEpoch,
        accepted.validationContext.now,
        currentAuthorization
      )
    };
    expect(
      contracts.syncBatchProducerDeliverySchema.safeParse(delivery).success
    ).toBe(true);
    expect(
      contracts.syncBatchProducerDeliverySchema.safeParse({
        ...delivery,
        cursorMint: {
          ...delivery.cursorMint,
          claims: { ...delivery.cursorMint.claims, scannedThrough: "109" }
        }
      }).success
    ).toBe(false);
    const futureAuthorizedDelivery = structuredClone(delivery);
    futureAuthorizedDelivery.authorizedBatch.commits[0]!.changes[0]!.authorizationDecisionRefs[0]!.decidedAt =
      "2026-07-11T09:30:00.001Z";
    expect(
      contracts.syncBatchProducerDeliverySchema.safeParse(
        futureAuthorizedDelivery
      ).success
    ).toBe(false);
    const realtime = {
      schemaId: INBOX_V2_REALTIME_ENVELOPE_SCHEMA_ID,
      schemaVersion: "v2",
      payload: {
        kind: "delta" as const,
        batch: polling,
        sseEventId: polling.payload.cursor
      }
    };
    expect(contracts.realtimeEnvelopeSchema.safeParse(realtime).success).toBe(
      true
    );
    expect(
      contracts.realtimeEnvelopeSchema.safeParse({
        ...realtime,
        payload: { ...realtime.payload, sseEventId: "cursor:different:0001" }
      }).success
    ).toBe(false);
  });

  it("keeps every active client-wire payload recursively free of producer evidence", () => {
    const wireBatch = batchEnvelope();
    const wireSnapshot = snapshotPage(false);
    const wireTransition = {
      kind: "scope_transition" as const,
      tenantId,
      streamEpoch,
      syncGeneration: "1",
      previousScopeId: scope().id,
      resultingScope: scope(),
      transitionCause: "revoke_or_narrow" as const,
      previousAuthorizationEpoch: authorizationEpoch,
      resultingAuthorizationEpoch: nextAuthorizationEpoch,
      authorizationNotAfter: notAfter,
      transitionPosition: "111",
      scannedThrough: "111",
      projectionCheckpoint: "111",
      cursor: "cursor:recipient:111:wire",
      sseEventId: "cursor:recipient:111:wire",
      invalidations: [wireChange(invalidate())],
      closeAfterDelivery: true as const,
      nextAction: "snapshot_required" as const
    };
    const wireRealtime = {
      schemaId: INBOX_V2_REALTIME_ENVELOPE_SCHEMA_ID,
      schemaVersion: "v2",
      payload: {
        kind: "delta" as const,
        batch: wireBatch,
        sseEventId: wireBatch.payload.cursor
      }
    };

    for (const payload of [
      wireBatch,
      wireSnapshot,
      wireTransition,
      wireRealtime
    ]) {
      expect(findProducerOnlyWireKeys(payload)).toEqual([]);
    }
    expect(
      contracts.scopeTransitionSchema.safeParse(wireTransition).success
    ).toBe(true);
    expect(
      contracts.syncBatchEnvelopeSchema.safeParse({
        ...wireBatch,
        payload: {
          ...wireBatch.payload,
          commits: wireBatch.payload.commits.map((commit, index) =>
            index === 0
              ? {
                  ...commit,
                  changes: commit.changes.map((change) => ({
                    ...change,
                    authorizationDecisionRefs: [decision()]
                  }))
                }
              : commit
          )
        }
      }).success
    ).toBe(false);
  });

  it("moves an access epoch only through an invalidation-only scope transition", () => {
    const authorizedTransition = {
      kind: "scope_transition" as const,
      tenantId,
      streamEpoch,
      syncGeneration: "1",
      previousScopeId: "scope:employee-1",
      resultingScope: scope(),
      transitionCause: "revoke_or_narrow" as const,
      previousAuthorizationEpoch: authorizationEpoch,
      resultingAuthorizationEpoch: nextAuthorizationEpoch,
      authorizationNotAfter: notAfter,
      authorizationDecisionRefs: [decision(nextAuthorizationEpoch, "denied")],
      transitionPosition: "111",
      scannedThrough: "111",
      projectionCheckpoint: "111",
      cursor: "cursor:recipient:111:new-epoch",
      sseEventId: "cursor:recipient:111:new-epoch",
      invalidations: [invalidate()],
      closeAfterDelivery: true,
      nextAction: "snapshot_required" as const
    };
    const {
      authorizationDecisionRefs: _transitionEvidence,
      invalidations: authorizedInvalidations,
      ...wireTransitionBase
    } = authorizedTransition;
    const transition = {
      ...wireTransitionBase,
      invalidations: authorizedInvalidations.map((change) => wireChange(change))
    };
    expect(contracts.scopeTransitionSchema.safeParse(transition).success).toBe(
      true
    );
    expect(
      contracts.scopeTransitionSchema.safeParse({
        ...transition,
        invalidations: [
          {
            ...wireChange(invalidate()),
            scope: {
              kind: "conversation" as const,
              conversation: {
                tenantId: "tenant:tenant-2",
                kind: "conversation" as const,
                id: "conversation:conversation-2"
              }
            }
          }
        ]
      }).success
    ).toBe(false);
    const producedAt = "2026-07-11T09:30:00.000Z";
    const previousAuthorization = authorizationSnapshot(authorizationEpoch);
    const resultingAuthorization = authorizationSnapshot(
      nextAuthorizationEpoch,
      producedAt
    );
    const transitionDelivery = {
      transition,
      authorizedTransition,
      previousAuthorization,
      resultingAuthorization,
      inputCursorProof: {
        kind: "accepted_for_scope_transition" as const,
        inputCursor: "cursor:accepted-input:100:previous-scope",
        claims: {
          tenantId,
          employee: scope().employee,
          scopeId: scope().id,
          streamEpoch,
          syncGeneration: "1",
          authorizationEpoch,
          schemaVersion: "v2",
          resumeMode: "delta" as const,
          scannedThrough: "100",
          issuedAt: decidedAt,
          notAfter
        },
        verifiedAt: producedAt
      },
      cursorMint: syncCursorMint(
        transition.cursor,
        transition.scannedThrough,
        "snapshot_required",
        nextAuthorizationEpoch,
        producedAt,
        resultingAuthorization
      ),
      producedAt
    };
    expect(
      contracts.scopeTransitionProducerDeliverySchema.safeParse(
        transitionDelivery
      ).success
    ).toBe(true);
    expect(
      contracts.realtimeEnvelopeSchema.safeParse({
        schemaId: INBOX_V2_REALTIME_ENVELOPE_SCHEMA_ID,
        schemaVersion: "v2",
        payload: {
          kind: "scope_transition",
          transition,
          sseEventId: transition.sseEventId
        }
      }).success
    ).toBe(true);
    expect(
      contracts.scopeTransitionProducerDeliverySchema.safeParse({
        ...transitionDelivery,
        cursorMint: {
          ...transitionDelivery.cursorMint,
          claims: {
            ...transitionDelivery.cursorMint.claims,
            scannedThrough: "110"
          }
        }
      }).success
    ).toBe(false);

    const grantOnly = {
      ...transition,
      transitionCause: "grant_or_expand" as const,
      invalidations: []
    };
    expect(contracts.scopeTransitionSchema.safeParse(grantOnly).success).toBe(
      true
    );
    expect(
      contracts.scopeTransitionSchema.safeParse({
        ...transition,
        scannedThrough: "112",
        projectionCheckpoint: "112"
      }).success
    ).toBe(false);
    expect(
      contracts.scopeTransitionSchema.safeParse({
        ...transition,
        invalidations: [
          { ...wireChange(invalidate()), value: { title: "leak" } }
        ]
      }).success
    ).toBe(false);
  });

  it("keeps ready/heartbeat/resync control frames free of resumable SSE IDs", () => {
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
        authorizationNotAfter: notAfter,
        projectionCheckpoint: "109",
        tenantStreamHead: "110",
        lagPositions: "1",
        connectedAt: decidedAt
      }
    };
    expect(contracts.realtimeEnvelopeSchema.safeParse(ready).success).toBe(
      true
    );
    expect(
      contracts.realtimeReadyProducerDeliverySchema.safeParse({
        ready: ready.payload,
        authorization: authorizationSnapshot(authorizationEpoch, decidedAt)
      }).success
    ).toBe(true);
    expect(
      contracts.realtimeEnvelopeSchema.safeParse({
        ...ready,
        payload: { ...ready.payload, sseEventId: "cursor:must-not-resume" }
      }).success
    ).toBe(false);

    const heartbeat = {
      schemaId: INBOX_V2_REALTIME_ENVELOPE_SCHEMA_ID,
      schemaVersion: "v2",
      payload: {
        kind: "heartbeat" as const,
        tenantId,
        scopeId: "scope:employee-1",
        streamEpoch,
        syncGeneration: "1",
        authorizationEpoch,
        authorizationNotAfter: notAfter,
        projectionCheckpoint: "109",
        tenantStreamHead: "110",
        lagPositions: "1",
        sentAt: decidedAt
      }
    };
    expect(contracts.realtimeEnvelopeSchema.safeParse(heartbeat).success).toBe(
      true
    );
    expect(
      contracts.realtimeHeartbeatProducerDeliverySchema.safeParse({
        heartbeat: heartbeat.payload,
        scope: scope(),
        authorization: authorizationSnapshot(authorizationEpoch, decidedAt)
      }).success
    ).toBe(true);
    expect(
      contracts.realtimeEnvelopeSchema.safeParse({
        ...heartbeat,
        payload: { ...heartbeat.payload, cursor: "cursor:must-not-advance" }
      }).success
    ).toBe(false);

    const resync = {
      schemaId: INBOX_V2_REALTIME_ENVELOPE_SCHEMA_ID,
      schemaVersion: "v2",
      payload: {
        kind: "resync_required" as const,
        tenantId,
        scopeId: "scope:employee-1",
        errorCode: "sync.epoch_changed" as const,
        invalidations: [{ kind: "recipient_scope" as const }],
        close: true as const
      }
    };
    expect(contracts.realtimeEnvelopeSchema.safeParse(resync).success).toBe(
      true
    );
    expect(
      contracts.realtimeEnvelopeSchema.safeParse({
        ...resync,
        payload: { ...resync.payload, sseEventId: "cursor:must-not-resume" }
      }).success
    ).toBe(false);
    expect(
      contracts.realtimeEnvelopeSchema.safeParse({
        ...resync,
        payload: {
          ...resync.payload,
          invalidations: [
            {
              kind: "entity" as const,
              entity: {
                tenantId: "tenant:tenant-2",
                entityTypeId: "core:conversation",
                entityId: "conversation:conversation-2"
              }
            }
          ]
        }
      }).success
    ).toBe(false);
  });

  it("binds every snapshot page to one frozen manifest and exact cursors", () => {
    const delivery = snapshotDelivery();
    const parsedDelivery =
      contracts.snapshotPageProducerDeliverySchema.safeParse(delivery);
    expect(
      parsedDelivery.success,
      parsedDelivery.success
        ? undefined
        : JSON.stringify(parsedDelivery.error.issues)
    ).toBe(true);
    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse({
        ...delivery,
        pageCursorMint: {
          ...delivery.pageCursorMint!,
          claims: {
            ...delivery.pageCursorMint!.claims,
            manifestHash: hashA
          }
        }
      }).success
    ).toBe(false);
    const futureAuthorizedPage = structuredClone(delivery);
    futureAuthorizedPage.authorizedEntities[0]!.authorizationDecisionRefs[0]!.decidedAt =
      "2026-07-11T09:30:00.000Z";
    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse(
        futureAuthorizedPage
      ).success
    ).toBe(false);
    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse(
        snapshotDelivery(false)
      ).success
    ).toBe(true);

    const pageClaims = delivery.pageCursorMint!.claims;
    const current = delivery.snapshotContext;
    const acceptedPage = validateInboxV2SnapshotPageCursorClaims({
      cursor: delivery.pageCursorMint!.cursor,
      claims: pageClaims,
      current
    });
    expect(acceptedPage.kind).toBe("accepted");
    if (acceptedPage.kind === "accepted") {
      expect(acceptedPage.acceptedPageHash).toBe(
        delivery.page.payload.pagePosition.pageHash
      );
      expect(acceptedPage.nextPageOrdinal).toBe("2");
    }
    expect(
      validateInboxV2SnapshotPageCursorClaims({
        cursor: delivery.pageCursorMint!.cursor,
        claims: { ...pageClaims, manifestHash: hashA },
        current
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "sync.cursor_invalid",
      cursorAdvance: null
    });

    const duplicatePage = snapshotPage();
    duplicatePage.payload.entities.push({
      ...wireChange(upsert()),
      recipientOrdinal: "2"
    });
    expect(
      contracts.snapshotPageEnvelopeSchema.safeParse(duplicatePage).success
    ).toBe(false);
    const incompleteManifest = snapshotDelivery();
    incompleteManifest.authorizedManifest.registrations[0]!.authorizationRequirements =
      [];
    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse(incompleteManifest)
        .success
    ).toBe(false);
    const expiredDecisionPage = snapshotDelivery();
    expiredDecisionPage.authorizedEntities[0]!.authorizationDecisionRefs[0]!.decidedAt =
      notAfter;
    expect(
      contracts.snapshotPageProducerDeliverySchema.safeParse(
        expiredDecisionPage
      ).success
    ).toBe(false);

    const foreignBatch = batch();
    foreignBatch.commits[0]!.changes[0]!.entity.tenantId = "tenant:tenant-2";
    expect(contracts.syncBatchSchema.safeParse(foreignBatch).success).toBe(
      false
    );
    const foreignSnapshot = snapshotPage();
    foreignSnapshot.payload.entities[0]!.entity.tenantId = "tenant:tenant-2";
    expect(
      contracts.snapshotPageEnvelopeSchema.safeParse(foreignSnapshot).success
    ).toBe(false);
    const foreignTimelineSnapshot = snapshotPage();
    (
      foreignTimelineSnapshot.payload.entities[0]! as { timeline: unknown }
    ).timeline = {
      conversation: {
        tenantId: "tenant:tenant-2",
        kind: "conversation",
        id: "conversation:conversation-2"
      },
      timelineSequence: "1"
    };
    expect(
      contracts.snapshotPageEnvelopeSchema.safeParse(foreignTimelineSnapshot)
        .success
    ).toBe(false);
  });

  it("exposes every stable cursor/resync outcome", () => {
    const errors = [
      "sync.cursor_invalid",
      "sync.cursor_future",
      "sync.cursor_expired",
      "sync.epoch_changed",
      "sync.scope_changed",
      "sync.schema_unsupported",
      "sync.gap_detected",
      "sync.resync_required"
    ];
    expect(
      errors.every(
        (errorCode) =>
          inboxV2SyncCursorErrorCodeSchema.safeParse(errorCode).success
      )
    ).toBe(true);
  });

  it("revalidates opaque cursor claims against scope, epochs, time and retained prefix", () => {
    const claims = {
      tenantId,
      employee: scope().employee,
      scopeId: "scope:employee-1",
      streamEpoch,
      syncGeneration: "1",
      authorizationEpoch,
      schemaVersion: "v2",
      resumeMode: "delta" as const,
      scannedThrough: "99",
      issuedAt: decidedAt,
      notAfter
    };
    const current = {
      tenantId,
      employee: scope().employee,
      scopeId: "scope:employee-1",
      streamEpoch,
      syncGeneration: "1",
      authorization: authorizationSnapshot(
        authorizationEpoch,
        "2026-07-11T09:30:00.000Z"
      ),
      supportedSchemaVersions: ["v2"],
      minRetainedTenantStreamPosition: "100",
      minReplayableRecipientPosition: "100",
      projectionCheckpoint: "110",
      tenantStreamHead: "112",
      now: "2026-07-11T09:30:00.000Z"
    };
    const cursor = "cursor:recipient:99:validation";

    const accepted = validateInboxV2SyncCursorClaims({
      cursor,
      claims,
      current
    });
    expect(accepted.kind).toBe("accepted");
    if (accepted.kind === "accepted") {
      expect(accepted.fromExclusive).toBe("99");
    }
    expect(
      validateInboxV2SyncCursorClaims({
        cursor,
        claims: { ...claims, resumeMode: "snapshot_required" },
        current
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "sync.resync_required",
      cursorAdvance: null
    });
    expect(
      validateInboxV2SyncCursorClaims({
        cursor,
        claims: { ...claims, scannedThrough: "98" },
        current
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "sync.cursor_expired",
      cursorAdvance: null
    });
    expect(
      validateInboxV2SyncCursorClaims({
        cursor,
        claims,
        current: {
          ...current,
          authorization: authorizationSnapshot(nextAuthorizationEpoch)
        }
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "sync.scope_changed",
      cursorAdvance: null
    });
    expect(
      validateInboxV2SyncCursorClaims({
        cursor,
        claims,
        current: { ...current, streamEpoch: "stream:epoch:restored" }
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "sync.epoch_changed",
      cursorAdvance: null
    });
    expect(
      validateInboxV2SyncCursorClaims({
        cursor,
        claims,
        current: { ...current, syncGeneration: "2" }
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "sync.epoch_changed",
      cursorAdvance: null
    });
    expect(
      validateInboxV2SyncCursorClaims({
        cursor,
        claims: { ...claims, scannedThrough: "111" },
        current
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "sync.gap_detected",
      cursorAdvance: null
    });
    expect(
      validateInboxV2SyncCursorClaims({
        cursor,
        claims: { ...claims, scannedThrough: "113" },
        current
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "sync.cursor_future",
      cursorAdvance: null
    });
    expect(
      validateInboxV2SyncCursorClaims({
        cursor,
        claims,
        current: { ...current, now: notAfter }
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "sync.cursor_expired",
      cursorAdvance: null
    });
    expect(
      validateInboxV2SyncCursorClaims({
        cursor,
        claims: { broken: true },
        current
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "sync.cursor_invalid",
      cursorAdvance: null
    });
    expect(
      validateInboxV2SyncCursorClaims({
        cursor,
        claims: {
          ...claims,
          employee: { ...claims.employee, id: "employee:employee-2" }
        },
        current
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "sync.cursor_invalid",
      cursorAdvance: null
    });
    expect(
      validateInboxV2SyncCursorClaims({
        cursor,
        claims: { ...claims, scannedThrough: "103" },
        current: { ...current, minReplayableRecipientPosition: "105" }
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "sync.cursor_expired",
      cursorAdvance: null
    });
    expect(
      validateInboxV2SyncCursorClaims({
        cursor,
        claims: { ...claims, schemaVersion: "v3" },
        current
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "sync.schema_unsupported",
      cursorAdvance: null
    });
    expect(
      validateInboxV2SyncCursorClaims({
        cursor,
        claims: { ...claims, issuedAt: notAfter },
        current
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "sync.cursor_invalid",
      cursorAdvance: null
    });
  });
});
