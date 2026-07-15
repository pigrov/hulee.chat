import { z } from "zod";

import { inboxV2LifecycleHandlerIdSchema } from "./data-lifecycle-primitives";
import { inboxV2DataGovernanceContextReferenceSchema } from "./data-governance";
import {
  inboxV2DataLifecyclePolicyReferenceSchema,
  inboxV2PolicyActivationReferenceSchema
} from "./data-lifecycle-policy";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema
} from "./entity-metadata";
import { inboxV2TenantIdSchema } from "./ids";
import {
  inboxV2PrivacyExportArtifactIdSchema,
  inboxV2PrivacyExportArtifactReferenceSchema,
  inboxV2PrivacyExportJobReferenceSchema,
  inboxV2PrivacyExportManifestReferenceSchema
} from "./privacy-export";
import { inboxV2PrivacyScopeManifestIdSchema } from "./privacy-hold-restriction";
import { inboxV2PrivacyRequestIdSchema } from "./privacy-request";
import { inboxV2Sha256DigestSchema } from "./sync-primitives";
import { inboxV2TenantTerminationScopeManifestReferenceSchema } from "./tenant-termination-scope";

const exportJobStateSchema = z.enum([
  "queued",
  "running",
  "ready",
  "revoked",
  "expired",
  "failed_retryable",
  "completed"
]);

const exportArtifactClaimKeySchema = z
  .string()
  .min(1)
  .max(512)
  .refine(hasNoControlCharacters, {
    message: "Artifact claim key must be one bounded opaque token."
  });

const exportPayloadLocatorSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine(hasNoControlCharacters, {
    message: "Export payload locator must be one bounded opaque value."
  });

const exportPersistenceOpaqueIdSchema = z
  .string()
  .min(1)
  .max(256)
  .refine(hasNoControlCharacters, {
    message: "Export persistence identifier must be one bounded opaque value."
  });

const genericExportProductAuthorityShape = {
  id: exportPersistenceOpaqueIdSchema,
  revision: inboxV2EntityRevisionSchema,
  hash: inboxV2Sha256DigestSchema
} as const;

export const inboxV2PrivacyExportPersistenceProductAuthoritySchema =
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("tenant_deployment"),
        tenantScope: inboxV2TenantTerminationScopeManifestReferenceSchema,
        governance: inboxV2DataGovernanceContextReferenceSchema,
        policy: inboxV2DataLifecyclePolicyReferenceSchema,
        activation: inboxV2PolicyActivationReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("manager_report"),
        ...genericExportProductAuthorityShape
      })
      .strict(),
    z
      .object({
        kind: z.literal("data_subject"),
        ...genericExportProductAuthorityShape
      })
      .strict()
  ]);

export const inboxV2PrivacyExportLifecycleKeySchema =
  inboxV2PrivacyExportJobReferenceSchema;

export const inboxV2PrivacyExportArtifactLifecycleHeadSchema = z
  .object({
    reference: inboxV2PrivacyExportArtifactReferenceSchema,
    artifactClaimKey: exportArtifactClaimKeySchema
  })
  .strict();

const artifactRevisionBaseShape = {
  tenantId: inboxV2TenantIdSchema,
  artifactId: inboxV2PrivacyExportArtifactIdSchema,
  revision: inboxV2EntityRevisionSchema,
  job: inboxV2PrivacyExportJobReferenceSchema,
  artifactClaimKey: exportArtifactClaimKeySchema,
  byteCount: z
    .union([
      z.bigint(),
      z.number().int().nonnegative(),
      z.string().regex(/^\d+$/u)
    ])
    .transform((value) => String(value)),
  recordedAt: inboxV2TimestampSchema
} as const;

export const inboxV2PrivacyExportArtifactLifecycleRevisionSchema = z
  .discriminatedUnion("state", [
    z
      .object({
        ...artifactRevisionBaseShape,
        state: z.literal("building"),
        manifest: z.null(),
        payloadChecksum: z.null(),
        payloadLocator: exportPayloadLocatorSchema.nullable(),
        packagingProofHash: z.null(),
        archiveCompositionHash: z.null(),
        readyAt: z.null(),
        expiresAt: z.null(),
        deletedAt: z.null()
      })
      .strict(),
    z
      .object({
        ...artifactRevisionBaseShape,
        state: z.literal("ready"),
        manifest: inboxV2PrivacyExportManifestReferenceSchema,
        payloadChecksum: inboxV2Sha256DigestSchema,
        payloadLocator: exportPayloadLocatorSchema,
        packagingProofHash: inboxV2Sha256DigestSchema,
        archiveCompositionHash: inboxV2Sha256DigestSchema,
        readyAt: inboxV2TimestampSchema,
        expiresAt: inboxV2TimestampSchema,
        deletedAt: z.null()
      })
      .strict(),
    z
      .object({
        ...artifactRevisionBaseShape,
        state: z.literal("quarantined"),
        manifest: z.null(),
        payloadChecksum: z.null(),
        payloadLocator: exportPayloadLocatorSchema.nullable(),
        packagingProofHash: z.null(),
        archiveCompositionHash: z.null(),
        readyAt: z.null(),
        expiresAt: z.null(),
        deletedAt: z.null()
      })
      .strict(),
    z
      .object({
        ...artifactRevisionBaseShape,
        state: z.literal("deleted"),
        manifest: z.null(),
        payloadChecksum: z.null(),
        payloadLocator: z.null(),
        packagingProofHash: z.null(),
        archiveCompositionHash: z.null(),
        readyAt: z.null(),
        expiresAt: z.null(),
        deletedAt: inboxV2TimestampSchema
      })
      .strict()
  ])
  .superRefine((revision, context) => {
    if (revision.job.tenantId !== revision.tenantId) {
      addIssue(
        context,
        ["job", "tenantId"],
        "Artifact revision and export job must belong to one tenant."
      );
    }
    if (
      revision.state === "ready" &&
      revision.manifest.tenantId !== revision.tenantId
    ) {
      addIssue(
        context,
        ["manifest", "tenantId"],
        "Ready artifact and export manifest must belong to one tenant."
      );
    }
    if (revision.state === "building" && BigInt(revision.byteCount) !== 0n) {
      addIssue(
        context,
        ["byteCount"],
        "Building artifact starts with zero finalized bytes."
      );
    }
    if (
      revision.state === "ready" &&
      (BigInt(revision.byteCount) <= 0n ||
        Date.parse(revision.readyAt) < Date.parse(revision.recordedAt) ||
        Date.parse(revision.expiresAt) <= Date.parse(revision.readyAt) ||
        Date.parse(revision.expiresAt) - Date.parse(revision.readyAt) >
          24 * 60 * 60 * 1_000)
    ) {
      addIssue(
        context,
        [],
        "Ready artifact requires finalized bytes and an ordered TTL no longer than 24 hours."
      );
    }
    if (
      revision.state === "deleted" &&
      Date.parse(revision.deletedAt) < Date.parse(revision.recordedAt)
    ) {
      addIssue(
        context,
        ["deletedAt"],
        "Artifact cannot be deleted before its lifecycle revision is recorded."
      );
    }
  });

export const inboxV2PrivacyExportLifecycleSnapshotSchema = z
  .object({
    stateRevision: inboxV2EntityRevisionSchema,
    state: exportJobStateSchema,
    manifest: inboxV2PrivacyExportManifestReferenceSchema.nullable(),
    artifact: inboxV2PrivacyExportArtifactLifecycleHeadSchema.nullable(),
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine(assertLifecycleSnapshotCoherence);

export const inboxV2PrivacyExportLifecycleBootstrapInputSchema = z
  .object({
    key: inboxV2PrivacyExportLifecycleKeySchema,
    productKind: z.enum([
      "tenant_deployment",
      "manager_report",
      "data_subject"
    ]),
    productAuthority: inboxV2PrivacyExportPersistenceProductAuthoritySchema,
    request: z
      .object({
        id: inboxV2PrivacyRequestIdSchema,
        revision: inboxV2EntityRevisionSchema
      })
      .strict()
      .nullable(),
    scopeManifest: z
      .object({
        id: inboxV2PrivacyScopeManifestIdSchema,
        revision: inboxV2EntityRevisionSchema
      })
      .strict()
      .nullable(),
    registry: z
      .object({
        id: exportPersistenceOpaqueIdSchema,
        revision: inboxV2EntityRevisionSchema
      })
      .strict(),
    exportHandlerId: inboxV2LifecycleHandlerIdSchema,
    principalKey: exportPersistenceOpaqueIdSchema,
    createdAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((input, context) => {
    if (input.productAuthority.kind !== input.productKind) {
      addIssue(
        context,
        ["productAuthority", "kind"],
        "Export product authority kind must match the persisted product kind."
      );
    }
    const requiresSubjectAuthority = input.productKind === "data_subject";
    if (
      requiresSubjectAuthority !== (input.request !== null) ||
      requiresSubjectAuthority !== (input.scopeManifest !== null)
    ) {
      addIssue(
        context,
        [],
        "Only a data-subject export bootstrap binds a privacy request and frozen scope manifest."
      );
    }
    if (input.productAuthority.kind === "tenant_deployment") {
      const authority = input.productAuthority;
      const tenantIds = [
        authority.tenantScope.tenantId,
        authority.governance.tenantId,
        authority.policy.tenantId,
        authority.activation.tenantId
      ];
      if (tenantIds.some((tenantId) => tenantId !== input.key.tenantId)) {
        addIssue(
          context,
          ["productAuthority"],
          "Tenant deployment scope and current authorities cannot cross the job tenant boundary."
        );
      }
      if (input.request !== null || input.scopeManifest !== null) {
        addIssue(
          context,
          ["productAuthority", "tenantScope"],
          "Tenant deployment authority owns its exact tenant-termination scope and cannot reuse subject-request fields."
        );
      }
    }
    if (input.createdAt !== input.key.requestedAt) {
      addIssue(
        context,
        ["createdAt"],
        "Export bootstrap creation time must equal the immutable job request time."
      );
    }
  });

export const inboxV2PrivacyExportLifecycleTransitionInputSchema = z
  .object({
    key: inboxV2PrivacyExportLifecycleKeySchema,
    expected: inboxV2PrivacyExportLifecycleSnapshotSchema,
    candidate: inboxV2PrivacyExportLifecycleSnapshotSchema,
    artifactRevision:
      inboxV2PrivacyExportArtifactLifecycleRevisionSchema.nullable()
  })
  .strict()
  .superRefine((input, context) => {
    const tenantIds = [
      input.key.tenantId,
      input.expected.manifest?.tenantId,
      input.expected.artifact?.reference.tenantId,
      input.candidate.manifest?.tenantId,
      input.candidate.artifact?.reference.tenantId,
      input.artifactRevision?.tenantId,
      input.artifactRevision?.job.tenantId
    ].filter((value) => value !== undefined);
    if (tenantIds.some((tenantId) => tenantId !== input.key.tenantId)) {
      addIssue(
        context,
        [],
        "Export lifecycle transition cannot cross the tenant boundary."
      );
    }
    if (
      BigInt(input.candidate.stateRevision) !==
      BigInt(input.expected.stateRevision) + 1n
    ) {
      addIssue(
        context,
        ["candidate", "stateRevision"],
        "Export job state revision must advance exactly once."
      );
    }
    if (
      Date.parse(input.candidate.updatedAt) <=
      Date.parse(input.expected.updatedAt)
    ) {
      addIssue(
        context,
        ["candidate", "updatedAt"],
        "Export lifecycle update time cannot move backwards."
      );
    }
    if (!isLegalJobStateEdge(input.expected.state, input.candidate.state)) {
      addIssue(
        context,
        ["candidate", "state"],
        "Export job lifecycle transition uses an illegal state edge."
      );
    }

    const expectedArtifact = input.expected.artifact;
    const candidateArtifact = input.candidate.artifact;
    const artifactChanged =
      artifactHeadKey(expectedArtifact) !== artifactHeadKey(candidateArtifact);
    const safeJobOnlyEdge =
      input.expected.state === "failed_retryable" &&
      (input.candidate.state === "revoked" ||
        input.candidate.state === "expired");
    if (!artifactChanged && !safeJobOnlyEdge) {
      addIssue(
        context,
        ["candidate", "artifact"],
        "This export job state revision must advance one current artifact revision."
      );
    }
    if (artifactChanged !== (input.artifactRevision !== null)) {
      addIssue(
        context,
        ["artifactRevision"],
        "Every changed artifact head requires one exact immutable lifecycle revision."
      );
      return;
    }
    if (input.artifactRevision === null || candidateArtifact === null) return;

    const revision = input.artifactRevision;
    if (
      Date.parse(revision.recordedAt) <= Date.parse(input.expected.updatedAt) ||
      Date.parse(revision.recordedAt) > Date.parse(input.candidate.updatedAt)
    ) {
      addIssue(
        context,
        ["artifactRevision", "recordedAt"],
        "Artifact revision time must be after the expected head and no later than the candidate CAS time."
      );
    }
    if (
      revision.artifactId !== candidateArtifact.reference.artifactId ||
      revision.revision !== candidateArtifact.reference.revision ||
      revision.state !== candidateArtifact.reference.state ||
      revision.artifactClaimKey !== candidateArtifact.artifactClaimKey ||
      revision.job.jobId !== input.key.jobId ||
      revision.job.revision !== input.key.revision ||
      revision.job.requestedAt !== input.key.requestedAt
    ) {
      addIssue(
        context,
        ["artifactRevision"],
        "Artifact lifecycle revision must exactly match its candidate head and job authority."
      );
    }
    if (
      revision.state === "ready" &&
      (input.candidate.manifest === null ||
        JSON.stringify(revision.manifest) !==
          JSON.stringify(input.candidate.manifest))
    ) {
      addIssue(
        context,
        ["artifactRevision", "manifest"],
        "Ready artifact revision must bind the candidate job's exact immutable manifest."
      );
    }

    if (expectedArtifact === null) {
      if (
        revision.revision !== "1" ||
        revision.state !== "building" ||
        input.candidate.state !== "running"
      ) {
        addIssue(
          context,
          ["artifactRevision"],
          "A new artifact must start building at revision 1 for a running job."
        );
      }
      return;
    }

    if (expectedArtifact.reference.artifactId === revision.artifactId) {
      if (
        BigInt(revision.revision) !==
          BigInt(expectedArtifact.reference.revision) + 1n ||
        revision.artifactClaimKey !== expectedArtifact.artifactClaimKey ||
        !isLegalArtifactStateEdge(
          expectedArtifact.reference.state,
          revision.state
        )
      ) {
        addIssue(
          context,
          ["artifactRevision"],
          "Existing artifact requires a stable claim key, legal state edge and next revision."
        );
      }
    } else if (
      input.expected.state !== "failed_retryable" ||
      input.candidate.state !== "running" ||
      revision.revision !== "1" ||
      revision.state !== "building"
    ) {
      addIssue(
        context,
        ["artifactRevision"],
        "Only a retryable job may switch to a new revision-1 building artifact."
      );
    }
  });

const lifecycleFoundResultSchema = z
  .object({
    outcome: z.literal("found"),
    current: inboxV2PrivacyExportLifecycleSnapshotSchema
  })
  .strict();

export const inboxV2PrivacyExportLifecycleLoadResultSchema =
  z.discriminatedUnion("outcome", [
    lifecycleFoundResultSchema,
    z.object({ outcome: z.literal("not_found") }).strict()
  ]);

export const inboxV2PrivacyExportLifecycleTransitionResultSchema =
  z.discriminatedUnion("outcome", [
    z
      .object({
        outcome: z.literal("applied"),
        current: inboxV2PrivacyExportLifecycleSnapshotSchema
      })
      .strict(),
    z
      .object({
        outcome: z.literal("already_applied"),
        current: inboxV2PrivacyExportLifecycleSnapshotSchema
      })
      .strict(),
    z
      .object({
        outcome: z.literal("conflict"),
        current: inboxV2PrivacyExportLifecycleSnapshotSchema
      })
      .strict(),
    z.object({ outcome: z.literal("not_found") }).strict()
  ]);

export const inboxV2PrivacyExportLifecycleBootstrapResultSchema =
  z.discriminatedUnion("outcome", [
    z
      .object({
        outcome: z.literal("applied"),
        current: inboxV2PrivacyExportLifecycleSnapshotSchema
      })
      .strict(),
    z
      .object({
        outcome: z.literal("already_applied"),
        current: inboxV2PrivacyExportLifecycleSnapshotSchema
      })
      .strict(),
    z
      .object({
        outcome: z.literal("conflict"),
        current: inboxV2PrivacyExportLifecycleSnapshotSchema
      })
      .strict()
  ]);

export type InboxV2PrivacyExportLifecycleKey = z.infer<
  typeof inboxV2PrivacyExportLifecycleKeySchema
>;
export type InboxV2PrivacyExportArtifactLifecycleRevision = z.infer<
  typeof inboxV2PrivacyExportArtifactLifecycleRevisionSchema
>;
export type InboxV2PrivacyExportLifecycleSnapshot = z.infer<
  typeof inboxV2PrivacyExportLifecycleSnapshotSchema
>;
export type InboxV2PrivacyExportLifecycleTransitionInput = z.infer<
  typeof inboxV2PrivacyExportLifecycleTransitionInputSchema
>;
export type InboxV2PrivacyExportLifecycleBootstrapInput = z.infer<
  typeof inboxV2PrivacyExportLifecycleBootstrapInputSchema
>;
export type InboxV2PrivacyExportLifecycleLoadResult = z.infer<
  typeof inboxV2PrivacyExportLifecycleLoadResultSchema
>;
export type InboxV2PrivacyExportLifecycleTransitionResult = z.infer<
  typeof inboxV2PrivacyExportLifecycleTransitionResultSchema
>;
export type InboxV2PrivacyExportLifecycleBootstrapResult = z.infer<
  typeof inboxV2PrivacyExportLifecycleBootstrapResultSchema
>;

/** Durable port for the authoritative export job/artifact state machine. */
export interface InboxV2PrivacyExportLifecycleRepository {
  bootstrap(
    input: Readonly<InboxV2PrivacyExportLifecycleBootstrapInput>
  ): Promise<InboxV2PrivacyExportLifecycleBootstrapResult>;
  loadCurrent(
    key: Readonly<InboxV2PrivacyExportLifecycleKey>
  ): Promise<InboxV2PrivacyExportLifecycleLoadResult>;
  compareAndSet(
    input: Readonly<InboxV2PrivacyExportLifecycleTransitionInput>
  ): Promise<InboxV2PrivacyExportLifecycleTransitionResult>;
}

const authenticLifecycleRepositories = new WeakSet<object>();

export function defineInboxV2PrivacyExportLifecycleRepository(
  repository: InboxV2PrivacyExportLifecycleRepository
): InboxV2PrivacyExportLifecycleRepository {
  if (
    typeof repository.bootstrap !== "function" ||
    typeof repository.loadCurrent !== "function" ||
    typeof repository.compareAndSet !== "function"
  ) {
    throw new Error("Privacy export lifecycle repository is invalid.");
  }
  const registered = Object.freeze({
    bootstrap: repository.bootstrap,
    loadCurrent: repository.loadCurrent,
    compareAndSet: repository.compareAndSet
  });
  authenticLifecycleRepositories.add(registered);
  return registered;
}

export function isInboxV2PrivacyExportLifecycleRepository(
  value: unknown
): value is InboxV2PrivacyExportLifecycleRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    authenticLifecycleRepositories.has(value)
  );
}

export async function loadInboxV2PrivacyExportLifecycle(input: {
  repository: InboxV2PrivacyExportLifecycleRepository;
  key: z.input<typeof inboxV2PrivacyExportLifecycleKeySchema>;
}): Promise<InboxV2PrivacyExportLifecycleLoadResult> {
  requireAuthenticRepository(input.repository);
  const key = inboxV2PrivacyExportLifecycleKeySchema.parse(input.key);
  const result = inboxV2PrivacyExportLifecycleLoadResultSchema.parse(
    await input.repository.loadCurrent(key)
  );
  return deepFreeze(result);
}

export async function bootstrapInboxV2PrivacyExportLifecycle(input: {
  repository: InboxV2PrivacyExportLifecycleRepository;
  bootstrap: z.input<typeof inboxV2PrivacyExportLifecycleBootstrapInputSchema>;
}): Promise<InboxV2PrivacyExportLifecycleBootstrapResult> {
  requireAuthenticRepository(input.repository);
  const bootstrap = inboxV2PrivacyExportLifecycleBootstrapInputSchema.parse(
    input.bootstrap
  );
  const result = inboxV2PrivacyExportLifecycleBootstrapResultSchema.parse(
    await input.repository.bootstrap(bootstrap)
  );
  const initial = initialLifecycleSnapshot(bootstrap);
  if (
    result.outcome === "applied" &&
    !sameLifecycleSnapshot(result.current, initial)
  ) {
    throw new Error(
      "Applied export lifecycle bootstrap must return the exact initial snapshot."
    );
  }
  return deepFreeze(result);
}

export async function compareAndSetInboxV2PrivacyExportLifecycle(input: {
  repository: InboxV2PrivacyExportLifecycleRepository;
  mutation: z.input<typeof inboxV2PrivacyExportLifecycleTransitionInputSchema>;
}): Promise<InboxV2PrivacyExportLifecycleTransitionResult> {
  requireAuthenticRepository(input.repository);
  const mutation = inboxV2PrivacyExportLifecycleTransitionInputSchema.parse(
    input.mutation
  );
  const result = inboxV2PrivacyExportLifecycleTransitionResultSchema.parse(
    await input.repository.compareAndSet(mutation)
  );
  if (
    (result.outcome === "applied" || result.outcome === "already_applied") &&
    !sameLifecycleSnapshot(result.current, mutation.candidate)
  ) {
    throw new Error(
      "Applied export lifecycle CAS must return the exact candidate snapshot."
    );
  }
  return deepFreeze(result);
}

function assertLifecycleSnapshotCoherence(
  snapshot: z.infer<typeof inboxV2PrivacyExportLifecycleSnapshotSchema>,
  context: z.RefinementCtx
): void {
  const artifactState = snapshot.artifact?.reference.state;
  const valid =
    (snapshot.state === "queued" &&
      snapshot.manifest === null &&
      snapshot.artifact === null) ||
    (snapshot.state === "running" &&
      snapshot.manifest === null &&
      artifactState === "building") ||
    (snapshot.state === "ready" &&
      snapshot.manifest !== null &&
      artifactState === "ready") ||
    (["revoked", "expired", "failed_retryable"].includes(snapshot.state) &&
      snapshot.artifact !== null &&
      (artifactState === "quarantined" || artifactState === "deleted")) ||
    (snapshot.state === "completed" &&
      snapshot.manifest !== null &&
      artifactState === "deleted");
  if (!valid) {
    addIssue(
      context,
      [],
      "Export job state must bind its exact manifest and safe current artifact state."
    );
  }
}

export function initialInboxV2PrivacyExportLifecycleSnapshot(
  input: z.input<typeof inboxV2PrivacyExportLifecycleBootstrapInputSchema>
): InboxV2PrivacyExportLifecycleSnapshot {
  return deepFreeze(
    initialLifecycleSnapshot(
      inboxV2PrivacyExportLifecycleBootstrapInputSchema.parse(input)
    )
  );
}

function initialLifecycleSnapshot(
  input: InboxV2PrivacyExportLifecycleBootstrapInput
): InboxV2PrivacyExportLifecycleSnapshot {
  return inboxV2PrivacyExportLifecycleSnapshotSchema.parse({
    stateRevision: "1",
    state: "queued",
    manifest: null,
    artifact: null,
    updatedAt: input.createdAt
  });
}

function isLegalJobStateEdge(from: string, to: string): boolean {
  const edges: Readonly<Record<string, readonly string[]>> = {
    queued: ["running"],
    running: ["ready", "revoked", "expired", "failed_retryable"],
    ready: ["completed", "revoked", "expired", "failed_retryable"],
    failed_retryable: ["running", "failed_retryable", "revoked", "expired"],
    revoked: ["revoked"],
    expired: ["expired"],
    completed: []
  };
  return edges[from]?.includes(to) === true;
}

function isLegalArtifactStateEdge(from: string, to: string): boolean {
  const edges: Readonly<Record<string, readonly string[]>> = {
    building: ["ready", "quarantined", "deleted"],
    ready: ["quarantined", "deleted"],
    quarantined: ["deleted"],
    deleted: []
  };
  return edges[from]?.includes(to) === true;
}

function artifactHeadKey(
  value: z.infer<typeof inboxV2PrivacyExportArtifactLifecycleHeadSchema> | null
): string | null {
  return value === null
    ? null
    : [
        value.reference.tenantId,
        value.reference.artifactId,
        value.reference.revision,
        value.reference.state,
        value.artifactClaimKey
      ].join("\u0000");
}

function sameLifecycleSnapshot(
  left: InboxV2PrivacyExportLifecycleSnapshot,
  right: InboxV2PrivacyExportLifecycleSnapshot
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requireAuthenticRepository(
  repository: InboxV2PrivacyExportLifecycleRepository
): void {
  if (!authenticLifecycleRepositories.has(repository)) {
    throw new Error(
      "Privacy export lifecycle requires the registered durable repository."
    );
  }
}

function hasNoControlCharacters(value: string): boolean {
  return [...value].every((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint > 31 && codePoint !== 127;
  });
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child, seen);
  }
  return Object.freeze(value);
}
