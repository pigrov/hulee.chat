import { z } from "zod";

import { inboxV2CatalogIdSchema, type InboxV2CatalogId } from "./catalog";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2ExternalMessageReferenceIdSchema,
  inboxV2ExternalMessageReferenceRefSchema,
  inboxV2ExternalThreadReferenceSchema,
  inboxV2MessageReferenceSchema,
  inboxV2NormalizedInboundEventReferenceSchema,
  inboxV2OutboundDispatchAttemptReferenceSchema,
  inboxV2RawInboundEventReferenceSchema,
  inboxV2SourceAccountReferenceSchema,
  inboxV2SourceExternalIdentityReferenceSchema,
  inboxV2SourceOccurrenceIdSchema,
  inboxV2SourceThreadBindingReferenceSchema,
  inboxV2TenantIdSchema,
  inboxV2TimelineItemReferenceSchema
} from "./ids";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION,
  inboxV2SchemaVersionTokenSchema
} from "./schema-version";
import {
  inboxV2AdapterContractSnapshotSchema,
  inboxV2AdapterIdentityDeclarationSchema,
  inboxV2ExternalMessageRealmIdSchema,
  inboxV2OpaqueProviderSubjectSchema,
  inboxV2RoutingTokenSchema,
  inboxV2RoutingTrustedServiceIdSchema,
  inboxV2SafeSourceDiagnosticSchema,
  type InboxV2AdapterContractSnapshot
} from "./source-routing-primitives";

export const INBOX_V2_EXTERNAL_MESSAGE_KEY_SCHEMA_ID =
  "core:inbox-v2.external-message-key" as const;
export const INBOX_V2_EXTERNAL_MESSAGE_REFERENCE_SCHEMA_ID =
  "core:inbox-v2.external-message-reference" as const;
export const INBOX_V2_SOURCE_OCCURRENCE_SCHEMA_ID =
  "core:inbox-v2.source-occurrence" as const;
export const INBOX_V2_SOURCE_OCCURRENCE_RESOLUTION_COMMIT_SCHEMA_ID =
  "core:inbox-v2.source-occurrence-resolution-commit" as const;
export const INBOX_V2_EXTERNAL_MESSAGE_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

export const INBOX_V2_PROVIDER_MESSAGE_OBJECT_KIND_CATALOG =
  "provider-message-object-kind" as const;
export const INBOX_V2_PROVIDER_REFERENCE_KIND_CATALOG =
  "provider-reference-kind" as const;
export const INBOX_V2_PROVIDER_TIMESTAMP_KIND_CATALOG =
  "provider-timestamp-kind" as const;

export type InboxV2ProviderMessageObjectKindId = InboxV2CatalogId<
  typeof INBOX_V2_PROVIDER_MESSAGE_OBJECT_KIND_CATALOG
>;
export type InboxV2ProviderReferenceKindId = InboxV2CatalogId<
  typeof INBOX_V2_PROVIDER_REFERENCE_KIND_CATALOG
>;
export type InboxV2ProviderTimestampKindId = InboxV2CatalogId<
  typeof INBOX_V2_PROVIDER_TIMESTAMP_KIND_CATALOG
>;

function createCatalogIdSchema<TCatalog extends string>() {
  return inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2CatalogId<TCatalog>
  );
}

export const inboxV2ProviderMessageObjectKindIdSchema =
  createCatalogIdSchema<typeof INBOX_V2_PROVIDER_MESSAGE_OBJECT_KIND_CATALOG>();
export const inboxV2ProviderReferenceKindIdSchema =
  createCatalogIdSchema<typeof INBOX_V2_PROVIDER_REFERENCE_KIND_CATALOG>();
export const inboxV2ProviderTimestampKindIdSchema =
  createCatalogIdSchema<typeof INBOX_V2_PROVIDER_TIMESTAMP_KIND_CATALOG>();

export const inboxV2ExternalMessageScopeKindSchema = z.enum([
  "provider_thread",
  "source_account",
  "source_thread_binding"
]);

export const inboxV2ExternalMessageRealmSchema = z
  .object({
    realmId: inboxV2ExternalMessageRealmIdSchema,
    realmVersion: inboxV2SchemaVersionTokenSchema,
    canonicalizationVersion: inboxV2SchemaVersionTokenSchema
  })
  .strict();

type InboxV2BaseAdapterIdentityDeclaration = z.infer<
  typeof inboxV2AdapterIdentityDeclarationSchema
>;

export type InboxV2ExternalMessageIdentityDeclaration = Omit<
  InboxV2BaseAdapterIdentityDeclaration,
  "identityKind" | "realmId" | "objectKindId" | "scopeKind"
> &
  Readonly<{
    identityKind: "message";
    realmId: z.infer<typeof inboxV2ExternalMessageRealmIdSchema>;
    objectKindId: InboxV2ProviderMessageObjectKindId;
    scopeKind: z.infer<typeof inboxV2ExternalMessageScopeKindSchema>;
  }>;

/**
 * A server-pinned message declaration. The shared adapter schema validates the
 * declaration first; this refinement narrows it to the three exact message
 * scopes and their typed realm/object-kind catalogs.
 */
export const inboxV2ExternalMessageIdentityDeclarationSchema =
  inboxV2AdapterIdentityDeclarationSchema
    .superRefine((declaration, context) => {
      if (declaration.identityKind !== "message") {
        addIssue(
          context,
          ["identityKind"],
          "External message identity declaration must use message identity kind."
        );
      }
      if (
        !inboxV2ExternalMessageRealmIdSchema.safeParse(declaration.realmId)
          .success
      ) {
        addIssue(
          context,
          ["realmId"],
          "External message identity declaration requires a message realm."
        );
      }
      if (
        !inboxV2ProviderMessageObjectKindIdSchema.safeParse(
          declaration.objectKindId
        ).success
      ) {
        addIssue(
          context,
          ["objectKindId"],
          "External message identity declaration requires a message object kind."
        );
      }
      if (
        !inboxV2ExternalMessageScopeKindSchema.safeParse(declaration.scopeKind)
          .success
      ) {
        addIssue(
          context,
          ["scopeKind"],
          "External message identity supports only provider-thread, account or binding scope."
        );
      }
      if (
        declaration.scopeKind === "provider_thread" &&
        declaration.decisionStrength !== "authoritative"
      ) {
        addIssue(
          context,
          ["decisionStrength"],
          "Provider-thread message identity requires an authoritative adapter declaration."
        );
      }
    })
    .transform(
      (declaration) =>
        declaration as unknown as InboxV2ExternalMessageIdentityDeclaration
    );

export const inboxV2ExternalMessageScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("provider_thread") }).strict(),
  z
    .object({
      kind: z.literal("source_account"),
      owner: inboxV2SourceAccountReferenceSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("source_thread_binding"),
      owner: inboxV2SourceThreadBindingReferenceSchema
    })
    .strict()
]);

/**
 * Stable exact provider message identity. Pinned declaration audit fields are
 * stored beside this key and deliberately excluded from uniqueness, just like
 * content, display sender and timestamps.
 */
export const inboxV2ExternalMessageKeySchema = z
  .object({
    realm: inboxV2ExternalMessageRealmSchema,
    scope: inboxV2ExternalMessageScopeSchema,
    objectKindId: inboxV2ProviderMessageObjectKindIdSchema,
    externalThread: inboxV2ExternalThreadReferenceSchema,
    canonicalExternalSubject: inboxV2OpaqueProviderSubjectSchema
  })
  .strict()
  .superRefine((key, context) => {
    if (
      key.scope.kind !== "provider_thread" &&
      key.scope.owner.tenantId !== key.externalThread.tenantId
    ) {
      addIssue(
        context,
        ["scope", "owner"],
        "Message scope owner and ExternalThread must use one tenant."
      );
    }
  });

export const inboxV2ExternalMessageReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2ExternalMessageReferenceIdSchema,
    key: inboxV2ExternalMessageKeySchema,
    identityDeclaration: inboxV2ExternalMessageIdentityDeclarationSchema,
    externalThread: inboxV2ExternalThreadReferenceSchema,
    timelineItem: inboxV2TimelineItemReferenceSchema,
    message: inboxV2MessageReferenceSchema,
    revision: inboxV2EntityRevisionSchema.refine((value) => value === "1", {
      message: "External message references are immutable at revision 1."
    }),
    createdAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((reference, context) => {
    for (const [field, nestedReference] of [
      ["externalThread", reference.externalThread],
      ["timelineItem", reference.timelineItem],
      ["message", reference.message]
    ] as const) {
      addTenantReferenceIssue(context, reference.tenantId, nestedReference, [
        field
      ]);
    }

    addMessageKeyTenantIssues(context, reference.tenantId, reference.key, [
      "key"
    ]);
    addMessageDeclarationIssues(
      context,
      reference.identityDeclaration,
      reference.key,
      ["identityDeclaration"]
    );
    if (
      !sameReference(reference.key.externalThread, reference.externalThread)
    ) {
      addIssue(
        context,
        ["externalThread"],
        "External message reference must target the exact thread from its key."
      );
    }
  });

export const inboxV2SourceOccurrenceBindingContextSchema = z
  .object({
    externalThread: inboxV2ExternalThreadReferenceSchema,
    sourceAccount: inboxV2SourceAccountReferenceSchema,
    sourceThreadBinding: inboxV2SourceThreadBindingReferenceSchema,
    bindingGeneration: inboxV2EntityRevisionSchema
  })
  .strict();

export const inboxV2SourceOccurrenceOriginSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.enum(["webhook", "stream", "poll", "history", "provider_echo"]),
        sourceAccount: inboxV2SourceAccountReferenceSchema,
        rawInboundEvent: inboxV2RawInboundEventReferenceSchema,
        normalizedInboundEvent: inboxV2NormalizedInboundEventReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("provider_response"),
        sourceAccount: inboxV2SourceAccountReferenceSchema,
        outboundDispatchAttempt: inboxV2OutboundDispatchAttemptReferenceSchema
      })
      .strict()
  ]
);

export const inboxV2SourceOccurrenceProviderActorSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("source_external_identity"),
        sourceExternalIdentity: inboxV2SourceExternalIdentityReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("provider_system"),
        actorKindId: inboxV2CatalogIdSchema,
        actorSubject: inboxV2OpaqueProviderSubjectSchema
      })
      .strict()
  ])
  .nullable();

export const inboxV2ProviderReferenceSchema = z
  .object({
    kindId: inboxV2ProviderReferenceKindIdSchema,
    subject: inboxV2OpaqueProviderSubjectSchema
  })
  .strict();

export const inboxV2ProviderTimestampSchema = z
  .object({
    kindId: inboxV2ProviderTimestampKindIdSchema,
    timestamp: inboxV2TimestampSchema
  })
  .strict();

export const inboxV2SourceOccurrenceDescriptorSchema = z
  .object({
    adapterContract: inboxV2AdapterContractSnapshotSchema,
    descriptorSchemaId: inboxV2CatalogIdSchema,
    descriptorVersion: inboxV2SchemaVersionTokenSchema,
    capabilityRevision: inboxV2EntityRevisionSchema,
    providerReferences: z.array(inboxV2ProviderReferenceSchema).min(1).max(32),
    descriptorDigestSha256: z.string().regex(/^[a-f0-9]{64}$/u)
  })
  .strict()
  .superRefine((descriptor, context) => {
    addUniqueCatalogFactIssues(
      context,
      descriptor.providerReferences,
      ["providerReferences"],
      "Provider reference"
    );
  });

export const inboxV2ExternalReferencePortabilityKindSchema = z.enum([
  "binding_only",
  "external_thread",
  "provider_global"
]);

export const inboxV2ExternalReferencePortabilitySchema = z
  .object({
    kind: inboxV2ExternalReferencePortabilityKindSchema,
    adapterContract: inboxV2AdapterContractSnapshotSchema,
    decisionStrength: z.enum(["authoritative", "safe_default"])
  })
  .strict()
  .superRefine((portability, context) => {
    if (
      portability.kind !== "binding_only" &&
      portability.decisionStrength !== "authoritative"
    ) {
      addIssue(
        context,
        ["decisionStrength"],
        "Cross-binding reference portability requires authoritative adapter evidence."
      );
    }
  });

export const inboxV2SourceOccurrenceResolutionSchema = z.discriminatedUnion(
  "state",
  [
    z
      .object({
        state: z.literal("pending"),
        diagnostic: inboxV2SafeSourceDiagnosticSchema
      })
      .strict(),
    z
      .object({
        state: z.literal("resolved"),
        externalMessageReference: inboxV2ExternalMessageReferenceRefSchema
      })
      .strict(),
    z
      .object({
        state: z.literal("conflicted"),
        candidateExternalMessageReferences: z
          .array(inboxV2ExternalMessageReferenceRefSchema)
          .min(2)
          .max(100),
        diagnostic: inboxV2SafeSourceDiagnosticSchema
      })
      .strict()
      .superRefine((resolution, context) => {
        const candidateIds = new Set<string>();
        for (const [
          index,
          reference
        ] of resolution.candidateExternalMessageReferences.entries()) {
          const id = String(reference.id);
          if (candidateIds.has(id)) {
            addIssue(
              context,
              ["candidateExternalMessageReferences", index, "id"],
              "Conflict candidates must be distinct."
            );
          }
          candidateIds.add(id);
        }
      })
  ]
);

/**
 * One immutable provider observation with mutable resolution state. This is a
 * single-row contract, not a lifetime collection of thread occurrences.
 */
export const inboxV2SourceOccurrenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2SourceOccurrenceIdSchema,
    messageKey: inboxV2ExternalMessageKeySchema,
    messageIdentityDeclaration: inboxV2ExternalMessageIdentityDeclarationSchema,
    bindingContext: inboxV2SourceOccurrenceBindingContextSchema,
    origin: inboxV2SourceOccurrenceOriginSchema,
    descriptor: inboxV2SourceOccurrenceDescriptorSchema,
    providerActor: inboxV2SourceOccurrenceProviderActorSchema,
    direction: z.enum(["inbound", "outbound", "system"]),
    providerTimestamps: z.array(inboxV2ProviderTimestampSchema).max(16),
    referencePortability: inboxV2ExternalReferencePortabilitySchema,
    resolution: inboxV2SourceOccurrenceResolutionSchema,
    observedAt: inboxV2TimestampSchema,
    recordedAt: inboxV2TimestampSchema,
    revision: inboxV2EntityRevisionSchema,
    createdAt: inboxV2TimestampSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((occurrence, context) => {
    const tenantId = occurrence.tenantId;

    addMessageKeyTenantIssues(context, tenantId, occurrence.messageKey, [
      "messageKey"
    ]);
    addMessageDeclarationIssues(
      context,
      occurrence.messageIdentityDeclaration,
      occurrence.messageKey,
      ["messageIdentityDeclaration"]
    );

    for (const [field, reference] of [
      ["externalThread", occurrence.bindingContext.externalThread],
      ["sourceAccount", occurrence.bindingContext.sourceAccount],
      ["sourceThreadBinding", occurrence.bindingContext.sourceThreadBinding]
    ] as const) {
      addTenantReferenceIssue(context, tenantId, reference, [
        "bindingContext",
        field
      ]);
    }

    if (
      !sameReference(
        occurrence.messageKey.externalThread,
        occurrence.bindingContext.externalThread
      )
    ) {
      addIssue(
        context,
        ["bindingContext", "externalThread"],
        "Occurrence binding context must use the message key thread."
      );
    }

    if (
      occurrence.messageKey.scope.kind === "source_account" &&
      !sameReference(
        occurrence.messageKey.scope.owner,
        occurrence.bindingContext.sourceAccount
      )
    ) {
      addIssue(
        context,
        ["messageKey", "scope", "owner"],
        "Account-scoped message key must use the occurrence SourceAccount."
      );
    }
    if (
      occurrence.messageKey.scope.kind === "source_thread_binding" &&
      !sameReference(
        occurrence.messageKey.scope.owner,
        occurrence.bindingContext.sourceThreadBinding
      )
    ) {
      addIssue(
        context,
        ["messageKey", "scope", "owner"],
        "Binding-scoped message key must use the occurrence binding."
      );
    }

    addTenantReferenceIssue(
      context,
      tenantId,
      occurrence.origin.sourceAccount,
      ["origin", "sourceAccount"]
    );
    if (
      !sameReference(
        occurrence.origin.sourceAccount,
        occurrence.bindingContext.sourceAccount
      )
    ) {
      addIssue(
        context,
        ["origin", "sourceAccount"],
        "Occurrence origin must agree with its binding SourceAccount."
      );
    }
    if (occurrence.origin.kind !== "provider_response") {
      addTenantReferenceIssue(
        context,
        tenantId,
        occurrence.origin.rawInboundEvent,
        ["origin", "rawInboundEvent"]
      );
      addTenantReferenceIssue(
        context,
        tenantId,
        occurrence.origin.normalizedInboundEvent,
        ["origin", "normalizedInboundEvent"]
      );
    } else {
      addTenantReferenceIssue(
        context,
        tenantId,
        occurrence.origin.outboundDispatchAttempt,
        ["origin", "outboundDispatchAttempt"]
      );
      if (
        occurrence.direction !== "outbound" ||
        occurrence.providerActor !== null
      ) {
        addIssue(
          context,
          ["origin", "kind"],
          "Provider responses are Hulee outbound observations without a provider actor."
        );
      }
    }

    if (
      occurrence.origin.kind === "provider_echo" &&
      (occurrence.direction !== "outbound" || occurrence.providerActor !== null)
    ) {
      addIssue(
        context,
        ["direction"],
        "Provider echoes are Hulee outbound observations without a provider actor."
      );
    }

    addProviderActorIssues(context, tenantId, occurrence);

    if (
      !sameAdapterContractSnapshot(
        occurrence.messageIdentityDeclaration.adapterContract,
        occurrence.descriptor.adapterContract
      )
    ) {
      addIssue(
        context,
        ["descriptor", "adapterContract"],
        "Occurrence descriptor must use the message identity adapter snapshot."
      );
    }
    if (
      !sameAdapterContractSnapshot(
        occurrence.messageIdentityDeclaration.adapterContract,
        occurrence.referencePortability.adapterContract
      )
    ) {
      addIssue(
        context,
        ["referencePortability", "adapterContract"],
        "Reference portability must use the message identity adapter snapshot."
      );
    }

    addUniqueCatalogFactIssues(
      context,
      occurrence.providerTimestamps,
      ["providerTimestamps"],
      "Provider timestamp"
    );

    if (
      !isInboxV2TimestampOrderValid(
        occurrence.observedAt,
        occurrence.recordedAt
      )
    ) {
      addIssue(
        context,
        ["recordedAt"],
        "Occurrence cannot be recorded before it is observed."
      );
    }
    if (occurrence.recordedAt !== occurrence.createdAt) {
      addIssue(
        context,
        ["createdAt"],
        "Occurrence creation time must preserve its immutable recorded time."
      );
    }
    if (
      !isInboxV2TimestampOrderValid(occurrence.createdAt, occurrence.updatedAt)
    ) {
      addIssue(
        context,
        ["updatedAt"],
        "Occurrence resolution update cannot precede creation."
      );
    }

    if (occurrence.resolution.state === "resolved") {
      addTenantReferenceIssue(
        context,
        tenantId,
        occurrence.resolution.externalMessageReference,
        ["resolution", "externalMessageReference"]
      );
    }
    if (occurrence.resolution.state === "conflicted") {
      for (const [
        index,
        reference
      ] of occurrence.resolution.candidateExternalMessageReferences.entries()) {
        addTenantReferenceIssue(context, tenantId, reference, [
          "resolution",
          "candidateExternalMessageReferences",
          index
        ]);
      }
    }
  });

/**
 * One CAS transition for one occurrence resolution. It intentionally carries
 * before/after rows instead of a lifetime occurrence aggregate, so concurrent
 * resolvers cannot overwrite a resolved or newer conflicted decision.
 */
export const inboxV2SourceOccurrenceResolutionCommitSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    expectedRevision: inboxV2EntityRevisionSchema,
    resultingRevision: inboxV2EntityRevisionSchema,
    changedAt: inboxV2TimestampSchema,
    resolver: z
      .object({
        kind: z.literal("trusted_service"),
        trustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
        resolutionToken: inboxV2RoutingTokenSchema
      })
      .strict(),
    before: inboxV2SourceOccurrenceSchema,
    after: inboxV2SourceOccurrenceSchema,
    resolvedReference: inboxV2ExternalMessageReferenceSchema.nullable()
  })
  .strict()
  .superRefine((commit, context) => {
    if (
      commit.before.tenantId !== commit.tenantId ||
      commit.after.tenantId !== commit.tenantId ||
      String(commit.before.id) !== String(commit.after.id)
    ) {
      addIssue(
        context,
        ["after", "id"],
        "Resolution CAS must target one exact tenant-scoped occurrence."
      );
    }

    if (
      commit.resolver.trustedServiceId !==
      commit.before.messageIdentityDeclaration.adapterContract
        .loadedByTrustedServiceId
    ) {
      addIssue(
        context,
        ["resolver", "trustedServiceId"],
        "Occurrence resolution must use the trusted service pinned by its message declaration."
      );
    }

    if (
      String(commit.before.revision) !== String(commit.expectedRevision) ||
      String(commit.after.revision) !== String(commit.resultingRevision) ||
      BigInt(commit.resultingRevision) !== BigInt(commit.expectedRevision) + 1n
    ) {
      addIssue(
        context,
        ["resultingRevision"],
        "Occurrence resolution must advance the exact current revision once."
      );
    }

    if (
      commit.after.updatedAt !== commit.changedAt ||
      !isInboxV2TimestampOrderValid(commit.before.updatedAt, commit.changedAt)
    ) {
      addIssue(
        context,
        ["changedAt"],
        "Resolution change time cannot regress and must become after.updatedAt."
      );
    }

    const expectedAfter = {
      ...commit.before,
      resolution: commit.after.resolution,
      revision: commit.resultingRevision,
      updatedAt: commit.changedAt
    };
    if (!sameValue(commit.after, expectedAfter)) {
      addIssue(
        context,
        ["after"],
        "Resolution CAS may change only resolution, revision and updatedAt."
      );
    }

    if (commit.before.resolution.state === "resolved") {
      addIssue(
        context,
        ["before", "resolution", "state"],
        "A resolved occurrence is terminal and cannot be overwritten."
      );
    }

    if (commit.after.resolution.state === "pending") {
      addIssue(
        context,
        ["after", "resolution", "state"],
        "A resolution commit cannot transition back to pending."
      );
    }

    if (commit.after.resolution.state === "resolved") {
      if (commit.resolvedReference === null) {
        addIssue(
          context,
          ["resolvedReference"],
          "Resolved occurrence commit requires the exact canonical reference."
        );
        return;
      }

      if (
        !sameReference(
          commit.after.resolution.externalMessageReference,
          commit.resolvedReference
        ) ||
        !sameExternalMessageKey(
          commit.resolvedReference.key,
          commit.after.messageKey
        )
      ) {
        addIssue(
          context,
          ["resolvedReference"],
          "Resolved occurrence and supplied reference must share exact ID, tenant and message key."
        );
      }
    } else if (commit.resolvedReference !== null) {
      addIssue(
        context,
        ["resolvedReference"],
        "Conflicted resolution cannot claim one canonical reference."
      );
    }
  });

export const inboxV2ExternalMessageKeyEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_EXTERNAL_MESSAGE_KEY_SCHEMA_ID,
    INBOX_V2_EXTERNAL_MESSAGE_SCHEMA_VERSION,
    inboxV2ExternalMessageKeySchema
  );
export const inboxV2ExternalMessageReferenceEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_EXTERNAL_MESSAGE_REFERENCE_SCHEMA_ID,
    INBOX_V2_EXTERNAL_MESSAGE_SCHEMA_VERSION,
    inboxV2ExternalMessageReferenceSchema
  );
export const inboxV2SourceOccurrenceEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_OCCURRENCE_SCHEMA_ID,
    INBOX_V2_EXTERNAL_MESSAGE_SCHEMA_VERSION,
    inboxV2SourceOccurrenceSchema
  );
export const inboxV2SourceOccurrenceResolutionCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_OCCURRENCE_RESOLUTION_COMMIT_SCHEMA_ID,
    INBOX_V2_EXTERNAL_MESSAGE_SCHEMA_VERSION,
    inboxV2SourceOccurrenceResolutionCommitSchema
  );

export type InboxV2ExternalMessageScopeKind = z.infer<
  typeof inboxV2ExternalMessageScopeKindSchema
>;
export type InboxV2ExternalMessageRealm = z.infer<
  typeof inboxV2ExternalMessageRealmSchema
>;
export type InboxV2ExternalMessageScope = z.infer<
  typeof inboxV2ExternalMessageScopeSchema
>;
export type InboxV2ExternalMessageKey = z.infer<
  typeof inboxV2ExternalMessageKeySchema
>;
export type InboxV2ExternalMessageReference = z.infer<
  typeof inboxV2ExternalMessageReferenceSchema
>;
export type InboxV2SourceOccurrenceBindingContext = z.infer<
  typeof inboxV2SourceOccurrenceBindingContextSchema
>;
export type InboxV2SourceOccurrenceOrigin = z.infer<
  typeof inboxV2SourceOccurrenceOriginSchema
>;
export type InboxV2SourceOccurrenceProviderActor = z.infer<
  typeof inboxV2SourceOccurrenceProviderActorSchema
>;
export type InboxV2ProviderReference = z.infer<
  typeof inboxV2ProviderReferenceSchema
>;
export type InboxV2ProviderTimestamp = z.infer<
  typeof inboxV2ProviderTimestampSchema
>;
export type InboxV2SourceOccurrenceDescriptor = z.infer<
  typeof inboxV2SourceOccurrenceDescriptorSchema
>;
export type InboxV2ExternalReferencePortabilityKind = z.infer<
  typeof inboxV2ExternalReferencePortabilityKindSchema
>;
export type InboxV2ExternalReferencePortability = z.infer<
  typeof inboxV2ExternalReferencePortabilitySchema
>;
export type InboxV2SourceOccurrenceResolution = z.infer<
  typeof inboxV2SourceOccurrenceResolutionSchema
>;
export type InboxV2SourceOccurrence = z.infer<
  typeof inboxV2SourceOccurrenceSchema
>;
export type InboxV2SourceOccurrenceResolutionCommit = z.infer<
  typeof inboxV2SourceOccurrenceResolutionCommitSchema
>;

function addProviderActorIssues(
  context: z.RefinementCtx,
  tenantId: string,
  occurrence: InboxV2SourceOccurrence
): void {
  const actor = occurrence.providerActor;
  const isHuleeOutboundObservation =
    occurrence.origin.kind === "provider_response" ||
    occurrence.origin.kind === "provider_echo";

  if (actor === null) {
    if (occurrence.direction !== "outbound" || !isHuleeOutboundObservation) {
      addIssue(
        context,
        ["providerActor"],
        "Only Hulee provider-response or provider-echo observations may omit the provider actor."
      );
    }
    return;
  }

  if (actor.kind === "source_external_identity") {
    addTenantReferenceIssue(context, tenantId, actor.sourceExternalIdentity, [
      "providerActor",
      "sourceExternalIdentity"
    ]);
    if (occurrence.direction === "system" || isHuleeOutboundObservation) {
      addIssue(
        context,
        ["providerActor", "kind"],
        "A proven native external identity is an inbound or native-provider outbound actor."
      );
    }
  }

  if (actor.kind === "provider_system" && occurrence.direction !== "system") {
    addIssue(
      context,
      ["providerActor", "kind"],
      "Provider-system actor requires system direction."
    );
  }
}

function addUniqueCatalogFactIssues(
  context: z.RefinementCtx,
  facts: readonly { kindId: string }[],
  path: PropertyKey[],
  label: string
): void {
  const kindIds = new Set<string>();

  for (const [index, fact] of facts.entries()) {
    const kindId = String(fact.kindId);
    if (kindIds.has(kindId)) {
      addIssue(
        context,
        [...path, index, "kindId"],
        `${label} kinds must be unique.`
      );
    }
    kindIds.add(kindId);
  }
}

function addMessageKeyTenantIssues(
  context: z.RefinementCtx,
  tenantId: string,
  key: InboxV2ExternalMessageKey,
  path: PropertyKey[]
): void {
  addTenantReferenceIssue(context, tenantId, key.externalThread, [
    ...path,
    "externalThread"
  ]);

  if (key.scope.kind !== "provider_thread") {
    addTenantReferenceIssue(context, tenantId, key.scope.owner, [
      ...path,
      "scope",
      "owner"
    ]);
  }
}

function addMessageDeclarationIssues(
  context: z.RefinementCtx,
  declaration: InboxV2ExternalMessageIdentityDeclaration,
  key: InboxV2ExternalMessageKey,
  path: PropertyKey[]
): void {
  if (
    declaration.realmId !== key.realm.realmId ||
    declaration.realmVersion !== key.realm.realmVersion ||
    declaration.canonicalizationVersion !== key.realm.canonicalizationVersion ||
    declaration.objectKindId !== key.objectKindId ||
    declaration.scopeKind !== key.scope.kind
  ) {
    addIssue(
      context,
      path,
      "Pinned message identity declaration must exactly describe the stable message key."
    );
  }
}

function sameExternalMessageKey(
  left: InboxV2ExternalMessageKey,
  right: InboxV2ExternalMessageKey
): boolean {
  if (
    left.canonicalExternalSubject !== right.canonicalExternalSubject ||
    !sameReference(left.externalThread, right.externalThread) ||
    left.realm.realmId !== right.realm.realmId ||
    left.realm.realmVersion !== right.realm.realmVersion ||
    left.realm.canonicalizationVersion !==
      right.realm.canonicalizationVersion ||
    left.objectKindId !== right.objectKindId ||
    left.scope.kind !== right.scope.kind
  ) {
    return false;
  }

  if (left.scope.kind === "provider_thread") {
    return right.scope.kind === "provider_thread";
  }
  if (left.scope.kind === "source_account") {
    return (
      right.scope.kind === "source_account" &&
      sameReference(left.scope.owner, right.scope.owner)
    );
  }
  return (
    right.scope.kind === "source_thread_binding" &&
    sameReference(left.scope.owner, right.scope.owner)
  );
}

function sameAdapterContractSnapshot(
  left: InboxV2AdapterContractSnapshot,
  right: InboxV2AdapterContractSnapshot
): boolean {
  return (
    left.contractId === right.contractId &&
    left.contractVersion === right.contractVersion &&
    left.declarationRevision === right.declarationRevision &&
    left.surfaceId === right.surfaceId &&
    left.loadedByTrustedServiceId === right.loadedByTrustedServiceId &&
    left.loadedAt === right.loadedAt
  );
}

function sameReference(
  left: { tenantId: string; id: string },
  right: { tenantId: string; id: string }
): boolean {
  return left.tenantId === right.tenantId && left.id === right.id;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addTenantReferenceIssue(
  context: z.RefinementCtx,
  tenantId: string,
  reference: { tenantId: string },
  path: PropertyKey[]
): void {
  if (reference.tenantId !== tenantId) {
    addIssue(
      context,
      path,
      "Inbox V2 nested reference must use the entity tenant."
    );
  }
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
