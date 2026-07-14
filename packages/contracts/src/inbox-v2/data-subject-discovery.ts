import { z } from "zod";

import type { Brand } from "../brand";
import { inboxV2CatalogIdSchema } from "./catalog";
import {
  isInboxV2DataLifecycleRegistry,
  type InboxV2DataLifecycleRegistry
} from "./data-lifecycle-catalog";
import {
  inboxV2DataClassIdSchema,
  inboxV2ExternalRouteIdSchema,
  inboxV2LifecycleHandlerIdSchema,
  inboxV2StorageRootIdSchema,
  inboxV2VersionedProfileReferenceSchema,
  INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION
} from "./data-lifecycle-primitives";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema
} from "./entity-metadata";
import {
  inboxV2AccountReferenceSchema,
  inboxV2ClientContactReferenceSchema,
  inboxV2EmployeeReferenceSchema,
  inboxV2NormalizedInboundEventReferenceSchema,
  inboxV2RawInboundEventReferenceSchema,
  inboxV2SourceAccountReferenceSchema,
  inboxV2SourceConnectionReferenceSchema,
  inboxV2SourceExternalIdentityReferenceSchema,
  inboxV2TenantIdSchema
} from "./ids";
import { inboxV2SourceIdentityRealmIdSchema } from "./participant-identity";
import {
  createInboxV2SchemaEnvelopeSchema,
  type InboxV2SchemaEnvelope
} from "./schema-version";
import {
  inboxV2PayloadReferenceSchema,
  inboxV2Sha256DigestSchema,
  inboxV2StreamEpochSchema,
  inboxV2SyncGenerationSchema,
  inboxV2TenantStreamPositionSchema
} from "./sync-primitives";
import { calculateInboxV2CanonicalSha256 } from "./recipient-sync-hash";

export const INBOX_V2_SUBJECT_DISCOVERY_MANIFEST_SCHEMA_ID =
  "core:inbox-v2.subject-discovery-manifest" as const;

const opaqueReferencePartPattern = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,199}$/;

function createOpaqueReferenceSchema<TBrand extends string>(prefix: string) {
  return z
    .string()
    .max(prefix.length + 200)
    .refine(
      (value) =>
        value.startsWith(`${prefix}:`) &&
        opaqueReferencePartPattern.test(value.slice(prefix.length + 1)),
      { message: `Reference must use the ${prefix}: prefix.` }
    )
    .transform((value) => value as Brand<string, TBrand>);
}

export type InboxV2UnresolvedProviderSubjectId = Brand<
  string,
  "InboxV2UnresolvedProviderSubjectId"
>;
export type InboxV2DataRootRecordId = Brand<string, "InboxV2DataRootRecordId">;
export type InboxV2DataSubjectLinkId = Brand<
  string,
  "InboxV2DataSubjectLinkId"
>;
export type InboxV2SubjectDiscoveryManifestId = Brand<
  string,
  "InboxV2SubjectDiscoveryManifestId"
>;

export const inboxV2UnresolvedProviderSubjectIdSchema =
  createOpaqueReferenceSchema<"InboxV2UnresolvedProviderSubjectId">(
    "unresolved_provider_subject"
  );
export const inboxV2DataRootRecordIdSchema =
  createOpaqueReferenceSchema<"InboxV2DataRootRecordId">("data_root");
export const inboxV2DataSubjectLinkIdSchema =
  createOpaqueReferenceSchema<"InboxV2DataSubjectLinkId">("subject_link");
export const inboxV2SubjectDiscoveryManifestIdSchema =
  createOpaqueReferenceSchema<"InboxV2SubjectDiscoveryManifestId">(
    "subject_discovery"
  );

export const inboxV2SubjectDiscoveryManifestReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2SubjectDiscoveryManifestIdSchema,
    revision: inboxV2EntityRevisionSchema,
    digest: inboxV2Sha256DigestSchema
  })
  .strict();

export const inboxV2UnresolvedProviderScopeSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("provider") }).strict(),
    z
      .object({
        kind: z.literal("source_connection"),
        owner: inboxV2SourceConnectionReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("source_account"),
        owner: inboxV2SourceAccountReferenceSchema
      })
      .strict()
  ]
);

export const inboxV2KnownDataSubjectReferenceSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("employee"),
        employee: inboxV2EmployeeReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("client_contact"),
        clientContact: inboxV2ClientContactReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("source_external_identity"),
        sourceExternalIdentity: inboxV2SourceExternalIdentityReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("account"),
        account: inboxV2AccountReferenceSchema
      })
      .strict()
  ]
);

export const inboxV2UnresolvedProviderSubjectReferenceSchema = z
  .object({
    kind: z.literal("unresolved_provider_subject"),
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2UnresolvedProviderSubjectIdSchema,
    realmId: inboxV2SourceIdentityRealmIdSchema,
    scope: inboxV2UnresolvedProviderScopeSchema
  })
  .strict()
  .superRefine((subject, context) => {
    if (
      "owner" in subject.scope &&
      subject.scope.owner.tenantId !== subject.tenantId
    ) {
      context.addIssue({
        code: "custom",
        path: ["scope", "owner", "tenantId"],
        message: "Unresolved provider subject scope must belong to its tenant."
      });
    }
  });

export const inboxV2DataSubjectReferenceSchema = z.union([
  inboxV2KnownDataSubjectReferenceSchema,
  inboxV2UnresolvedProviderSubjectReferenceSchema
]);

export const inboxV2DataRootReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    dataClassId: inboxV2DataClassIdSchema,
    storageRootId: inboxV2StorageRootIdSchema,
    recordId: inboxV2DataRootRecordIdSchema
  })
  .strict();

/** Reference only: classified evidence stays behind its own authorization. */
export const inboxV2ClassifiedEvidenceReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    dataClassId: inboxV2DataClassIdSchema,
    storageRootId: inboxV2StorageRootIdSchema,
    payload: inboxV2PayloadReferenceSchema
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.payload.tenantId !== evidence.tenantId) {
      context.addIssue({
        code: "custom",
        path: ["payload", "tenantId"],
        message: "Classified evidence payload must belong to its tenant."
      });
    }
  });

export const inboxV2DataSubjectLinkRoleSchema = z.enum([
  "author",
  "participant",
  "contact",
  "caller",
  "recording_speaker",
  "mentioned_person",
  "crm_subject",
  "owner",
  "security_actor"
]);

export const inboxV2DataSubjectLinkProvenanceSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("canonical_relation"),
        evidence: inboxV2ClassifiedEvidenceReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("source_observation"),
        sourceEvent: z.union([
          inboxV2RawInboundEventReferenceSchema,
          inboxV2NormalizedInboundEventReferenceSchema
        ])
      })
      .strict(),
    z
      .object({
        kind: z.literal("reviewed_candidate"),
        evidence: inboxV2ClassifiedEvidenceReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("migration"),
        evidence: inboxV2ClassifiedEvidenceReferenceSchema
      })
      .strict()
  ]
);

/** Discovery evidence only. This contract intentionally has no authority field. */
export const inboxV2DataSubjectLinkSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2DataSubjectLinkIdSchema,
    root: inboxV2DataRootReferenceSchema,
    subject: inboxV2DataSubjectReferenceSchema,
    role: inboxV2DataSubjectLinkRoleSchema,
    provenance: inboxV2DataSubjectLinkProvenanceSchema,
    revision: inboxV2EntityRevisionSchema,
    createdAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((link, context) => {
    addTenantMismatchIssue(context, link.tenantId, link.root.tenantId, [
      "root",
      "tenantId"
    ]);
    addTenantMismatchIssue(
      context,
      link.tenantId,
      dataSubjectTenantId(link.subject),
      ["subject"]
    );
    addTenantMismatchIssue(
      context,
      link.tenantId,
      provenanceTenantId(link.provenance),
      ["provenance"]
    );
  });

const inboxV2DeterministicCoverageSchema = z
  .object({
    kind: z.literal("deterministic"),
    root: inboxV2DataRootReferenceSchema,
    method: z.enum([
      "structured_subject_link",
      "identity_alias",
      "provider_scoped_identifier"
    ]),
    outcome: z.enum(["matched", "not_found"])
  })
  .strict();

const inboxV2SearchAssistedCoverageSchema = z
  .object({
    kind: z.literal("search_assisted"),
    root: inboxV2DataRootReferenceSchema,
    outcome: z.enum(["candidates_found", "no_candidates", "unavailable"]),
    candidateEvidence: z
      .array(inboxV2ClassifiedEvidenceReferenceSchema)
      .max(1_000)
  })
  .strict();

const inboxV2ManualReviewCoverageSchema = z
  .object({
    kind: z.literal("manual_review"),
    root: inboxV2DataRootReferenceSchema,
    outcome: z.enum([
      "required",
      "confirmed_match",
      "confirmed_no_match",
      "unavailable"
    ]),
    evidence: z.array(inboxV2ClassifiedEvidenceReferenceSchema).max(1_000)
  })
  .strict();

const inboxV2ExternalCoverageSchema = z
  .object({
    kind: z.literal("external"),
    root: inboxV2DataRootReferenceSchema,
    routeId: inboxV2ExternalRouteIdSchema,
    outcome: z.enum(["covered", "unsupported", "unknown", "failed_retryable"]),
    evidence: z.array(inboxV2ClassifiedEvidenceReferenceSchema).max(1_000)
  })
  .strict();

export const inboxV2SubjectDiscoveryCoverageEntrySchema = z.discriminatedUnion(
  "kind",
  [
    inboxV2DeterministicCoverageSchema,
    inboxV2SearchAssistedCoverageSchema,
    inboxV2ManualReviewCoverageSchema,
    inboxV2ExternalCoverageSchema
  ]
);

export const inboxV2ThirdPartyProtectionSchema = z
  .object({
    kind: z.literal("redact_or_omit"),
    status: z.enum(["review_required", "redacted", "omitted"]),
    policyProfile: inboxV2VersionedProfileReferenceSchema,
    reasonCode: inboxV2CatalogIdSchema
  })
  .strict();

export const inboxV2DiscoveredRootAssessmentSchema = z
  .object({
    root: inboxV2DataRootReferenceSchema,
    subjects: z.array(inboxV2DataSubjectReferenceSchema).max(10_000),
    relationshipToRequester: z.enum([
      "requester_only",
      "third_party_only",
      "mixed",
      "unresolved"
    ]),
    thirdPartyProtection: inboxV2ThirdPartyProtectionSchema.nullable()
  })
  .strict();

export const inboxV2SubjectDiscoveryManifestSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2SubjectDiscoveryManifestIdSchema,
    requesterSubject: inboxV2DataSubjectReferenceSchema,
    discoveredSubjects: z
      .array(inboxV2DataSubjectReferenceSchema)
      .min(1)
      .max(10_000),
    subjectLinks: z.array(inboxV2DataSubjectLinkSchema).max(100_000),
    roots: z.array(inboxV2DiscoveredRootAssessmentSchema).max(100_000),
    coverage: z.array(inboxV2SubjectDiscoveryCoverageEntrySchema).max(400_000),
    revision: inboxV2EntityRevisionSchema,
    digest: inboxV2Sha256DigestSchema,
    generatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((manifest, context) => {
    const requesterKey = dataSubjectReferenceKey(manifest.requesterSubject);
    const subjectKeys = manifest.discoveredSubjects.map(
      dataSubjectReferenceKey
    );
    const rootKeys = manifest.roots.map((entry) =>
      dataRootReferenceKey(entry.root)
    );
    const linkKeys = manifest.subjectLinks.map((link) => String(link.id));
    const coverageKeys = manifest.coverage.map(discoveryCoverageKey);

    addTenantMismatchIssue(
      context,
      manifest.tenantId,
      dataSubjectTenantId(manifest.requesterSubject),
      ["requesterSubject"]
    );
    requireStrictlySortedUnique(context, subjectKeys, ["discoveredSubjects"]);
    requireStrictlySortedUnique(context, rootKeys, ["roots"]);
    requireStrictlySortedUnique(context, linkKeys, ["subjectLinks"]);
    requireStrictlySortedUnique(context, coverageKeys, ["coverage"]);

    if (!subjectKeys.includes(requesterKey)) {
      context.addIssue({
        code: "custom",
        path: ["discoveredSubjects"],
        message: "Discovery manifest must include its requester subject."
      });
    }

    const declaredSubjects = new Set(subjectKeys);
    const declaredRoots = new Set(rootKeys);

    for (const [index, subject] of manifest.discoveredSubjects.entries()) {
      addTenantMismatchIssue(
        context,
        manifest.tenantId,
        dataSubjectTenantId(subject),
        ["discoveredSubjects", index]
      );
    }

    for (const [index, rootAssessment] of manifest.roots.entries()) {
      addTenantMismatchIssue(
        context,
        manifest.tenantId,
        rootAssessment.root.tenantId,
        ["roots", index, "root", "tenantId"]
      );
      const assessmentSubjectKeys = rootAssessment.subjects.map(
        dataSubjectReferenceKey
      );
      requireStrictlySortedUnique(context, assessmentSubjectKeys, [
        "roots",
        index,
        "subjects"
      ]);
      for (const subjectKey of assessmentSubjectKeys) {
        if (!declaredSubjects.has(subjectKey)) {
          context.addIssue({
            code: "custom",
            path: ["roots", index, "subjects"],
            message: "Root subject must be declared by the discovery manifest."
          });
        }
      }
      validateRootRelationship(
        context,
        rootAssessment,
        assessmentSubjectKeys,
        requesterKey,
        index
      );
    }

    for (const [index, link] of manifest.subjectLinks.entries()) {
      if (
        !declaredRoots.has(dataRootReferenceKey(link.root)) ||
        !declaredSubjects.has(dataSubjectReferenceKey(link.subject))
      ) {
        context.addIssue({
          code: "custom",
          path: ["subjectLinks", index],
          message: "Subject link must reference a declared root and subject."
        });
      }
    }

    for (const [index, coverage] of manifest.coverage.entries()) {
      addTenantMismatchIssue(
        context,
        manifest.tenantId,
        coverage.root.tenantId,
        ["coverage", index, "root", "tenantId"]
      );
      if (!declaredRoots.has(dataRootReferenceKey(coverage.root))) {
        context.addIssue({
          code: "custom",
          path: ["coverage", index, "root"],
          message: "Discovery coverage must reference a declared root."
        });
      }
      for (const evidence of coverageEvidence(coverage)) {
        addTenantMismatchIssue(context, manifest.tenantId, evidence.tenantId, [
          "coverage",
          index
        ]);
      }
    }

    const coveredRoots = new Set(
      manifest.coverage.map((entry) => dataRootReferenceKey(entry.root))
    );
    for (const [index, root] of manifest.roots.entries()) {
      if (!coveredRoots.has(dataRootReferenceKey(root.root))) {
        context.addIssue({
          code: "custom",
          path: ["roots", index],
          message:
            "Every discovered root requires an explicit coverage outcome."
        });
      }
    }

    const { digest, ...body } = manifest;
    if (digest !== calculateSubjectDiscoveryManifestDigest(body)) {
      context.addIssue({
        code: "custom",
        path: ["digest"],
        message:
          "Discovery manifest digest must match its canonical complete scope."
      });
    }
  });

export const inboxV2SubjectDiscoveryManifestEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SUBJECT_DISCOVERY_MANIFEST_SCHEMA_ID,
    INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION,
    inboxV2SubjectDiscoveryManifestSchema
  );

export type InboxV2DataSubjectReference = z.infer<
  typeof inboxV2DataSubjectReferenceSchema
>;
export type InboxV2DataRootReference = z.infer<
  typeof inboxV2DataRootReferenceSchema
>;
export type InboxV2ClassifiedEvidenceReference = z.infer<
  typeof inboxV2ClassifiedEvidenceReferenceSchema
>;
export type InboxV2DataSubjectLink = z.infer<
  typeof inboxV2DataSubjectLinkSchema
>;
export type InboxV2SubjectDiscoveryCoverageEntry = z.infer<
  typeof inboxV2SubjectDiscoveryCoverageEntrySchema
>;
export type InboxV2SubjectDiscoveryManifest = z.infer<
  typeof inboxV2SubjectDiscoveryManifestSchema
>;
export type InboxV2SubjectDiscoveryManifestReference = z.infer<
  typeof inboxV2SubjectDiscoveryManifestReferenceSchema
>;
export type InboxV2SubjectDiscoveryManifestEnvelope = InboxV2SchemaEnvelope<
  typeof INBOX_V2_SUBJECT_DISCOVERY_MANIFEST_SCHEMA_ID,
  typeof INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION,
  InboxV2SubjectDiscoveryManifest
>;

const {
  digest: _subjectDiscoveryDigestField,
  ...subjectDiscoveryManifestBodyShape
} = inboxV2SubjectDiscoveryManifestSchema.shape;
const inboxV2SubjectDiscoveryManifestBodySchema = z
  .object(subjectDiscoveryManifestBodyShape)
  .strict();
export const inboxV2SubjectDiscoverySourceResultSchema =
  inboxV2SubjectDiscoveryManifestBodySchema
    .extend({
      streamEpoch: inboxV2StreamEpochSchema,
      syncGeneration: inboxV2SyncGenerationSchema,
      completeThroughPosition: inboxV2TenantStreamPositionSchema,
      scannedDiscoveryHandlerIds: z
        .array(inboxV2LifecycleHandlerIdSchema)
        .max(100_000)
    })
    .strict();

export const inboxV2SubjectDiscoveryCompletenessProofSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    manifest: inboxV2SubjectDiscoveryManifestReferenceSchema,
    source: inboxV2VersionedProfileReferenceSchema,
    registryCompositionHash: inboxV2Sha256DigestSchema,
    streamEpoch: inboxV2StreamEpochSchema,
    syncGeneration: inboxV2SyncGenerationSchema,
    completeThroughPosition: inboxV2TenantStreamPositionSchema,
    scannedDiscoveryHandlerIds: z
      .array(inboxV2LifecycleHandlerIdSchema)
      .max(100_000),
    resultKind: z.enum(["complete_nonempty", "complete_zero"]),
    rootCount: z.number().int().nonnegative().max(100_000),
    rootSetHash: inboxV2Sha256DigestSchema,
    subjectSetHash: inboxV2Sha256DigestSchema,
    linkSetHash: inboxV2Sha256DigestSchema,
    coverageSetHash: inboxV2Sha256DigestSchema,
    zeroEvidenceHash: inboxV2Sha256DigestSchema.nullable(),
    proofHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((proof, context) => {
    const validZero =
      proof.resultKind === "complete_zero" &&
      proof.rootCount === 0 &&
      proof.zeroEvidenceHash !== null;
    const validNonempty =
      proof.resultKind === "complete_nonempty" &&
      proof.rootCount > 0 &&
      proof.zeroEvidenceHash === null;
    if (!validZero && !validNonempty) {
      context.addIssue({
        code: "custom",
        path: ["resultKind"],
        message:
          "Discovery result kind must match its root count and zero evidence."
      });
    }
    if (
      !isStrictlySortedUniqueStrings(
        proof.scannedDiscoveryHandlerIds.map(String)
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["scannedDiscoveryHandlerIds"],
        message: "Discovery handler IDs must be strictly sorted and unique."
      });
    }
    const { proofHash, ...body } = proof;
    if (
      proofHash !== calculateInboxV2SubjectDiscoveryCompletenessProofHash(body)
    ) {
      context.addIssue({
        code: "custom",
        path: ["proofHash"],
        message: "Discovery completeness proof hash must match every fence."
      });
    }
  });

export type InboxV2SubjectDiscoverySourceResult = z.infer<
  typeof inboxV2SubjectDiscoverySourceResultSchema
>;
export type InboxV2SubjectDiscoveryCompletenessProof = z.infer<
  typeof inboxV2SubjectDiscoveryCompletenessProofSchema
>;
export type InboxV2SubjectDiscoverySource = Readonly<{
  id: string;
  version: string;
  loadCompleteDiscovery: (
    input: Readonly<{
      tenantId: string;
      requesterSubject: InboxV2DataSubjectReference;
      registryCompositionHash: string;
    }>
  ) => z.input<typeof inboxV2SubjectDiscoverySourceResultSchema>;
}>;

const definedInboxV2SubjectDiscoveryManifests = new WeakSet<object>();
const definedInboxV2SubjectDiscoverySources = new WeakSet<object>();
const subjectDiscoveryCompletenessProofs = new WeakMap<
  object,
  InboxV2SubjectDiscoveryCompletenessProof
>();

export function calculateInboxV2SubjectDiscoveryManifestDigest(
  input: Omit<
    z.input<typeof inboxV2SubjectDiscoveryManifestSchema>,
    "digest"
  > & { digest?: unknown }
) {
  const { digest: _ignored, ...candidate } = input;
  const body = inboxV2SubjectDiscoveryManifestBodySchema.parse(candidate);
  return calculateSubjectDiscoveryManifestDigest(body);
}

export function calculateInboxV2SubjectDiscoveryCompletenessProofHash(input: {
  proofHash?: unknown;
  [key: string]: unknown;
}) {
  const { proofHash: _ignored, ...proof } = input;
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.subject-discovery-completeness-proof",
    hashVersion: "v1",
    proof
  });
}

/** Registers the server-owned adapter that enumerates the complete subject scope. */
export function defineInboxV2SubjectDiscoverySource(input: {
  id: string;
  version: string;
  loadCompleteDiscovery: InboxV2SubjectDiscoverySource["loadCompleteDiscovery"];
}): InboxV2SubjectDiscoverySource {
  const reference = inboxV2VersionedProfileReferenceSchema.parse({
    id: input.id,
    version: input.version
  });
  const source = Object.freeze({
    ...reference,
    loadCompleteDiscovery: input.loadCompleteDiscovery
  });
  definedInboxV2SubjectDiscoverySources.add(source);
  return source;
}

/**
 * Resolves executable discovery authority through a registered complete-state
 * adapter and binds it to the exact lifecycle registry and stream high-water.
 */
export function resolveInboxV2SubjectDiscoveryManifest(input: {
  source: InboxV2SubjectDiscoverySource;
  registry: InboxV2DataLifecycleRegistry;
  tenantId: string;
  requesterSubject: z.input<typeof inboxV2DataSubjectReferenceSchema>;
}): InboxV2SubjectDiscoveryManifest {
  if (
    !definedInboxV2SubjectDiscoverySources.has(input.source) ||
    !isInboxV2DataLifecycleRegistry(input.registry)
  ) {
    throw new Error(
      "Subject discovery requires a registered complete-state source and authentic registry."
    );
  }
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const requesterSubject = inboxV2DataSubjectReferenceSchema.parse(
    input.requesterSubject
  );
  if (dataSubjectTenantId(requesterSubject) !== tenantId) {
    throw new Error("Subject discovery requester crosses the tenant boundary.");
  }
  const result = inboxV2SubjectDiscoverySourceResultSchema.parse(
    input.source.loadCompleteDiscovery({
      tenantId,
      requesterSubject,
      registryCompositionHash: String(input.registry.compositionHash)
    })
  );
  if (
    result.tenantId !== tenantId ||
    dataSubjectReferenceKey(result.requesterSubject) !==
      dataSubjectReferenceKey(requesterSubject)
  ) {
    throw new Error(
      "Subject discovery source returned a different tenant or requester."
    );
  }

  const expectedHandlerIds = canonicalSortedUniqueStrings(
    input.registry.dataUses.flatMap((use) =>
      use.subjectDiscoveryHandlerId === null
        ? []
        : [String(use.subjectDiscoveryHandlerId)]
    )
  );
  const scannedHandlerIds = result.scannedDiscoveryHandlerIds.map(String);
  if (
    !isStrictlySortedUniqueStrings(scannedHandlerIds) ||
    !sameCanonicalStringSet(scannedHandlerIds, expectedHandlerIds)
  ) {
    throw new Error(
      "Subject discovery source did not scan the exact registered discovery-handler set."
    );
  }
  for (const assessment of result.roots) {
    const hasRegisteredLineage = input.registry.dataUses.some(
      (use) =>
        use.dataClassId === assessment.root.dataClassId &&
        use.storageRootId === assessment.root.storageRootId &&
        use.subjectDiscoveryHandlerId !== null &&
        scannedHandlerIds.includes(String(use.subjectDiscoveryHandlerId))
    );
    if (!hasRegisteredLineage) {
      throw new Error(
        `Discovered root ${dataRootReferenceKey(assessment.root)} has no registered subject-discovery lineage.`
      );
    }
  }

  const {
    streamEpoch,
    syncGeneration,
    completeThroughPosition,
    scannedDiscoveryHandlerIds: _scannedDiscoveryHandlerIds,
    ...manifestBody
  } = result;
  const manifest = deepFreezeDiscoveryValue(
    inboxV2SubjectDiscoveryManifestSchema.parse({
      ...manifestBody,
      digest: calculateSubjectDiscoveryManifestDigest(manifestBody)
    })
  );
  const rootKeys = manifest.roots.map(({ root }) => dataRootReferenceKey(root));
  const manifestReference = {
    tenantId: manifest.tenantId,
    id: manifest.id,
    revision: manifest.revision,
    digest: manifest.digest
  };
  const proofBody = {
    tenantId,
    manifest: manifestReference,
    source: { id: input.source.id, version: input.source.version },
    registryCompositionHash: input.registry.compositionHash,
    streamEpoch,
    syncGeneration,
    completeThroughPosition,
    scannedDiscoveryHandlerIds: result.scannedDiscoveryHandlerIds,
    resultKind:
      rootKeys.length === 0
        ? ("complete_zero" as const)
        : ("complete_nonempty" as const),
    rootCount: rootKeys.length,
    rootSetHash: calculateDiscoverySetHash("root", rootKeys),
    subjectSetHash: calculateDiscoverySetHash(
      "subject",
      manifest.discoveredSubjects.map(dataSubjectReferenceKey)
    ),
    linkSetHash: calculateDiscoverySetHash(
      "link",
      manifest.subjectLinks.map(({ id }) => String(id))
    ),
    coverageSetHash: calculateDiscoverySetHash(
      "coverage",
      manifest.coverage.map(discoveryCoverageKey)
    ),
    zeroEvidenceHash:
      rootKeys.length === 0
        ? calculateInboxV2CanonicalSha256({
            domain: "core:inbox-v2.subject-discovery-zero-evidence",
            hashVersion: "v1",
            tenantId,
            requesterSubject: dataSubjectReferenceKey(requesterSubject),
            registryCompositionHash: input.registry.compositionHash,
            source: { id: input.source.id, version: input.source.version },
            streamEpoch,
            syncGeneration,
            completeThroughPosition,
            scannedDiscoveryHandlerIds: result.scannedDiscoveryHandlerIds
          })
        : null
  };
  const proof = deepFreezeDiscoveryValue(
    inboxV2SubjectDiscoveryCompletenessProofSchema.parse({
      ...proofBody,
      proofHash:
        calculateInboxV2SubjectDiscoveryCompletenessProofHash(proofBody)
    })
  );
  definedInboxV2SubjectDiscoveryManifests.add(manifest);
  subjectDiscoveryCompletenessProofs.set(manifest, proof);
  return manifest;
}

export function getInboxV2SubjectDiscoveryCompletenessProof(
  manifest: unknown
): InboxV2SubjectDiscoveryCompletenessProof | null {
  return typeof manifest === "object" && manifest !== null
    ? (subjectDiscoveryCompletenessProofs.get(manifest) ?? null)
    : null;
}

/**
 * Canonicalizes a wire/storage manifest. It deliberately does not grant
 * executable discovery authority; use `resolveInboxV2SubjectDiscoveryManifest`
 * with a registered complete-state source for that.
 */
export function defineInboxV2SubjectDiscoveryManifest(
  input: Omit<
    z.input<typeof inboxV2SubjectDiscoveryManifestSchema>,
    "digest"
  > & { digest?: unknown }
): InboxV2SubjectDiscoveryManifest {
  const { digest: _ignored, ...candidate } = input;
  const body = inboxV2SubjectDiscoveryManifestBodySchema.parse(candidate);
  const manifest = inboxV2SubjectDiscoveryManifestSchema.parse({
    ...body,
    digest: calculateSubjectDiscoveryManifestDigest(body)
  });
  const immutableManifest = deepFreezeDiscoveryValue(manifest);
  return immutableManifest;
}

/** Frozen caller-authored lookalikes are not executable discovery authority. */
export function isInboxV2SubjectDiscoveryManifest(
  value: unknown
): value is InboxV2SubjectDiscoveryManifest {
  return (
    typeof value === "object" &&
    value !== null &&
    definedInboxV2SubjectDiscoveryManifests.has(value)
  );
}

export function matchesInboxV2SubjectDiscoveryManifestReference(input: {
  manifest: z.input<typeof inboxV2SubjectDiscoveryManifestSchema>;
  reference: z.input<typeof inboxV2SubjectDiscoveryManifestReferenceSchema>;
}): boolean {
  const manifest = inboxV2SubjectDiscoveryManifestSchema.safeParse(
    input.manifest
  );
  const reference = inboxV2SubjectDiscoveryManifestReferenceSchema.safeParse(
    input.reference
  );
  return (
    manifest.success &&
    reference.success &&
    manifest.data.tenantId === reference.data.tenantId &&
    manifest.data.id === reference.data.id &&
    manifest.data.revision === reference.data.revision &&
    manifest.data.digest === reference.data.digest
  );
}

export function dataSubjectReferenceKey(
  subject: InboxV2DataSubjectReference
): string {
  switch (subject.kind) {
    case "employee":
      return `${subject.employee.tenantId}\u0000employee\u0000${subject.employee.id}`;
    case "client_contact":
      return `${subject.clientContact.tenantId}\u0000client_contact\u0000${subject.clientContact.id}`;
    case "source_external_identity":
      return `${subject.sourceExternalIdentity.tenantId}\u0000source_external_identity\u0000${subject.sourceExternalIdentity.id}`;
    case "account":
      return `${subject.account.tenantId}\u0000account\u0000${subject.account.id}`;
    case "unresolved_provider_subject":
      return `${subject.tenantId}\u0000unresolved_provider_subject\u0000${subject.realmId}\u0000${unresolvedScopeKey(subject.scope)}\u0000${subject.id}`;
  }
}

export function dataRootReferenceKey(root: InboxV2DataRootReference): string {
  return `${root.tenantId}\u0000${root.dataClassId}\u0000${root.storageRootId}\u0000${root.recordId}`;
}

function dataSubjectTenantId(subject: InboxV2DataSubjectReference): string {
  switch (subject.kind) {
    case "employee":
      return subject.employee.tenantId;
    case "client_contact":
      return subject.clientContact.tenantId;
    case "source_external_identity":
      return subject.sourceExternalIdentity.tenantId;
    case "account":
      return subject.account.tenantId;
    case "unresolved_provider_subject":
      return subject.tenantId;
  }
}

function provenanceTenantId(
  provenance: z.infer<typeof inboxV2DataSubjectLinkProvenanceSchema>
): string {
  return provenance.kind === "source_observation"
    ? provenance.sourceEvent.tenantId
    : provenance.evidence.tenantId;
}

function unresolvedScopeKey(
  scope: z.infer<typeof inboxV2UnresolvedProviderScopeSchema>
): string {
  return "owner" in scope ? `${scope.kind}:${scope.owner.id}` : scope.kind;
}

function discoveryCoverageKey(
  coverage: InboxV2SubjectDiscoveryCoverageEntry
): string {
  const qualifier =
    coverage.kind === "external"
      ? coverage.routeId
      : coverage.kind === "deterministic"
        ? coverage.method
        : "single";
  return `${dataRootReferenceKey(coverage.root)}\u0000${coverage.kind}\u0000${qualifier}`;
}

function coverageEvidence(
  coverage: InboxV2SubjectDiscoveryCoverageEntry
): readonly InboxV2ClassifiedEvidenceReference[] {
  switch (coverage.kind) {
    case "deterministic":
      return [];
    case "search_assisted":
      return coverage.candidateEvidence;
    case "manual_review":
    case "external":
      return coverage.evidence;
  }
}

function calculateSubjectDiscoveryManifestDigest(body: unknown) {
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.subject-discovery-manifest",
    hashVersion: "v1",
    manifest: body
  });
}

function calculateDiscoverySetHash(kind: string, keys: readonly string[]) {
  return calculateInboxV2CanonicalSha256({
    domain: `core:inbox-v2.subject-discovery-${kind}-set`,
    hashVersion: "v1",
    keys
  });
}

function canonicalSortedUniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function isStrictlySortedUniqueStrings(values: readonly string[]): boolean {
  return values.every(
    (value, index) => index === 0 || values[index - 1]! < value
  );
}

function sameCanonicalStringSet(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function deepFreezeDiscoveryValue<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreezeDiscoveryValue(child);
  }
  return Object.freeze(value);
}

function validateRootRelationship(
  context: z.RefinementCtx,
  assessment: z.infer<typeof inboxV2DiscoveredRootAssessmentSchema>,
  subjectKeys: readonly string[],
  requesterKey: string,
  index: number
): void {
  const hasRequester = subjectKeys.includes(requesterKey);
  const hasThirdParty = subjectKeys.some((key) => key !== requesterKey);
  const protectionRequired =
    assessment.relationshipToRequester === "third_party_only" ||
    assessment.relationshipToRequester === "mixed";

  const validRelationship =
    (assessment.relationshipToRequester === "requester_only" &&
      hasRequester &&
      !hasThirdParty) ||
    (assessment.relationshipToRequester === "third_party_only" &&
      !hasRequester &&
      hasThirdParty) ||
    (assessment.relationshipToRequester === "mixed" &&
      hasRequester &&
      hasThirdParty) ||
    (assessment.relationshipToRequester === "unresolved" &&
      subjectKeys.length === 0);

  if (!validRelationship) {
    context.addIssue({
      code: "custom",
      path: ["roots", index, "relationshipToRequester"],
      message:
        "Root relationship must match its requester and third-party subjects."
    });
  }

  if (
    (protectionRequired && assessment.thirdPartyProtection === null) ||
    (!protectionRequired && assessment.thirdPartyProtection !== null)
  ) {
    context.addIssue({
      code: "custom",
      path: ["roots", index, "thirdPartyProtection"],
      message:
        "Mixed and third-party roots require protection; requester-only and unresolved roots do not."
    });
  }
}

function requireStrictlySortedUnique(
  context: z.RefinementCtx,
  values: readonly string[],
  path: PropertyKey[]
): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) {
      context.addIssue({
        code: "custom",
        path,
        message: "Entries must be strictly sorted and unique by canonical key."
      });
      return;
    }
  }
}

function addTenantMismatchIssue(
  context: z.RefinementCtx,
  tenantId: string,
  referencedTenantId: string,
  path: PropertyKey[]
): void {
  if (tenantId !== referencedTenantId) {
    context.addIssue({
      code: "custom",
      path,
      message: "Referenced discovery data must belong to the same tenant."
    });
  }
}
