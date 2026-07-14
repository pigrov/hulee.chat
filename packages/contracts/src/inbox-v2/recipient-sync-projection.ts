import { z } from "zod";

import { inboxV2AuthorizationEpochSchema } from "./authorization-epoch";
import { inboxV2CatalogIdSchema } from "./catalog";
import { inboxV2EntityRevisionSchema } from "./entity-metadata";
import { inboxV2SchemaVersionTokenSchema } from "./schema-version";
import { assertInboxV2ClosedJsonSchema } from "./schema-safety";
import {
  inboxV2AudienceImpactIdSchema,
  inboxV2AuthorizationDecisionReferenceSchema,
  inboxV2EntityKeySchema,
  inboxV2InvalidationScopeSchema,
  inboxV2RecipientStateFingerprintSchema,
  inboxV2Sha256DigestSchema,
  inboxV2TenantStreamCommitPositionSchema,
  inboxV2TimelinePositionContextSchema
} from "./sync-primitives";
import {
  containsForbiddenRecipientPayloadKey,
  isBoundedJsonRecipientValue
} from "./recipient-sync-json";
import {
  calculateInboxV2CanonicalSha256,
  verifyInboxV2RecipientInvalidateInstructionHash,
  verifyInboxV2RecipientTombstoneStateHash
} from "./recipient-sync-hash";

const recipientChangeOrderingFields = {
  recipientOrdinal: inboxV2EntityRevisionSchema,
  sourceChangeOrdinal: inboxV2EntityRevisionSchema
} as const;

const recipientChangeBaseFields = {
  ...recipientChangeOrderingFields,
  authorizationDecisionRefs: z
    .array(inboxV2AuthorizationDecisionReferenceSchema)
    .min(1)
    .max(64)
} as const;

/**
 * Client wire changes deliberately carry no authorization evidence. The
 * producer validates the richer internal change before serializing this exact
 * allowlist, so adding an evidence field fails closed instead of being
 * silently stripped by Zod.
 */
const recipientWireChangeBaseFields = {
  ...recipientChangeOrderingFields
} as const;

type InboxV2RecipientCallback<TContext, TResult> = {
  bivarianceHack(context: TContext): TResult;
}["bivarianceHack"];

const recipientInvalidateChangeFields = {
  ...recipientChangeBaseFields,
  kind: z.literal("invalidate"),
  projectionTypeId: inboxV2CatalogIdSchema,
  entity: inboxV2EntityKeySchema,
  revision: inboxV2EntityRevisionSchema,
  lastChangedStreamPosition: inboxV2TenantStreamCommitPositionSchema,
  timeline: inboxV2TimelinePositionContextSchema.nullable(),
  stateSchemaId: inboxV2CatalogIdSchema,
  stateSchemaVersion: inboxV2SchemaVersionTokenSchema,
  stateHash: z.union([
    inboxV2RecipientStateFingerprintSchema,
    inboxV2Sha256DigestSchema
  ]),
  reasonId: inboxV2CatalogIdSchema,
  targetedFetchRequired: z.literal(true)
} as const;

export const inboxV2ArchivedV1RecipientInvalidateChangeSchema = z
  .object({
    ...recipientInvalidateChangeFields,
    stateHash: inboxV2Sha256DigestSchema
  })
  .strict();

export const inboxV2RecipientInvalidateChangeSchema = z
  .object({
    ...recipientInvalidateChangeFields,
    invalidationHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((change, context) => {
    if (!verifyInboxV2RecipientInvalidateInstructionHash(change)) {
      context.addIssue({
        code: "custom",
        path: ["invalidationHash"],
        message:
          "Recipient invalidation hash must match its canonical instruction and expected actual state."
      });
    }
  });

/** Security purge is delivered only as a scope transition, never as an
 * ordinary revisioned entity delta. It clears the previous authorization
 * scope before any payload can be emitted under the resulting epoch. */
export const inboxV2RecipientSecurityPurgeChangeSchema = z
  .object({
    ...recipientChangeBaseFields,
    kind: z.literal("security_purge"),
    scope: inboxV2InvalidationScopeSchema,
    reasonId: inboxV2CatalogIdSchema,
    accessTransitionToken: inboxV2AudienceImpactIdSchema,
    resultingAuthorizationEpoch: inboxV2AuthorizationEpochSchema
  })
  .strict();

export const inboxV2RecipientWireSecurityPurgeChangeSchema = z
  .object({
    ...recipientWireChangeBaseFields,
    kind: z.literal("security_purge"),
    scope: inboxV2InvalidationScopeSchema,
    reasonId: inboxV2CatalogIdSchema,
    accessTransitionToken: inboxV2AudienceImpactIdSchema,
    resultingAuthorizationEpoch: inboxV2AuthorizationEpochSchema
  })
  .strict();

export type InboxV2RecipientWireProjectionRegistration<
  TValueSchema extends z.ZodType = z.ZodTypeAny
> = Readonly<{
  projectionTypeId: string;
  entityTypeId: string;
  stateSchemaId: string;
  stateSchemaVersion: string;
  valueContextValidatorId: string;
  valueContextValidatorFingerprint: string;
  valueSchema: TValueSchema;
  validateValueContext: InboxV2RecipientCallback<
    InboxV2RecipientProjectionValueContext<z.output<TValueSchema>>,
    boolean
  >;
}>;

export type InboxV2RecipientProjectionRegistration<
  TValueSchema extends z.ZodType = z.ZodTypeAny
> = InboxV2RecipientWireProjectionRegistration<TValueSchema> &
  Readonly<{
    authorizationRequirements: readonly Readonly<{
      permissionId: string;
      resourceScopeId: string;
      resourceResolverId: string;
      resourceResolverFingerprint: string;
      resolveResource: InboxV2RecipientCallback<
        InboxV2RecipientAuthorizationResourceContext<z.output<TValueSchema>>,
        unknown
      >;
    }>[];
  }>;

export type InboxV2NormalizedRecipientWireProjectionRegistration = Readonly<{
  projectionTypeId: string;
  entityTypeId: string;
  stateSchemaId: string;
  stateSchemaVersion: string;
  valueContextValidatorId: string;
  valueContextValidatorFingerprint: string;
  valueSchema: z.ZodType;
  validateValueContext: InboxV2RecipientCallback<
    InboxV2RecipientProjectionValueContext<unknown>,
    boolean
  >;
}>;

export type InboxV2NormalizedRecipientProjectionRegistration =
  InboxV2NormalizedRecipientWireProjectionRegistration &
    Readonly<{
      authorizationRequirements: readonly Readonly<{
        permissionId: string;
        resourceScopeId: string;
        resourceResolverId: string;
        resourceResolverFingerprint: string;
        resolveResource: InboxV2RecipientCallback<
          InboxV2RecipientAuthorizationResourceContext<unknown>,
          unknown
        >;
      }>[];
    }>;

export type InboxV2RecipientProjectionValueContext<TValue = unknown> =
  Readonly<{
    entity: z.output<typeof inboxV2EntityKeySchema>;
    timeline: z.output<typeof inboxV2TimelinePositionContextSchema> | null;
    value: TValue;
  }>;

export type InboxV2RecipientAuthorizationResourceContext<TValue = unknown> =
  Readonly<{
    entity: z.output<typeof inboxV2EntityKeySchema>;
    timeline: z.output<typeof inboxV2TimelinePositionContextSchema> | null;
    value: TValue | undefined;
  }>;

export type InboxV2RecipientResourceResolverSemanticDescriptor = Readonly<{
  resourceResolverId: string;
  resourceResolverFingerprint: string;
}>;

export type InboxV2RecipientValueContextValidatorSemanticDescriptor = Readonly<{
  valueContextValidatorId: string;
  valueContextValidatorFingerprint: string;
}>;

export const inboxV2RecipientEntityResourceResolverSemantic =
  createBuiltInRecipientResourceResolverSemantic({
    resourceResolverId: "core:recipient-resource.entity",
    semanticVersion: "v1",
    contract: "return-the-exact-recipient-entity-key"
  });

export const inboxV2RecipientTimelineConversationResourceResolverSemantic =
  createBuiltInRecipientResourceResolverSemantic({
    resourceResolverId: "core:recipient-resource.timeline-conversation",
    semanticVersion: "v1",
    contract:
      "return-null-without-timeline-otherwise-return-the-timeline-conversation-entity-key"
  });

export const inboxV2RecipientValueHasNoTenantScopedReferencesSemantic =
  createBuiltInRecipientValueContextValidatorSemantic({
    valueContextValidatorId:
      "core:recipient-value-context.no-tenant-scoped-references",
    semanticVersion: "v1",
    contract: "accept-only-bounded-values-without-any-nested-tenantId-property"
  });

export function defineInboxV2RecipientProjection<
  const TValueSchema extends z.ZodType,
  const TProjectionTypeId extends string,
  const TEntityTypeId extends string,
  const TStateSchemaId extends string,
  const TStateSchemaVersion extends string
>(
  registration: InboxV2RecipientProjectionRegistration<TValueSchema> &
    Readonly<{
      projectionTypeId: TProjectionTypeId;
      entityTypeId: TEntityTypeId;
      stateSchemaId: TStateSchemaId;
      stateSchemaVersion: TStateSchemaVersion;
    }>
): InboxV2RecipientProjectionRegistration<TValueSchema> &
  Readonly<{
    projectionTypeId: TProjectionTypeId;
    entityTypeId: TEntityTypeId;
    stateSchemaId: TStateSchemaId;
    stateSchemaVersion: TStateSchemaVersion;
  }> {
  return registration;
}

export function defineInboxV2RecipientWireProjection<
  const TValueSchema extends z.ZodType,
  const TProjectionTypeId extends string,
  const TEntityTypeId extends string,
  const TStateSchemaId extends string,
  const TStateSchemaVersion extends string
>(
  registration: InboxV2RecipientWireProjectionRegistration<TValueSchema> &
    Readonly<{
      projectionTypeId: TProjectionTypeId;
      entityTypeId: TEntityTypeId;
      stateSchemaId: TStateSchemaId;
      stateSchemaVersion: TStateSchemaVersion;
    }>
): InboxV2RecipientWireProjectionRegistration<TValueSchema> &
  Readonly<{
    projectionTypeId: TProjectionTypeId;
    entityTypeId: TEntityTypeId;
    stateSchemaId: TStateSchemaId;
    stateSchemaVersion: TStateSchemaVersion;
  }> {
  return registration;
}

type InboxV2DerivedRecipientWireProjectionRegistration<
  TRegistration extends InboxV2RecipientWireProjectionRegistration
> = Readonly<{
  projectionTypeId: TRegistration["projectionTypeId"];
  entityTypeId: TRegistration["entityTypeId"];
  stateSchemaId: TRegistration["stateSchemaId"];
  stateSchemaVersion: TRegistration["stateSchemaVersion"];
  valueContextValidatorId: TRegistration["valueContextValidatorId"];
  valueContextValidatorFingerprint: TRegistration["valueContextValidatorFingerprint"];
  valueSchema: TRegistration["valueSchema"];
  validateValueContext: TRegistration["validateValueContext"];
}>;

/** Exact projection from a server registration into client-safe schema input. */
export function deriveInboxV2RecipientWireProjectionRegistrations<
  const TRegistrations extends
    readonly InboxV2RecipientWireProjectionRegistration[]
>(
  registrations: TRegistrations
): {
  readonly [TIndex in keyof TRegistrations]: TRegistrations[TIndex] extends InboxV2RecipientWireProjectionRegistration
    ? InboxV2DerivedRecipientWireProjectionRegistration<TRegistrations[TIndex]>
    : never;
} {
  return registrations.map((registration) =>
    Object.freeze({
      projectionTypeId: registration.projectionTypeId,
      entityTypeId: registration.entityTypeId,
      stateSchemaId: registration.stateSchemaId,
      stateSchemaVersion: registration.stateSchemaVersion,
      valueContextValidatorId: registration.valueContextValidatorId,
      valueContextValidatorFingerprint:
        registration.valueContextValidatorFingerprint,
      valueSchema: registration.valueSchema,
      validateValueContext: registration.validateValueContext
    })
  ) as unknown as {
    readonly [TIndex in keyof TRegistrations]: TRegistrations[TIndex] extends InboxV2RecipientWireProjectionRegistration
      ? InboxV2DerivedRecipientWireProjectionRegistration<
          TRegistrations[TIndex]
        >
      : never;
  };
}

export const inboxV2RecipientEntityResourceResolver = (
  change: InboxV2RecipientAuthorizationResourceContext
) => change.entity;

export const inboxV2RecipientTimelineConversationResourceResolver = (
  change: InboxV2RecipientAuthorizationResourceContext
) =>
  change.timeline === null
    ? null
    : {
        tenantId: change.timeline.conversation.tenantId,
        entityTypeId: "core:conversation",
        entityId: change.timeline.conversation.id
      };

/**
 * Explicit registration policy for projections whose value is intentionally
 * free of tenant-scoped references. New reference-bearing fields therefore
 * fail closed until the projection supplies a contextual binding policy.
 */
export const inboxV2RecipientValueHasNoTenantScopedReferences = (
  context: InboxV2RecipientProjectionValueContext
): boolean => scanRecipientValueTenantReferences(context.value, () => false);

type InboxV2AnyRecipientUpsert = z.output<
  ReturnType<typeof createRecipientUpsertBranch<z.ZodType>>
>;

type InboxV2AnyRecipientUpsertInput = z.input<
  ReturnType<typeof createRecipientUpsertBranch<z.ZodType>>
>;

type InboxV2AnyRecipientWireUpsert = z.output<
  ReturnType<typeof createRecipientWireUpsertBranch<z.ZodType>>
>;

type InboxV2AnyRecipientWireUpsertInput = z.input<
  ReturnType<typeof createRecipientWireUpsertBranch<z.ZodType>>
>;

type InboxV2RecipientUpsertOutputFor<
  TProjection extends InboxV2RecipientProjectionRegistration
> = TProjection extends InboxV2RecipientProjectionRegistration
  ? Omit<
      InboxV2AnyRecipientUpsert,
      "projectionTypeId" | "stateSchemaId" | "stateSchemaVersion" | "value"
    > & {
      projectionTypeId: TProjection["projectionTypeId"];
      stateSchemaId: TProjection["stateSchemaId"];
      stateSchemaVersion: TProjection["stateSchemaVersion"];
      value: z.output<TProjection["valueSchema"]>;
    }
  : never;

type InboxV2RecipientUpsertInputFor<
  TProjection extends InboxV2RecipientProjectionRegistration
> = TProjection extends InboxV2RecipientProjectionRegistration
  ? Omit<
      InboxV2AnyRecipientUpsertInput,
      "projectionTypeId" | "stateSchemaId" | "stateSchemaVersion" | "value"
    > & {
      projectionTypeId: TProjection["projectionTypeId"];
      stateSchemaId: TProjection["stateSchemaId"];
      stateSchemaVersion: TProjection["stateSchemaVersion"];
      value: z.input<TProjection["valueSchema"]>;
    }
  : never;

type InboxV2RecipientUpsertOutput<
  TProjections extends readonly InboxV2RecipientProjectionRegistration[]
> = InboxV2RecipientUpsertOutputFor<TProjections[number]>;

type InboxV2RecipientUpsertInput<
  TProjections extends readonly InboxV2RecipientProjectionRegistration[]
> = InboxV2RecipientUpsertInputFor<TProjections[number]>;

type InboxV2RecipientWireUpsertOutputFor<
  TProjection extends InboxV2RecipientWireProjectionRegistration
> = TProjection extends InboxV2RecipientWireProjectionRegistration
  ? Omit<
      InboxV2AnyRecipientWireUpsert,
      "projectionTypeId" | "stateSchemaId" | "stateSchemaVersion" | "value"
    > & {
      projectionTypeId: TProjection["projectionTypeId"];
      stateSchemaId: TProjection["stateSchemaId"];
      stateSchemaVersion: TProjection["stateSchemaVersion"];
      value: z.output<TProjection["valueSchema"]>;
    }
  : never;

type InboxV2RecipientWireUpsertInputFor<
  TProjection extends InboxV2RecipientWireProjectionRegistration
> = TProjection extends InboxV2RecipientWireProjectionRegistration
  ? Omit<
      InboxV2AnyRecipientWireUpsertInput,
      "projectionTypeId" | "stateSchemaId" | "stateSchemaVersion" | "value"
    > & {
      projectionTypeId: TProjection["projectionTypeId"];
      stateSchemaId: TProjection["stateSchemaId"];
      stateSchemaVersion: TProjection["stateSchemaVersion"];
      value: z.input<TProjection["valueSchema"]>;
    }
  : never;

type InboxV2RecipientWireUpsertOutput<
  TProjections extends readonly InboxV2RecipientWireProjectionRegistration[]
> = InboxV2RecipientWireUpsertOutputFor<TProjections[number]>;

type InboxV2RecipientWireUpsertInput<
  TProjections extends readonly InboxV2RecipientWireProjectionRegistration[]
> = InboxV2RecipientWireUpsertInputFor<TProjections[number]>;

export function createInboxV2RecipientUpsertChangeSchema<
  const TProjections extends readonly InboxV2RecipientProjectionRegistration[]
>(input: {
  projections: TProjections;
  verifyRecipientStateFingerprint: (change: unknown) => boolean;
}) {
  const registrations = normalizeRecipientProjectionRegistrations(
    input.projections
  );
  return createRecipientUpsertDispatcher(
    createRecipientProjectionRegistry(registrations),
    true,
    input.verifyRecipientStateFingerprint
  ) as z.ZodType<
    InboxV2RecipientUpsertOutput<TProjections>,
    InboxV2RecipientUpsertInput<TProjections>
  >;
}

export function createInboxV2RecipientWireUpsertChangeSchema<
  const TProjections extends
    readonly InboxV2RecipientWireProjectionRegistration[]
>(input: { projections: TProjections }) {
  const registrations = normalizeRecipientWireProjectionRegistrations(
    input.projections
  );
  return createRecipientWireUpsertDispatcher(
    createRecipientProjectionRegistry(registrations)
  ) as z.ZodType<
    InboxV2RecipientWireUpsertOutput<TProjections>,
    InboxV2RecipientWireUpsertInput<TProjections>
  >;
}

/** Frozen V1 wire parser: keeps the historical syntactic stateHash contract. */
export function createInboxV2ArchivedV1RecipientUpsertChangeSchema<
  const TProjections extends readonly InboxV2RecipientProjectionRegistration[]
>(input: { projections: TProjections }) {
  const registrations = normalizeRecipientProjectionRegistrations(
    input.projections
  );
  return createRecipientUpsertDispatcher(
    createRecipientProjectionRegistry(registrations),
    false
  ) as z.ZodType<
    InboxV2RecipientUpsertOutput<TProjections>,
    InboxV2RecipientUpsertInput<TProjections>
  >;
}

export function createInboxV2RecipientEntityChangeSchema<
  const TProjections extends readonly InboxV2RecipientProjectionRegistration[]
>(input: {
  projections: TProjections;
  verifyRecipientStateFingerprint: (change: unknown) => boolean;
}) {
  const registrations = normalizeRecipientProjectionRegistrations(
    input.projections
  );
  const registry = createRecipientProjectionRegistry(registrations);
  const upsertSchema = createRecipientUpsertDispatcher(
    registry,
    true,
    input.verifyRecipientStateFingerprint
  ) as z.ZodType<
    InboxV2RecipientUpsertOutput<TProjections>,
    InboxV2RecipientUpsertInput<TProjections>
  >;
  return z.union([
    upsertSchema,
    z
      .object({
        ...recipientChangeBaseFields,
        kind: z.literal("tombstone"),
        projectionTypeId: inboxV2CatalogIdSchema,
        entity: inboxV2EntityKeySchema,
        revision: inboxV2EntityRevisionSchema,
        lastChangedStreamPosition: inboxV2TenantStreamCommitPositionSchema,
        timeline: inboxV2TimelinePositionContextSchema.nullable(),
        stateSchemaId: inboxV2CatalogIdSchema,
        stateSchemaVersion: inboxV2SchemaVersionTokenSchema,
        stateHash: inboxV2Sha256DigestSchema,
        reasonId: inboxV2CatalogIdSchema
      })
      .strict()
      .superRefine((change, context) => {
        if (
          findRecipientProjectionRegistration(registry, change) === undefined
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Recipient tombstone must match one exact registered entity/state schema."
          });
        }
        if (!verifyInboxV2RecipientTombstoneStateHash(change)) {
          context.addIssue({
            code: "custom",
            path: ["stateHash"],
            message:
              "Recipient tombstone stateHash must match its canonical projected state."
          });
        }
      }),
    inboxV2RecipientInvalidateChangeSchema.superRefine((change, context) => {
      if (findRecipientProjectionRegistration(registry, change) === undefined) {
        context.addIssue({
          code: "custom",
          message:
            "Recipient invalidation must match one exact registered entity/state schema."
        });
      }
    })
  ]);
}

export function createInboxV2RecipientWireEntityChangeSchema<
  const TProjections extends
    readonly InboxV2RecipientWireProjectionRegistration[]
>(input: { projections: TProjections }) {
  const registrations = normalizeRecipientWireProjectionRegistrations(
    input.projections
  );
  const registry = createRecipientProjectionRegistry(registrations);
  const upsertSchema = createRecipientWireUpsertDispatcher(
    registry
  ) as z.ZodType<
    InboxV2RecipientWireUpsertOutput<TProjections>,
    InboxV2RecipientWireUpsertInput<TProjections>
  >;
  return z.union([
    upsertSchema,
    z
      .object({
        ...recipientWireChangeBaseFields,
        kind: z.literal("tombstone"),
        projectionTypeId: inboxV2CatalogIdSchema,
        entity: inboxV2EntityKeySchema,
        revision: inboxV2EntityRevisionSchema,
        lastChangedStreamPosition: inboxV2TenantStreamCommitPositionSchema,
        timeline: inboxV2TimelinePositionContextSchema.nullable(),
        stateSchemaId: inboxV2CatalogIdSchema,
        stateSchemaVersion: inboxV2SchemaVersionTokenSchema,
        stateHash: inboxV2Sha256DigestSchema,
        reasonId: inboxV2CatalogIdSchema
      })
      .strict()
      .superRefine((change, context) => {
        if (
          findRecipientProjectionRegistration(registry, change) === undefined
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Recipient wire tombstone must match one exact registered entity/state schema."
          });
        }
        if (!verifyInboxV2RecipientTombstoneStateHash(change)) {
          context.addIssue({
            code: "custom",
            path: ["stateHash"],
            message:
              "Recipient wire tombstone stateHash must match its canonical projected state."
          });
        }
      }),
    z
      .object({
        ...recipientWireChangeBaseFields,
        kind: z.literal("invalidate"),
        projectionTypeId: inboxV2CatalogIdSchema,
        entity: inboxV2EntityKeySchema,
        revision: inboxV2EntityRevisionSchema,
        lastChangedStreamPosition: inboxV2TenantStreamCommitPositionSchema,
        timeline: inboxV2TimelinePositionContextSchema.nullable(),
        stateSchemaId: inboxV2CatalogIdSchema,
        stateSchemaVersion: inboxV2SchemaVersionTokenSchema,
        stateHash: z.union([
          inboxV2RecipientStateFingerprintSchema,
          inboxV2Sha256DigestSchema
        ]),
        reasonId: inboxV2CatalogIdSchema,
        targetedFetchRequired: z.literal(true),
        invalidationHash: inboxV2Sha256DigestSchema
      })
      .strict()
      .superRefine((change, context) => {
        if (
          findRecipientProjectionRegistration(registry, change) === undefined
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Recipient wire invalidation must match one exact registered entity/state schema."
          });
        }
        if (!verifyInboxV2RecipientInvalidateInstructionHash(change)) {
          context.addIssue({
            code: "custom",
            path: ["invalidationHash"],
            message:
              "Recipient wire invalidation hash must match its canonical instruction and expected actual state."
          });
        }
      })
  ]);
}

/**
 * Frozen V1 entity-change parser. It intentionally does not recompute stateHash
 * and its invalidate shape intentionally has no invalidationHash.
 */
export function createInboxV2ArchivedV1RecipientEntityChangeSchema<
  const TProjections extends readonly InboxV2RecipientProjectionRegistration[]
>(input: { projections: TProjections }) {
  const registrations = normalizeRecipientProjectionRegistrations(
    input.projections
  );
  const registry = createRecipientProjectionRegistry(registrations);
  const upsertSchema = createRecipientUpsertDispatcher(
    registry,
    false
  ) as z.ZodType<
    InboxV2RecipientUpsertOutput<TProjections>,
    InboxV2RecipientUpsertInput<TProjections>
  >;
  return z.union([
    upsertSchema,
    z
      .object({
        ...recipientChangeBaseFields,
        kind: z.literal("tombstone"),
        projectionTypeId: inboxV2CatalogIdSchema,
        entity: inboxV2EntityKeySchema,
        revision: inboxV2EntityRevisionSchema,
        lastChangedStreamPosition: inboxV2TenantStreamCommitPositionSchema,
        timeline: inboxV2TimelinePositionContextSchema.nullable(),
        stateSchemaId: inboxV2CatalogIdSchema,
        stateSchemaVersion: inboxV2SchemaVersionTokenSchema,
        stateHash: inboxV2Sha256DigestSchema,
        reasonId: inboxV2CatalogIdSchema
      })
      .strict()
      .superRefine((change, context) => {
        if (
          findRecipientProjectionRegistration(registry, change) === undefined
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Archived V1 recipient tombstone must match one exact registered entity/state schema."
          });
        }
      }),
    inboxV2ArchivedV1RecipientInvalidateChangeSchema.superRefine(
      (change, context) => {
        if (
          findRecipientProjectionRegistration(registry, change) === undefined
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Archived V1 recipient invalidation must match one exact registered entity/state schema."
          });
        }
      }
    )
  ]);
}

function assertBoundedRecipientValueSchema(schema: z.ZodType): void {
  assertInboxV2ClosedJsonSchema(schema, "Recipient sync projection value");
}

export function normalizeRecipientWireProjectionRegistrations(
  registrations: readonly InboxV2RecipientWireProjectionRegistration[]
): readonly InboxV2NormalizedRecipientWireProjectionRegistration[] {
  if (registrations.length === 0 || registrations.length > 256) {
    throw new Error(
      "Recipient sync requires between 1 and 256 projection registrations."
    );
  }
  const normalized = registrations
    .map((registration) => {
      assertBoundedRecipientValueSchema(registration.valueSchema);
      if (typeof registration.validateValueContext !== "function") {
        throw new Error(
          "Recipient projection requires a contextual value validation policy."
        );
      }
      return Object.freeze({
        projectionTypeId: String(
          inboxV2CatalogIdSchema.parse(registration.projectionTypeId)
        ),
        entityTypeId: String(
          inboxV2CatalogIdSchema.parse(registration.entityTypeId)
        ),
        stateSchemaId: String(
          inboxV2CatalogIdSchema.parse(registration.stateSchemaId)
        ),
        stateSchemaVersion: String(
          inboxV2SchemaVersionTokenSchema.parse(registration.stateSchemaVersion)
        ),
        valueContextValidatorId: String(
          inboxV2CatalogIdSchema.parse(registration.valueContextValidatorId)
        ),
        valueContextValidatorFingerprint: String(
          inboxV2Sha256DigestSchema.parse(
            registration.valueContextValidatorFingerprint
          )
        ),
        valueSchema: registration.valueSchema,
        validateValueContext: registration.validateValueContext as (
          context: InboxV2RecipientProjectionValueContext<unknown>
        ) => boolean
      });
    })
    .sort((left, right) =>
      compareRecipientContractIds(left.projectionTypeId, right.projectionTypeId)
    );
  const keys = normalized.map((registration) => registration.projectionTypeId);
  const entityTypes = normalized.map(
    (registration) => registration.entityTypeId
  );
  if (
    new Set(keys).size !== keys.length ||
    new Set(entityTypes).size !== entityTypes.length
  ) {
    throw new Error(
      "Recipient projection registrations require unique projection and entity types per sync generation."
    );
  }
  return Object.freeze(normalized);
}

export function normalizeRecipientProjectionRegistrations(
  registrations: readonly InboxV2RecipientProjectionRegistration[]
): readonly InboxV2NormalizedRecipientProjectionRegistration[] {
  const wireRegistrations =
    normalizeRecipientWireProjectionRegistrations(registrations);
  const registrationsByProjectionType = new Map(
    registrations.map((registration) => [
      String(inboxV2CatalogIdSchema.parse(registration.projectionTypeId)),
      registration
    ])
  );
  return Object.freeze(
    wireRegistrations.map((wireRegistration) => {
      const registration = registrationsByProjectionType.get(
        wireRegistration.projectionTypeId
      );
      if (registration === undefined) {
        throw new Error(
          "Recipient projection authorization registration is missing."
        );
      }
      return Object.freeze({
        ...wireRegistration,
        authorizationRequirements: normalizeRecipientAuthorizationRequirements(
          registration.authorizationRequirements
        )
      });
    })
  );
}

function createRecipientUpsertBranch<TValueSchema extends z.ZodType>(
  registration: InboxV2NormalizedRecipientProjectionRegistration &
    Readonly<{ valueSchema: TValueSchema }>,
  verifyStateHash: boolean,
  verifyRecipientStateFingerprint?: (change: unknown) => boolean
) {
  return z
    .object({
      ...recipientChangeBaseFields,
      kind: z.literal("upsert"),
      projectionTypeId: z.literal(registration.projectionTypeId),
      entity: inboxV2EntityKeySchema.superRefine((entity, context) => {
        if (entity.entityTypeId !== registration.entityTypeId) {
          context.addIssue({
            code: "custom",
            path: ["entityTypeId"],
            message: "Recipient entity type must match its projection registry."
          });
        }
      }),
      revision: inboxV2EntityRevisionSchema,
      lastChangedStreamPosition: inboxV2TenantStreamCommitPositionSchema,
      timeline: inboxV2TimelinePositionContextSchema.nullable(),
      stateSchemaId: z.literal(registration.stateSchemaId),
      stateSchemaVersion: z.literal(registration.stateSchemaVersion),
      stateHash: verifyStateHash
        ? inboxV2RecipientStateFingerprintSchema
        : inboxV2Sha256DigestSchema,
      value: registration.valueSchema
    })
    .strict()
    .superRefine((change, context) => {
      const value = (change as unknown as { value: unknown }).value;
      const boundedAndSanitized =
        isBoundedJsonRecipientValue(value) &&
        !containsForbiddenRecipientPayloadKey(value);
      if (!boundedAndSanitized) {
        context.addIssue({
          code: "custom",
          path: ["value"],
          message:
            "Recipient projection must be bounded JSON without raw provider payload or credential fields."
        });
        return;
      }

      if (verifyStateHash) {
        if (
          !scanRecipientValueTenantReferences(
            value,
            (tenantReference) => tenantReference === change.entity.tenantId
          )
        ) {
          context.addIssue({
            code: "custom",
            path: ["value"],
            message:
              "Recipient projection value may only contain tenant references from its entity tenant."
          });
          return;
        }

        let contextIsValid = false;
        try {
          contextIsValid =
            registration.validateValueContext({
              entity: change.entity,
              timeline: change.timeline,
              value
            }) === true;
        } catch {
          contextIsValid = false;
        }
        if (!contextIsValid) {
          context.addIssue({
            code: "custom",
            path: ["value"],
            message:
              "Recipient projection value must match its registered entity and timeline context."
          });
        }
        let fingerprintIsValid = false;
        try {
          fingerprintIsValid =
            verifyRecipientStateFingerprint?.(change) === true;
        } catch {
          fingerprintIsValid = false;
        }
        if (!fingerprintIsValid) {
          context.addIssue({
            code: "custom",
            path: ["stateHash"],
            message:
              "Recipient upsert requires a verified tenant-keyed state fingerprint."
          });
        }
      }
    });
}

function createRecipientWireUpsertBranch<TValueSchema extends z.ZodType>(
  registration: InboxV2NormalizedRecipientWireProjectionRegistration &
    Readonly<{ valueSchema: TValueSchema }>
) {
  return z
    .object({
      ...recipientWireChangeBaseFields,
      kind: z.literal("upsert"),
      projectionTypeId: z.literal(registration.projectionTypeId),
      entity: inboxV2EntityKeySchema.superRefine((entity, context) => {
        if (entity.entityTypeId !== registration.entityTypeId) {
          context.addIssue({
            code: "custom",
            path: ["entityTypeId"],
            message:
              "Recipient wire entity type must match its projection registry."
          });
        }
      }),
      revision: inboxV2EntityRevisionSchema,
      lastChangedStreamPosition: inboxV2TenantStreamCommitPositionSchema,
      timeline: inboxV2TimelinePositionContextSchema.nullable(),
      stateSchemaId: z.literal(registration.stateSchemaId),
      stateSchemaVersion: z.literal(registration.stateSchemaVersion),
      stateHash: inboxV2RecipientStateFingerprintSchema,
      value: registration.valueSchema
    })
    .strict()
    .superRefine((change, context) => {
      const value = (change as unknown as { value: unknown }).value;
      const boundedAndSanitized =
        isBoundedJsonRecipientValue(value) &&
        !containsForbiddenRecipientPayloadKey(value);
      if (!boundedAndSanitized) {
        context.addIssue({
          code: "custom",
          path: ["value"],
          message:
            "Recipient wire projection must be bounded JSON without raw provider payload or credential fields."
        });
        return;
      }

      if (
        !scanRecipientValueTenantReferences(
          value,
          (tenantReference) => tenantReference === change.entity.tenantId
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["value"],
          message:
            "Recipient wire projection value may only contain tenant references from its entity tenant."
        });
        return;
      }

      let contextIsValid = false;
      try {
        contextIsValid =
          registration.validateValueContext({
            entity: change.entity,
            timeline: change.timeline,
            value
          }) === true;
      } catch {
        contextIsValid = false;
      }
      if (!contextIsValid) {
        context.addIssue({
          code: "custom",
          path: ["value"],
          message:
            "Recipient wire projection value must match its registered entity and timeline context."
        });
      }
    });
}

function scanRecipientValueTenantReferences(
  value: unknown,
  acceptsTenantId: (tenantId: string) => boolean
): boolean {
  const queue: unknown[] = [value];
  let visited = 0;
  while (queue.length > 0 && visited < 10_000) {
    const current = queue.pop();
    visited += 1;
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    if (current === null || typeof current !== "object") {
      continue;
    }
    for (const [key, nested] of Object.entries(current)) {
      if (
        key === "tenantId" &&
        (typeof nested !== "string" || !acceptsTenantId(nested))
      ) {
        return false;
      }
      queue.push(nested);
    }
  }
  return queue.length === 0;
}

export function createRecipientProjectionRegistry<
  TRegistration extends InboxV2NormalizedRecipientWireProjectionRegistration
>(registrations: readonly TRegistration[]): ReadonlyMap<string, TRegistration> {
  return new Map(
    registrations.map((registration) => [
      registration.projectionTypeId,
      registration
    ])
  );
}

function createRecipientUpsertDispatcher(
  registry: ReadonlyMap<
    string,
    InboxV2NormalizedRecipientProjectionRegistration
  >,
  verifyStateHash: boolean,
  verifyRecipientStateFingerprint?: (change: unknown) => boolean
): z.ZodType<InboxV2AnyRecipientUpsert, unknown> {
  const branches = new Map(
    [...registry].map(([projectionTypeId, registration]) => [
      projectionTypeId,
      createRecipientUpsertBranch(
        registration,
        verifyStateHash,
        verifyRecipientStateFingerprint
      )
    ])
  );
  return z.any().transform((value, context) => {
    const header = z
      .object({ projectionTypeId: inboxV2CatalogIdSchema })
      .passthrough()
      .safeParse(value);
    const branch = header.success
      ? branches.get(String(header.data.projectionTypeId))
      : undefined;
    if (branch === undefined) {
      context.addIssue({
        code: "custom",
        message: "Recipient upsert projection type is not registered."
      });
      return z.NEVER;
    }
    const parsed = branch.safeParse(value);
    if (!parsed.success) {
      context.addIssue({
        code: "custom",
        message:
          "Recipient upsert must match its exact registered entity/state/value schema."
      });
      return z.NEVER;
    }
    return parsed.data;
  }) as z.ZodType<InboxV2AnyRecipientUpsert, unknown>;
}

function createRecipientWireUpsertDispatcher(
  registry: ReadonlyMap<
    string,
    InboxV2NormalizedRecipientWireProjectionRegistration
  >
): z.ZodType<InboxV2AnyRecipientWireUpsert, unknown> {
  const branches = new Map(
    [...registry].map(([projectionTypeId, registration]) => [
      projectionTypeId,
      createRecipientWireUpsertBranch(registration)
    ])
  );
  return z.any().transform((value, context) => {
    const header = z
      .object({ projectionTypeId: inboxV2CatalogIdSchema })
      .passthrough()
      .safeParse(value);
    const branch = header.success
      ? branches.get(String(header.data.projectionTypeId))
      : undefined;
    if (branch === undefined) {
      context.addIssue({
        code: "custom",
        message: "Recipient wire upsert projection type is not registered."
      });
      return z.NEVER;
    }
    const parsed = branch.safeParse(value);
    if (!parsed.success) {
      context.addIssue({
        code: "custom",
        message:
          "Recipient wire upsert must match its exact registered entity/state/value schema."
      });
      return z.NEVER;
    }
    return parsed.data;
  }) as z.ZodType<InboxV2AnyRecipientWireUpsert, unknown>;
}

function normalizeRecipientAuthorizationRequirements(
  requirements: InboxV2RecipientProjectionRegistration["authorizationRequirements"]
): InboxV2NormalizedRecipientProjectionRegistration["authorizationRequirements"] {
  if (requirements.length === 0 || requirements.length > 16) {
    throw new Error(
      "Recipient projection requires 1..16 authorization conjunctions."
    );
  }
  const normalized = requirements
    .map((requirement) =>
      Object.freeze({
        permissionId: String(
          inboxV2CatalogIdSchema.parse(requirement.permissionId)
        ),
        resourceScopeId: String(
          inboxV2CatalogIdSchema.parse(requirement.resourceScopeId)
        ),
        resourceResolverId: String(
          inboxV2CatalogIdSchema.parse(requirement.resourceResolverId)
        ),
        resourceResolverFingerprint: String(
          inboxV2Sha256DigestSchema.parse(
            requirement.resourceResolverFingerprint
          )
        ),
        resolveResource: requirement.resolveResource
      })
    )
    .sort((left, right) =>
      compareRecipientContractIds(
        `${left.resourceResolverId}\u0000${left.permissionId}\u0000${left.resourceScopeId}\u0000${left.resourceResolverFingerprint}`,
        `${right.resourceResolverId}\u0000${right.permissionId}\u0000${right.resourceScopeId}\u0000${right.resourceResolverFingerprint}`
      )
    );
  const keys = normalized.map(
    (requirement) =>
      `${requirement.resourceResolverId}\u0000${requirement.permissionId}\u0000${requirement.resourceScopeId}`
  );
  if (
    new Set(keys).size !== keys.length ||
    normalized.some(
      (requirement) => typeof requirement.resolveResource !== "function"
    )
  ) {
    throw new Error(
      "Recipient projection authorization conjunctions must be unique and supported."
    );
  }
  return Object.freeze(normalized);
}

export function findRecipientProjectionRegistration<
  TRegistration extends InboxV2NormalizedRecipientWireProjectionRegistration
>(
  registry: ReadonlyMap<string, TRegistration>,
  change: {
    projectionTypeId: string;
    entity: { entityTypeId: string };
    stateSchemaId: string;
    stateSchemaVersion: string;
  }
): TRegistration | undefined {
  const registration = registry.get(String(change.projectionTypeId));
  return registration !== undefined &&
    registration.entityTypeId === String(change.entity.entityTypeId) &&
    registration.stateSchemaId === String(change.stateSchemaId) &&
    registration.stateSchemaVersion === String(change.stateSchemaVersion)
    ? registration
    : undefined;
}

export function recipientRequirementResource(
  requirement: InboxV2NormalizedRecipientProjectionRegistration["authorizationRequirements"][number],
  change: {
    entity: InboxV2RecipientAuthorizationResourceContext["entity"];
    timeline: InboxV2RecipientAuthorizationResourceContext["timeline"];
    value?: unknown;
  }
): Readonly<{
  tenantId: string;
  entityTypeId: string;
  entityId: string;
}> | null {
  try {
    const parsed = inboxV2EntityKeySchema.safeParse(
      requirement.resolveResource({
        entity: change.entity,
        timeline: change.timeline,
        value: "value" in change ? change.value : undefined
      })
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function compareRecipientContractIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function createBuiltInRecipientResourceResolverSemantic(input: {
  resourceResolverId: string;
  semanticVersion: string;
  contract: string;
}): InboxV2RecipientResourceResolverSemanticDescriptor {
  const resourceResolverId = String(
    inboxV2CatalogIdSchema.parse(input.resourceResolverId)
  );
  return Object.freeze({
    resourceResolverId,
    resourceResolverFingerprint: String(
      calculateInboxV2CanonicalSha256({
        domain: "core:inbox-v2.recipient-resource-resolver-semantic",
        semanticVersion: input.semanticVersion,
        resourceResolverId,
        contract: input.contract
      })
    )
  });
}

function createBuiltInRecipientValueContextValidatorSemantic(input: {
  valueContextValidatorId: string;
  semanticVersion: string;
  contract: string;
}): InboxV2RecipientValueContextValidatorSemanticDescriptor {
  const valueContextValidatorId = String(
    inboxV2CatalogIdSchema.parse(input.valueContextValidatorId)
  );
  return Object.freeze({
    valueContextValidatorId,
    valueContextValidatorFingerprint: String(
      calculateInboxV2CanonicalSha256({
        domain: "core:inbox-v2.recipient-value-context-validator-semantic",
        semanticVersion: input.semanticVersion,
        valueContextValidatorId,
        contract: input.contract
      })
    )
  });
}
