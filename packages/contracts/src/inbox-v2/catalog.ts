import { z } from "zod";

import type { Brand } from "../brand";
import {
  inboxV2LocalIdSchema,
  inboxV2ModuleIdSchema,
  inboxV2NamespacedIdSchema,
  parseInboxV2NamespacedId
} from "./namespace";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION,
  type InboxV2SchemaEnvelope
} from "./schema-version";

export const INBOX_V2_CATALOG_REGISTRATION_SCHEMA_ID =
  "core:inbox-v2.catalog-registration" as const;

export type InboxV2CatalogName = Brand<string, "InboxV2CatalogName">;
export type InboxV2CatalogId<TCatalog extends string = string> = Brand<
  string,
  `InboxV2CatalogId:${TCatalog}`
>;

export type InboxV2CatalogOwner =
  | Readonly<{ kind: "core" }>
  | Readonly<{ kind: "module"; moduleId: string }>;

export type InboxV2DeepReadonly<TValue> = TValue extends (
  ...args: never[]
) => unknown
  ? TValue
  : TValue extends readonly (infer TItem)[]
    ? readonly InboxV2DeepReadonly<TItem>[]
    : TValue extends object
      ? { readonly [TKey in keyof TValue]: InboxV2DeepReadonly<TValue[TKey]> }
      : TValue;

export type InboxV2CatalogEntry<
  TCatalog extends string,
  TDefinition
> = Readonly<{
  id: InboxV2CatalogId<TCatalog>;
  definition: InboxV2DeepReadonly<TDefinition>;
}>;

export type InboxV2CatalogRegistrationPayload<
  TCatalog extends string,
  TDefinition
> = Readonly<{
  catalog: TCatalog;
  owner: InboxV2CatalogOwner;
  entries: readonly InboxV2CatalogEntry<TCatalog, TDefinition>[];
}>;

export type InboxV2CatalogRegistration<
  TCatalog extends string,
  TDefinition
> = InboxV2SchemaEnvelope<
  typeof INBOX_V2_CATALOG_REGISTRATION_SCHEMA_ID,
  typeof INBOX_V2_INITIAL_SCHEMA_VERSION,
  InboxV2CatalogRegistrationPayload<TCatalog, TDefinition>
>;

export const inboxV2CatalogNameSchema = inboxV2LocalIdSchema.transform(
  (value) => value as unknown as InboxV2CatalogName
);

export const inboxV2CatalogIdSchema = inboxV2NamespacedIdSchema.transform(
  (value) => value as unknown as InboxV2CatalogId
);

function createInboxV2CatalogIdSchema<const TCatalog extends string>() {
  return inboxV2NamespacedIdSchema.transform(
    (value) => value as unknown as InboxV2CatalogId<TCatalog>
  );
}

export function createInboxV2CoreCatalogRegistrationSchema<
  const TCatalog extends string,
  TDefinitionSchema extends z.ZodType
>(input: { catalog: TCatalog; definitionSchema: TDefinitionSchema }) {
  inboxV2CatalogNameSchema.parse(input.catalog);

  const payloadSchema = z
    .object({
      catalog: z.literal(input.catalog),
      owner: z.object({ kind: z.literal("core") }).strict(),
      entries: createCatalogEntriesSchema({
        catalog: input.catalog,
        owner: { kind: "core" },
        definitionSchema: input.definitionSchema
      })
    })
    .strict();

  return createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_CATALOG_REGISTRATION_SCHEMA_ID,
    INBOX_V2_INITIAL_SCHEMA_VERSION,
    payloadSchema
  );
}

export function createInboxV2ModuleCatalogRegistrationSchema<
  const TCatalog extends string,
  const TModuleId extends string,
  TDefinitionSchema extends z.ZodType
>(input: {
  catalog: TCatalog;
  moduleId: TModuleId;
  definitionSchema: TDefinitionSchema;
}) {
  inboxV2CatalogNameSchema.parse(input.catalog);
  inboxV2ModuleIdSchema.parse(input.moduleId);

  const owner = {
    kind: "module" as const,
    moduleId: input.moduleId
  };
  const payloadSchema = z
    .object({
      catalog: z.literal(input.catalog),
      owner: z
        .object({
          kind: z.literal("module"),
          moduleId: z.literal(input.moduleId)
        })
        .strict(),
      entries: createCatalogEntriesSchema({
        catalog: input.catalog,
        owner,
        definitionSchema: input.definitionSchema
      })
    })
    .strict();

  return createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_CATALOG_REGISTRATION_SCHEMA_ID,
    INBOX_V2_INITIAL_SCHEMA_VERSION,
    payloadSchema
  );
}

const inboxV2CatalogRegistrationStructureSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_CATALOG_REGISTRATION_SCHEMA_ID,
    INBOX_V2_INITIAL_SCHEMA_VERSION,
    z
      .object({
        catalog: inboxV2CatalogNameSchema,
        owner: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("core") }).strict(),
          z
            .object({
              kind: z.literal("module"),
              moduleId: inboxV2ModuleIdSchema
            })
            .strict()
        ]),
        entries: z
          .array(
            z
              .object({
                id: inboxV2CatalogIdSchema,
                definition: z.unknown()
              })
              .strict()
          )
          .min(1)
          .max(10_000)
      })
      .strict()
  );

function createCatalogEntriesSchema<
  const TCatalog extends string,
  TDefinitionSchema extends z.ZodType
>(input: {
  catalog: TCatalog;
  owner: InboxV2CatalogOwner;
  definitionSchema: TDefinitionSchema;
}) {
  const catalogIdSchema = createInboxV2CatalogIdSchema<TCatalog>();

  return z
    .array(
      z
        .object({
          id: catalogIdSchema,
          definition: input.definitionSchema
        })
        .strict()
    )
    .min(1)
    .max(10_000)
    .superRefine((entries, context) => {
      const seenIds = new Set<string>();

      for (const [index, entry] of entries.entries()) {
        const entryId = String(entry.id);

        if (seenIds.has(entryId)) {
          context.addIssue({
            code: "custom",
            path: [index, "id"],
            message: `Duplicate Inbox V2 catalog ID: ${entryId}.`
          });
        }

        seenIds.add(entryId);

        if (!catalogIdBelongsToOwner(entryId, input.owner)) {
          context.addIssue({
            code: "custom",
            path: [index, "id"],
            message:
              input.owner.kind === "core"
                ? "Core catalog registration accepts only core:* IDs."
                : `Module catalog registration accepts only module:${input.owner.moduleId}:* IDs.`
          });
        }
      }
    });
}

/**
 * Produces an immutable registration list and rejects duplicate IDs across
 * separately validated registration envelopes. It keeps no process-global
 * registry state.
 */
export function defineInboxV2CatalogRegistrations<
  TRegistration extends InboxV2CatalogRegistration<string, unknown>
>(
  registrations: readonly TRegistration[]
): readonly InboxV2DeepReadonly<TRegistration>[] {
  const seenIds = new Set<string>();
  const normalized = registrations.map((input) => {
    const registration = inboxV2CatalogRegistrationStructureSchema.parse(input);

    for (const entry of registration.payload.entries) {
      if (
        !catalogIdBelongsToOwner(String(entry.id), registration.payload.owner)
      ) {
        throw new Error(
          `Inbox V2 catalog ID ${String(entry.id)} does not belong to its declared owner.`
        );
      }

      const key = `${registration.payload.catalog}\u0000${String(entry.id)}`;

      if (seenIds.has(key)) {
        throw new Error(
          `Duplicate Inbox V2 catalog ID in ${registration.payload.catalog}: ${String(entry.id)}.`
        );
      }

      seenIds.add(key);
    }

    return Object.freeze({
      ...registration,
      payload: Object.freeze({
        ...registration.payload,
        owner: Object.freeze({ ...registration.payload.owner }),
        entries: Object.freeze(
          registration.payload.entries.map((entry) =>
            Object.freeze({
              ...entry,
              definition: cloneAndFreezeCatalogDefinition(entry.definition)
            })
          )
        )
      })
    }) as unknown as InboxV2DeepReadonly<TRegistration>;
  });

  return Object.freeze(normalized);
}

function catalogIdBelongsToOwner(
  catalogId: string,
  owner: InboxV2CatalogOwner
): boolean {
  const parts = parseInboxV2NamespacedId(catalogId);

  if (owner.kind === "core") {
    return parts.namespace === "core";
  }

  return "moduleId" in parts && parts.moduleId === owner.moduleId;
}

function cloneAndFreezeCatalogDefinition<TValue>(
  value: TValue,
  ancestors = new WeakSet<object>()
): InboxV2DeepReadonly<TValue> {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value as InboxV2DeepReadonly<TValue>;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Inbox V2 catalog definitions require finite numbers.");
    }

    return value as InboxV2DeepReadonly<TValue>;
  }

  if (typeof value !== "object") {
    throw new Error(
      "Inbox V2 catalog definitions must be JSON-compatible immutable data."
    );
  }

  if (ancestors.has(value)) {
    throw new Error("Inbox V2 catalog definitions cannot contain cycles.");
  }

  ancestors.add(value);

  if (Array.isArray(value)) {
    const clone = value.map((item) =>
      cloneAndFreezeCatalogDefinition(item, ancestors)
    );
    ancestors.delete(value);
    return Object.freeze(clone) as InboxV2DeepReadonly<TValue>;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;

  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(
      "Inbox V2 catalog definitions must contain only plain objects and arrays."
    );
  }

  const clone: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value)) {
    clone[key] = cloneAndFreezeCatalogDefinition(item, ancestors);
  }

  ancestors.delete(value);
  return Object.freeze(clone) as InboxV2DeepReadonly<TValue>;
}
