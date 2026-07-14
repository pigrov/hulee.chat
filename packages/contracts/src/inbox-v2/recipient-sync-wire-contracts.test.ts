import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  INBOX_V2_MAX_SYNC_FRAME_BYTES,
  INBOX_V2_REALTIME_ENVELOPE_SCHEMA_ID,
  INBOX_V2_RECIPIENT_SNAPSHOT_PAGE_SCHEMA_ID,
  INBOX_V2_RECIPIENT_SYNC_BATCH_SCHEMA_ID,
  INBOX_V2_RECIPIENT_SYNC_SCHEMA_VERSION
} from "./recipient-sync-constants";
import {
  calculateInboxV2SnapshotCumulativePageChainHash,
  calculateInboxV2SnapshotManifestHash,
  calculateInboxV2SnapshotPageHash
} from "./recipient-sync-hash";
import {
  defineInboxV2RecipientProjection,
  defineInboxV2RecipientWireProjection,
  deriveInboxV2RecipientWireProjectionRegistrations,
  inboxV2RecipientEntityResourceResolver,
  inboxV2RecipientEntityResourceResolverSemantic,
  inboxV2RecipientValueHasNoTenantScopedReferences,
  inboxV2RecipientValueHasNoTenantScopedReferencesSemantic
} from "./recipient-sync-projection";
import { createInboxV2RecipientWireSyncContracts } from "./recipient-sync-wire-contracts";

const digestA = `sha256:${"a".repeat(64)}`;
const digestC = `sha256:${"c".repeat(64)}`;
const stateFingerprint = `hmac-sha256:generation-1:${"b".repeat(64)}`;
const tenantId = "tenant:tenant-1";
const authorizationEpoch = "authorization:epoch-0001";
const authorizationNotAfter = "2026-07-11T10:00:00.000Z";
const snapshotIssuedAt = "2026-07-11T09:00:00.000Z";
const cursor = "cursor:wire-result-0001";

const projection = defineInboxV2RecipientWireProjection({
  projectionTypeId: "core:wire-conversation-summary",
  entityTypeId: "core:conversation",
  stateSchemaId: "core:wire-conversation-summary",
  stateSchemaVersion: "v1",
  ...inboxV2RecipientValueHasNoTenantScopedReferencesSemantic,
  valueSchema: z
    .object({
      kind: z.literal("wire_conversation_summary"),
      title: z.string().min(1),
      metadata: z
        .object({
          key: z.string().optional(),
          claims: z.string().optional()
        })
        .strict()
        .optional()
    })
    .strict(),
  validateValueContext: inboxV2RecipientValueHasNoTenantScopedReferences
});

const highConfidenceForbiddenValueKeys = [
  "acceptedInput",
  "acceptedInputCursor",
  "authorization",
  "authorizationDecisionRefs",
  "authorizationProof",
  "authorizationRequirements",
  "authorizationSnapshot",
  "authorizedBatch",
  "authorizedEntities",
  "authorizedManifest",
  "authorizedTransition",
  "cursorMint",
  "currentAuthorization",
  "decodedClaims",
  "employeeAccessRevision",
  "employeeInboxRelationRevision",
  "frozenAuthorization",
  "inputCursorProof",
  "pageCursorMint",
  "pageMint",
  "previousAuthorization",
  "resolveResource",
  "resourceDependencies",
  "resourceResolver",
  "resourceResolverFingerprint",
  "resourceResolverId",
  "resultingAuthorization",
  "resumeClaims",
  "resumeCursorMint",
  "sharedAccessRevision",
  "snapshotContext",
  "stateFingerprintProtection",
  "temporalBoundaryDigest",
  "tenantRbacRevision",
  "validationContext",
  "verifyRecipientStateFingerprint"
] as const;

const closedMarkerValueSchema = z.union([
  z.string(),
  z.array(z.string()),
  z.object({ marker: z.string() }).strict()
]);
const highConfidenceForbiddenValueShape = Object.fromEntries(
  highConfidenceForbiddenValueKeys.map((key) => [
    key,
    closedMarkerValueSchema.optional()
  ])
) as Record<
  (typeof highConfidenceForbiddenValueKeys)[number],
  z.ZodOptional<typeof closedMarkerValueSchema>
>;

const dependencyVectorShapeSchema = z
  .object({
    tenantRbacRevision: z.string(),
    employeeAccessRevision: z.string(),
    employeeInboxRelationRevision: z.string(),
    sharedAccessRevision: z.string(),
    resourceDependencies: z.array(z.string()),
    temporalBoundaryDigest: z.string()
  })
  .strict();
const authorizationSnapshotShapeSchema = z
  .object({
    tenantId: z.string(),
    employee: z.object({ tenantId: z.string(), id: z.string() }).strict(),
    value: z.string(),
    dependencies: dependencyVectorShapeSchema,
    evaluatedAt: z.string(),
    notAfter: z.string(),
    nextAuthorizationBoundary: z.string().nullable()
  })
  .strict();
const syncCursorClaimsShapeSchema = z
  .object({
    tenantId: z.string(),
    employee: z.object({ tenantId: z.string(), id: z.string() }).strict(),
    scopeId: z.string(),
    streamEpoch: z.string(),
    syncGeneration: z.string(),
    authorizationEpoch: z.string(),
    schemaVersion: z.string(),
    resumeMode: z.enum(["delta", "snapshot_required"]),
    scannedThrough: z.string(),
    issuedAt: z.string(),
    notAfter: z.string()
  })
  .strict();
const pageCursorClaimsShapeSchema = z
  .object({
    tenantId: z.string(),
    employee: z.object({ tenantId: z.string(), id: z.string() }).strict(),
    scopeId: z.string(),
    snapshotId: z.string(),
    streamEpoch: z.string(),
    syncGeneration: z.string(),
    authorizationEpoch: z.string(),
    schemaVersion: z.string(),
    snapshotCheckpoint: z.string(),
    manifestHash: z.string(),
    snapshotContextHash: z.string(),
    nextPageOrdinal: z.string(),
    afterExclusive: z.object({ entityId: z.string() }).strict(),
    acceptedPageHash: z.string(),
    acceptedCumulativeEntityCount: z.string(),
    acceptedCumulativePageChainHash: z.string(),
    issuedAt: z.string(),
    notAfter: z.string()
  })
  .strict();
const authorizationDecisionShapeSchema = z
  .object({
    tenantId: z.string(),
    id: z.string(),
    authorizationEpoch: z.string(),
    principal: z.object({ kind: z.string() }).strict(),
    permissionId: z.string(),
    resourceScopeId: z.string(),
    resource: z.object({ entityId: z.string() }).strict(),
    resourceAccessRevision: z.string(),
    decisionRevision: z.string(),
    decisionHash: z.string(),
    outcome: z.enum(["allowed", "denied"]),
    decidedAt: z.string(),
    notAfter: z.string()
  })
  .strict();
const authorizationRequirementShapeSchema = z
  .object({
    permissionId: z.string(),
    resourceScopeId: z.string(),
    resourceResolver: z
      .object({ semanticId: z.string(), fingerprint: z.string() })
      .strict()
  })
  .strict();
const richManifestShapeSchema = z
  .object({
    completeness: z.literal("complete_for_scope"),
    registrations: z.array(
      z
        .object({
          projectionTypeId: z.string(),
          authorizationRequirements: z.array(
            authorizationRequirementShapeSchema
          )
        })
        .strict()
    ),
    indexScopeIds: z.array(z.string())
  })
  .strict();
const cursorMintShapeSchema = z
  .object({
    cursor: z.string(),
    claims: z.union([syncCursorClaimsShapeSchema, pageCursorClaimsShapeSchema]),
    authorization: authorizationSnapshotShapeSchema
  })
  .strict();
const acceptedProofShapeSchema = z
  .object({
    kind: z.enum(["accepted", "accepted_for_scope_transition"]),
    inputCursor: z.string(),
    claims: syncCursorClaimsShapeSchema,
    verifiedAt: z.string()
  })
  .strict();
const fingerprintProtectionShapeSchema = z
  .object({
    tenantId: z.string(),
    purpose: z.literal("recipient_state_integrity"),
    keyGeneration: z.string(),
    key: z.array(z.number())
  })
  .strict();

const permissiveMetadataSchema = z
  .object({
    ...highConfidenceForbiddenValueShape,
    key: z.string().optional(),
    claims: z.string().optional(),
    authorizationEpoch: z.string().optional(),
    authorizationNotAfter: z.string().optional(),
    businessContext: z
      .object({ tenantId: z.string(), label: z.string() })
      .strict()
      .optional(),
    customAuthorizationSnapshot: authorizationSnapshotShapeSchema.optional(),
    customDependencyVector: dependencyVectorShapeSchema.optional(),
    customSyncCursorClaims: syncCursorClaimsShapeSchema.optional(),
    customPageCursorClaims: pageCursorClaimsShapeSchema.optional(),
    customCursorMint: cursorMintShapeSchema.optional(),
    customAcceptedProof: acceptedProofShapeSchema.optional(),
    customAuthorizationDecision: authorizationDecisionShapeSchema.optional(),
    customAuthorizationDecisions: z
      .array(authorizationDecisionShapeSchema)
      .optional(),
    customAuthorizationRequirement:
      authorizationRequirementShapeSchema.optional(),
    customFingerprintProtection: fingerprintProtectionShapeSchema.optional(),
    customRichManifest: richManifestShapeSchema.optional()
  })
  .strict();

const permissiveProjection = defineInboxV2RecipientWireProjection({
  projectionTypeId: "core:wire-permissive-summary",
  entityTypeId: "core:conversation",
  stateSchemaId: "core:wire-permissive-summary",
  stateSchemaVersion: "v1",
  valueContextValidatorId: "core:wire-permissive-value-context",
  valueContextValidatorFingerprint: digestA,
  valueSchema: z
    .object({
      kind: z.literal("wire_permissive_summary"),
      metadata: permissiveMetadataSchema
    })
    .strict(),
  validateValueContext: () => true
});

const contracts = createInboxV2RecipientWireSyncContracts({
  projections: [projection],
  snapshotIndexScopeIds: ["core:employee-inbox"]
});

const permissiveContracts = createInboxV2RecipientWireSyncContracts({
  projections: [permissiveProjection],
  snapshotIndexScopeIds: ["core:employee-inbox"]
});

const serverProjection = defineInboxV2RecipientProjection({
  ...projection,
  authorizationRequirements: [
    {
      permissionId: "core:conversation.read",
      resourceScopeId: "core:conversation",
      ...inboxV2RecipientEntityResourceResolverSemantic,
      resolveResource: inboxV2RecipientEntityResourceResolver
    }
  ]
});

const scope = {
  id: "scope:employee-inbox-1",
  kind: "employee_inbox" as const,
  employee: {
    tenantId,
    kind: "employee" as const,
    id: "employee:employee-1"
  }
};

const entity = {
  tenantId,
  entityTypeId: "core:conversation",
  entityId: "conversation:conversation-1"
} as const;

function upsert() {
  return {
    recipientOrdinal: "1",
    sourceChangeOrdinal: "1",
    kind: "upsert" as const,
    projectionTypeId: "core:wire-conversation-summary",
    entity,
    revision: "1",
    lastChangedStreamPosition: "1",
    timeline: null,
    stateSchemaId: "core:wire-conversation-summary",
    stateSchemaVersion: "v1",
    stateHash: stateFingerprint,
    value: {
      kind: "wire_conversation_summary" as const,
      title: "Support"
    }
  };
}

function permissiveUpsert(metadata: z.input<typeof permissiveMetadataSchema>) {
  return {
    recipientOrdinal: "1",
    sourceChangeOrdinal: "1",
    kind: "upsert" as const,
    projectionTypeId: "core:wire-permissive-summary",
    entity: {
      tenantId,
      entityTypeId: "core:conversation",
      entityId: "conversation:permissive-1"
    },
    revision: "1",
    lastChangedStreamPosition: "1",
    timeline: null,
    stateSchemaId: "core:wire-permissive-summary",
    stateSchemaVersion: "v1",
    stateHash: stateFingerprint,
    value: {
      kind: "wire_permissive_summary" as const,
      metadata
    }
  };
}

function dependencyVectorShape() {
  return {
    tenantRbacRevision: "1",
    employeeAccessRevision: "1",
    employeeInboxRelationRevision: "1",
    sharedAccessRevision: "1",
    resourceDependencies: [],
    temporalBoundaryDigest: digestA
  };
}

function authorizationSnapshotShape() {
  return {
    tenantId,
    employee: { tenantId, id: "employee:employee-1" },
    value: authorizationEpoch,
    dependencies: dependencyVectorShape(),
    evaluatedAt: snapshotIssuedAt,
    notAfter: authorizationNotAfter,
    nextAuthorizationBoundary: null
  };
}

function syncCursorClaimsShape() {
  return {
    tenantId,
    employee: { tenantId, id: "employee:employee-1" },
    scopeId: "scope:employee-inbox-1",
    streamEpoch: "stream:epoch-0001",
    syncGeneration: "1",
    authorizationEpoch,
    schemaVersion: "v2",
    resumeMode: "delta" as const,
    scannedThrough: "1",
    issuedAt: snapshotIssuedAt,
    notAfter: authorizationNotAfter
  };
}

function pageCursorClaimsShape() {
  return {
    tenantId,
    employee: { tenantId, id: "employee:employee-1" },
    scopeId: "scope:employee-inbox-1",
    snapshotId: "snapshot:wire-1",
    streamEpoch: "stream:epoch-0001",
    syncGeneration: "1",
    authorizationEpoch,
    schemaVersion: "v2",
    snapshotCheckpoint: "1",
    manifestHash: digestA,
    snapshotContextHash: digestC,
    nextPageOrdinal: "2",
    afterExclusive: { entityId: "conversation:permissive-1" },
    acceptedPageHash: digestA,
    acceptedCumulativeEntityCount: "1",
    acceptedCumulativePageChainHash: digestC,
    issuedAt: snapshotIssuedAt,
    notAfter: authorizationNotAfter
  };
}

function authorizationDecisionShape() {
  return {
    tenantId,
    id: "authorization-decision:1",
    authorizationEpoch,
    principal: { kind: "employee" },
    permissionId: "core:conversation.read",
    resourceScopeId: "core:conversation",
    resource: { entityId: "conversation:permissive-1" },
    resourceAccessRevision: "1",
    decisionRevision: "1",
    decisionHash: digestA,
    outcome: "allowed" as const,
    decidedAt: snapshotIssuedAt,
    notAfter: authorizationNotAfter
  };
}

function authorizationRequirementShape() {
  return {
    permissionId: "core:conversation.read",
    resourceScopeId: "core:conversation",
    resourceResolver: {
      semanticId: "core:recipient-resource.entity",
      fingerprint: digestA
    }
  };
}

function richManifestShape() {
  return {
    completeness: "complete_for_scope" as const,
    registrations: [
      {
        projectionTypeId: "core:wire-permissive-summary",
        authorizationRequirements: [authorizationRequirementShape()]
      }
    ],
    indexScopeIds: ["core:employee-inbox"]
  };
}

function syncBatchEnvelope() {
  return {
    schemaId: INBOX_V2_RECIPIENT_SYNC_BATCH_SCHEMA_ID,
    schemaVersion: INBOX_V2_RECIPIENT_SYNC_SCHEMA_VERSION,
    payload: {
      tenantId,
      streamEpoch: "stream:epoch-0001",
      syncGeneration: "1",
      scopeId: scope.id,
      scope,
      authorizationEpoch,
      authorizationNotAfter,
      fromExclusive: "0",
      scannedThrough: "1",
      projectionCheckpoint: "1",
      hasMore: false,
      cursor,
      commits: [
        {
          commitId: "commit:wire-1",
          streamPosition: "1",
          clientMutationIds: ["mutation:wire-1"],
          recipientChangeCount: "1",
          commitCompleteness: "complete" as const,
          changes: [upsert()]
        }
      ]
    }
  };
}

function largeSyncBatchPayload() {
  const commitCount = 16;
  const changesPerCommit = 256;
  return {
    tenantId,
    streamEpoch: "stream:epoch-0001",
    syncGeneration: "1",
    scopeId: scope.id,
    scope,
    authorizationEpoch,
    authorizationNotAfter,
    fromExclusive: "0",
    scannedThrough: String(commitCount),
    projectionCheckpoint: String(commitCount),
    hasMore: false,
    cursor: "cursor:wire-large-result-0001",
    commits: Array.from({ length: commitCount }, (_, commitIndex) => {
      const streamPosition = String(commitIndex + 1);
      return {
        commitId: `commit:wire-large-${commitIndex + 1}`,
        streamPosition,
        clientMutationIds: [],
        recipientChangeCount: String(changesPerCommit),
        commitCompleteness: "complete" as const,
        changes: Array.from({ length: changesPerCommit }, (_, changeIndex) => {
          const ordinal = String(changeIndex + 1);
          const globalIndex = commitIndex * changesPerCommit + changeIndex + 1;
          return {
            recipientOrdinal: ordinal,
            sourceChangeOrdinal: ordinal,
            kind: "upsert" as const,
            projectionTypeId: "core:wire-conversation-summary",
            entity: {
              tenantId,
              entityTypeId: "core:conversation",
              entityId: `conversation:large-${globalIndex}`
            },
            revision: "1",
            lastChangedStreamPosition: streamPosition,
            timeline: null,
            stateSchemaId: "core:wire-conversation-summary",
            stateSchemaVersion: "v1",
            stateHash: stateFingerprint,
            value: {
              kind: "wire_conversation_summary" as const,
              title: "x"
            }
          };
        })
      };
    })
  };
}

function snapshotPageEnvelope() {
  const manifestDefinitionHash = digestA;
  const pageHash = calculateInboxV2SnapshotPageHash({
    frozenContext: {
      tenantId,
      scopeId: scope.id,
      snapshotId: "snapshot:wire-1",
      streamEpoch: "stream:epoch-0001",
      syncGeneration: "1",
      authorizationEpoch,
      schemaVersion: INBOX_V2_RECIPIENT_SYNC_SCHEMA_VERSION,
      snapshotCheckpoint: "1",
      snapshotIssuedAt,
      manifestDefinitionHash
    },
    position: {
      ordinal: "1",
      afterExclusive: null,
      firstInclusive: null,
      throughInclusive: null,
      entityCount: "0",
      previousPageHash: null,
      previousCumulativeEntityCount: "0",
      cumulativeEntityCount: "0",
      previousCumulativePageChainHash: null
    },
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
  } as const;
  const manifestHash = calculateInboxV2SnapshotManifestHash({
    manifestDefinitionHash,
    coverage
  });

  return {
    schemaId: INBOX_V2_RECIPIENT_SNAPSHOT_PAGE_SCHEMA_ID,
    schemaVersion: INBOX_V2_RECIPIENT_SYNC_SCHEMA_VERSION,
    payload: {
      tenantId,
      streamEpoch: "stream:epoch-0001",
      syncGeneration: "1",
      scopeId: scope.id,
      scope,
      authorizationEpoch,
      authorizationNotAfter,
      manifest: {
        completeness: "complete_for_scope" as const,
        registrations: [
          {
            projectionTypeId: "core:wire-conversation-summary",
            entityTypeId: "core:conversation",
            stateSchemaId: "core:wire-conversation-summary",
            stateSchemaVersion: "v1",
            valueContextValidator: {
              semanticId:
                "core:recipient-value-context.no-tenant-scoped-references",
              fingerprint: projection.valueContextValidatorFingerprint
            }
          }
        ],
        indexScopeIds: ["core:employee-inbox"],
        manifestDefinitionHash,
        manifestHash,
        coverage
      },
      snapshotId: "snapshot:wire-1",
      snapshotCheckpoint: "1",
      snapshotContextHash: digestC,
      snapshotIssuedAt,
      resumeAfter: cursor,
      pageCursor: null,
      pagePosition: {
        ordinal: "1",
        afterExclusive: null,
        firstInclusive: null,
        throughInclusive: null,
        entityCount: "0",
        previousPageHash: null,
        pageHash,
        previousCumulativeEntityCount: "0",
        cumulativeEntityCount: "0",
        previousCumulativePageChainHash: null,
        cumulativePageChainHash: pageChainRootHash
      },
      finalCompletion: {
        snapshotId: "snapshot:wire-1",
        manifestHash,
        snapshotCheckpoint: "1",
        pageCount: "1",
        entityCount: "0",
        finalEntity: null,
        pageChainRootHash
      },
      hasMore: false,
      entities: []
    }
  };
}

function heartbeatEnvelope() {
  return {
    schemaId: INBOX_V2_REALTIME_ENVELOPE_SCHEMA_ID,
    schemaVersion: INBOX_V2_RECIPIENT_SYNC_SCHEMA_VERSION,
    payload: {
      kind: "heartbeat" as const,
      tenantId,
      scopeId: scope.id,
      streamEpoch: "stream:epoch-0001",
      syncGeneration: "1",
      authorizationEpoch,
      authorizationNotAfter,
      projectionCheckpoint: "1",
      tenantStreamHead: "1",
      lagPositions: "0",
      sentAt: snapshotIssuedAt
    }
  };
}

describe("Inbox V2 client-only recipient wire contracts", () => {
  it("parses only active wire batches and preserves typed projection values", () => {
    const parsed = contracts.parseSyncBatchEnvelope(syncBatchEnvelope());
    expect(parsed.kind).toBe("parsed");
    if (parsed.kind !== "parsed") {
      return;
    }

    const change = parsed.value.payload.commits[0]!.changes[0]!;
    expect(change).not.toHaveProperty("authorizationDecisionRefs");
    if (change.kind === "upsert") {
      expect(change.value.title).toBe("Support");
    }

    const archived = structuredClone(syncBatchEnvelope());
    archived.schemaVersion = "v1" as typeof archived.schemaVersion;
    expect(contracts.parseSyncBatchEnvelope(archived)).toEqual({
      kind: "rejected",
      errorCode: "sync.schema_unsupported",
      cursorAdvance: null
    });
  });

  it("accepts the declared 4096-change batch near the frame byte budget", () => {
    const batch = largeSyncBatchPayload();
    const encoder = new TextEncoder();
    const baselineBytes = encoder.encode(JSON.stringify(batch)).byteLength;
    const targetBytes = INBOX_V2_MAX_SYNC_FRAME_BYTES - 64 * 1024;
    const paddingPerChange = Math.max(
      0,
      Math.floor((targetBytes - baselineBytes) / 4_096)
    );
    const paddedTitle = "x".repeat(1 + paddingPerChange);
    for (const commit of batch.commits) {
      for (const change of commit.changes) {
        change.value.title = paddedTitle;
      }
    }

    const encodedBytes = encoder.encode(JSON.stringify(batch)).byteLength;
    expect(encodedBytes).toBeGreaterThan(
      Math.floor(INBOX_V2_MAX_SYNC_FRAME_BYTES * 0.9)
    );
    expect(encodedBytes).toBeLessThan(INBOX_V2_MAX_SYNC_FRAME_BYTES);
    expect(batch.commits.flatMap((commit) => commit.changes)).toHaveLength(
      4_096
    );
    expect(contracts.syncBatchSchema.safeParse(batch).success).toBe(true);
  });

  it("terminates and rejects an oversized adversarial 4096-change batch", () => {
    const batch = largeSyncBatchPayload();
    const encoder = new TextEncoder();
    const baselineBytes = encoder.encode(JSON.stringify(batch)).byteLength;
    const targetBytes = INBOX_V2_MAX_SYNC_FRAME_BYTES - 64 * 1024;
    const paddingPerChange = Math.max(
      0,
      Math.floor((targetBytes - baselineBytes) / 4_096)
    );
    const oversizedTitle = "x".repeat(1 + paddingPerChange + 32);
    for (const commit of batch.commits) {
      for (const change of commit.changes) {
        change.value.title = oversizedTitle;
      }
    }

    expect(encoder.encode(JSON.stringify(batch)).byteLength).toBeGreaterThan(
      INBOX_V2_MAX_SYNC_FRAME_BYTES
    );
    expect(contracts.syncBatchSchema.safeParse(batch).success).toBe(false);
  });

  it("verifies opaque manifest-to-coverage and page-chain commitments", () => {
    const snapshot = snapshotPageEnvelope();
    expect(contracts.parseSnapshotPageEnvelope(snapshot).kind).toBe("parsed");

    const tamperedDefinition = structuredClone(snapshot);
    tamperedDefinition.payload.manifest.manifestDefinitionHash = digestC;
    expect(contracts.parseSnapshotPageEnvelope(tamperedDefinition).kind).toBe(
      "rejected"
    );

    const tamperedCoverage = structuredClone(snapshot) as unknown as {
      payload: {
        manifest: { coverage: { pageChainRootHash: string } };
      };
    };
    tamperedCoverage.payload.manifest.coverage.pageChainRootHash = digestC;
    expect(contracts.parseSnapshotPageEnvelope(tamperedCoverage).kind).toBe(
      "rejected"
    );

    const leakedResolver = structuredClone(snapshot) as unknown as {
      payload: { manifest: { registrations: Array<Record<string, unknown>> } };
    };
    leakedResolver.payload.manifest.registrations[0]!.authorizationRequirements =
      [];
    expect(contracts.parseSnapshotPageEnvelope(leakedResolver).kind).toBe(
      "rejected"
    );
  });

  it("keeps heartbeat authorization bounds opaque and rejects nested proof topology", () => {
    const heartbeat = heartbeatEnvelope();
    const parsed = contracts.parseRealtimeEnvelope(heartbeat);
    expect(parsed.kind).toBe("parsed");
    if (parsed.kind === "parsed" && parsed.value.payload.kind === "heartbeat") {
      expect(parsed.value.payload.authorizationEpoch).toBe(authorizationEpoch);
      expect(parsed.value.payload.authorizationNotAfter).toBe(
        authorizationNotAfter
      );
    }

    const leakedBatch = structuredClone(syncBatchEnvelope()) as unknown as {
      payload: {
        commits: Array<{
          changes: Array<Record<string, unknown>>;
        }>;
      };
    };
    leakedBatch.payload.commits[0]!.changes[0]!.authorizationDecisionRefs = [];
    expect(contracts.parseSyncBatchEnvelope(leakedBatch).kind).toBe("rejected");

    const leakedCommit = structuredClone(syncBatchEnvelope()) as unknown as {
      payload: { commits: Array<Record<string, unknown>> };
    };
    leakedCommit.payload.commits[0]!.authorizationSnapshot = {};
    expect(contracts.parseSyncBatchEnvelope(leakedCommit).kind).toBe(
      "rejected"
    );

    const leakedRealtime = structuredClone(heartbeat) as unknown as {
      payload: Record<string, unknown>;
    };
    leakedRealtime.payload.decodedClaims = {};
    expect(contracts.parseRealtimeEnvelope(leakedRealtime).kind).toBe(
      "rejected"
    );
  });

  it("allows ordinary business key/claims fields inside typed projection values", () => {
    const base = upsert();
    const change = {
      ...base,
      value: {
        ...base.value,
        metadata: { key: "order-number", claims: "customer statement" }
      }
    };
    expect(contracts.entityChangeSchema.safeParse(change).success).toBe(true);
    expect(
      permissiveContracts.entityChangeSchema.safeParse(
        permissiveUpsert({
          key: "order-number",
          claims: "customer statement",
          authorizationEpoch,
          authorizationNotAfter,
          businessContext: { tenantId, label: "customer-owned metadata" }
        })
      ).success
    ).toBe(true);
  });

  it("rejects every high-confidence producer wrapper in a closed value", () => {
    for (const key of highConfidenceForbiddenValueKeys) {
      const metadata = {
        [key]: "server-only-proof"
      } as z.input<typeof permissiveMetadataSchema>;
      expect(
        permissiveContracts.entityChangeSchema.safeParse(
          permissiveUpsert(metadata)
        ).success
      ).toBe(false);
    }
  });

  it("rejects renamed wrappers around recognizable server-only structures", () => {
    const structuralAliases: Array<z.input<typeof permissiveMetadataSchema>> = [
      { customAuthorizationSnapshot: authorizationSnapshotShape() },
      { customDependencyVector: dependencyVectorShape() },
      { customSyncCursorClaims: syncCursorClaimsShape() },
      { customPageCursorClaims: pageCursorClaimsShape() },
      {
        customCursorMint: {
          cursor: "cursor:renamed-mint-1",
          claims: syncCursorClaimsShape(),
          authorization: authorizationSnapshotShape()
        }
      },
      {
        customCursorMint: {
          cursor: "cursor:renamed-page-mint-1",
          claims: pageCursorClaimsShape(),
          authorization: authorizationSnapshotShape()
        }
      },
      {
        customAcceptedProof: {
          kind: "accepted",
          inputCursor: "cursor:renamed-proof-1",
          claims: syncCursorClaimsShape(),
          verifiedAt: snapshotIssuedAt
        }
      },
      {
        customAcceptedProof: {
          kind: "accepted_for_scope_transition",
          inputCursor: "cursor:renamed-transition-proof-1",
          claims: syncCursorClaimsShape(),
          verifiedAt: snapshotIssuedAt
        }
      },
      { customAuthorizationDecision: authorizationDecisionShape() },
      { customAuthorizationDecisions: [authorizationDecisionShape()] },
      { customAuthorizationRequirement: authorizationRequirementShape() },
      {
        customFingerprintProtection: {
          tenantId,
          purpose: "recipient_state_integrity",
          keyGeneration: "recipient-state-key:g1",
          key: [1, 2, 3]
        }
      },
      { customRichManifest: richManifestShape() }
    ];

    for (const metadata of structuralAliases) {
      expect(
        permissiveContracts.entityChangeSchema.safeParse(
          permissiveUpsert(metadata)
        ).success
      ).toBe(false);
    }
  });

  it("exposes no producer, archived or proof-schema aliases", () => {
    const surface = Object.keys(contracts);
    expect(surface).not.toContain("syncBatchDeliverySchema");
    expect(surface).not.toContain("snapshotPageDeliverySchema");
    expect(surface).not.toContain("scopeTransitionDeliverySchema");
    expect(
      surface.some((key) => /authorized|archived|producer/iu.test(key))
    ).toBe(false);
  });

  it("rejects server registration and key/verifier fields at construction", () => {
    expect(() =>
      createInboxV2RecipientWireSyncContracts({
        projections: [
          {
            ...projection,
            authorizationRequirements: []
          }
        ],
        snapshotIndexScopeIds: ["core:employee-inbox"]
      } as never)
    ).toThrow(/client-safe fields/iu);

    expect(() =>
      createInboxV2RecipientWireSyncContracts({
        projections: [projection],
        snapshotIndexScopeIds: ["core:employee-inbox"],
        verifyRecipientStateFingerprint: () => true
      } as never)
    ).toThrow(/client-safe fields/iu);
  });

  it("derives an exact client-safe registration tuple from server config", () => {
    const derived = deriveInboxV2RecipientWireProjectionRegistrations([
      serverProjection
    ]);
    expect(derived[0]).not.toHaveProperty("authorizationRequirements");
    expect(() =>
      createInboxV2RecipientWireSyncContracts({
        projections: derived,
        snapshotIndexScopeIds: ["core:employee-inbox"]
      })
    ).not.toThrow();
  });
});
