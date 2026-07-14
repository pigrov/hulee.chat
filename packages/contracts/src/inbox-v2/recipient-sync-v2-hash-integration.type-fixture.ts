import { z } from "zod";

import {
  createInboxV2ArchivedV1RecipientEntityChangeSchema,
  createInboxV2RecipientEntityChangeSchema,
  defineInboxV2RecipientProjection,
  inboxV2RecipientEntityResourceResolverSemantic,
  inboxV2RecipientValueHasNoTenantScopedReferencesSemantic
} from "./recipient-sync-projection";

const projection = defineInboxV2RecipientProjection({
  projectionTypeId: "core:typed-summary",
  entityTypeId: "core:conversation",
  stateSchemaId: "core:typed-summary",
  stateSchemaVersion: "v1",
  ...inboxV2RecipientValueHasNoTenantScopedReferencesSemantic,
  authorizationRequirements: [
    {
      permissionId: "core:conversation.read",
      resourceScopeId: "core:conversation",
      ...inboxV2RecipientEntityResourceResolverSemantic,
      resolveResource: ({ entity, value }) => {
        const title: string | undefined = value?.title;
        void title;
        // @ts-expect-error Resolver value retains the registered schema output.
        void value?.missing;
        return entity;
      }
    }
  ],
  valueSchema: z
    .object({
      kind: z.literal("typed_summary"),
      title: z.string()
    })
    .strict(),
  validateValueContext: ({ value }) => {
    const title: string = value.title;
    void title;
    // @ts-expect-error Validator value retains the registered schema output.
    void value.missing;
    return true;
  }
});

const _active = createInboxV2RecipientEntityChangeSchema({
  projections: [projection],
  verifyRecipientStateFingerprint: () => true
});
const _archived = createInboxV2ArchivedV1RecipientEntityChangeSchema({
  projections: [projection]
});

export function recipientV2HashTypeNarrowingFixture(
  activeChange: z.output<typeof _active>,
  archivedChange: z.output<typeof _archived>
): void {
  if (activeChange.kind === "upsert") {
    const title: string = activeChange.value.title;
    void title;
    // @ts-expect-error The registered value has no missing field.
    void activeChange.value.missing;
  }
  if (activeChange.kind === "invalidate") {
    const invalidationHash: string = activeChange.invalidationHash;
    void invalidationHash;
  }
  if (archivedChange.kind === "invalidate") {
    // @ts-expect-error Archived V1 invalidate intentionally has no hash field.
    void archivedChange.invalidationHash;
  }
}
