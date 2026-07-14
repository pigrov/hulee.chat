import { z } from "zod";

import {
  defineInboxV2RecipientProjection,
  defineInboxV2RecipientWireProjection,
  deriveInboxV2RecipientWireProjectionRegistrations,
  inboxV2RecipientEntityResourceResolver,
  inboxV2RecipientEntityResourceResolverSemantic,
  inboxV2RecipientValueHasNoTenantScopedReferences,
  inboxV2RecipientValueHasNoTenantScopedReferencesSemantic,
  createInboxV2RecipientWireSyncContracts
} from "./recipient-sync";

const conversationProjection = defineInboxV2RecipientWireProjection({
  projectionTypeId: "core:wire-facade-conversation",
  entityTypeId: "core:conversation",
  stateSchemaId: "core:wire-facade-conversation",
  stateSchemaVersion: "v1",
  ...inboxV2RecipientValueHasNoTenantScopedReferencesSemantic,
  valueSchema: z
    .object({
      kind: z.literal("wire_facade_conversation"),
      title: z.string()
    })
    .strict(),
  validateValueContext: inboxV2RecipientValueHasNoTenantScopedReferences
});

const messageProjection = defineInboxV2RecipientWireProjection({
  projectionTypeId: "core:wire-facade-message",
  entityTypeId: "core:message",
  stateSchemaId: "core:wire-facade-message",
  stateSchemaVersion: "v1",
  ...inboxV2RecipientValueHasNoTenantScopedReferencesSemantic,
  valueSchema: z
    .object({
      kind: z.literal("wire_facade_message"),
      text: z.string()
    })
    .strict(),
  validateValueContext: inboxV2RecipientValueHasNoTenantScopedReferences
});

const wireContracts = createInboxV2RecipientWireSyncContracts({
  projections: [conversationProjection, messageProjection],
  snapshotIndexScopeIds: ["core:employee-inbox"]
});

const serverProjection = defineInboxV2RecipientProjection({
  ...conversationProjection,
  authorizationRequirements: [
    {
      permissionId: "core:conversation.read",
      resourceScopeId: "core:conversation",
      ...inboxV2RecipientEntityResourceResolverSemantic,
      resolveResource: inboxV2RecipientEntityResourceResolver
    }
  ]
});

createInboxV2RecipientWireSyncContracts({
  projections: deriveInboxV2RecipientWireProjectionRegistrations([
    serverProjection
  ]),
  snapshotIndexScopeIds: ["core:employee-inbox"]
});

createInboxV2RecipientWireSyncContracts({
  // @ts-expect-error Client facade rejects server authorization registrations.
  projections: [serverProjection],
  snapshotIndexScopeIds: ["core:employee-inbox"]
});

createInboxV2RecipientWireSyncContracts({
  projections: [conversationProjection],
  snapshotIndexScopeIds: ["core:employee-inbox"],
  // @ts-expect-error Client facade accepts no key/verifier producer input.
  verifyRecipientStateFingerprint: () => true
});

type WireBatch = z.output<typeof wireContracts.syncBatchSchema>;
type WireSnapshotPage = z.output<typeof wireContracts.snapshotPageSchema>;
type WireRealtime = z.output<typeof wireContracts.realtimeSchema>;

export function recipientWireFacadeTypeNarrowingFixture(
  batch: WireBatch,
  snapshot: WireSnapshotPage,
  realtime: WireRealtime
): void {
  for (const commit of batch.commits) {
    for (const change of commit.changes) {
      // @ts-expect-error Wire changes expose no authorization evidence.
      void change.authorizationDecisionRefs;
      if (
        change.kind === "upsert" &&
        change.projectionTypeId === "core:wire-facade-conversation"
      ) {
        const title: string = change.value.title;
        void title;
        // @ts-expect-error Projection discriminator excludes Message fields.
        void change.value.text;
      }
      if (
        change.kind === "upsert" &&
        change.projectionTypeId === "core:wire-facade-message"
      ) {
        const text: string = change.value.text;
        void text;
        // @ts-expect-error Projection discriminator excludes Conversation fields.
        void change.value.title;
      }
    }
  }

  const registration = snapshot.manifest.registrations[0]!;
  const semanticId: string = registration.valueContextValidator.semanticId;
  void semanticId;
  // @ts-expect-error Wire manifest excludes authorization resolver metadata.
  void registration.authorizationRequirements;

  if (realtime.kind === "heartbeat") {
    const epoch: string = realtime.authorizationEpoch;
    const notAfter: string = realtime.authorizationNotAfter;
    void epoch;
    void notAfter;
    // @ts-expect-error Heartbeat exposes no decoded cursor/auth claims.
    void realtime.claims;
  }

  // @ts-expect-error Client facade returns no producer proof schema aliases.
  void wireContracts.syncBatchDeliverySchema;
  // @ts-expect-error Client facade returns no archived parser.
  void wireContracts.parseArchivedV1RealtimeEnvelope;
}
