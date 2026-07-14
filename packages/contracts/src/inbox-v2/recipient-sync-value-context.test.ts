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
  defineInboxV2RecipientProjection,
  INBOX_V2_RECIPIENT_SYNC_BATCH_SCHEMA_ID,
  inboxV2ConversationReferenceSchema,
  inboxV2MessageReferenceSchema,
  validateInboxV2SyncCursorClaims,
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

const tenantId = "tenant:tenant-1";
const authorizationEpoch = "authorization:epoch-0001";
const authorizationNotAfter = "2026-07-11T10:00:00.000Z";
const hashA = `sha256:${"a".repeat(64)}`;
const hashB = `sha256:${"b".repeat(64)}`;
const stateProtection = {
  tenantId,
  purpose: "recipient_state_integrity" as const,
  keyGeneration: "recipient-state-key:g1",
  key: new Uint8Array(32).fill(0x33)
};
const messageValueSchema = z
  .object({
    kind: z.literal("message_summary"),
    message: inboxV2MessageReferenceSchema,
    conversation: inboxV2ConversationReferenceSchema,
    text: z.string().max(2_000)
  })
  .strict();

function messageProjection(
  validateValueContext: InboxV2RecipientProjectionRegistration<
    typeof messageValueSchema
  >["validateValueContext"] = ({ entity, timeline, value }) =>
    timeline !== null &&
    value.message.tenantId === entity.tenantId &&
    String(value.message.id) === String(entity.entityId) &&
    value.conversation.tenantId === entity.tenantId &&
    value.conversation.tenantId === timeline.conversation.tenantId &&
    value.conversation.id === timeline.conversation.id
) {
  return defineInboxV2RecipientProjection({
    projectionTypeId: "core:message-summary",
    entityTypeId: "core:message",
    stateSchemaId: "core:message-summary",
    stateSchemaVersion: "v2",
    valueContextValidatorId: "core:test.message-value-context",
    valueContextValidatorFingerprint: hashA,
    authorizationRequirements: [
      {
        permissionId: "core:conversation.read",
        resourceScopeId: "core:conversation",
        resourceResolverId: "core:recipient-resource.value-conversation",
        resourceResolverFingerprint: hashB,
        resolveResource: ({ value, timeline }) => {
          const conversation = value?.conversation ?? timeline?.conversation;
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
    validateValueContext
  });
}

function contracts(projection = messageProjection()) {
  return createTestRecipientSyncContracts({
    snapshotIndexScopeIds: ["core:employee-inbox"],
    projections: [projection]
  });
}

function authorizationDecision() {
  return {
    tenantId,
    id: "authorization-decision:message-conversation",
    authorizationEpoch,
    principal: {
      kind: "employee" as const,
      employee: {
        tenantId,
        kind: "employee" as const,
        id: "employee:employee-1"
      }
    },
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
    outcome: "allowed" as const,
    decidedAt: "2026-07-11T09:00:00.000Z",
    notAfter: authorizationNotAfter
  };
}

function messageChange() {
  const change = {
    recipientOrdinal: "1",
    sourceChangeOrdinal: "1",
    authorizationDecisionRefs: [authorizationDecision()],
    kind: "upsert" as const,
    projectionTypeId: "core:message-summary",
    entity: {
      tenantId,
      entityTypeId: "core:message",
      entityId: "message:message-1"
    },
    revision: "2",
    lastChangedStreamPosition: "104",
    timeline: {
      conversation: {
        tenantId,
        kind: "conversation" as const,
        id: "conversation:conversation-1"
      },
      timelineSequence: "10"
    },
    stateSchemaId: "core:message-summary",
    stateSchemaVersion: "v2",
    value: {
      kind: "message_summary" as const,
      message: {
        tenantId,
        kind: "message" as const,
        id: "message:message-1"
      },
      conversation: {
        tenantId,
        kind: "conversation" as const,
        id: "conversation:conversation-1"
      },
      text: "Hello"
    }
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

function employee() {
  return {
    tenantId,
    kind: "employee" as const,
    id: "employee:employee-1"
  };
}

function scope() {
  return {
    id: "scope:employee-1",
    kind: "employee_inbox" as const,
    employee: employee()
  };
}

function authorizationSnapshot(
  evaluatedAt = "2026-07-11T08:55:00.000Z",
  accessRevision = "2"
) {
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
          resource: {
            tenantId,
            entityTypeId: "core:conversation",
            entityId: "conversation:conversation-1"
          },
          accessRevision
        }
      ],
      temporalBoundaryDigest: hashA
    },
    evaluatedAt,
    notAfter: authorizationNotAfter,
    nextAuthorizationBoundary: null
  };
}

function batch() {
  return {
    tenantId,
    streamEpoch: "stream:epoch:value-context",
    syncGeneration: "1",
    scopeId: scope().id,
    scope: scope(),
    authorizationEpoch,
    authorizationNotAfter,
    fromExclusive: "100",
    scannedThrough: "104",
    projectionCheckpoint: "104",
    hasMore: false,
    cursor: "cursor:recipient:104:value-context",
    commits: [
      {
        commitId: "commit:value-context-104",
        streamPosition: "104",
        clientMutationIds: ["mutation:value-context-104"],
        recipientChangeCount: "1",
        commitCompleteness: "complete" as const,
        changes: [wireChange(messageChange())]
      }
    ]
  };
}

function authorizedBatch() {
  return {
    ...batch(),
    commits: batch().commits.map((commit) => ({
      ...commit,
      changes: [messageChange()]
    }))
  };
}

function batchProducerDelivery(accessRevision = "2") {
  const now = "2026-07-11T09:10:00.000Z";
  const currentAuthorization = authorizationSnapshot(now, accessRevision);
  const acceptedInputCursor = validateInboxV2SyncCursorClaims({
    cursor: "cursor:recipient:100:value-context-input",
    claims: {
      tenantId,
      employee: employee(),
      scopeId: scope().id,
      streamEpoch: "stream:epoch:value-context",
      syncGeneration: "1",
      authorizationEpoch,
      schemaVersion: "v2",
      resumeMode: "delta",
      scannedThrough: "100",
      issuedAt: "2026-07-11T09:00:00.000Z",
      notAfter: authorizationNotAfter
    },
    current: {
      tenantId,
      employee: employee(),
      scopeId: scope().id,
      streamEpoch: "stream:epoch:value-context",
      syncGeneration: "1",
      authorization: currentAuthorization,
      supportedSchemaVersions: ["v2"],
      minRetainedTenantStreamPosition: "0",
      minReplayableRecipientPosition: "0",
      projectionCheckpoint: "104",
      tenantStreamHead: "104",
      now
    }
  });
  if (acceptedInputCursor.kind !== "accepted") {
    throw new Error(
      `Expected accepted cursor, got ${acceptedInputCursor.errorCode}`
    );
  }
  return {
    batch: {
      schemaId: INBOX_V2_RECIPIENT_SYNC_BATCH_SCHEMA_ID,
      schemaVersion: "v2",
      payload: batch()
    },
    authorizedBatch: authorizedBatch(),
    authorization: currentAuthorization,
    acceptedInputCursor,
    cursorMint: {
      cursor: batch().cursor,
      claims: {
        ...acceptedInputCursor.claims,
        scannedThrough: "104",
        issuedAt: now
      },
      authorization: currentAuthorization
    }
  };
}

function snapshotPage() {
  const snapshotChange = messageChange();
  const snapshotEntity = snapshotChange.entity;
  const snapshotIssuedAt = "2026-07-11T09:00:00.000Z";
  const manifestDefinition = {
    recipientSyncSchemaVersion: "v2",
    completeness: "complete_for_scope" as const,
    registrations: [
      {
        projectionTypeId: "core:message-summary",
        entityTypeId: "core:message",
        stateSchemaId: "core:message-summary",
        stateSchemaVersion: "v2",
        valueContextValidator: {
          semanticId: "core:test.message-value-context",
          fingerprint: hashA
        },
        authorizationRequirements: [
          {
            permissionId: "core:conversation.read",
            resourceScopeId: "core:conversation",
            resourceResolver: {
              semanticId: "core:recipient-resource.value-conversation",
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
  const pageHash = calculateInboxV2SnapshotPageHash({
    frozenContext: {
      tenantId,
      scopeId: scope().id,
      snapshotId: "snapshot:value-context",
      streamEpoch: "stream:epoch:value-context",
      syncGeneration: "1",
      authorizationEpoch,
      schemaVersion: "v2",
      snapshotCheckpoint: "104",
      snapshotIssuedAt,
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
  const pageChainRootHash = calculateInboxV2SnapshotCumulativePageChainHash({
    previousCumulativePageChainHash: null,
    pageHash,
    cumulativeEntityCount: "1"
  });
  const coverage = {
    entityCount: "1",
    pageCount: "1",
    finalEntity: snapshotEntity,
    pageChainRootHash
  };
  const manifestHash = calculateInboxV2SnapshotManifestHash({
    manifestDefinitionHash,
    coverage
  });
  const snapshotAuthorization = authorizationSnapshot();
  const resumeClaims = {
    tenantId,
    employee: employee(),
    scopeId: scope().id,
    streamEpoch: "stream:epoch:value-context",
    syncGeneration: "1",
    authorizationEpoch,
    schemaVersion: "v2",
    resumeMode: "delta" as const,
    scannedThrough: "104",
    issuedAt: snapshotIssuedAt,
    notAfter: authorizationNotAfter
  };
  const snapshotContextHash = calculateInboxV2SnapshotContextHash({
    tenantId,
    scope: scope(),
    snapshotId: "snapshot:value-context",
    streamEpoch: "stream:epoch:value-context",
    syncGeneration: "1",
    authorization: snapshotAuthorization,
    schemaVersion: "v2",
    snapshotCheckpoint: "104",
    manifestHash,
    coverage,
    snapshotIssuedAt,
    resumeClaims
  });
  const wireRegistrations = manifestDefinition.registrations.map(
    ({ authorizationRequirements: _authorizationRequirements, ...wire }) => wire
  );
  return {
    tenantId,
    streamEpoch: "stream:epoch:value-context",
    syncGeneration: "1",
    scopeId: scope().id,
    scope: scope(),
    authorizationEpoch,
    authorizationNotAfter,
    manifest: {
      completeness: manifestDefinition.completeness,
      registrations: wireRegistrations,
      indexScopeIds: manifestDefinition.indexScopeIds,
      manifestDefinitionHash,
      manifestHash,
      coverage
    },
    snapshotId: "snapshot:value-context",
    snapshotCheckpoint: "104",
    snapshotContextHash,
    snapshotIssuedAt,
    resumeAfter: "cursor:recipient:104:snapshot-resume",
    pageCursor: null,
    pagePosition: {
      ordinal: "1",
      afterExclusive: null,
      firstInclusive: snapshotEntity,
      throughInclusive: snapshotEntity,
      entityCount: "1",
      previousPageHash: null,
      pageHash,
      previousCumulativeEntityCount: "0",
      cumulativeEntityCount: "1",
      previousCumulativePageChainHash: null,
      cumulativePageChainHash: pageChainRootHash
    },
    finalCompletion: {
      snapshotId: "snapshot:value-context",
      manifestHash,
      snapshotCheckpoint: "104",
      pageCount: "1",
      entityCount: "1",
      finalEntity: snapshotEntity,
      pageChainRootHash
    },
    hasMore: false,
    entities: [wireChange(snapshotChange)]
  };
}

describe("Inbox V2 recipient projection value context", () => {
  it("requires every registration to provide a contextual value policy", () => {
    const incomplete = {
      projectionTypeId: "core:message-summary",
      entityTypeId: "core:message",
      stateSchemaId: "core:message-summary",
      stateSchemaVersion: "v2",
      valueContextValidatorId: "core:test.incomplete-value-context",
      valueContextValidatorFingerprint: hashA,
      authorizationRequirements: [
        {
          permissionId: "core:conversation.read",
          resourceScopeId: "core:conversation",
          resourceResolverId: "core:recipient-resource.entity",
          resourceResolverFingerprint: hashB,
          resolveResource: ({ entity }: { entity: unknown }) => entity
        }
      ],
      valueSchema: messageValueSchema
    } as unknown as InboxV2RecipientProjectionRegistration<
      typeof messageValueSchema
    >;

    expect(() =>
      createTestRecipientSyncContracts({
        snapshotIndexScopeIds: ["core:employee-inbox"],
        projections: [incomplete]
      })
    ).toThrow(/contextual value validation policy/u);
  });

  it("rejects foreign tenants, wrong entity IDs and wrong parent conversations", () => {
    const schema = contracts().entityChangeSchema;
    expect(schema.safeParse(wireChange(messageChange())).success).toBe(true);

    const foreignTenant = structuredClone(wireChange(messageChange()));
    foreignTenant.value.message.tenantId = "tenant:tenant-2";
    expect(schema.safeParse(foreignTenant).success).toBe(false);

    const wrongEntity = structuredClone(wireChange(messageChange()));
    wrongEntity.value.message.id = "message:message-2";
    expect(schema.safeParse(wrongEntity).success).toBe(false);

    const wrongConversation = structuredClone(wireChange(messageChange()));
    wrongConversation.timeline.conversation.id = "conversation:conversation-2";
    expect(schema.safeParse(wrongConversation).success).toBe(false);
  });

  it("enforces contextual value bindings in both batch and snapshot paths", () => {
    const recipientContracts = contracts();
    expect(recipientContracts.syncBatchSchema.safeParse(batch()).success).toBe(
      true
    );
    expect(
      recipientContracts.snapshotPageSchema.safeParse(snapshotPage()).success
    ).toBe(true);

    const staleAuthorizationDependency = batchProducerDelivery("1");
    expect(
      recipientContracts.syncBatchProducerDeliverySchema.safeParse(
        staleAuthorizationDependency
      ).success
    ).toBe(false);

    for (const kind of [
      "foreign_tenant",
      "wrong_entity",
      "wrong_conversation"
    ] as const) {
      const invalidBatch = structuredClone(batch());
      const invalidPage = structuredClone(snapshotPage());
      const batchChange = invalidBatch.commits[0]!.changes[0]!;
      const pageChange = invalidPage.entities[0]!;
      if (kind === "foreign_tenant") {
        batchChange.value.message.tenantId = "tenant:tenant-2";
        pageChange.value.message.tenantId = "tenant:tenant-2";
      } else if (kind === "wrong_entity") {
        batchChange.value.message.id = "message:message-2";
        pageChange.value.message.id = "message:message-2";
      } else {
        batchChange.timeline.conversation.id = "conversation:conversation-2";
        pageChange.timeline.conversation.id = "conversation:conversation-2";
      }
      expect(
        recipientContracts.syncBatchSchema.safeParse(invalidBatch).success
      ).toBe(false);
      expect(
        recipientContracts.snapshotPageSchema.safeParse(invalidPage).success
      ).toBe(false);
    }
  });

  it("rejects ambiguous commit, entity, mutation and decision identities", () => {
    const schema = contracts().syncBatchSchema;

    const duplicateEntity = structuredClone(batch());
    const secondChange = structuredClone(
      duplicateEntity.commits[0]!.changes[0]!
    );
    secondChange.recipientOrdinal = "2";
    secondChange.sourceChangeOrdinal = "2";
    duplicateEntity.commits[0]!.changes.push(secondChange);
    duplicateEntity.commits[0]!.recipientChangeCount = "2";
    expect(schema.safeParse(duplicateEntity).success).toBe(false);

    const duplicateCommitId = twoCommitBatch();
    duplicateCommitId.commits[1]!.commitId =
      duplicateCommitId.commits[0]!.commitId;
    expect(schema.safeParse(duplicateCommitId).success).toBe(false);

    const duplicateMutation = twoCommitBatch();
    duplicateMutation.commits[1]!.clientMutationIds = [
      duplicateMutation.commits[0]!.clientMutationIds[0]!
    ];
    expect(schema.safeParse(duplicateMutation).success).toBe(false);

    const duplicateDecisionInOneArray = structuredClone(
      batchProducerDelivery()
    );
    duplicateDecisionInOneArray.authorizedBatch.commits[0]!.changes[0]!.authorizationDecisionRefs.push(
      structuredClone(
        duplicateDecisionInOneArray.authorizedBatch.commits[0]!.changes[0]!
          .authorizationDecisionRefs[0]!
      )
    );
    expect(
      contracts().syncBatchProducerDeliverySchema.safeParse(
        duplicateDecisionInOneArray
      ).success
    ).toBe(false);

    const conflictingDecisionBody = batchProducerDelivery();
    conflictingDecisionBody.batch.payload = twoCommitBatch();
    conflictingDecisionBody.authorizedBatch = authorizedTwoCommitBatch();
    conflictingDecisionBody.authorizedBatch.commits[1]!.changes[0]!.authorizationDecisionRefs[0]!.decisionHash = `sha256:${"c".repeat(64)}`;
    conflictingDecisionBody.cursorMint.cursor =
      conflictingDecisionBody.batch.payload.cursor;
    conflictingDecisionBody.cursorMint.claims.scannedThrough = "105";
    expect(
      contracts().syncBatchProducerDeliverySchema.safeParse(
        conflictingDecisionBody
      ).success
    ).toBe(false);
  });

  it("fails closed when a registered contextual policy throws", () => {
    const throwing = messageProjection(() => {
      throw new Error("projection policy unavailable");
    });
    expect(
      contracts(throwing).entityChangeSchema.safeParse(
        wireChange(messageChange())
      ).success
    ).toBe(false);
  });
});

function twoCommitBatch() {
  const value = structuredClone(batch());
  value.scannedThrough = "105";
  value.projectionCheckpoint = "105";
  value.cursor = "cursor:recipient:105:value-context";
  const secondAuthorizedChange = structuredClone(messageChange());
  secondAuthorizedChange.revision = "3";
  secondAuthorizedChange.lastChangedStreamPosition = "105";
  secondAuthorizedChange.stateHash = calculateInboxV2RecipientUpsertStateHash(
    secondAuthorizedChange,
    stateProtection
  );
  const secondChange = wireChange(secondAuthorizedChange);
  value.commits.push({
    commitId: "commit:value-context-105",
    streamPosition: "105",
    clientMutationIds: ["mutation:value-context-105"],
    recipientChangeCount: "1",
    commitCompleteness: "complete" as const,
    changes: [secondChange]
  });
  return value;
}

function authorizedTwoCommitBatch() {
  const wire = twoCommitBatch();
  const first = messageChange();
  const second = messageChange();
  second.revision = "3";
  second.lastChangedStreamPosition = "105";
  second.stateHash = calculateInboxV2RecipientUpsertStateHash(
    second,
    stateProtection
  );
  return {
    ...wire,
    commits: [
      { ...wire.commits[0]!, changes: [first] },
      { ...wire.commits[1]!, changes: [second] }
    ]
  };
}
