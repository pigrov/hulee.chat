import { z } from "zod";

import {
  createInboxV2RecipientEntityChangeSchema,
  createInboxV2RecipientWireEntityChangeSchema,
  defineInboxV2RecipientWireProjection,
  inboxV2RecipientValueHasNoTenantScopedReferences,
  inboxV2RecipientValueHasNoTenantScopedReferencesSemantic
} from "./recipient-sync-projection";

const conversationProjection = defineInboxV2RecipientWireProjection({
  projectionTypeId: "core:wire-typed-conversation",
  entityTypeId: "core:conversation",
  stateSchemaId: "core:wire-typed-conversation",
  stateSchemaVersion: "v1",
  ...inboxV2RecipientValueHasNoTenantScopedReferencesSemantic,
  valueSchema: z
    .object({
      kind: z.literal("wire_typed_conversation"),
      title: z.string()
    })
    .strict(),
  validateValueContext: inboxV2RecipientValueHasNoTenantScopedReferences
});

const messageProjection = defineInboxV2RecipientWireProjection({
  projectionTypeId: "core:wire-typed-message",
  entityTypeId: "core:message",
  stateSchemaId: "core:wire-typed-message",
  stateSchemaVersion: "v1",
  ...inboxV2RecipientValueHasNoTenantScopedReferencesSemantic,
  valueSchema: z
    .object({
      kind: z.literal("wire_typed_message"),
      text: z.string()
    })
    .strict(),
  validateValueContext: inboxV2RecipientValueHasNoTenantScopedReferences
});

const _wireSchema = createInboxV2RecipientWireEntityChangeSchema({
  projections: [conversationProjection, messageProjection]
});

createInboxV2RecipientEntityChangeSchema({
  // @ts-expect-error Producer schemas require server authorization resolvers.
  projections: [conversationProjection],
  verifyRecipientStateFingerprint: () => true
});

export function recipientWireProjectionTypeNarrowingFixture(
  change: z.output<typeof _wireSchema>
): void {
  // Client wire changes never expose producer-side authorization evidence.
  // @ts-expect-error authorizationDecisionRefs is not part of the wire shape.
  void change.authorizationDecisionRefs;

  if (
    change.kind === "upsert" &&
    change.projectionTypeId === "core:wire-typed-conversation"
  ) {
    const title: string = change.value.title;
    void title;
    // @ts-expect-error Projection discriminator excludes Message fields.
    void change.value.text;
  }

  if (
    change.kind === "upsert" &&
    change.projectionTypeId === "core:wire-typed-message"
  ) {
    const text: string = change.value.text;
    void text;
    // @ts-expect-error Projection discriminator excludes Conversation fields.
    void change.value.title;
  }
}
