import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createInboxV2ArchivedV1RecipientEntityChangeSchema,
  createInboxV2RecipientEntityChangeSchema,
  defineInboxV2RecipientProjection,
  inboxV2RecipientEntityResourceResolver,
  inboxV2RecipientEntityResourceResolverSemantic,
  inboxV2RecipientValueHasNoTenantScopedReferences,
  inboxV2RecipientValueHasNoTenantScopedReferencesSemantic,
  normalizeRecipientProjectionRegistrations
} from "./recipient-sync-projection";
import type { InboxV2RecipientProjectionRegistration } from "./recipient-sync-projection";
import {
  calculateInboxV2RecipientInvalidateInstructionHash,
  calculateInboxV2RecipientTombstoneStateHash,
  calculateInboxV2RecipientUpsertStateHash,
  verifyInboxV2RecipientUpsertStateHash
} from "./recipient-sync-hash";
import {
  decideInboxV2EntityChangeApplication,
  inboxV2EntityRevisionStateSchema
} from "./recipient-sync-application";
import { createInboxV2RecipientSyncContracts } from "./recipient-sync-contracts";
import {
  INBOX_V2_RECIPIENT_SNAPSHOT_PAGE_SCHEMA_ID,
  INBOX_V2_RECIPIENT_SYNC_BATCH_SCHEMA_ID
} from "./recipient-sync-constants";

const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;
const digestC = `sha256:${"c".repeat(64)}`;
const stateProtection = {
  tenantId: "tenant:tenant-1",
  purpose: "recipient_state_integrity" as const,
  keyGeneration: "recipient-state-key:g1",
  key: new Uint8Array(32).fill(0x44)
};

const valueSchema = z
  .object({
    kind: z.literal("conversation_summary"),
    title: z.string().min(1)
  })
  .strict();

const projection = defineInboxV2RecipientProjection({
  projectionTypeId: "core:conversation-summary",
  entityTypeId: "core:conversation",
  stateSchemaId: "core:conversation-summary",
  stateSchemaVersion: "v1",
  ...inboxV2RecipientValueHasNoTenantScopedReferencesSemantic,
  authorizationRequirements: [
    {
      permissionId: "core:conversation.read",
      resourceScopeId: "core:conversation",
      ...inboxV2RecipientEntityResourceResolverSemantic,
      resolveResource: inboxV2RecipientEntityResourceResolver
    }
  ],
  valueSchema,
  validateValueContext: inboxV2RecipientValueHasNoTenantScopedReferences
});

const activeSchema = createInboxV2RecipientEntityChangeSchema({
  projections: [projection],
  verifyRecipientStateFingerprint: (change) =>
    verifyInboxV2RecipientUpsertStateHash(
      change as Parameters<typeof verifyInboxV2RecipientUpsertStateHash>[0],
      stateProtection
    )
});
const archivedV1Schema = createInboxV2ArchivedV1RecipientEntityChangeSchema({
  projections: [projection]
});

const entity = {
  tenantId: "tenant:tenant-1",
  entityTypeId: "core:conversation",
  entityId: "conversation:conversation-1"
} as const;

const decision = {
  tenantId: "tenant:tenant-1",
  id: "authorization-decision:decision-1",
  authorizationEpoch: "authorization:epoch-0001",
  principal: {
    kind: "employee" as const,
    employee: {
      tenantId: "tenant:tenant-1",
      kind: "employee" as const,
      id: "employee:employee-1"
    }
  },
  permissionId: "core:conversation.read",
  resourceScopeId: "core:conversation",
  resource: entity,
  resourceAccessRevision: "1",
  decisionRevision: "1",
  decisionHash: digestA,
  outcome: "allowed" as const,
  decidedAt: "2026-07-11T09:00:00.000Z",
  notAfter: "2026-07-11T10:00:00.000Z"
};

const changeBase = {
  recipientOrdinal: "1",
  sourceChangeOrdinal: "1",
  authorizationDecisionRefs: [decision],
  projectionTypeId: "core:conversation-summary",
  entity,
  revision: "3",
  lastChangedStreamPosition: "90",
  timeline: null,
  stateSchemaId: "core:conversation-summary",
  stateSchemaVersion: "v1"
} as const;

function activeUpsert() {
  const change = {
    ...changeBase,
    kind: "upsert" as const,
    value: { kind: "conversation_summary" as const, title: "Support" }
  };
  return {
    ...change,
    stateHash: calculateInboxV2RecipientUpsertStateHash(change, stateProtection)
  };
}

function activeTombstone() {
  const change = {
    ...changeBase,
    kind: "tombstone" as const,
    reasonId: "core:privacy-erased"
  };
  return {
    ...change,
    stateHash: calculateInboxV2RecipientTombstoneStateHash(change)
  };
}

function activeInvalidate() {
  const change = {
    ...changeBase,
    kind: "invalidate" as const,
    stateHash: digestA,
    reasonId: "core:targeted-fetch-required",
    targetedFetchRequired: true as const
  };
  return {
    ...change,
    invalidationHash: calculateInboxV2RecipientInvalidateInstructionHash(change)
  };
}

describe("Inbox V2 active and archived recipient entity hashes", () => {
  it("requires explicit stable semantic metadata in every registration", () => {
    const normalized = normalizeRecipientProjectionRegistrations([projection]);
    expect(normalized[0]).toMatchObject({
      valueContextValidatorId:
        "core:recipient-value-context.no-tenant-scoped-references",
      valueContextValidatorFingerprint: expect.stringMatching(
        /^sha256:[a-f0-9]{64}$/u
      ),
      authorizationRequirements: [
        {
          resourceResolverId: "core:recipient-resource.entity",
          resourceResolverFingerprint: expect.stringMatching(
            /^sha256:[a-f0-9]{64}$/u
          )
        }
      ]
    });

    const missingValidatorFingerprint = {
      ...projection,
      valueContextValidatorFingerprint: undefined
    } as unknown as InboxV2RecipientProjectionRegistration;
    expect(() =>
      normalizeRecipientProjectionRegistrations([missingValidatorFingerprint])
    ).toThrow();

    const missingResolverFingerprint = {
      ...projection,
      authorizationRequirements: [
        {
          ...projection.authorizationRequirements[0]!,
          resourceResolverFingerprint: undefined
        }
      ]
    } as unknown as InboxV2RecipientProjectionRegistration;
    expect(() =>
      normalizeRecipientProjectionRegistrations([missingResolverFingerprint])
    ).toThrow();
  });

  it("recomputes active upsert state but leaves archived V1 syntax frozen", () => {
    const upsert = activeUpsert();
    expect(activeSchema.safeParse(upsert).success).toBe(true);
    expect(
      activeSchema.safeParse({ ...upsert, stateHash: digestB }).success
    ).toBe(false);
    expect(
      activeSchema.safeParse({
        ...upsert,
        value: { ...upsert.value, title: "Tampered" }
      }).success
    ).toBe(false);

    expect(archivedV1Schema.safeParse(upsert).success).toBe(false);
    expect(
      archivedV1Schema.safeParse({ ...upsert, stateHash: digestB }).success
    ).toBe(true);
  });

  it("recomputes active tombstones but preserves archived V1 stateHash", () => {
    const tombstone = activeTombstone();
    expect(activeSchema.safeParse(tombstone).success).toBe(true);
    expect(
      activeSchema.safeParse({ ...tombstone, stateHash: digestB }).success
    ).toBe(false);
    expect(
      archivedV1Schema.safeParse({ ...tombstone, stateHash: digestB }).success
    ).toBe(true);
  });

  it("requires a canonical invalidate instruction hash only in active V2", () => {
    const invalidate = activeInvalidate();
    expect(activeSchema.safeParse(invalidate).success).toBe(true);
    expect(
      activeSchema.safeParse({ ...invalidate, invalidationHash: digestB })
        .success
    ).toBe(false);
    const { invalidationHash: _, ...archivedInvalidate } = invalidate;
    expect(activeSchema.safeParse(archivedInvalidate).success).toBe(false);
    expect(archivedV1Schema.safeParse(archivedInvalidate).success).toBe(true);
    expect(archivedV1Schema.safeParse(invalidate).success).toBe(false);
  });

  it("keeps archived V1 value and authorization semantics isolated from active changes", () => {
    const activeRejectingProjection = defineInboxV2RecipientProjection({
      ...projection,
      authorizationRequirements: [
        ...projection.authorizationRequirements,
        {
          permissionId: "core:staff-note.read",
          resourceScopeId: "core:staff-note",
          resourceResolverId: "core:recipient-resource.unavailable-active-v2",
          resourceResolverFingerprint: digestB,
          resolveResource: () => null
        }
      ],
      validateValueContext: () => false
    });
    const rejectingActiveSchema = createInboxV2RecipientEntityChangeSchema({
      projections: [activeRejectingProjection],
      verifyRecipientStateFingerprint: (change) =>
        verifyInboxV2RecipientUpsertStateHash(
          change as Parameters<typeof verifyInboxV2RecipientUpsertStateHash>[0],
          stateProtection
        )
    });
    const frozenArchivedSchema =
      createInboxV2ArchivedV1RecipientEntityChangeSchema({
        projections: [projection]
      });
    const upsert = activeUpsert();
    const archivedUpsert = { ...upsert, stateHash: digestA };
    expect(rejectingActiveSchema.safeParse(upsert).success).toBe(false);
    expect(frozenArchivedSchema.safeParse(upsert).success).toBe(false);
    expect(frozenArchivedSchema.safeParse(archivedUpsert).success).toBe(true);

    const contracts = createInboxV2RecipientSyncContracts({
      projections: [activeRejectingProjection],
      archivedV1Projections: [projection],
      snapshotIndexScopeIds: ["core:employee-inbox"],
      archivedV1SnapshotIndexScopeIds: ["core:employee-inbox"],
      verifyRecipientStateFingerprint: (change) =>
        verifyInboxV2RecipientUpsertStateHash(
          change as Parameters<typeof verifyInboxV2RecipientUpsertStateHash>[0],
          stateProtection
        )
    });
    const archivedEnvelope = {
      schemaId: INBOX_V2_RECIPIENT_SYNC_BATCH_SCHEMA_ID,
      schemaVersion: "v1",
      payload: {
        tenantId: entity.tenantId,
        streamEpoch: "stream:epoch-archived-isolation",
        syncGeneration: "1",
        scopeId: "scope:archived-isolation",
        scope: {
          id: "scope:archived-isolation",
          kind: "employee_inbox" as const,
          employee: decision.principal.employee
        },
        authorizationEpoch: decision.authorizationEpoch,
        authorizationNotAfter: decision.notAfter,
        fromExclusive: "100",
        scannedThrough: "104",
        projectionCheckpoint: "104",
        hasMore: false,
        cursor: "cursor:recipient:104:archived-isolation",
        commits: [
          {
            commitId: "commit:archived-isolation-104",
            streamPosition: "104",
            clientMutationIds: ["mutation:archived-isolation-104"],
            recipientChangeCount: "1",
            commitCompleteness: "complete" as const,
            changes: [archivedUpsert]
          }
        ]
      }
    };
    expect(
      contracts.parseArchivedV1SyncBatchEnvelope(archivedEnvelope).kind
    ).toBe("parsed");
  });

  it("keeps archived V1 snapshot index coverage frozen when active V2 adds an index", () => {
    const contracts = createInboxV2RecipientSyncContracts({
      projections: [projection],
      archivedV1Projections: [projection],
      snapshotIndexScopeIds: ["core:employee-inbox", "core:new-index"],
      archivedV1SnapshotIndexScopeIds: ["core:employee-inbox"],
      verifyRecipientStateFingerprint: () => false
    });
    const archivedSnapshotEnvelope = {
      schemaId: INBOX_V2_RECIPIENT_SNAPSHOT_PAGE_SCHEMA_ID,
      schemaVersion: "v1",
      payload: {
        tenantId: entity.tenantId,
        streamEpoch: "stream:epoch-archived-index-isolation",
        syncGeneration: "1",
        scopeId: "scope:archived-index-isolation",
        scope: {
          id: "scope:archived-index-isolation",
          kind: "employee_inbox" as const,
          employee: decision.principal.employee
        },
        authorizationEpoch: decision.authorizationEpoch,
        authorizationNotAfter: decision.notAfter,
        manifest: {
          completeness: "complete_for_scope" as const,
          registrations: [
            {
              projectionTypeId: projection.projectionTypeId,
              entityTypeId: projection.entityTypeId,
              stateSchemaId: projection.stateSchemaId,
              stateSchemaVersion: projection.stateSchemaVersion,
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
          manifestHash: digestB
        },
        snapshotId: "snapshot:archived-index-isolation",
        snapshotCheckpoint: "110",
        resumeAfter: "cursor:recipient:110:archived-index-isolation",
        pageCursor: null,
        pagePositionHash: null,
        hasMore: false,
        entities: []
      }
    };

    expect(
      contracts.parseArchivedV1SnapshotPageEnvelope(archivedSnapshotEnvelope)
        .kind
    ).toBe("parsed");
  });
});

describe("Inbox V2 equal-revision actual state application", () => {
  it("requires invalidate reducer state to retain its instruction hash", () => {
    expect(
      inboxV2EntityRevisionStateSchema.safeParse({
        revision: "5",
        operation: "invalidate",
        stateHash: digestA
      }).success
    ).toBe(false);
    expect(
      inboxV2EntityRevisionStateSchema.safeParse({
        revision: "5",
        operation: "upsert",
        stateHash: digestA
      }).success
    ).toBe(false);
    expect(
      inboxV2EntityRevisionStateSchema.safeParse({
        revision: "5",
        operation: "tombstone",
        stateHash: activeUpsert().stateHash
      }).success
    ).toBe(false);
    expect(
      inboxV2EntityRevisionStateSchema.safeParse({
        revision: "5",
        operation: "upsert",
        stateHash: digestA,
        invalidationHash: digestB
      }).success
    ).toBe(false);
  });

  it("resolves matching invalidation and actual state without hiding conflicts", () => {
    const stateFingerprint = activeUpsert().stateHash;
    const conflictingStateFingerprint = `hmac-sha256:recipient-state-key:g1:${"c".repeat(64)}`;
    const invalidate = {
      revision: "5",
      operation: "invalidate" as const,
      stateHash: stateFingerprint,
      invalidationHash: digestB
    };
    const upsert = {
      revision: "5",
      operation: "upsert" as const,
      stateHash: stateFingerprint
    };

    expect(
      decideInboxV2EntityChangeApplication({
        current: invalidate,
        incoming: upsert
      })
    ).toEqual({ kind: "apply" });
    expect(
      decideInboxV2EntityChangeApplication({
        current: upsert,
        incoming: invalidate
      })
    ).toEqual({ kind: "duplicate" });
    expect(
      decideInboxV2EntityChangeApplication({
        current: invalidate,
        incoming: invalidate
      })
    ).toEqual({ kind: "duplicate" });
    expect(
      decideInboxV2EntityChangeApplication({
        current: invalidate,
        incoming: { ...invalidate, invalidationHash: digestC }
      })
    ).toEqual({
      kind: "conflict",
      errorCode: "sync.revision_conflict"
    });
    expect(
      decideInboxV2EntityChangeApplication({
        current: invalidate,
        incoming: { ...upsert, stateHash: conflictingStateFingerprint }
      })
    ).toEqual({
      kind: "conflict",
      errorCode: "sync.revision_conflict"
    });
    expect(
      decideInboxV2EntityChangeApplication({
        current: upsert,
        incoming: {
          revision: "5",
          operation: "tombstone" as const,
          stateHash: digestA
        }
      })
    ).toEqual({
      kind: "conflict",
      errorCode: "sync.revision_conflict"
    });
  });
});
