import { z } from "zod";

import {
  inboxV2DataClassDefinitionSchema,
  inboxV2ModuleDataUseSchema,
  inboxV2ProcessingPurposeDefinitionSchema,
  inboxV2StorageRootDefinitionSchema,
  isInboxV2DataLifecycleRegistry,
  type InboxV2DataLifecycleRegistry
} from "./data-lifecycle-catalog";
import {
  inboxV2DataClassIdSchema,
  inboxV2ProcessingPurposeIdSchema,
  inboxV2StorageRootIdSchema
} from "./data-lifecycle-primitives";
import { inboxV2EntityRevisionSchema } from "./entity-metadata";
import { inboxV2ModuleIdSchema, inboxV2NamespacedIdSchema } from "./namespace";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";
import { inboxV2Sha256DigestSchema } from "./sync-primitives";

export const INBOX_V2_SOURCE_REGISTRY_LIFECYCLE_BINDING_SCHEMA_ID =
  "core:inbox-v2.source-registry-lifecycle-binding" as const;
export const INBOX_V2_SOURCE_REGISTRY_LIFECYCLE_BINDING_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

/**
 * Closed physical/logical copy inventory for the source-registry boundary.
 * Adding another retained surface requires a contract revision and lifecycle
 * registration; callers cannot hide a new copy behind an arbitrary string.
 */
export const inboxV2SourceRegistryCopySlotSchema = z.enum([
  "source_connection_registry",
  "source_onboarding_result_snapshot",
  "source_account_registry",
  "channel_connector_registry",
  "channel_session_state",
  "channel_session_event",
  "channel_auth_challenge_outcome",
  "credential_binding",
  "source_registry_artifact",
  "source_ingress_route",
  "source_catalog_registration",
  "source_module_registration"
]);

export const inboxV2SourceRegistryLifecycleRegistryReferenceSchema = z
  .object({
    id: inboxV2NamespacedIdSchema,
    revision: inboxV2EntityRevisionSchema,
    compositionHash: inboxV2Sha256DigestSchema
  })
  .strict();

export const inboxV2SourceRegistryLifecycleOwnerSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("core") }).strict(),
    z
      .object({
        kind: z.literal("module"),
        moduleId: inboxV2ModuleIdSchema
      })
      .strict()
  ]
);

const inboxV2SourceRegistryPurposeBindingSchema = z
  .object({
    id: inboxV2ProcessingPurposeIdSchema,
    definition: inboxV2ProcessingPurposeDefinitionSchema
  })
  .strict();

export const inboxV2SourceRegistryLifecycleBindingEntrySchema = z
  .object({
    copySlot: inboxV2SourceRegistryCopySlotSchema,
    owner: inboxV2SourceRegistryLifecycleOwnerSchema,
    lineageRevision: inboxV2EntityRevisionSchema,
    dataClass: z
      .object({
        id: inboxV2DataClassIdSchema,
        definition: inboxV2DataClassDefinitionSchema
      })
      .strict(),
    storageRoot: z
      .object({
        id: inboxV2StorageRootIdSchema,
        definition: inboxV2StorageRootDefinitionSchema
      })
      .strict(),
    processingPurposes: z
      .array(inboxV2SourceRegistryPurposeBindingSchema)
      .min(1)
      .max(1_000),
    dataUse: inboxV2ModuleDataUseSchema
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.dataClass.id !== entry.dataUse.dataClassId) {
      addIssue(
        context,
        ["dataClass", "id"],
        "Lifecycle binding data class must match its registered data use."
      );
    }
    if (entry.storageRoot.id !== entry.dataUse.storageRootId) {
      addIssue(
        context,
        ["storageRoot", "id"],
        "Lifecycle binding storage root must match its registered data use."
      );
    }

    const purposeIds = entry.processingPurposes.map((purpose) =>
      String(purpose.id)
    );
    if (new Set(purposeIds).size !== purposeIds.length) {
      addIssue(
        context,
        ["processingPurposes"],
        "Lifecycle binding processing purposes must be unique."
      );
    }
    if (!sameStringSet(purposeIds, entry.dataUse.purposeIds)) {
      addIssue(
        context,
        ["processingPurposes"],
        "Lifecycle binding purposes must exactly match its registered data use."
      );
    }
    if (
      !entry.dataUse.operations.includes("delete") ||
      !entry.dataUse.operations.includes("verify_absence")
    ) {
      addIssue(
        context,
        ["dataUse", "operations"],
        "Retained source-registry copies require delete and absence-verification lineage."
      );
    }
    if (
      entry.copySlot === "credential_binding" &&
      (entry.dataClass.definition.sensitivity !== "secret" ||
        entry.dataClass.definition.holdEligible ||
        entry.dataClass.definition.exportBehavior !== "never" ||
        !entry.dataClass.definition.immediateTerminalPurge)
    ) {
      addIssue(
        context,
        ["dataClass", "definition"],
        "Credential bindings require the non-holdable, non-exportable immediate-purge secret class."
      );
    }
  });

export const inboxV2SourceRegistryLifecycleLocatorSchema = z
  .object({
    registry: inboxV2SourceRegistryLifecycleRegistryReferenceSchema,
    copySlot: inboxV2SourceRegistryCopySlotSchema,
    dataClassId: inboxV2DataClassIdSchema,
    storageRootId: inboxV2StorageRootIdSchema,
    purposeId: inboxV2ProcessingPurposeIdSchema,
    lineageRevision: inboxV2EntityRevisionSchema
  })
  .strict();

const inboxV2SourceRegistryLifecycleBindingPayloadSchema = z
  .object({
    registry: inboxV2SourceRegistryLifecycleRegistryReferenceSchema,
    bindings: z
      .array(inboxV2SourceRegistryLifecycleBindingEntrySchema)
      .min(1)
      .max(10_000)
  })
  .strict()
  .superRefine((payload, context) => {
    const keys = new Set<string>();
    for (const [index, binding] of payload.bindings.entries()) {
      const key = lifecycleBindingKey(binding);
      if (keys.has(key)) {
        addIssue(
          context,
          ["bindings", index],
          "Duplicate source-registry lifecycle binding."
        );
      }
      keys.add(key);
    }
  });

export const inboxV2SourceRegistryLifecycleBindingSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_REGISTRY_LIFECYCLE_BINDING_SCHEMA_ID,
    INBOX_V2_SOURCE_REGISTRY_LIFECYCLE_BINDING_SCHEMA_VERSION,
    inboxV2SourceRegistryLifecycleBindingPayloadSchema
  );

export type InboxV2SourceRegistryCopySlot = z.infer<
  typeof inboxV2SourceRegistryCopySlotSchema
>;
export type InboxV2SourceRegistryLifecycleRegistryReference = z.infer<
  typeof inboxV2SourceRegistryLifecycleRegistryReferenceSchema
>;
export type InboxV2SourceRegistryLifecycleBindingEntry = z.infer<
  typeof inboxV2SourceRegistryLifecycleBindingEntrySchema
>;
export type InboxV2SourceRegistryLifecycleLocator = z.infer<
  typeof inboxV2SourceRegistryLifecycleLocatorSchema
>;
export type InboxV2SourceRegistryLifecycleBinding = Readonly<
  z.infer<typeof inboxV2SourceRegistryLifecycleBindingSchema>
>;

const definedSourceRegistryLifecycleBindings = new WeakSet<object>();

/** A schema-valid caller clone is not lifecycle authority. */
export function isInboxV2SourceRegistryLifecycleBinding(
  value: unknown
): value is InboxV2SourceRegistryLifecycleBinding {
  return (
    typeof value === "object" &&
    value !== null &&
    definedSourceRegistryLifecycleBindings.has(value)
  );
}

export function defineInboxV2SourceRegistryLifecycleBinding(input: {
  registry: InboxV2DataLifecycleRegistry;
  value: z.input<typeof inboxV2SourceRegistryLifecycleBindingSchema>;
}): InboxV2SourceRegistryLifecycleBinding {
  if (!isInboxV2DataLifecycleRegistry(input.registry)) {
    throw new Error(
      "Source-registry lifecycle binding requires an authentic ADR-0015 lifecycle registry."
    );
  }

  const parsed = inboxV2SourceRegistryLifecycleBindingSchema.parse(input.value);
  if (
    parsed.payload.registry.compositionHash !== input.registry.compositionHash
  ) {
    throw new Error(
      "Source-registry lifecycle binding pins a stale or different registry composition."
    );
  }

  for (const binding of parsed.payload.bindings) {
    assertBindingMatchesRegistry(input.registry, binding);
  }

  const frozen = cloneAndFreeze(parsed);
  definedSourceRegistryLifecycleBindings.add(frozen as object);
  return frozen;
}

export function assertInboxV2SourceRegistryLifecycleLocator(input: {
  binding: InboxV2SourceRegistryLifecycleBinding;
  locator: z.input<typeof inboxV2SourceRegistryLifecycleLocatorSchema>;
}): InboxV2SourceRegistryLifecycleLocator {
  if (!isInboxV2SourceRegistryLifecycleBinding(input.binding)) {
    throw new Error(
      "Source-registry lifecycle locator requires an authentic lifecycle binding."
    );
  }
  const locator = inboxV2SourceRegistryLifecycleLocatorSchema.parse(
    input.locator
  );
  if (
    !sameRegistryReference(locator.registry, input.binding.payload.registry)
  ) {
    throw new Error(
      "Source-registry lifecycle locator pins a different registry reference."
    );
  }

  const found = input.binding.payload.bindings.some(
    (candidate) =>
      candidate.copySlot === locator.copySlot &&
      candidate.dataClass.id === locator.dataClassId &&
      candidate.storageRoot.id === locator.storageRootId &&
      candidate.lineageRevision === locator.lineageRevision &&
      candidate.processingPurposes.some(
        (purpose) => purpose.id === locator.purposeId
      )
  );
  if (!found) {
    throw new Error(
      "Source-registry lifecycle locator has no exact registered copy/root/purpose/lineage binding."
    );
  }
  return locator;
}

function assertBindingMatchesRegistry(
  registry: InboxV2DataLifecycleRegistry,
  binding: z.output<typeof inboxV2SourceRegistryLifecycleBindingEntrySchema>
): void {
  const expectedOwner =
    binding.owner.kind === "core" ? "core" : String(binding.owner.moduleId);
  const dataUse = registry.dataUses.find(
    (candidate) =>
      candidate.owner === expectedOwner &&
      candidate.dataClassId === binding.dataClass.id &&
      candidate.storageRootId === binding.storageRoot.id
  );
  if (
    dataUse === undefined ||
    !sameJson(dataUseWithoutOwner(dataUse), binding.dataUse)
  ) {
    throw new Error(
      `Lifecycle binding ${binding.copySlot} does not match an exact registered data use.`
    );
  }

  const dataClass = registry.dataClasses.find(
    (candidate) => candidate.id === binding.dataClass.id
  );
  if (
    dataClass === undefined ||
    !sameJson(dataClass.definition, binding.dataClass.definition)
  ) {
    throw new Error(
      `Lifecycle binding ${binding.copySlot} has a stale data-class definition.`
    );
  }

  const storageRoot = registry.storageRoots.find(
    (candidate) => candidate.id === binding.storageRoot.id
  );
  if (
    storageRoot === undefined ||
    !sameJson(storageRoot.definition, binding.storageRoot.definition)
  ) {
    throw new Error(
      `Lifecycle binding ${binding.copySlot} has a stale storage-root definition.`
    );
  }

  for (const purpose of binding.processingPurposes) {
    const registered = registry.processingPurposes.find(
      (candidate) => candidate.id === purpose.id
    );
    if (
      registered === undefined ||
      !sameJson(registered.definition, purpose.definition)
    ) {
      throw new Error(
        `Lifecycle binding ${binding.copySlot} has a stale processing-purpose definition.`
      );
    }
  }
}

function dataUseWithoutOwner(
  value: InboxV2DataLifecycleRegistry["dataUses"][number]
): Omit<InboxV2DataLifecycleRegistry["dataUses"][number], "owner"> {
  const { owner: _owner, ...dataUse } = value;
  return dataUse;
}

function lifecycleBindingKey(
  binding: z.output<typeof inboxV2SourceRegistryLifecycleBindingEntrySchema>
): string {
  return [
    binding.copySlot,
    binding.dataClass.id,
    binding.storageRoot.id,
    binding.lineageRevision
  ].join("\u0000");
}

function sameRegistryReference(
  left: InboxV2SourceRegistryLifecycleRegistryReference,
  right: InboxV2SourceRegistryLifecycleRegistryReference
): boolean {
  return (
    left.id === right.id &&
    left.revision === right.revision &&
    left.compositionHash === right.compositionHash
  );
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addIssue(
  context: z.RefinementCtx,
  path: readonly (string | number)[],
  message: string
): void {
  context.addIssue({ code: "custom", path: [...path], message });
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
