import { z } from "zod";

import {
  isInboxV2DataLifecycleRegistry,
  type InboxV2DataLifecycleRegistry
} from "./data-lifecycle-catalog";
import {
  inboxV2DataGovernanceContextReferenceSchema,
  isInboxV2DataGovernanceContext,
  matchesInboxV2DataGovernanceContextReference,
  type InboxV2DataGovernanceContext
} from "./data-governance";
import {
  getInboxV2CurrentPolicyActivationReference,
  inboxV2DataLifecyclePolicyReferenceSchema,
  inboxV2PolicyActivationReferenceSchema,
  isInboxV2CurrentActivatedEffectiveTenantPolicy,
  type InboxV2EffectiveTenantPolicy,
  type InboxV2PolicyActivationLedger
} from "./data-lifecycle-policy";
import {
  inboxV2DataClassIdSchema,
  inboxV2ExternalRouteIdSchema,
  inboxV2StorageRootIdSchema,
  inboxV2VersionedProfileReferenceSchema
} from "./data-lifecycle-primitives";
import {
  inboxV2DataRootReferenceSchema,
  dataRootReferenceKey
} from "./data-subject-discovery";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema
} from "./entity-metadata";
import { inboxV2TenantIdSchema } from "./ids";
import { inboxV2NamespacedIdSchema } from "./namespace";
import { calculateInboxV2CanonicalSha256 } from "./recipient-sync-hash";
import {
  inboxV2Sha256DigestSchema,
  inboxV2StreamEpochSchema,
  inboxV2SyncGenerationSchema,
  inboxV2TenantStreamPositionSchema
} from "./sync-primitives";

export const inboxV2TenantTerminationScopeBoundarySchema = z
  .object({
    streamEpoch: inboxV2StreamEpochSchema,
    syncGeneration: inboxV2SyncGenerationSchema,
    completeThroughPosition: inboxV2TenantStreamPositionSchema,
    snapshotHash: inboxV2Sha256DigestSchema
  })
  .strict();

const tenantTerminationRootBaseShape = {
  root: inboxV2DataRootReferenceSchema,
  expectedEntityRevision: inboxV2EntityRevisionSchema,
  expectedLineageRevision: inboxV2EntityRevisionSchema
} as const;

export const inboxV2TenantTerminationScopeRootSchema = z.discriminatedUnion(
  "handling",
  [
    z
      .object({
        ...tenantTerminationRootBaseShape,
        handling: z.literal("export_then_erase")
      })
      .strict(),
    z
      .object({
        ...tenantTerminationRootBaseShape,
        handling: z.literal("erase_without_export"),
        omissionReason: z.enum([
          "secret",
          "registry_never_export",
          "registry_omit_with_reason",
          "backup_copy"
        ])
      })
      .strict(),
    z
      .object({
        ...tenantTerminationRootBaseShape,
        handling: z.literal("external_delete_and_track"),
        externalRouteIds: z.array(inboxV2ExternalRouteIdSchema).min(1).max(64)
      })
      .strict()
  ]
);

export const inboxV2TenantTerminationScannedDataUseSchema = z
  .object({
    dataClassId: inboxV2DataClassIdSchema,
    storageRootId: inboxV2StorageRootIdSchema
  })
  .strict();

export const inboxV2TenantTerminationScopeManifestReferenceSchema = z
  .object({
    kind: z.literal("tenant_termination_scope"),
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2NamespacedIdSchema,
    revision: inboxV2EntityRevisionSchema,
    registryCompositionHash: inboxV2Sha256DigestSchema,
    rootSetHash: inboxV2Sha256DigestSchema,
    exportRootSetHash: inboxV2Sha256DigestSchema,
    proofHash: inboxV2Sha256DigestSchema
  })
  .strict();

export const inboxV2TenantTerminationScopeManifestSchema = z
  .object({
    kind: z.literal("tenant_termination_scope"),
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2NamespacedIdSchema,
    revision: inboxV2EntityRevisionSchema,
    source: inboxV2VersionedProfileReferenceSchema,
    registryCompositionHash: inboxV2Sha256DigestSchema,
    governance: inboxV2DataGovernanceContextReferenceSchema,
    policy: inboxV2DataLifecyclePolicyReferenceSchema,
    policyActivation: inboxV2PolicyActivationReferenceSchema,
    boundary: inboxV2TenantTerminationScopeBoundarySchema,
    scannedDataUses: z
      .array(inboxV2TenantTerminationScannedDataUseSchema)
      .max(100_000),
    roots: z.array(inboxV2TenantTerminationScopeRootSchema).max(100_000),
    generatedAt: inboxV2TimestampSchema,
    rootSetHash: inboxV2Sha256DigestSchema,
    exportRootSetHash: inboxV2Sha256DigestSchema,
    proofHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((manifest, context) => {
    const rootKeys = manifest.roots.map(({ root }) =>
      dataRootReferenceKey(root)
    );
    const dataUseKeys = manifest.scannedDataUses.map(tenantDataUseKey);
    const routeSetsCanonical = manifest.roots.every(
      (entry) =>
        entry.handling !== "external_delete_and_track" ||
        isStrictlySortedUnique(entry.externalRouteIds.map(String))
    );
    if (
      manifest.roots.some(({ root }) => root.tenantId !== manifest.tenantId) ||
      manifest.governance.tenantId !== manifest.tenantId ||
      manifest.policy.tenantId !== manifest.tenantId ||
      manifest.policyActivation.tenantId !== manifest.tenantId ||
      !isStrictlySortedUnique(rootKeys) ||
      !isStrictlySortedUnique(dataUseKeys) ||
      !routeSetsCanonical ||
      manifest.rootSetHash !== calculateTenantRootSetHash(rootKeys) ||
      manifest.exportRootSetHash !==
        calculateTenantRootSetHash(
          manifest.roots
            .filter(({ handling }) => handling === "export_then_erase")
            .map(({ root }) => dataRootReferenceKey(root))
        ) ||
      manifest.proofHash !==
        calculateInboxV2TenantTerminationScopeProofHash(manifest)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Tenant termination scope must be canonical, tenant-wide and hash every root, omission and high-water fence."
      });
    }
  });

const inboxV2TenantTerminationScopeSourceResultSchema = z
  .object({
    kind: z.literal("tenant_termination_scope"),
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2NamespacedIdSchema,
    revision: inboxV2EntityRevisionSchema,
    boundary: inboxV2TenantTerminationScopeBoundarySchema,
    scannedDataUses: z
      .array(inboxV2TenantTerminationScannedDataUseSchema)
      .max(100_000),
    roots: z.array(inboxV2TenantTerminationScopeRootSchema).max(100_000),
    generatedAt: inboxV2TimestampSchema
  })
  .strict();

const inboxV2TenantTerminationScopeCasResultSchema = z
  .object({
    outcome: z.enum(["matched_and_sealed", "changed"]),
    tenantId: inboxV2TenantIdSchema,
    registryCompositionHash: inboxV2Sha256DigestSchema,
    boundary: inboxV2TenantTerminationScopeBoundarySchema,
    rootSetHash: inboxV2Sha256DigestSchema,
    exportRootSetHash: inboxV2Sha256DigestSchema,
    checkedAt: inboxV2TimestampSchema
  })
  .strict();

export type InboxV2TenantTerminationScopeManifest = z.infer<
  typeof inboxV2TenantTerminationScopeManifestSchema
>;
export type InboxV2TenantTerminationScopeRoot = z.infer<
  typeof inboxV2TenantTerminationScopeRootSchema
>;

export type InboxV2TenantTerminationScopeSource = Readonly<{
  id: string;
  version: string;
  loadCompleteTenantScope(
    input: Readonly<{
      tenantId: string;
      registryCompositionHash: string;
      expectedDataUses: readonly z.infer<
        typeof inboxV2TenantTerminationScannedDataUseSchema
      >[];
    }>
  ): z.input<typeof inboxV2TenantTerminationScopeSourceResultSchema>;
  compareAndSetDestructiveScope(
    input: Readonly<{
      manifest: InboxV2TenantTerminationScopeManifest;
      checkedAt: string;
    }>
  ): z.input<typeof inboxV2TenantTerminationScopeCasResultSchema>;
}>;

const authenticTenantScopeSources = new WeakSet<object>();
const authenticTenantScopeManifests = new WeakSet<object>();
const tenantScopeSourceByManifest = new WeakMap<
  object,
  InboxV2TenantTerminationScopeSource
>();
const tenantScopeAuthorityByManifest = new WeakMap<
  object,
  Readonly<{
    governanceContext: InboxV2DataGovernanceContext;
    policy: InboxV2EffectiveTenantPolicy;
    activationLedger: InboxV2PolicyActivationLedger;
  }>
>();

export function defineInboxV2TenantTerminationScopeSource(input: {
  id: string;
  version: string;
  loadCompleteTenantScope: InboxV2TenantTerminationScopeSource["loadCompleteTenantScope"];
  compareAndSetDestructiveScope: InboxV2TenantTerminationScopeSource["compareAndSetDestructiveScope"];
}): InboxV2TenantTerminationScopeSource {
  const reference = inboxV2VersionedProfileReferenceSchema.parse({
    id: input.id,
    version: input.version
  });
  if (
    typeof input.loadCompleteTenantScope !== "function" ||
    typeof input.compareAndSetDestructiveScope !== "function"
  ) {
    throw new Error(
      "Tenant termination source requires complete enumeration and destructive-scope CAS capabilities."
    );
  }
  const source = Object.freeze({
    ...reference,
    loadCompleteTenantScope: input.loadCompleteTenantScope,
    compareAndSetDestructiveScope: input.compareAndSetDestructiveScope
  });
  authenticTenantScopeSources.add(source);
  return source;
}

export function resolveInboxV2TenantTerminationScopeManifest(input: {
  source: InboxV2TenantTerminationScopeSource;
  registry: InboxV2DataLifecycleRegistry;
  governanceContext: InboxV2DataGovernanceContext;
  policy: InboxV2EffectiveTenantPolicy;
  activationLedger: InboxV2PolicyActivationLedger;
  tenantId: string;
}): InboxV2TenantTerminationScopeManifest {
  if (
    !authenticTenantScopeSources.has(input.source) ||
    !isInboxV2DataLifecycleRegistry(input.registry)
  ) {
    throw new Error(
      "Tenant termination scope requires a registered complete-state source and authentic registry."
    );
  }
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const policyActivation = getInboxV2CurrentPolicyActivationReference({
    ledger: input.activationLedger,
    policy: input.policy
  });
  if (
    !isInboxV2DataGovernanceContext(input.governanceContext) ||
    !isInboxV2CurrentActivatedEffectiveTenantPolicy({
      ledger: input.activationLedger,
      policy: input.policy
    }) ||
    policyActivation === null ||
    input.governanceContext.tenantId !== tenantId ||
    input.policy.tenantId !== tenantId ||
    input.policy.registryCompositionHash !== input.registry.compositionHash ||
    !matchesInboxV2DataGovernanceContextReference({
      context: input.governanceContext,
      reference: input.policy.governanceContextRef
    })
  ) {
    throw new Error(
      "Tenant termination scope requires current governance, policy activation and registry composition."
    );
  }
  const expectedDataUses = z
    .array(inboxV2TenantTerminationScannedDataUseSchema)
    .parse(
      input.registry.dataUses.map(({ dataClassId, storageRootId }) => ({
        dataClassId: String(dataClassId),
        storageRootId: String(storageRootId)
      }))
    )
    .sort((left, right) =>
      tenantDataUseKey(left).localeCompare(tenantDataUseKey(right))
    );
  const result = inboxV2TenantTerminationScopeSourceResultSchema.parse(
    input.source.loadCompleteTenantScope({
      tenantId,
      registryCompositionHash: String(input.registry.compositionHash),
      expectedDataUses
    })
  );
  if (
    result.tenantId !== tenantId ||
    Date.parse(result.generatedAt) <
      Date.parse(input.governanceContext.effectiveAt) ||
    Date.parse(result.generatedAt) >=
      Date.parse(input.governanceContext.reviewAt) ||
    Date.parse(result.generatedAt) < Date.parse(input.policy.effectiveAt) ||
    !sameCanonicalValues(
      result.scannedDataUses.map(tenantDataUseKey),
      expectedDataUses.map(tenantDataUseKey)
    )
  ) {
    throw new Error(
      "Tenant termination source did not scan the exact current registry data-use set."
    );
  }
  for (const entry of result.roots) {
    validateTenantScopeRoot(entry, input.registry);
  }
  const body = {
    ...result,
    source: { id: input.source.id, version: input.source.version },
    registryCompositionHash: input.registry.compositionHash,
    governance: {
      tenantId: input.governanceContext.tenantId,
      id: input.governanceContext.id,
      version: input.governanceContext.version,
      contextHash: input.governanceContext.contextHash
    },
    policy: {
      tenantId: input.policy.tenantId,
      id: input.policy.id,
      version: input.policy.version,
      policyHash: input.policy.policyHash
    },
    policyActivation,
    rootSetHash: calculateTenantRootSetHash(
      result.roots.map(({ root }) => dataRootReferenceKey(root))
    ),
    exportRootSetHash: calculateTenantRootSetHash(
      result.roots
        .filter(({ handling }) => handling === "export_then_erase")
        .map(({ root }) => dataRootReferenceKey(root))
    )
  } as const;
  const manifest = deepFreezeTenantScope(
    inboxV2TenantTerminationScopeManifestSchema.parse({
      ...body,
      proofHash: calculateInboxV2TenantTerminationScopeProofHash(body)
    })
  );
  authenticTenantScopeManifests.add(manifest);
  tenantScopeSourceByManifest.set(manifest, input.source);
  tenantScopeAuthorityByManifest.set(manifest, {
    governanceContext: input.governanceContext,
    policy: input.policy,
    activationLedger: input.activationLedger
  });
  return manifest;
}

export function isInboxV2TenantTerminationScopeManifest(
  value: unknown
): value is InboxV2TenantTerminationScopeManifest {
  return (
    typeof value === "object" &&
    value !== null &&
    authenticTenantScopeManifests.has(value)
  );
}

export function inboxV2TenantTerminationScopeManifestReference(
  manifest: InboxV2TenantTerminationScopeManifest
): z.infer<typeof inboxV2TenantTerminationScopeManifestReferenceSchema> {
  if (!isInboxV2TenantTerminationScopeManifest(manifest)) {
    throw new Error(
      "Tenant termination scope reference requires authenticity."
    );
  }
  return {
    kind: "tenant_termination_scope",
    tenantId: manifest.tenantId,
    id: manifest.id,
    revision: manifest.revision,
    registryCompositionHash: manifest.registryCompositionHash,
    rootSetHash: manifest.rootSetHash,
    exportRootSetHash: manifest.exportRootSetHash,
    proofHash: manifest.proofHash
  };
}

export function matchesInboxV2TenantTerminationScopeReference(input: {
  manifest: InboxV2TenantTerminationScopeManifest;
  reference: z.input<
    typeof inboxV2TenantTerminationScopeManifestReferenceSchema
  >;
}): boolean {
  if (!isInboxV2TenantTerminationScopeManifest(input.manifest)) return false;
  const reference = inboxV2TenantTerminationScopeManifestReferenceSchema.parse(
    input.reference
  );
  return (
    JSON.stringify(reference) ===
    JSON.stringify(
      inboxV2TenantTerminationScopeManifestReference(input.manifest)
    )
  );
}

/**
 * Activation-time composition-root CAS. A production source must atomically
 * verify this high-water/root set and seal the tenant against new customer-data
 * writes before returning `matched_and_sealed`.
 */
export function compareAndSetInboxV2TenantTerminationDestructiveScope(input: {
  manifest: InboxV2TenantTerminationScopeManifest;
  checkedAt: string;
}): void {
  const source = tenantScopeSourceByManifest.get(input.manifest);
  if (source === undefined) {
    throw new Error(
      "Tenant termination deletion requires authentic scope-source lineage."
    );
  }
  const checkedAt = inboxV2TimestampSchema.parse(input.checkedAt);
  const result = inboxV2TenantTerminationScopeCasResultSchema.parse(
    source.compareAndSetDestructiveScope({
      manifest: input.manifest,
      checkedAt
    })
  );
  if (
    result.outcome !== "matched_and_sealed" ||
    result.checkedAt !== checkedAt ||
    result.tenantId !== input.manifest.tenantId ||
    result.registryCompositionHash !== input.manifest.registryCompositionHash ||
    JSON.stringify(result.boundary) !==
      JSON.stringify(input.manifest.boundary) ||
    result.rootSetHash !== input.manifest.rootSetHash ||
    result.exportRootSetHash !== input.manifest.exportRootSetHash
  ) {
    throw new Error(
      "Tenant termination scope changed after export; re-enumeration and a new export are required."
    );
  }
}

export function assertInboxV2TenantTerminationScopeCurrentAuthority(input: {
  manifest: InboxV2TenantTerminationScopeManifest;
  registryCompositionHash: string;
  governance: z.input<typeof inboxV2DataGovernanceContextReferenceSchema>;
  policy: z.input<typeof inboxV2DataLifecyclePolicyReferenceSchema>;
  checkedAt: string;
}): void {
  const authority = tenantScopeAuthorityByManifest.get(input.manifest);
  const checkedAt = inboxV2TimestampSchema.parse(input.checkedAt);
  const activation =
    authority === undefined
      ? null
      : getInboxV2CurrentPolicyActivationReference({
          ledger: authority.activationLedger,
          policy: authority.policy
        });
  if (
    authority === undefined ||
    activation === null ||
    input.manifest.registryCompositionHash !== input.registryCompositionHash ||
    !matchesInboxV2DataGovernanceContextReference({
      context: authority.governanceContext,
      reference: input.governance
    }) ||
    JSON.stringify(input.policy) !== JSON.stringify(input.manifest.policy) ||
    JSON.stringify(activation) !==
      JSON.stringify(input.manifest.policyActivation) ||
    Date.parse(checkedAt) <
      Date.parse(authority.governanceContext.effectiveAt) ||
    Date.parse(checkedAt) >= Date.parse(authority.governanceContext.reviewAt) ||
    Date.parse(checkedAt) < Date.parse(authority.policy.effectiveAt)
  ) {
    throw new Error(
      "Tenant termination scope no longer has current governance or policy authority."
    );
  }
}

export function calculateInboxV2TenantTerminationScopeProofHash(input: {
  proofHash?: unknown;
  [key: string]: unknown;
}) {
  const { proofHash: _ignored, ...scope } = input;
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.tenant-termination-scope",
    hashVersion: "v1",
    scope
  });
}

export function inboxV2TenantTerminationExportRoots(
  manifest: InboxV2TenantTerminationScopeManifest
): readonly InboxV2TenantTerminationScopeRoot[] {
  return manifest.roots.filter(
    ({ handling }) => handling === "export_then_erase"
  );
}

function validateTenantScopeRoot(
  entry: InboxV2TenantTerminationScopeRoot,
  registry: InboxV2DataLifecycleRegistry
): void {
  const dataClass = registry.dataClasses.find(
    ({ id }) => id === entry.root.dataClassId
  );
  const storageRoot = registry.storageRoots.find(
    ({ id }) => id === entry.root.storageRootId
  );
  const use = registry.dataUses.find(
    (candidate) =>
      candidate.dataClassId === entry.root.dataClassId &&
      candidate.storageRootId === entry.root.storageRootId
  );
  if (
    dataClass === undefined ||
    storageRoot === undefined ||
    use === undefined
  ) {
    throw new Error(
      `Tenant termination root ${dataRootReferenceKey(entry.root)} has no registered lineage.`
    );
  }
  const externalRouteIds = registry.moduleContributions
    .flatMap(({ payload }) => payload.externalRoutes)
    .filter(
      (route) =>
        route.storageRootId === entry.root.storageRootId &&
        route.dataClassIds.includes(entry.root.dataClassId)
    )
    .map(({ id }) => String(id))
    .sort();
  const expectedHandling =
    storageRoot.definition.kind === "external_route"
      ? "external_delete_and_track"
      : storageRoot.definition.kind === "backup"
        ? "erase_without_export"
        : dataClass.definition.sensitivity === "secret" ||
            dataClass.definition.exportBehavior === "never" ||
            dataClass.definition.exportBehavior === "omit_with_reason"
          ? "erase_without_export"
          : "export_then_erase";
  const expectedOmission =
    storageRoot.definition.kind === "backup"
      ? "backup_copy"
      : dataClass.definition.sensitivity === "secret"
        ? "secret"
        : dataClass.definition.exportBehavior === "never"
          ? "registry_never_export"
          : dataClass.definition.exportBehavior === "omit_with_reason"
            ? "registry_omit_with_reason"
            : null;
  if (
    entry.handling !== expectedHandling ||
    (entry.handling === "erase_without_export" &&
      entry.omissionReason !== expectedOmission) ||
    (entry.handling === "external_delete_and_track" &&
      (!sameCanonicalValues(
        entry.externalRouteIds.map(String),
        externalRouteIds
      ) ||
        externalRouteIds.length === 0))
  ) {
    throw new Error(
      `Tenant termination root ${dataRootReferenceKey(entry.root)} has an unsafe export/delete classification.`
    );
  }
}

function tenantDataUseKey(
  use: z.infer<typeof inboxV2TenantTerminationScannedDataUseSchema>
): string {
  return `${use.dataClassId}\u0000${use.storageRootId}`;
}

function calculateTenantRootSetHash(keys: readonly string[]) {
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.tenant-termination-root-set",
    hashVersion: "v1",
    keys
  });
}

function isStrictlySortedUnique(values: readonly string[]): boolean {
  return values.every(
    (value, index) => index === 0 || values[index - 1]! < value
  );
}

function sameCanonicalValues(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function deepFreezeTenantScope<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreezeTenantScope(child);
  return Object.freeze(value);
}
