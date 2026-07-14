import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createInboxV2RecipientEntityChangeSchema,
  createInboxV2RecipientWireEntityChangeSchema,
  createInboxV2RecipientWireUpsertChangeSchema,
  defineInboxV2RecipientProjection,
  defineInboxV2RecipientWireProjection,
  inboxV2RecipientEntityResourceResolver,
  inboxV2RecipientEntityResourceResolverSemantic,
  inboxV2RecipientValueHasNoTenantScopedReferences,
  inboxV2RecipientValueHasNoTenantScopedReferencesSemantic,
  inboxV2RecipientWireSecurityPurgeChangeSchema,
  normalizeRecipientWireProjectionRegistrations
} from "./recipient-sync-projection";
import {
  calculateInboxV2RecipientInvalidateInstructionHash,
  calculateInboxV2RecipientTombstoneStateHash,
  calculateInboxV2RecipientUpsertStateHash,
  verifyInboxV2RecipientUpsertStateHash
} from "./recipient-sync-hash";

const digest = `sha256:${"a".repeat(64)}`;
const stateFingerprintProtection = {
  tenantId: "tenant:tenant-1",
  purpose: "recipient_state_integrity" as const,
  keyGeneration: "state-key:generation-1",
  key: new Uint8Array(32).fill(7)
};

const wireProjection = defineInboxV2RecipientWireProjection({
  projectionTypeId: "core:wire-conversation-summary",
  entityTypeId: "core:conversation",
  stateSchemaId: "core:wire-conversation-summary",
  stateSchemaVersion: "v1",
  ...inboxV2RecipientValueHasNoTenantScopedReferencesSemantic,
  valueSchema: z
    .object({
      kind: z.literal("wire_conversation_summary"),
      title: z.string().min(1)
    })
    .strict(),
  validateValueContext: inboxV2RecipientValueHasNoTenantScopedReferences
});

const producerProjection = defineInboxV2RecipientProjection({
  ...wireProjection,
  authorizationRequirements: [
    {
      permissionId: "core:conversation.read",
      resourceScopeId: "core:conversation",
      ...inboxV2RecipientEntityResourceResolverSemantic,
      resolveResource: inboxV2RecipientEntityResourceResolver
    }
  ]
});

const wireEntitySchema = createInboxV2RecipientWireEntityChangeSchema({
  projections: [wireProjection]
});
const wireUpsertSchema = createInboxV2RecipientWireUpsertChangeSchema({
  projections: [wireProjection]
});
const internalEntitySchema = createInboxV2RecipientEntityChangeSchema({
  projections: [producerProjection],
  verifyRecipientStateFingerprint: (change) =>
    verifyInboxV2RecipientUpsertStateHash(
      change as Parameters<typeof verifyInboxV2RecipientUpsertStateHash>[0],
      stateFingerprintProtection
    )
});

const entity = {
  tenantId: "tenant:tenant-1",
  entityTypeId: "core:conversation",
  entityId: "conversation:conversation-1"
} as const;

const timeline = {
  conversation: {
    tenantId: "tenant:tenant-1",
    kind: "conversation" as const,
    id: "conversation:conversation-1"
  },
  timelineSequence: "17"
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
  decisionHash: digest,
  outcome: "allowed" as const,
  decidedAt: "2026-07-11T09:00:00.000Z",
  notAfter: "2026-07-11T10:00:00.000Z"
};

const wireBase = {
  recipientOrdinal: "5",
  sourceChangeOrdinal: "2",
  projectionTypeId: "core:wire-conversation-summary",
  entity,
  revision: "3",
  lastChangedStreamPosition: "90",
  timeline,
  stateSchemaId: "core:wire-conversation-summary",
  stateSchemaVersion: "v1"
} as const;

function wireUpsert() {
  const change = {
    ...wireBase,
    kind: "upsert" as const,
    value: {
      kind: "wire_conversation_summary" as const,
      title: "Support"
    }
  };
  return {
    ...change,
    stateHash: calculateInboxV2RecipientUpsertStateHash(
      change,
      stateFingerprintProtection
    )
  };
}

function wireTombstone() {
  const change = {
    ...wireBase,
    kind: "tombstone" as const,
    reasonId: "core:privacy-erased"
  };
  return {
    ...change,
    stateHash: calculateInboxV2RecipientTombstoneStateHash(change)
  };
}

function wireInvalidate() {
  const change = {
    ...wireBase,
    kind: "invalidate" as const,
    stateHash: digest,
    reasonId: "core:targeted-fetch-required",
    targetedFetchRequired: true as const
  };
  return {
    ...change,
    invalidationHash: calculateInboxV2RecipientInvalidateInstructionHash(change)
  };
}

describe("Inbox V2 recipient client-wire projection schemas", () => {
  it("normalizes a client-safe registration without authorization callbacks", () => {
    const [normalized] = normalizeRecipientWireProjectionRegistrations([
      wireProjection
    ]);

    expect(normalized).toMatchObject({
      projectionTypeId: "core:wire-conversation-summary",
      entityTypeId: "core:conversation",
      stateSchemaId: "core:wire-conversation-summary",
      stateSchemaVersion: "v1"
    });
    expect(normalized).not.toHaveProperty("authorizationRequirements");
  });

  it("preserves typed state, hashes, ordering and timeline metadata", () => {
    const upsert = wireUpsert();
    const parsed = wireUpsertSchema.parse(upsert);

    expect(parsed).toEqual(upsert);
    expect(parsed.recipientOrdinal).toBe("5");
    expect(parsed.sourceChangeOrdinal).toBe("2");
    expect(parsed.entity.tenantId).toBe("tenant:tenant-1");
    expect(parsed.timeline).toEqual(timeline);
    expect(parsed.stateHash).toBe(upsert.stateHash);
    expect(wireEntitySchema.safeParse(wireTombstone()).success).toBe(true);
    expect(wireEntitySchema.safeParse(wireInvalidate()).success).toBe(true);
    expect(
      wireEntitySchema.safeParse({ ...upsert, stateHash: digest }).success
    ).toBe(false);
  });

  it("rejects internal authorization evidence on every client-wire change", () => {
    const entityChanges = [wireUpsert(), wireTombstone(), wireInvalidate()];
    for (const change of entityChanges) {
      expect(
        wireEntitySchema.safeParse({
          ...change,
          authorizationDecisionRefs: [decision]
        }).success
      ).toBe(false);
    }

    expect(
      internalEntitySchema.safeParse({
        ...wireUpsert(),
        authorizationDecisionRefs: [decision]
      }).success
    ).toBe(true);

    const securityPurge = {
      recipientOrdinal: "1",
      sourceChangeOrdinal: "1",
      kind: "security_purge" as const,
      scope: { kind: "recipient_scope" as const },
      reasonId: "core:authorization-revoked",
      accessTransitionToken: "audience-impact:transition-1",
      resultingAuthorizationEpoch: "authorization:epoch-0002"
    };
    expect(
      inboxV2RecipientWireSecurityPurgeChangeSchema.safeParse(securityPurge)
        .success
    ).toBe(true);
    expect(
      inboxV2RecipientWireSecurityPurgeChangeSchema.safeParse({
        ...securityPurge,
        authorizationDecisionRefs: [decision]
      }).success
    ).toBe(false);
  });
});
