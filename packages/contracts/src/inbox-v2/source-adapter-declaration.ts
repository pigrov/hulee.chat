import { z } from "zod";

import { inboxV2CatalogIdSchema } from "./catalog";
import { inboxV2NamespacedIdSchema } from "./namespace";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION,
  inboxV2SchemaIdSchema,
  inboxV2SchemaVersionTokenSchema
} from "./schema-version";
import { inboxV2AdapterContractSnapshotSchema } from "./source-routing-primitives";
import { inboxV2SourceRegistryNameSchema } from "./source-registry-state";
import {
  inboxV2SourceRegistryLifecycleRegistryReferenceSchema,
  inboxV2SourceRegistryCopySlotSchema,
  isInboxV2SourceRegistryLifecycleBinding,
  type InboxV2SourceRegistryLifecycleBinding
} from "./source-registry-lifecycle";

export const INBOX_V2_SOURCE_ADAPTER_DECLARATION_SCHEMA_ID =
  "core:inbox-v2.source-adapter-declaration" as const;
export const INBOX_V2_SOURCE_ADAPTER_DECLARATION_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;
export const INBOX_V2_SOURCE_ONBOARDING_ONE_TIME_RESPONSE_SCHEMA_ID =
  "core:source-onboarding-response" as const;
export const INBOX_V2_SOURCE_ONBOARDING_WEBHOOK_TOKEN_FIELD_ID =
  "core:webhook-token" as const;

const sourceAdapterSchemaReferenceSchema = z
  .object({
    schemaId: inboxV2SchemaIdSchema,
    supportedVersions: z.array(inboxV2SchemaVersionTokenSchema).min(1).max(32)
  })
  .strict()
  .superRefine((reference, context) => {
    if (
      new Set(reference.supportedVersions).size !==
      reference.supportedVersions.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["supportedVersions"],
        message: "Adapter schema versions must be unique."
      });
    }
  });

const sourceAdapterOneTimeResponseDeclarationSchema = z
  .object({
    schemaId: inboxV2SchemaIdSchema,
    schemaVersion: inboxV2SchemaVersionTokenSchema,
    fieldIds: z.array(inboxV2CatalogIdSchema).min(1).max(100)
  })
  .strict()
  .superRefine((declaration, context) => {
    if (new Set(declaration.fieldIds).size !== declaration.fieldIds.length) {
      context.addIssue({
        code: "custom",
        path: ["fieldIds"],
        message: "One-time response field IDs must be unique."
      });
    }
  });

const sourceAdapterDeclarationPayloadSchema = z
  .object({
    sourceName: inboxV2SourceRegistryNameSchema,
    sourceTypeId: inboxV2CatalogIdSchema,
    setupMode: z.enum([
      "channel_connector",
      "source_connection",
      "public_api",
      "manual"
    ]),
    adapterContract: inboxV2AdapterContractSnapshotSchema,
    lifecycleRegistry: inboxV2SourceRegistryLifecycleRegistryReferenceSchema,
    requiredCopySlots: z
      .array(inboxV2SourceRegistryCopySlotSchema)
      .min(1)
      .max(32),
    supportsAccounts: z.boolean(),
    accountIdentityAuthority: z.enum(["db003", "not_applicable"]),
    credentialMode: z.enum(["none", "revocable_secret_binding"]),
    configurationSchema: sourceAdapterSchemaReferenceSchema.nullable(),
    capabilitySchema: sourceAdapterSchemaReferenceSchema.nullable(),
    metadataSchema: sourceAdapterSchemaReferenceSchema.nullable(),
    diagnosticSchema: sourceAdapterSchemaReferenceSchema.nullable(),
    onboarding: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("not_supported") }).strict(),
      z
        .object({
          mode: z.enum(["standalone", "delegated"]),
          handlerId: inboxV2NamespacedIdSchema,
          oneTimeResponse:
            sourceAdapterOneTimeResponseDeclarationSchema.nullable()
        })
        .strict()
    ]),
    ingress: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("not_supported") }).strict(),
      z
        .object({
          mode: z.enum(["webhook", "polling", "stream"]),
          handlerId: inboxV2NamespacedIdSchema
        })
        .strict()
    ])
  })
  .strict()
  .superRefine((declaration, context) => {
    if (
      new Set(declaration.requiredCopySlots).size !==
      declaration.requiredCopySlots.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["requiredCopySlots"],
        message: "Required source-adapter lifecycle slots must be unique."
      });
    }
    const required = new Set(declaration.requiredCopySlots);
    for (const slot of [
      "source_connection_registry",
      "source_registry_artifact",
      "source_catalog_registration",
      "source_module_registration"
    ] as const) {
      if (!required.has(slot)) {
        context.addIssue({
          code: "custom",
          path: ["requiredCopySlots"],
          message: `Source adapter declaration requires ${slot}.`
        });
      }
    }
    if (
      declaration.setupMode === "channel_connector" &&
      !required.has("channel_connector_registry")
    ) {
      context.addIssue({
        code: "custom",
        path: ["requiredCopySlots"],
        message:
          "Channel-connector setup requires channel_connector_registry lifecycle lineage."
      });
    }
    if (
      declaration.supportsAccounts !== required.has("source_account_registry")
    ) {
      context.addIssue({
        code: "custom",
        path: ["supportsAccounts"],
        message:
          "SourceAccount support and source_account_registry lifecycle lineage must be declared together."
      });
    }
    if (
      declaration.supportsAccounts !==
      (declaration.accountIdentityAuthority === "db003")
    ) {
      context.addIssue({
        code: "custom",
        path: ["accountIdentityAuthority"],
        message: "SourceAccount adapters must reuse DB-003 identity authority."
      });
    }
    if (
      (declaration.credentialMode === "revocable_secret_binding") !==
      required.has("credential_binding")
    ) {
      context.addIssue({
        code: "custom",
        path: ["credentialMode"],
        message:
          "Revocable credentials and credential_binding lifecycle lineage must be declared together."
      });
    }
    if (
      declaration.ingress.mode !== "not_supported" &&
      !required.has("source_ingress_route")
    ) {
      context.addIssue({
        code: "custom",
        path: ["requiredCopySlots"],
        message:
          "Ingress-capable adapters require source_ingress_route lineage."
      });
    }
  });

export const inboxV2SourceAdapterDeclarationSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_ADAPTER_DECLARATION_SCHEMA_ID,
    INBOX_V2_SOURCE_ADAPTER_DECLARATION_SCHEMA_VERSION,
    sourceAdapterDeclarationPayloadSchema
  );

export type InboxV2SourceAdapterDeclaration = Readonly<
  z.infer<typeof inboxV2SourceAdapterDeclarationSchema>
>;

const definedSourceAdapterDeclarations = new WeakSet<object>();
const sourceAdapterDeclarationLifecycleBindings = new WeakMap<
  object,
  InboxV2SourceRegistryLifecycleBinding
>();

export function isInboxV2SourceAdapterDeclaration(
  value: unknown
): value is InboxV2SourceAdapterDeclaration {
  return (
    typeof value === "object" &&
    value !== null &&
    definedSourceAdapterDeclarations.has(value)
  );
}

/**
 * Keeps the declaration tied to the exact authentic lifecycle authority used
 * when it was defined. A second binding from the same registry composition is
 * not interchangeable because its copy/root/purpose lineage may differ.
 */
export function isInboxV2SourceAdapterDeclarationLifecycleBinding(input: {
  declaration: InboxV2SourceAdapterDeclaration;
  lifecycleBinding: InboxV2SourceRegistryLifecycleBinding;
}): boolean {
  return (
    isInboxV2SourceAdapterDeclaration(input.declaration) &&
    isInboxV2SourceRegistryLifecycleBinding(input.lifecycleBinding) &&
    sourceAdapterDeclarationLifecycleBindings.get(
      input.declaration as object
    ) === input.lifecycleBinding
  );
}

export function defineInboxV2SourceAdapterDeclaration(input: {
  lifecycleBinding: InboxV2SourceRegistryLifecycleBinding;
  value: z.input<typeof inboxV2SourceAdapterDeclarationSchema>;
}): InboxV2SourceAdapterDeclaration {
  if (!isInboxV2SourceRegistryLifecycleBinding(input.lifecycleBinding)) {
    throw new Error(
      "Source-adapter declaration requires an authentic lifecycle binding."
    );
  }
  const parsed = inboxV2SourceAdapterDeclarationSchema.parse(input.value);
  if (
    parsed.payload.lifecycleRegistry.id !==
      input.lifecycleBinding.payload.registry.id ||
    parsed.payload.lifecycleRegistry.revision !==
      input.lifecycleBinding.payload.registry.revision ||
    parsed.payload.lifecycleRegistry.compositionHash !==
      input.lifecycleBinding.payload.registry.compositionHash
  ) {
    throw new Error(
      "Source-adapter declaration pins a different lifecycle registry."
    );
  }
  const availableSlots = new Set(
    input.lifecycleBinding.payload.bindings.map((binding) => binding.copySlot)
  );
  for (const slot of parsed.payload.requiredCopySlots) {
    if (!availableSlots.has(slot)) {
      throw new Error(
        `Source-adapter declaration lacks authentic lifecycle binding for ${slot}.`
      );
    }
  }
  const frozen = cloneAndFreeze(parsed);
  definedSourceAdapterDeclarations.add(frozen as object);
  sourceAdapterDeclarationLifecycleBindings.set(
    frozen as object,
    input.lifecycleBinding
  );
  return frozen;
}

function cloneAndFreeze<TValue>(value: TValue): TValue {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneAndFreeze(item))) as TValue;
  }
  const clone: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    clone[key] = cloneAndFreeze(item);
  }
  return Object.freeze(clone) as TValue;
}
