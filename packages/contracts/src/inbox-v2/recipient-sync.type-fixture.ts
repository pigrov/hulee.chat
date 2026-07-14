import { z } from "zod";

import {
  inboxV2ConversationReferenceSchema,
  inboxV2MessageReferenceSchema
} from "./ids";
import {
  calculateInboxV2CanonicalSha256,
  createInboxV2RecipientSyncContracts,
  defineInboxV2RecipientProjection,
  inboxV2RecipientEntityResourceResolver,
  inboxV2RecipientEntityResourceResolverSemantic,
  inboxV2RecipientValueHasNoTenantScopedReferencesSemantic,
  inboxV2RecipientValueHasNoTenantScopedReferences
} from "./recipient-sync";
import type { InboxV2RecipientProjectionRegistration } from "./recipient-sync";

function createTypeFixtureRecipientSyncContracts<
  const TProjections extends readonly InboxV2RecipientProjectionRegistration[]
>(input: {
  projections: TProjections;
  snapshotIndexScopeIds: readonly string[];
}) {
  return createInboxV2RecipientSyncContracts({
    ...input,
    archivedV1Projections: input.projections,
    archivedV1SnapshotIndexScopeIds: input.snapshotIndexScopeIds,
    verifyRecipientStateFingerprint: () => true
  });
}

const messageResolverFingerprint = calculateInboxV2CanonicalSha256({
  semanticId: "fixture:recipient-resource.value-conversation",
  semanticVersion: "v1"
});
const messageValidatorFingerprint = calculateInboxV2CanonicalSha256({
  semanticId: "fixture:recipient-value-context.message",
  semanticVersion: "v1"
});

const _contracts = createTypeFixtureRecipientSyncContracts({
  snapshotIndexScopeIds: ["core:employee-inbox"],
  projections: [
    defineInboxV2RecipientProjection({
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
      valueSchema: z
        .object({
          kind: z.literal("conversation_summary"),
          title: z.string()
        })
        .strict(),
      validateValueContext: inboxV2RecipientValueHasNoTenantScopedReferences
    }),
    defineInboxV2RecipientProjection({
      projectionTypeId: "core:message-summary",
      entityTypeId: "core:message",
      stateSchemaId: "core:message-summary",
      stateSchemaVersion: "v1",
      valueContextValidatorId: "fixture:recipient-value-context.message",
      valueContextValidatorFingerprint: messageValidatorFingerprint,
      authorizationRequirements: [
        {
          permissionId: "core:conversation.read",
          resourceScopeId: "core:conversation",
          resourceResolverId: "core:recipient-resource.value-conversation",
          resourceResolverFingerprint: messageResolverFingerprint,
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
      valueSchema: z
        .object({
          kind: z.literal("message_summary"),
          message: inboxV2MessageReferenceSchema,
          conversation: inboxV2ConversationReferenceSchema,
          text: z.string()
        })
        .strict(),
      validateValueContext: ({ entity, timeline, value }) =>
        timeline !== null &&
        value.message.tenantId === entity.tenantId &&
        String(value.message.id) === String(entity.entityId) &&
        value.conversation.tenantId === entity.tenantId &&
        value.conversation.tenantId === timeline.conversation.tenantId &&
        value.conversation.id === timeline.conversation.id
    })
  ]
});

type SyncBatch = z.output<typeof _contracts.syncBatchSchema>;

export function recipientSyncTypeNarrowingFixture(batch: SyncBatch): void {
  for (const commit of batch.commits) {
    for (const change of commit.changes) {
      if (change.kind !== "upsert") {
        continue;
      }
      if (change.projectionTypeId === "core:conversation-summary") {
        const title: string = change.value.title;
        void title;
        // @ts-expect-error Projection discriminator excludes Message fields.
        void change.value.text;
      } else if (change.projectionTypeId === "core:message-summary") {
        const text: string = change.value.text;
        const messageId: string = change.value.message.id;
        void text;
        void messageId;
        // @ts-expect-error Projection discriminator excludes Conversation fields.
        void change.value.title;
      }
    }
  }
}
