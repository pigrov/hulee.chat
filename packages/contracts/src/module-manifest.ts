import { z } from "zod";

import {
  defineInboxV2DataLifecycleRegistry,
  inboxV2ModuleDataGovernanceContributionSchema
} from "./inbox-v2/data-lifecycle-catalog";
import { inboxV2ModuleIdSchema } from "./inbox-v2/namespace";

export const moduleTypeSchema = z.enum([
  "auth",
  "channel",
  "source",
  "telephony",
  "crm",
  "ai",
  "marketing",
  "analytics",
  "storage",
  "notification",
  "workflow",
  "billing",
  "company"
]);

export const uiSlotIdSchema = z.enum([
  "tenant.settings.section",
  "integration.settings.section",
  "client.profile.card",
  "conversation.composer.tool",
  "conversation.message.action",
  "inbox.sidebar.section",
  "admin.section",
  "reports.section",
  "support.case.panel"
]);

export const uiClientKindSchema = z.enum(["web", "mobile", "desktop"]);

const manifestModuleIdSchema = inboxV2ModuleIdSchema.transform((value) =>
  String(value)
);
const manifestStringSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value === value.trim(), {
    message: "Manifest strings must already be canonical and trimmed."
  });
const manifestStringListSchema = z
  .array(manifestStringSchema)
  .max(1_000)
  .superRefine((values, context) => {
    const seen = new Set<string>();

    for (const [index, value] of values.entries()) {
      if (seen.has(value)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: `Duplicate manifest value: ${value}.`
        });
      }
      seen.add(value);
    }
  });
const requiredOpaqueSchema = z.unknown().nonoptional();

export const uiSlotContributionSchema = z
  .object({
    id: manifestStringSchema,
    slot: uiSlotIdSchema,
    componentRef: manifestStringSchema,
    titleKey: manifestStringSchema.optional(),
    requiredPermissions: manifestStringListSchema.optional(),
    supportedClients: z
      .array(uiClientKindSchema)
      .min(1)
      .max(3)
      .superRefine((values, context) => {
        const seen = new Set<string>();

        for (const [index, value] of values.entries()) {
          if (seen.has(value)) {
            context.addIssue({
              code: "custom",
              path: [index],
              message: `Duplicate supported client: ${value}.`
            });
          }
          seen.add(value);
        }
      })
      .optional(),
    order: z.number().int().min(-1_000_000).max(1_000_000).optional()
  })
  .strict();

const moduleManifestCommonShape = {
  id: manifestModuleIdSchema,
  type: moduleTypeSchema,
  name: manifestStringSchema,
  version: manifestStringSchema,
  capabilities: manifestStringListSchema,
  configSchema: requiredOpaqueSchema,
  permissions: manifestStringListSchema.optional(),
  uiSlots: z.array(uiSlotContributionSchema).max(1_000).optional(),
  healthChecks: manifestStringListSchema.optional()
} satisfies z.ZodRawShape;

const moduleManifestNoDataSchema = z
  .object({
    ...moduleManifestCommonShape,
    dataHandling: z.literal("none")
  })
  .strict();

const moduleManifestWithDataSchema = z
  .object({
    ...moduleManifestCommonShape,
    secretsSchema: z.unknown().optional(),
    events: manifestStringListSchema.optional(),
    webhooks: manifestStringListSchema.optional(),
    jobs: manifestStringListSchema.optional(),
    dataHandling: z.literal("tenant_or_customer_data"),
    dataGovernance: inboxV2ModuleDataGovernanceContributionSchema
  })
  .strict();

/**
 * Runtime module boundary. A data-bearing module cannot be represented without
 * its complete Inbox V2 governance contribution, while a no-data module cannot
 * smuggle one in through an optional field or an unknown root property.
 */
export const moduleManifestSchema = z
  .discriminatedUnion("dataHandling", [
    moduleManifestNoDataSchema,
    moduleManifestWithDataSchema
  ])
  .superRefine((manifest, context) => {
    if (
      manifest.dataHandling === "tenant_or_customer_data" &&
      manifest.dataGovernance.payload.moduleId !== manifest.id
    ) {
      context.addIssue({
        code: "custom",
        path: ["dataGovernance", "payload", "moduleId"],
        message:
          "Data-governance contribution moduleId must equal the manifest id."
      });
    }
  });

export type ModuleType = z.infer<typeof moduleTypeSchema>;
export type UiSlotId = z.infer<typeof uiSlotIdSchema>;
export type UiClientKind = z.infer<typeof uiClientKindSchema>;
export type UiSlotContribution = z.infer<typeof uiSlotContributionSchema>;
export type ModuleManifest = z.infer<typeof moduleManifestSchema>;
export type ModuleManifestInput = z.input<typeof moduleManifestSchema>;

const definedModuleManifests = new WeakSet<object>();

/**
 * Defines one manifest and executes the complete lifecycle-registry validator.
 * Structural parsing alone is insufficient because handler/root compatibility
 * is a cross-catalog invariant.
 */
export function defineModuleManifest(
  input: ModuleManifestInput
): ModuleManifest {
  const manifest = moduleManifestSchema.parse(input);

  if (manifest.dataHandling === "tenant_or_customer_data") {
    defineInboxV2DataLifecycleRegistry({
      moduleContributions: [manifest.dataGovernance]
    });
  }

  const frozen = freezeManifest(manifest);
  definedModuleManifests.add(frozen);
  return frozen;
}

/** Compose standard/company manifests atomically and reject duplicate IDs. */
export function defineModuleManifests(
  inputs: readonly ModuleManifestInput[]
): readonly ModuleManifest[] {
  const manifests = inputs.map((input) => moduleManifestSchema.parse(input));
  const seen = new Set<string>();

  for (const manifest of manifests) {
    if (seen.has(manifest.id)) {
      throw new Error(`Duplicate module manifest id: ${manifest.id}.`);
    }
    seen.add(manifest.id);
  }

  defineInboxV2DataLifecycleRegistry({
    moduleContributions: manifests.flatMap((manifest) =>
      manifest.dataHandling === "tenant_or_customer_data"
        ? [manifest.dataGovernance]
        : []
    )
  });

  return Object.freeze(
    manifests.map((manifest, index) => {
      const original = inputs[index];

      if (
        original !== undefined &&
        typeof original === "object" &&
        original !== null &&
        definedModuleManifests.has(original)
      ) {
        return original as ModuleManifest;
      }

      const frozen = freezeManifest(manifest);
      definedModuleManifests.add(frozen);
      return frozen;
    })
  );
}

function freezeManifest(manifest: ModuleManifest): ModuleManifest {
  if (manifest.dataHandling === "tenant_or_customer_data") {
    deepFreezePlain(manifest.dataGovernance);
    for (const field of ["events", "webhooks", "jobs"] as const) {
      const values = manifest[field];
      if (values !== undefined) {
        Object.freeze(values);
      }
    }
  }

  for (const field of [
    "capabilities",
    "permissions",
    "healthChecks"
  ] as const) {
    const values = manifest[field];
    if (values !== undefined) {
      Object.freeze(values);
    }
  }

  if (manifest.uiSlots !== undefined) {
    for (const slot of manifest.uiSlots) {
      if (slot.requiredPermissions !== undefined) {
        Object.freeze(slot.requiredPermissions);
      }
      if (slot.supportedClients !== undefined) {
        Object.freeze(slot.supportedClients);
      }
      Object.freeze(slot);
    }
    Object.freeze(manifest.uiSlots);
  }

  return Object.freeze(manifest);
}

function deepFreezePlain<TValue>(value: TValue): TValue {
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreezePlain(item);
    }
    return Object.freeze(value) as TValue;
  }

  if (typeof value === "object" && value !== null) {
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype === Object.prototype || prototype === null) {
      for (const child of Object.values(value)) {
        deepFreezePlain(child);
      }
      Object.freeze(value);
    }
  }

  return value;
}
