import { z } from "zod";

import type { Brand } from "../brand";
import { inboxV2CatalogIdSchema } from "./catalog";
import { inboxV2DataGovernanceContextReferenceSchema } from "./data-governance";
import {
  isInboxV2DataLifecycleRegistry,
  type InboxV2DataLifecycleRegistry
} from "./data-lifecycle-catalog";
import { inboxV2DataLifecyclePolicyReferenceSchema } from "./data-lifecycle-policy";
import {
  inboxV2DataClassIdSchema,
  inboxV2DataExportBehaviorSchema,
  inboxV2DataSensitivitySchema,
  inboxV2ExternalRouteIdSchema,
  inboxV2LifecycleHandlerIdSchema,
  inboxV2ProcessingPurposeIdSchema,
  inboxV2StorageRootIdSchema,
  inboxV2VersionedProfileReferenceSchema,
  INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION
} from "./data-lifecycle-primitives";
import {
  dataRootReferenceKey,
  dataSubjectReferenceKey,
  inboxV2DataRootReferenceSchema,
  inboxV2DataSubjectReferenceSchema,
  inboxV2SubjectDiscoveryManifestReferenceSchema
} from "./data-subject-discovery";
import {
  assertInboxV2TenantTerminationScopeCurrentAuthority,
  inboxV2TenantTerminationExportRoots,
  inboxV2TenantTerminationScopeManifestReferenceSchema,
  isInboxV2TenantTerminationScopeManifest,
  matchesInboxV2TenantTerminationScopeReference,
  type InboxV2TenantTerminationScopeManifest
} from "./tenant-termination-scope";
import {
  inboxV2BigintCounterSchema,
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import { inboxV2TenantIdSchema } from "./ids";
import {
  inboxV2PrivacyDecisionIdSchema,
  inboxV2PrivacyIdentityVerificationSchema,
  inboxV2PrivacyRequestDecisionSchema,
  inboxV2PrivacyRequestReferenceSchema,
  isInboxV2PrivacyRequest,
  type InboxV2PrivacyRequest
} from "./privacy-request";
import { inboxV2ProcessingRestrictionReferenceSchema } from "./privacy-hold-restriction";
import {
  assertInboxV2PrivacyTerminalExportCurrent,
  registerInboxV2PrivacyTerminalExportAuthenticity
} from "./privacy-authenticity";
import {
  createInboxV2SchemaEnvelopeSchema,
  inboxV2SchemaIdSchema,
  inboxV2SchemaVersionTokenSchema
} from "./schema-version";
import {
  inboxV2AuthorizationDecisionReferenceSchema,
  inboxV2PayloadReferenceSchema,
  inboxV2Sha256DigestSchema,
  inboxV2SnapshotIdSchema,
  inboxV2StreamEpochSchema,
  inboxV2SyncGenerationSchema,
  inboxV2TenantStreamPositionSchema
} from "./sync-primitives";
import { calculateInboxV2CanonicalSha256 } from "./recipient-sync-hash";

export const INBOX_V2_PRIVACY_EXPORT_JOB_SCHEMA_ID =
  "core:inbox-v2.privacy-export-job" as const;
export const INBOX_V2_PRIVACY_EXPORT_MANIFEST_SCHEMA_ID =
  "core:inbox-v2.privacy-export-manifest" as const;
export const INBOX_V2_PRIVACY_EXPORT_ARTIFACT_SCHEMA_ID =
  "core:inbox-v2.privacy-export-artifact" as const;
export const INBOX_V2_PRIVACY_EXPORT_DOWNLOAD_RECEIPT_SCHEMA_ID =
  "core:inbox-v2.privacy-export-download-receipt" as const;

export type InboxV2PrivacyExportJobId = Brand<
  string,
  "InboxV2PrivacyExportJobId"
>;
export type InboxV2PrivacyExportManifestId = Brand<
  string,
  "InboxV2PrivacyExportManifestId"
>;
export type InboxV2PrivacyExportArtifactId = Brand<
  string,
  "InboxV2PrivacyExportArtifactId"
>;
export type InboxV2PrivacyExportDownloadReceiptId = Brand<
  string,
  "InboxV2PrivacyExportDownloadReceiptId"
>;

const privacyExportOpaqueIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~:-]*$/u);

export const inboxV2PrivacyExportJobIdSchema =
  privacyExportOpaqueIdSchema.transform(
    (value) => value as InboxV2PrivacyExportJobId
  );
export const inboxV2PrivacyExportManifestIdSchema =
  privacyExportOpaqueIdSchema.transform(
    (value) => value as InboxV2PrivacyExportManifestId
  );
export const inboxV2PrivacyExportArtifactIdSchema =
  privacyExportOpaqueIdSchema.transform(
    (value) => value as InboxV2PrivacyExportArtifactId
  );
export const inboxV2PrivacyExportDownloadReceiptIdSchema =
  privacyExportOpaqueIdSchema.transform(
    (value) => value as InboxV2PrivacyExportDownloadReceiptId
  );

export const inboxV2PrivacyExportJobReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    jobId: inboxV2PrivacyExportJobIdSchema,
    revision: inboxV2EntityRevisionSchema,
    requestedAt: inboxV2TimestampSchema
  })
  .strict();

export const inboxV2PrivacyExportManifestReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    manifestId: inboxV2PrivacyExportManifestIdSchema,
    revision: inboxV2EntityRevisionSchema,
    manifestHash: inboxV2Sha256DigestSchema
  })
  .strict();

export const inboxV2PrivacyExportArtifactReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    artifactId: inboxV2PrivacyExportArtifactIdSchema,
    revision: inboxV2EntityRevisionSchema,
    state: z.enum(["building", "ready", "quarantined", "deleted"])
  })
  .strict();

export const inboxV2PrivacyExportReportDefinitionReferenceSchema = z
  .object({
    id: inboxV2CatalogIdSchema,
    revision: inboxV2EntityRevisionSchema,
    digest: inboxV2Sha256DigestSchema
  })
  .strict();

export const inboxV2PrivacyExportReportScopeReferenceSchema = z
  .object({
    id: inboxV2CatalogIdSchema,
    revision: inboxV2EntityRevisionSchema,
    accessLevel: z.enum(["aggregate", "drilldown", "pii"]),
    scopeHash: inboxV2Sha256DigestSchema
  })
  .strict();

export const inboxV2PrivacyExportDecisionReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    decisionId: inboxV2PrivacyDecisionIdSchema,
    revision: inboxV2EntityRevisionSchema,
    digest: inboxV2Sha256DigestSchema
  })
  .strict();

export const inboxV2PrivacyExportProductSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("tenant_deployment"),
      tenantScope: inboxV2TenantTerminationScopeManifestReferenceSchema,
      scopeProofHash: inboxV2Sha256DigestSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("manager_report"),
      reportDefinition: inboxV2PrivacyExportReportDefinitionReferenceSchema,
      reportScope: inboxV2PrivacyExportReportScopeReferenceSchema,
      scopeProofHash: inboxV2Sha256DigestSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("data_subject"),
      intent: z.enum(["access", "portability"]),
      request: inboxV2PrivacyRequestReferenceSchema,
      discovery: inboxV2SubjectDiscoveryManifestReferenceSchema,
      decision: inboxV2PrivacyExportDecisionReferenceSchema,
      scopeProofHash: inboxV2Sha256DigestSchema
    })
    .strict()
]);

export const inboxV2PrivacyExportFormatSchema = z
  .object({
    kind: z.enum(["json", "csv", "encrypted_archive"]),
    schemaId: inboxV2SchemaIdSchema,
    schemaVersion: inboxV2SchemaVersionTokenSchema
  })
  .strict();

export const inboxV2PrivacyExportProjectionProfileReferenceSchema = z
  .object({
    id: inboxV2CatalogIdSchema,
    revision: inboxV2EntityRevisionSchema,
    digest: inboxV2Sha256DigestSchema
  })
  .strict();

export const inboxV2PrivacyExportProjectionFieldSchema = z
  .object({
    fieldId: inboxV2CatalogIdSchema,
    dataClassId: inboxV2DataClassIdSchema
  })
  .strict();

export const inboxV2PrivacyExportProjectionProfileSchema = z
  .object({
    reference: inboxV2PrivacyExportProjectionProfileReferenceSchema,
    productKind: z.enum([
      "tenant_deployment",
      "manager_report",
      "data_subject"
    ]),
    formats: z.array(inboxV2PrivacyExportFormatSchema).min(1).max(32),
    fields: z
      .array(inboxV2PrivacyExportProjectionFieldSchema)
      .min(1)
      .max(4_096),
    projectionHandlerIds: z
      .array(inboxV2LifecycleHandlerIdSchema)
      .min(1)
      .max(512)
  })
  .strict()
  .superRefine((profile, context) => {
    addCanonicalUniqueIssue(
      context,
      profile.formats.map(exportFormatKey),
      ["formats"],
      "Projection formats"
    );
    addCanonicalUniqueIssue(
      context,
      profile.fields.map(
        ({ dataClassId, fieldId }) => `${dataClassId}\u0000${fieldId}`
      ),
      ["fields"],
      "Projection fields"
    );
    addCanonicalUniqueIssue(
      context,
      profile.projectionHandlerIds,
      ["projectionHandlerIds"],
      "Projection handlers"
    );
    if (
      profile.reference.digest !==
      calculateInboxV2PrivacyExportProjectionProfileDigest(profile)
    ) {
      addIssue(
        context,
        ["reference", "digest"],
        "Projection profile digest must match its canonical registered fields, product, formats and handlers."
      );
    }
  });

export const inboxV2PrivacyExportProjectionCatalogSchema = z
  .object({
    id: inboxV2CatalogIdSchema,
    revision: inboxV2EntityRevisionSchema,
    profiles: z
      .array(inboxV2PrivacyExportProjectionProfileSchema)
      .min(1)
      .max(1_024),
    digest: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((catalog, context) => {
    addCanonicalUniqueIssue(
      context,
      catalog.profiles.map(
        ({ reference }) => `${reference.id}\u0000${reference.revision}`
      ),
      ["profiles"],
      "Projection catalog profiles"
    );
    if (
      catalog.digest !==
      calculateInboxV2PrivacyExportProjectionCatalogDigest(catalog)
    ) {
      addIssue(
        context,
        ["digest"],
        "Projection catalog digest must cover every authoritative profile."
      );
    }
  });

export const inboxV2PrivacyExportClassSelectionSchema = z
  .object({
    dataClassId: inboxV2DataClassIdSchema,
    sensitivity: inboxV2DataSensitivitySchema,
    exportBehavior: inboxV2DataExportBehaviorSchema
  })
  .strict()
  .superRefine((selection, context) => {
    if (
      selection.sensitivity === "secret" ||
      selection.exportBehavior === "never"
    ) {
      addIssue(
        context,
        [],
        "Secrets and never-export data classes cannot enter an export scope."
      );
    }
  });

export const inboxV2PrivacyExportDataUseSelectionSchema = z
  .object({
    dataClassId: inboxV2DataClassIdSchema,
    storageRootId: inboxV2StorageRootIdSchema,
    projectionHandlerId: inboxV2LifecycleHandlerIdSchema,
    exportHandlerId: inboxV2LifecycleHandlerIdSchema
  })
  .strict();

export const inboxV2PrivacyExportScopeSchema = z
  .object({
    purposeId: inboxV2ProcessingPurposeIdSchema,
    classes: z.array(inboxV2PrivacyExportClassSelectionSchema).min(1).max(512),
    dataUses: z
      .array(inboxV2PrivacyExportDataUseSelectionSchema)
      .min(1)
      .max(4_096),
    projectionProfile: inboxV2PrivacyExportProjectionProfileReferenceSchema,
    thirdPartyProtectionProfileId: inboxV2CatalogIdSchema
  })
  .strict()
  .superRefine((scope, context) => {
    addCanonicalUniqueIssue(
      context,
      scope.classes.map(({ dataClassId }) => dataClassId),
      ["classes"],
      "Export data classes"
    );
    addCanonicalUniqueIssue(
      context,
      scope.dataUses.map(
        ({ dataClassId, storageRootId }) =>
          `${dataClassId}\u0000${storageRootId}`
      ),
      ["dataUses"],
      "Export class/root uses"
    );
    const selectedClassIds = new Set(
      scope.classes.map(({ dataClassId }) => String(dataClassId))
    );
    if (
      scope.dataUses.some(
        ({ dataClassId }) => !selectedClassIds.has(String(dataClassId))
      ) ||
      scope.classes.some(
        ({ dataClassId }) =>
          !scope.dataUses.some((use) => use.dataClassId === dataClassId)
      )
    ) {
      addIssue(
        context,
        ["dataUses"],
        "Export data uses must cover exactly the selected data classes."
      );
    }
  });

export const inboxV2PrivacyExportBoundarySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("tenant_stream_high_water"),
      streamEpoch: inboxV2StreamEpochSchema,
      syncGeneration: inboxV2SyncGenerationSchema,
      highWaterPosition: inboxV2TenantStreamPositionSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("authoritative_snapshot"),
      snapshotId: inboxV2SnapshotIdSchema,
      snapshotHash: inboxV2Sha256DigestSchema,
      syncGeneration: inboxV2SyncGenerationSchema,
      highWaterPosition: inboxV2TenantStreamPositionSchema
    })
    .strict()
]);

export const inboxV2PrivacyExportRestrictionCheckpointSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    requestedUse: z.literal("export"),
    restrictions: z.array(inboxV2ProcessingRestrictionReferenceSchema).max(256),
    outcome: z.enum(["allowed", "blocked"]),
    evaluatedAt: inboxV2TimestampSchema,
    decisionHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((checkpoint, context) => {
    addCanonicalUniqueIssue(
      context,
      checkpoint.restrictions.map(
        ({ restrictionId, revision }) => `${restrictionId}\u0000${revision}`
      ),
      ["restrictions"],
      "Export processing restrictions"
    );
    if (
      checkpoint.restrictions.some(
        ({ tenantId }) => tenantId !== checkpoint.tenantId
      )
    ) {
      addIssue(
        context,
        ["restrictions"],
        "Export restriction evaluation cannot cross tenants."
      );
    }
  });

export const inboxV2PrivacyExportAuthorizationCheckpointSchema = z
  .object({
    phase: z.enum(["request", "chunk", "manifest_zero", "download"]),
    chunkOrdinal: inboxV2BigintCounterSchema.nullable(),
    decision: inboxV2AuthorizationDecisionReferenceSchema,
    restriction: inboxV2PrivacyExportRestrictionCheckpointSchema,
    checkedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((checkpoint, context) => {
    if ((checkpoint.phase === "chunk") !== (checkpoint.chunkOrdinal !== null)) {
      addIssue(
        context,
        ["chunkOrdinal"],
        "Only chunk authorization checkpoints carry a chunk ordinal."
      );
    }
    if (
      checkpoint.decision.outcome !== "allowed" ||
      checkpoint.restriction.outcome !== "allowed" ||
      checkpoint.restriction.tenantId !== checkpoint.decision.tenantId ||
      checkpoint.restriction.evaluatedAt !== checkpoint.checkedAt ||
      Date.parse(checkpoint.checkedAt) <
        Date.parse(checkpoint.decision.decidedAt) ||
      (checkpoint.phase !== "request" &&
        checkpoint.decision.decidedAt !== checkpoint.checkedAt) ||
      Date.parse(checkpoint.checkedAt) >=
        Date.parse(checkpoint.decision.notAfter)
    ) {
      addIssue(
        context,
        ["decision"],
        "An export checkpoint requires same-tenant RBAC and processing-restriction allowance."
      );
    }
  });

export const inboxV2PrivacyExportApprovalSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("not_required"),
      reason: z.enum(["verified_data_subject_case", "adr_0013_report_policy"])
    })
    .strict(),
  z
    .object({
      kind: z.literal("separated_approval"),
      authorization: inboxV2AuthorizationDecisionReferenceSchema,
      approvedAt: inboxV2TimestampSchema
    })
    .strict()
]);

export const inboxV2DataSubjectExportScopeProofSchema = z
  .object({
    kind: z.literal("data_subject_scope_proof"),
    tenantId: inboxV2TenantIdSchema,
    job: inboxV2PrivacyExportJobReferenceSchema,
    request: inboxV2PrivacyRequestReferenceSchema,
    requesterSubject: inboxV2DataSubjectReferenceSchema,
    intent: z.enum(["access", "portability"]),
    verification: inboxV2PrivacyIdentityVerificationSchema,
    discovery: inboxV2SubjectDiscoveryManifestReferenceSchema,
    discoveryRoots: z.array(inboxV2DataRootReferenceSchema).max(100_000),
    decisionReference: inboxV2PrivacyExportDecisionReferenceSchema,
    decision: inboxV2PrivacyRequestDecisionSchema,
    approvedRoots: z.array(inboxV2DataRootReferenceSchema).min(1).max(100_000),
    evaluatedAt: inboxV2TimestampSchema,
    proofHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((proof, context) => {
    const tenantIds = [
      proof.job.tenantId,
      proof.request.tenantId,
      privacyExportSubjectTenantId(proof.requesterSubject),
      proof.verification.tenantId,
      proof.discovery.tenantId,
      proof.decisionReference.tenantId,
      proof.decision.tenantId,
      ...proof.discoveryRoots.map((root) => root.tenantId),
      ...proof.approvedRoots.map((root) => root.tenantId)
    ];
    if (tenantIds.some((value) => value !== proof.tenantId)) {
      addIssue(
        context,
        [],
        "Data-subject export scope proof cannot cross tenants."
      );
    }
    addCanonicalUniqueIssue(
      context,
      proof.discoveryRoots.map(dataRootReferenceKey),
      ["discoveryRoots"],
      "Data-subject discovery roots"
    );
    addCanonicalUniqueIssue(
      context,
      proof.approvedRoots.map(dataRootReferenceKey),
      ["approvedRoots"],
      "Data-subject approved roots"
    );
    const decisionRootKeys = proof.decision.rootDecisions.map(({ root }) =>
      dataRootReferenceKey(root)
    );
    const approvedDisposition =
      proof.intent === "access" ? "include_normalized" : "include_portable";
    const expectedApprovedRootKeys = proof.decision.rootDecisions
      .filter(({ disposition }) => disposition === approvedDisposition)
      .map(({ root }) => dataRootReferenceKey(root));
    const approvedPurposeMismatch = proof.decision.rootDecisions.some(
      ({ disposition, purposeIds }) =>
        disposition === approvedDisposition &&
        !purposeIds.some(
          (purposeId) =>
            String(purposeId) === "core:data_subject_request_execution"
        )
    );
    const requesterVerified =
      proof.verification.status === "verified" &&
      proof.verification.verifiedSubjects.some(
        (verifiedSubject) =>
          dataSubjectReferenceKey(verifiedSubject) ===
          dataSubjectReferenceKey(proof.requesterSubject)
      );
    if (
      proof.verification.status !== "verified" ||
      !requesterVerified ||
      !sameCanonicalValues(
        decisionRootKeys,
        proof.discoveryRoots.map(dataRootReferenceKey)
      ) ||
      !sameCanonicalValues(
        expectedApprovedRootKeys,
        proof.approvedRoots.map(dataRootReferenceKey)
      ) ||
      approvedPurposeMismatch ||
      proof.decisionReference.decisionId !== proof.decision.id ||
      proof.decisionReference.revision !== proof.decision.revision ||
      proof.decisionReference.digest !== proof.decision.digest ||
      !["approved", "partially_approved"].includes(proof.decision.result) ||
      Date.parse(proof.evaluatedAt) <
        Date.parse(proof.verification.completedAt) ||
      proof.proofHash !== calculateInboxV2DataSubjectExportScopeProofHash(proof)
    ) {
      addIssue(
        context,
        [],
        "Data-subject export requires verified identity and exact discovery/decision/approved-root coverage."
      );
    }
  });

export const inboxV2ManagerReportAuthorizationManifestSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2CatalogIdSchema,
    revision: inboxV2EntityRevisionSchema,
    reportScopeHash: inboxV2Sha256DigestSchema,
    permissionDecisions: z
      .array(inboxV2AuthorizationDecisionReferenceSchema)
      .min(2)
      .max(32),
    authorizedRoots: z
      .array(
        z
          .object({
            root: inboxV2DataRootReferenceSchema,
            expectedEntityRevision: inboxV2EntityRevisionSchema,
            expectedLineageRevision: inboxV2EntityRevisionSchema,
            permissionDecisions: z
              .array(inboxV2AuthorizationDecisionReferenceSchema)
              .min(1)
              .max(32),
            lineagePermissionDecisions: z
              .array(inboxV2AuthorizationDecisionReferenceSchema)
              .min(1)
              .max(32)
          })
          .strict()
      )
      .max(100_000),
    resourceCount: inboxV2BigintCounterSchema,
    evaluatedAt: inboxV2TimestampSchema,
    notAfter: inboxV2TimestampSchema,
    allResourcesAuthorized: z.literal(true),
    digest: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((manifest, context) => {
    addCanonicalUniqueIssue(
      context,
      manifest.permissionDecisions.map(({ permissionId }) => permissionId),
      ["permissionDecisions"],
      "Manager report permission decisions"
    );
    addCanonicalUniqueIssue(
      context,
      manifest.authorizedRoots.map(({ root }) => dataRootReferenceKey(root)),
      ["authorizedRoots"],
      "Manager report authorized roots"
    );
    for (const [index, root] of manifest.authorizedRoots.entries()) {
      addCanonicalUniqueIssue(
        context,
        root.permissionDecisions.map(({ permissionId }) => permissionId),
        ["authorizedRoots", index, "permissionDecisions"],
        "Manager root permission decisions"
      );
      addCanonicalUniqueIssue(
        context,
        root.lineagePermissionDecisions.map(({ permissionId }) => permissionId),
        ["authorizedRoots", index, "lineagePermissionDecisions"],
        "Manager root lineage permission decisions"
      );
    }
    const authorityPrincipalKeys = [
      ...manifest.permissionDecisions.map(authorizationPrincipalKey),
      ...manifest.authorizedRoots.flatMap((root) => [
        ...root.permissionDecisions.map(authorizationPrincipalKey),
        ...root.lineagePermissionDecisions.map(authorizationPrincipalKey)
      ])
    ];
    if (
      new Set(authorityPrincipalKeys).size !== 1 ||
      !isInboxV2TimestampOrderValid(manifest.evaluatedAt, manifest.notAfter) ||
      manifest.evaluatedAt === manifest.notAfter ||
      BigInt(manifest.resourceCount) !==
        BigInt(manifest.authorizedRoots.length) ||
      manifest.authorizedRoots.some(
        ({ root }) => root.tenantId !== manifest.tenantId
      ) ||
      manifest.authorizedRoots.some((authorizedRoot) =>
        authorizedRoot.permissionDecisions.some(
          (decision) =>
            decision.tenantId !== manifest.tenantId ||
            decision.outcome !== "allowed" ||
            decision.resourceScopeId !== "core:privacy-export-root" ||
            decision.resource.tenantId !== manifest.tenantId ||
            String(decision.resource.entityTypeId) !==
              String(authorizedRoot.root.dataClassId) ||
            String(decision.resource.entityId) !==
              String(authorizedRoot.root.recordId) ||
            String(decision.resourceAccessRevision) !==
              String(authorizedRoot.expectedEntityRevision) ||
            decision.decidedAt !== manifest.evaluatedAt ||
            Date.parse(decision.notAfter) < Date.parse(manifest.notAfter)
        )
      ) ||
      manifest.authorizedRoots.some((authorizedRoot) =>
        authorizedRoot.lineagePermissionDecisions.some(
          (decision) =>
            decision.tenantId !== manifest.tenantId ||
            decision.outcome !== "allowed" ||
            decision.resourceScopeId !== "core:privacy-export-root-lineage" ||
            decision.resource.tenantId !== manifest.tenantId ||
            String(decision.resource.entityTypeId) !==
              "core:data-root-lineage" ||
            String(decision.resource.entityId) !==
              String(authorizedRoot.root.recordId) ||
            String(decision.resourceAccessRevision) !==
              String(authorizedRoot.expectedLineageRevision) ||
            decision.decidedAt !== manifest.evaluatedAt ||
            Date.parse(decision.notAfter) < Date.parse(manifest.notAfter)
        )
      ) ||
      manifest.digest !==
        calculateInboxV2ManagerReportAuthorizationManifestDigest(manifest)
    ) {
      addIssue(
        context,
        ["notAfter"],
        "Manager report authorization proof requires a finite current window."
      );
    }
  });

export const inboxV2ManagerReportExportScopeProofSchema = z
  .object({
    kind: z.literal("manager_report_scope_proof"),
    tenantId: inboxV2TenantIdSchema,
    job: inboxV2PrivacyExportJobReferenceSchema,
    reportDefinition: inboxV2PrivacyExportReportDefinitionReferenceSchema,
    reportScope: inboxV2PrivacyExportReportScopeReferenceSchema,
    projectionProfile: inboxV2PrivacyExportProjectionProfileReferenceSchema,
    boundary: inboxV2PrivacyExportBoundarySchema,
    authorizationManifest: inboxV2ManagerReportAuthorizationManifestSchema,
    proofHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((proof, context) => {
    if (
      proof.job.tenantId !== proof.tenantId ||
      proof.authorizationManifest.tenantId !== proof.tenantId ||
      proof.authorizationManifest.reportScopeHash !==
        proof.reportScope.scopeHash ||
      !sameCanonicalValues(
        proof.authorizationManifest.permissionDecisions.map(
          ({ permissionId }) => permissionId
        ),
        requiredManagerReportPermissions(proof.reportScope.accessLevel)
      ) ||
      proof.authorizationManifest.permissionDecisions.some(
        (decision) =>
          decision.tenantId !== proof.tenantId ||
          decision.outcome !== "allowed" ||
          decision.resourceScopeId !== "core:manager-report-scope" ||
          decision.resource.tenantId !== proof.tenantId ||
          decision.resource.entityTypeId !== "core:manager-report-scope" ||
          String(decision.resource.entityId) !== proof.reportScope.id ||
          String(decision.resourceAccessRevision) !==
            String(proof.reportScope.revision) ||
          Date.parse(decision.decidedAt) >
            Date.parse(proof.authorizationManifest.evaluatedAt) ||
          Date.parse(decision.notAfter) <
            Date.parse(proof.authorizationManifest.notAfter)
      ) ||
      proof.proofHash !==
        calculateInboxV2ManagerReportExportScopeProofHash(proof)
    ) {
      addIssue(
        context,
        [],
        "Manager report export proof must bind the exact report scope and every aggregate/drilldown/PII authority."
      );
    }
  });

export const inboxV2PrivacyExportDataCategorySchema = z.enum([
  "subject_provided",
  "provider_observed",
  "tenant_decision",
  "inferred_candidate",
  "business_data",
  "anonymous_aggregate"
]);

export const inboxV2PrivacyExportManifestChunkSchema = z
  .object({
    ordinal: inboxV2BigintCounterSchema,
    dataCategory: inboxV2PrivacyExportDataCategorySchema,
    root: inboxV2DataRootReferenceSchema,
    expectedEntityRevision: inboxV2EntityRevisionSchema,
    expectedLineageRevision: inboxV2EntityRevisionSchema,
    subjects: z.array(inboxV2DataSubjectReferenceSchema).max(10_000),
    projectionProfile: inboxV2PrivacyExportProjectionProfileReferenceSchema,
    projectionHandlerId: inboxV2LifecycleHandlerIdSchema,
    productScopeProofHash: inboxV2Sha256DigestSchema.nullable(),
    payload: inboxV2PayloadReferenceSchema,
    itemCount: inboxV2BigintCounterSchema,
    byteCount: inboxV2BigintCounterSchema,
    checksum: inboxV2Sha256DigestSchema,
    authorization: inboxV2PrivacyExportAuthorizationCheckpointSchema,
    rootAuthorizations: z
      .array(inboxV2PrivacyExportAuthorizationCheckpointSchema)
      .min(1)
      .max(32),
    lineageAuthorization: inboxV2PrivacyExportAuthorizationCheckpointSchema,
    materializedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((chunk, context) => {
    if (
      chunk.authorization.phase !== "chunk" ||
      chunk.authorization.chunkOrdinal !== chunk.ordinal
    ) {
      addIssue(
        context,
        ["authorization"],
        "Every export chunk requires its matching current authorization checkpoint."
      );
    }
    if (chunk.authorization.checkedAt !== chunk.materializedAt) {
      addIssue(
        context,
        ["authorization", "checkedAt"],
        "Chunk authorization must be checked at its exact materialization time."
      );
    }
    addCanonicalUniqueIssue(
      context,
      chunk.rootAuthorizations.map(({ decision }) => decision.permissionId),
      ["rootAuthorizations"],
      "Chunk root authorizations"
    );
    if (
      chunk.rootAuthorizations.some(
        (checkpoint) =>
          checkpoint.phase !== "chunk" ||
          checkpoint.chunkOrdinal !== chunk.ordinal ||
          checkpoint.checkedAt !== chunk.materializedAt ||
          checkpoint.decision.resourceScopeId !== "core:privacy-export-root" ||
          checkpoint.decision.resource.tenantId !== chunk.root.tenantId ||
          String(checkpoint.decision.resource.entityTypeId) !==
            String(chunk.root.dataClassId) ||
          String(checkpoint.decision.resource.entityId) !==
            String(chunk.root.recordId) ||
          String(checkpoint.decision.resourceAccessRevision) !==
            String(chunk.expectedEntityRevision)
      )
    ) {
      addIssue(
        context,
        ["rootAuthorizations"],
        "Every chunk requires fresh exact-root authorization and entity revision fences at materialization."
      );
    }
    const chunkPrincipalKey = authorizationPrincipalKey(
      chunk.authorization.decision
    );
    if (
      chunk.rootAuthorizations.some(
        ({ decision }) =>
          authorizationPrincipalKey(decision) !== chunkPrincipalKey
      ) ||
      authorizationPrincipalKey(chunk.lineageAuthorization.decision) !==
        chunkPrincipalKey
    ) {
      addIssue(
        context,
        ["rootAuthorizations"],
        "Chunk, root and lineage authorizations must belong to one principal."
      );
    }
    if (
      chunk.lineageAuthorization.phase !== "chunk" ||
      chunk.lineageAuthorization.chunkOrdinal !== chunk.ordinal ||
      chunk.lineageAuthorization.checkedAt !== chunk.materializedAt ||
      chunk.lineageAuthorization.decision.resourceScopeId !==
        "core:privacy-export-root-lineage" ||
      chunk.lineageAuthorization.decision.resource.tenantId !==
        chunk.root.tenantId ||
      String(chunk.lineageAuthorization.decision.resource.entityTypeId) !==
        "core:data-root-lineage" ||
      String(chunk.lineageAuthorization.decision.resource.entityId) !==
        String(chunk.root.recordId) ||
      String(chunk.lineageAuthorization.decision.resourceAccessRevision) !==
        String(chunk.expectedLineageRevision)
    ) {
      addIssue(
        context,
        ["lineageAuthorization"],
        "Every chunk requires a fresh exact lineage-revision authorization at materialization."
      );
    }
    if (chunk.payload.digest !== chunk.checksum) {
      addIssue(
        context,
        ["checksum"],
        "Chunk checksum must match its exact payload reference digest."
      );
    }
    if (BigInt(chunk.itemCount) === 0n) {
      addIssue(
        context,
        ["itemCount"],
        "A materialized chunk must contain at least one item; zero results require verified-zero evidence."
      );
    }
    addCanonicalUniqueIssue(
      context,
      chunk.subjects.map(dataSubjectReferenceKey),
      ["subjects"],
      "Chunk subjects"
    );
  });

export const inboxV2PrivacyExportEnumerationReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2CatalogIdSchema,
    revision: inboxV2EntityRevisionSchema,
    digest: inboxV2Sha256DigestSchema
  })
  .strict();

export const inboxV2PrivacyExportEnumeratedRootSchema = z
  .object({
    root: inboxV2DataRootReferenceSchema,
    expectedEntityRevision: inboxV2EntityRevisionSchema,
    expectedLineageRevision: inboxV2EntityRevisionSchema
  })
  .strict();

export const inboxV2PrivacyExportScopeEnumerationSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2CatalogIdSchema,
    revision: inboxV2EntityRevisionSchema,
    job: inboxV2PrivacyExportJobReferenceSchema,
    product: inboxV2PrivacyExportProductSchema,
    scope: inboxV2PrivacyExportScopeSchema,
    boundary: inboxV2PrivacyExportBoundarySchema,
    productScopeProofHash: inboxV2Sha256DigestSchema.nullable(),
    sourceHandlerId: inboxV2LifecycleHandlerIdSchema,
    sourceResult: inboxV2PayloadReferenceSchema,
    outcome: z.enum(["complete", "verified_zero"]),
    roots: z.array(inboxV2PrivacyExportEnumeratedRootSchema).max(100_000),
    completedAt: inboxV2TimestampSchema,
    digest: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((enumeration, context) => {
    addCanonicalUniqueIssue(
      context,
      enumeration.roots.map(({ root }) => dataRootReferenceKey(root)),
      ["roots"],
      "Enumerated export roots"
    );
    if (
      enumeration.job.tenantId !== enumeration.tenantId ||
      enumeration.sourceResult.tenantId !== enumeration.tenantId ||
      enumeration.roots.some(
        ({ root }) => root.tenantId !== enumeration.tenantId
      ) ||
      (enumeration.outcome === "verified_zero") !==
        (enumeration.roots.length === 0) ||
      enumeration.productScopeProofHash !==
        exportProductScopeProofHash(enumeration.product) ||
      enumeration.digest !==
        calculateInboxV2PrivacyExportScopeEnumerationDigest(enumeration)
    ) {
      addIssue(
        context,
        [],
        "Export enumeration must be a complete tenant-bound source result for its exact product, scope and boundary."
      );
    }
  });

export const inboxV2PrivacyExportVerifiedZeroEvidenceSchema = z
  .object({
    kind: z.literal("verified_zero_scope"),
    productScopeProofHash: inboxV2Sha256DigestSchema.nullable(),
    enumeration: inboxV2PrivacyExportEnumerationReferenceSchema,
    authorization: inboxV2PrivacyExportAuthorizationCheckpointSchema,
    verifiedAt: inboxV2TimestampSchema,
    evidenceHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((evidence, context) => {
    if (
      evidence.authorization.phase !== "manifest_zero" ||
      evidence.authorization.checkedAt !== evidence.verifiedAt
    ) {
      addIssue(
        context,
        ["authorization"],
        "A verified-zero export requires a fresh manifest-zero authorization checkpoint."
      );
    }
    if (
      evidence.evidenceHash !==
      calculateInboxV2PrivacyExportVerifiedZeroEvidenceHash(evidence)
    ) {
      addIssue(
        context,
        ["evidenceHash"],
        "Verified-zero evidence hash must match its canonical authorization proof."
      );
    }
  });

export const inboxV2PrivacyExportScopeCompletionSchema = z
  .object({
    kind: z.literal("complete_for_scope"),
    enumeration: inboxV2PrivacyExportEnumerationReferenceSchema,
    expectedRootCount: inboxV2BigintCounterSchema,
    emittedRootCount: inboxV2BigintCounterSchema,
    finalChunkOrdinal: inboxV2BigintCounterSchema.nullable(),
    rootSetHash: inboxV2Sha256DigestSchema,
    completedAt: inboxV2TimestampSchema,
    completionHash: inboxV2Sha256DigestSchema
  })
  .strict();

export const inboxV2PrivacyExportOmissionSchema = z
  .object({
    scopeKind: z.enum(["data_class", "storage_root", "field", "third_party"]),
    scopeId: inboxV2CatalogIdSchema,
    reasonCode: inboxV2CatalogIdSchema,
    itemCount: inboxV2BigintCounterSchema
  })
  .strict();

export const inboxV2PrivacyExportExternalResidualSchema = z
  .object({
    routeId: inboxV2ExternalRouteIdSchema,
    outcome: z.enum([
      "not_required",
      "requested",
      "confirmed",
      "unsupported",
      "unknown",
      "failed_retryable"
    ]),
    evidenceRef: inboxV2PayloadReferenceSchema.nullable()
  })
  .strict();

export const inboxV2PrivacyExportManifestSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2PrivacyExportManifestIdSchema,
    revision: inboxV2EntityRevisionSchema,
    job: inboxV2PrivacyExportJobReferenceSchema,
    product: inboxV2PrivacyExportProductSchema,
    scope: inboxV2PrivacyExportScopeSchema,
    boundary: inboxV2PrivacyExportBoundarySchema,
    governance: inboxV2DataGovernanceContextReferenceSchema,
    policy: inboxV2DataLifecyclePolicyReferenceSchema,
    format: inboxV2PrivacyExportFormatSchema,
    chunks: z.array(inboxV2PrivacyExportManifestChunkSchema).max(100_000),
    verifiedZeroEvidence:
      inboxV2PrivacyExportVerifiedZeroEvidenceSchema.nullable(),
    omissions: z.array(inboxV2PrivacyExportOmissionSchema).max(100_000),
    externalResiduals: z
      .array(inboxV2PrivacyExportExternalResidualSchema)
      .max(1_000),
    totalItemCount: inboxV2BigintCounterSchema,
    totalByteCount: inboxV2BigintCounterSchema,
    scopeCompletion: inboxV2PrivacyExportScopeCompletionSchema,
    generatedAt: inboxV2TimestampSchema,
    manifestHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((manifest, context) => {
    const expectedProofHash = exportProductScopeProofHash(manifest.product);
    const tenantIds = [
      manifest.job.tenantId,
      manifest.governance.tenantId,
      manifest.policy.tenantId,
      manifest.scopeCompletion.enumeration.tenantId,
      ...(manifest.product.kind === "data_subject"
        ? [
            manifest.product.request.tenantId,
            manifest.product.discovery.tenantId,
            manifest.product.decision.tenantId
          ]
        : []),
      ...manifest.chunks.flatMap((chunk) => [
        chunk.root.tenantId,
        chunk.payload.tenantId,
        chunk.authorization.decision.tenantId,
        ...chunk.rootAuthorizations.flatMap((checkpoint) => [
          checkpoint.decision.tenantId,
          checkpoint.restriction.tenantId
        ]),
        chunk.lineageAuthorization.decision.tenantId,
        chunk.lineageAuthorization.restriction.tenantId,
        ...chunk.subjects.map(privacyExportSubjectTenantId)
      ]),
      ...(manifest.verifiedZeroEvidence === null
        ? []
        : [
            manifest.verifiedZeroEvidence.enumeration.tenantId,
            manifest.verifiedZeroEvidence.authorization.decision.tenantId,
            manifest.verifiedZeroEvidence.authorization.restriction.tenantId
          ]),
      ...manifest.externalResiduals.flatMap((residual) =>
        residual.evidenceRef === null ? [] : [residual.evidenceRef.tenantId]
      )
    ];
    if (tenantIds.some((value) => value !== manifest.tenantId)) {
      addIssue(
        context,
        [],
        "An export manifest and every nested reference must belong to one tenant."
      );
    }
    const requiredPermission = requiredExportPermission(manifest.product);
    for (const [index, chunk] of manifest.chunks.entries()) {
      const dataUse = manifest.scope.dataUses.find(
        (candidate) =>
          candidate.dataClassId === chunk.root.dataClassId &&
          candidate.storageRootId === chunk.root.storageRootId
      );
      if (
        chunk.authorization.decision.permissionId !== requiredPermission ||
        !isAuthorizationBoundToExportJob(
          chunk.authorization.decision,
          manifest.job
        ) ||
        !isTimestampAtOrAfter(
          chunk.authorization.checkedAt,
          manifest.job.requestedAt
        ) ||
        !isTimestampAtOrAfter(manifest.generatedAt, chunk.materializedAt) ||
        chunk.projectionProfile.id !== manifest.scope.projectionProfile.id ||
        chunk.projectionProfile.revision !==
          manifest.scope.projectionProfile.revision ||
        chunk.projectionProfile.digest !==
          manifest.scope.projectionProfile.digest ||
        dataUse === undefined ||
        dataUse.projectionHandlerId !== chunk.projectionHandlerId ||
        chunk.payload.schemaId !== manifest.format.schemaId ||
        chunk.payload.schemaVersion !== manifest.format.schemaVersion ||
        chunk.productScopeProofHash !== expectedProofHash ||
        (manifest.product.kind !== "manager_report" &&
          chunk.rootAuthorizations.some(
            ({ decision }) => decision.permissionId !== requiredPermission
          )) ||
        (manifest.product.kind !== "manager_report" &&
          chunk.lineageAuthorization.decision.permissionId !==
            requiredPermission) ||
        (manifest.product.kind === "data_subject" &&
          chunk.subjects.length === 0)
      ) {
        addIssue(
          context,
          ["chunks", index],
          "Every export chunk must bind exact class/root/subject/projection lineage, product proof, format and fresh job authorization before manifest generation."
        );
      }
    }
    if (!isTimestampAtOrAfter(manifest.generatedAt, manifest.job.requestedAt)) {
      addIssue(
        context,
        ["generatedAt"],
        "An export manifest cannot be generated before its job was requested."
      );
    }
    addStrictlyIncreasingCounterIssue(
      context,
      manifest.chunks.map(({ ordinal }) => ordinal),
      ["chunks"],
      "Export chunk ordinals"
    );
    if (
      manifest.chunks.some(
        ({ ordinal }, index) => BigInt(ordinal) !== BigInt(index + 1)
      )
    ) {
      addIssue(
        context,
        ["chunks"],
        "Export chunk ordinals must form a continuous one-based chain."
      );
    }
    addCanonicalUniqueIssue(
      context,
      manifest.externalResiduals.map(({ routeId }) => routeId),
      ["externalResiduals"],
      "Export external routes"
    );
    const derivedItemCount = manifest.chunks.reduce(
      (total, chunk) => total + BigInt(chunk.itemCount),
      0n
    );
    const derivedByteCount = manifest.chunks.reduce(
      (total, chunk) => total + BigInt(chunk.byteCount),
      0n
    );
    if (
      BigInt(manifest.totalItemCount) !== derivedItemCount ||
      BigInt(manifest.totalByteCount) !== derivedByteCount
    ) {
      addIssue(
        context,
        ["totalItemCount"],
        "Manifest totals must be derived exactly from materialized chunks."
      );
    }
    const zeroEvidence = manifest.verifiedZeroEvidence;
    if (
      (manifest.chunks.length === 0) !== (zeroEvidence !== null) ||
      (zeroEvidence !== null &&
        (manifest.totalItemCount !== "0" ||
          manifest.totalByteCount !== "0" ||
          zeroEvidence.productScopeProofHash !== expectedProofHash ||
          !sameStructuredValue(
            zeroEvidence.enumeration,
            manifest.scopeCompletion.enumeration
          ) ||
          zeroEvidence.authorization.decision.permissionId !==
            requiredPermission ||
          !isAuthorizationBoundToExportJob(
            zeroEvidence.authorization.decision,
            manifest.job
          ) ||
          !isTimestampAtOrAfter(
            zeroEvidence.verifiedAt,
            manifest.job.requestedAt
          ) ||
          !isTimestampAtOrAfter(manifest.generatedAt, zeroEvidence.verifiedAt)))
    ) {
      addIssue(
        context,
        ["verifiedZeroEvidence"],
        "An empty ready manifest requires exact fresh verified-zero evidence and non-empty manifests forbid it."
      );
    }
    const emittedRootKeys = [
      ...new Set(manifest.chunks.map(({ root }) => dataRootReferenceKey(root)))
    ].sort();
    const expectedFinalOrdinal =
      manifest.chunks.length === 0 ? null : manifest.chunks.at(-1)!.ordinal;
    if (
      BigInt(manifest.scopeCompletion.expectedRootCount) !==
        BigInt(emittedRootKeys.length) ||
      manifest.scopeCompletion.emittedRootCount !==
        manifest.scopeCompletion.expectedRootCount ||
      manifest.scopeCompletion.finalChunkOrdinal !== expectedFinalOrdinal ||
      manifest.scopeCompletion.rootSetHash !==
        calculateInboxV2CanonicalSha256({
          domain: "core:inbox-v2.privacy-export-root-set",
          hashVersion: "v1",
          roots: manifest.chunks.map((chunk) => ({
            root: chunk.root,
            expectedEntityRevision: chunk.expectedEntityRevision,
            expectedLineageRevision: chunk.expectedLineageRevision
          }))
        }) ||
      !isTimestampAtOrAfter(
        manifest.scopeCompletion.completedAt,
        manifest.chunks.at(-1)?.materializedAt ?? manifest.job.requestedAt
      ) ||
      !isTimestampAtOrAfter(
        manifest.generatedAt,
        manifest.scopeCompletion.completedAt
      ) ||
      manifest.scopeCompletion.completionHash !==
        calculateInboxV2PrivacyExportScopeCompletionHash(manifest)
    ) {
      addIssue(
        context,
        ["scopeCompletion"],
        "Ready manifest requires a continuous final scope enumeration with exact root/revision completeness proof."
      );
    }
    if (
      manifest.manifestHash !==
      calculateInboxV2PrivacyExportManifestHash(manifest)
    ) {
      addIssue(
        context,
        ["manifestHash"],
        "Manifest hash must match every canonical chunk, omission, total and completeness field."
      );
    }
    if (
      manifest.product.kind === "data_subject" &&
      manifest.product.intent === "portability" &&
      manifest.chunks.some(({ dataCategory }) =>
        ["tenant_decision", "inferred_candidate", "business_data"].includes(
          dataCategory
        )
      )
    ) {
      addIssue(
        context,
        ["chunks"],
        "Portability uses its narrower schema and cannot include inferred or tenant-decision data."
      );
    }
  });

export const inboxV2PrivacyExportArchiveMaterializationSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2CatalogIdSchema,
    revision: inboxV2EntityRevisionSchema,
    manifest: inboxV2PrivacyExportManifestReferenceSchema,
    archiveCompositionHash: inboxV2Sha256DigestSchema,
    encryptedPayload: inboxV2PayloadReferenceSchema,
    encryptedByteCount: inboxV2BigintCounterSchema,
    encryptionProfileId: inboxV2CatalogIdSchema,
    packagerHandlerId: inboxV2LifecycleHandlerIdSchema,
    materializedAt: inboxV2TimestampSchema,
    proofHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((materialization, context) => {
    if (
      materialization.manifest.tenantId !== materialization.tenantId ||
      materialization.encryptedPayload.tenantId !== materialization.tenantId ||
      BigInt(materialization.encryptedByteCount) <= 0n ||
      materialization.proofHash !==
        calculateInboxV2PrivacyExportArchiveMaterializationProofHash(
          materialization
        )
    ) {
      addIssue(
        context,
        [],
        "Archive materialization must bind actual encrypted bytes to its exact manifest composition."
      );
    }
  });

const exportArtifactBaseShape = {
  tenantId: inboxV2TenantIdSchema,
  id: inboxV2PrivacyExportArtifactIdSchema,
  revision: inboxV2EntityRevisionSchema,
  job: inboxV2PrivacyExportJobReferenceSchema,
  product: inboxV2PrivacyExportProductSchema,
  createdAt: inboxV2TimestampSchema
} as const;

const buildingExportArtifactSchema = z
  .object({
    ...exportArtifactBaseShape,
    state: z.literal("building"),
    partialPayload: inboxV2PayloadReferenceSchema.nullable()
  })
  .strict();

const readyExportArtifactSchema = z
  .object({
    ...exportArtifactBaseShape,
    state: z.literal("ready"),
    manifest: inboxV2PrivacyExportManifestReferenceSchema,
    encryptedPayload: inboxV2PayloadReferenceSchema,
    encryptedByteCount: inboxV2BigintCounterSchema,
    encryptionProfileId: inboxV2CatalogIdSchema,
    checksum: inboxV2Sha256DigestSchema,
    archiveCompositionHash: inboxV2Sha256DigestSchema,
    packagingProofHash: inboxV2Sha256DigestSchema,
    readyAt: inboxV2TimestampSchema,
    expiresAt: inboxV2TimestampSchema,
    oneUse: z.literal(true),
    revocable: z.literal(true),
    currentAuthorizationRequired: z.literal(true)
  })
  .strict();

const quarantinedExportArtifactSchema = z
  .object({
    ...exportArtifactBaseShape,
    state: z.literal("quarantined"),
    encryptedPayload: inboxV2PayloadReferenceSchema,
    reasonCode: inboxV2CatalogIdSchema,
    quarantinedAt: inboxV2TimestampSchema,
    deleteBy: inboxV2TimestampSchema,
    downloadDisabled: z.literal(true)
  })
  .strict();

const deletedExportArtifactSchema = z
  .object({
    ...exportArtifactBaseShape,
    state: z.literal("deleted"),
    priorPayloadDigest: inboxV2Sha256DigestSchema,
    deletionEvidence: inboxV2PayloadReferenceSchema,
    deletedAt: inboxV2TimestampSchema,
    allObjectVersionsDeleted: z.literal(true)
  })
  .strict();

export const inboxV2PrivacyExportArtifactSchema = z
  .discriminatedUnion("state", [
    buildingExportArtifactSchema,
    readyExportArtifactSchema,
    quarantinedExportArtifactSchema,
    deletedExportArtifactSchema
  ])
  .superRefine((artifact, context) => {
    const nestedTenantIds = [
      artifact.job.tenantId,
      ...(artifact.product.kind === "data_subject"
        ? [
            artifact.product.request.tenantId,
            artifact.product.discovery.tenantId,
            artifact.product.decision.tenantId
          ]
        : [])
    ];
    if (artifact.state === "building" && artifact.partialPayload !== null) {
      nestedTenantIds.push(artifact.partialPayload.tenantId);
    }
    if (artifact.state === "ready") {
      nestedTenantIds.push(
        artifact.manifest.tenantId,
        artifact.encryptedPayload.tenantId
      );
      const ttlMilliseconds =
        Date.parse(artifact.expiresAt) - Date.parse(artifact.readyAt);
      if (
        !isTimestampAtOrAfter(artifact.createdAt, artifact.job.requestedAt) ||
        !isInboxV2TimestampOrderValid(artifact.createdAt, artifact.readyAt) ||
        !isInboxV2TimestampOrderValid(artifact.readyAt, artifact.expiresAt) ||
        ttlMilliseconds <= 0 ||
        ttlMilliseconds > 24 * 60 * 60 * 1_000 ||
        BigInt(artifact.encryptedByteCount) <= 0n ||
        artifact.encryptedPayload.digest !== artifact.checksum ||
        artifact.packagingProofHash !==
          calculateInboxV2PrivacyExportArtifactPackagingProofHash(artifact)
      ) {
        addIssue(
          context,
          [],
          "A ready artifact requires exact payload integrity and an ordered TTL no longer than 24 hours."
        );
      }
    }
    if (artifact.state === "quarantined") {
      nestedTenantIds.push(artifact.encryptedPayload.tenantId);
      const quarantineMilliseconds =
        Date.parse(artifact.deleteBy) - Date.parse(artifact.quarantinedAt);
      if (
        !isTimestampAtOrAfter(artifact.quarantinedAt, artifact.createdAt) ||
        !isInboxV2TimestampOrderValid(
          artifact.quarantinedAt,
          artifact.deleteBy
        ) ||
        quarantineMilliseconds <= 0 ||
        quarantineMilliseconds > 60 * 60 * 1_000
      ) {
        addIssue(
          context,
          ["deleteBy"],
          "A quarantined artifact requires deletion within one hour."
        );
      }
    }
    if (artifact.state === "deleted") {
      nestedTenantIds.push(artifact.deletionEvidence.tenantId);
    }
    if (nestedTenantIds.some((value) => value !== artifact.tenantId)) {
      addIssue(
        context,
        [],
        "An export artifact and every nested reference must belong to one tenant."
      );
    }
  });

const exportDownloadReceiptBaseShape = {
  tenantId: inboxV2TenantIdSchema,
  id: inboxV2PrivacyExportDownloadReceiptIdSchema,
  revision: inboxV2EntityRevisionSchema,
  job: inboxV2PrivacyExportJobReferenceSchema,
  artifact: inboxV2PrivacyExportArtifactReferenceSchema,
  manifest: inboxV2PrivacyExportManifestReferenceSchema,
  product: inboxV2PrivacyExportProductSchema,
  issuedAt: inboxV2TimestampSchema,
  expiresAt: inboxV2TimestampSchema,
  issuanceAuthorization: inboxV2PrivacyExportAuthorizationCheckpointSchema,
  issuanceArtifactAuthorization: inboxV2AuthorizationDecisionReferenceSchema,
  oneUse: z.literal(true)
} as const;

export const inboxV2PrivacyExportDownloadReceiptSchema = z
  .discriminatedUnion("state", [
    z
      .object({
        ...exportDownloadReceiptBaseShape,
        state: z.literal("issued")
      })
      .strict(),
    z
      .object({
        ...exportDownloadReceiptBaseShape,
        state: z.literal("consumed"),
        consumedAt: inboxV2TimestampSchema,
        consumeAuthorization: inboxV2PrivacyExportAuthorizationCheckpointSchema,
        consumeArtifactAuthorization:
          inboxV2AuthorizationDecisionReferenceSchema,
        consumptionHash: inboxV2Sha256DigestSchema
      })
      .strict(),
    z
      .object({
        ...exportDownloadReceiptBaseShape,
        state: z.literal("revoked"),
        revokedAt: inboxV2TimestampSchema,
        reasonCode: inboxV2CatalogIdSchema
      })
      .strict(),
    z
      .object({
        ...exportDownloadReceiptBaseShape,
        state: z.literal("expired"),
        expiredAt: inboxV2TimestampSchema
      })
      .strict()
  ])
  .superRefine((receipt, context) => {
    const tenantIds = [
      receipt.job.tenantId,
      receipt.artifact.tenantId,
      receipt.manifest.tenantId,
      receipt.issuanceAuthorization.decision.tenantId,
      receipt.issuanceAuthorization.restriction.tenantId,
      receipt.issuanceArtifactAuthorization.tenantId,
      ...(receipt.product.kind === "data_subject"
        ? [
            receipt.product.request.tenantId,
            receipt.product.discovery.tenantId,
            receipt.product.decision.tenantId
          ]
        : [])
    ];
    if (
      tenantIds.some((value) => value !== receipt.tenantId) ||
      receipt.artifact.state !== "ready" ||
      receipt.issuanceAuthorization.phase !== "download" ||
      receipt.issuanceAuthorization.checkedAt !== receipt.issuedAt ||
      receipt.issuanceAuthorization.decision.permissionId !==
        requiredExportPermission(receipt.product) ||
      !isAuthorizationBoundToExportJob(
        receipt.issuanceAuthorization.decision,
        receipt.job
      ) ||
      !isAuthorizationBoundToReadyExportArtifact(
        receipt.issuanceArtifactAuthorization,
        receipt.artifact,
        requiredExportPermission(receipt.product),
        receipt.issuedAt
      ) ||
      authorizationPrincipalKey(receipt.issuanceArtifactAuthorization) !==
        authorizationPrincipalKey(receipt.issuanceAuthorization.decision) ||
      !isInboxV2TimestampOrderValid(receipt.issuedAt, receipt.expiresAt) ||
      receipt.issuedAt === receipt.expiresAt
    ) {
      addIssue(
        context,
        [],
        "A download receipt requires exact ready-artifact lineage and fresh one-use issuance authorization."
      );
    }
    if (receipt.state === "consumed") {
      tenantIds.push(
        receipt.consumeAuthorization.decision.tenantId,
        receipt.consumeAuthorization.restriction.tenantId,
        receipt.consumeArtifactAuthorization.tenantId
      );
      if (
        tenantIds.some((value) => value !== receipt.tenantId) ||
        receipt.consumeAuthorization.phase !== "download" ||
        receipt.consumeAuthorization.checkedAt !== receipt.consumedAt ||
        receipt.consumeAuthorization.decision.id ===
          receipt.issuanceAuthorization.decision.id ||
        receipt.consumeAuthorization.decision.permissionId !==
          requiredExportPermission(receipt.product) ||
        !isAuthorizationBoundToExportJob(
          receipt.consumeAuthorization.decision,
          receipt.job
        ) ||
        !isAuthorizationBoundToReadyExportArtifact(
          receipt.consumeArtifactAuthorization,
          receipt.artifact,
          requiredExportPermission(receipt.product),
          receipt.consumedAt
        ) ||
        authorizationPrincipalKey(receipt.consumeAuthorization.decision) !==
          authorizationPrincipalKey(receipt.issuanceAuthorization.decision) ||
        authorizationPrincipalKey(receipt.consumeArtifactAuthorization) !==
          authorizationPrincipalKey(receipt.issuanceAuthorization.decision) ||
        !isTimestampAtOrAfter(receipt.consumedAt, receipt.issuedAt) ||
        Date.parse(receipt.consumedAt) >= Date.parse(receipt.expiresAt) ||
        receipt.consumptionHash !==
          calculateInboxV2PrivacyExportDownloadConsumptionHash(receipt)
      ) {
        addIssue(
          context,
          ["consumeAuthorization"],
          "Receipt consumption requires a new current authorization at the exact consume time."
        );
      }
    }
    if (
      receipt.state === "revoked" &&
      !isTimestampAtOrAfter(receipt.revokedAt, receipt.issuedAt)
    ) {
      addIssue(
        context,
        ["revokedAt"],
        "Receipt cannot be revoked before issue."
      );
    }
    if (
      receipt.state === "expired" &&
      Date.parse(receipt.expiredAt) < Date.parse(receipt.expiresAt)
    ) {
      addIssue(
        context,
        ["expiredAt"],
        "Receipt cannot expire before its declared expiry."
      );
    }
  });

const exportJobBaseShape = {
  tenantId: inboxV2TenantIdSchema,
  id: inboxV2PrivacyExportJobIdSchema,
  revision: inboxV2EntityRevisionSchema,
  product: inboxV2PrivacyExportProductSchema,
  scope: inboxV2PrivacyExportScopeSchema,
  boundary: inboxV2PrivacyExportBoundarySchema,
  governance: inboxV2DataGovernanceContextReferenceSchema,
  policy: inboxV2DataLifecyclePolicyReferenceSchema,
  format: inboxV2PrivacyExportFormatSchema,
  requestAuthorization: inboxV2PrivacyExportAuthorizationCheckpointSchema,
  approval: inboxV2PrivacyExportApprovalSchema,
  requestedAt: inboxV2TimestampSchema
} as const;

export const inboxV2PrivacyExportJobSchema = z
  .discriminatedUnion("state", [
    z
      .object({
        ...exportJobBaseShape,
        state: z.literal("queued"),
        manifest: z.null(),
        artifact: z.null()
      })
      .strict(),
    z
      .object({
        ...exportJobBaseShape,
        state: z.literal("running"),
        manifest: z.null(),
        artifact: inboxV2PrivacyExportArtifactReferenceSchema
      })
      .strict(),
    z
      .object({
        ...exportJobBaseShape,
        state: z.literal("ready"),
        manifest: inboxV2PrivacyExportManifestReferenceSchema,
        artifact: inboxV2PrivacyExportArtifactReferenceSchema
      })
      .strict(),
    z
      .object({
        ...exportJobBaseShape,
        state: z.enum(["revoked", "expired", "failed_retryable"]),
        manifest: inboxV2PrivacyExportManifestReferenceSchema.nullable(),
        artifact: inboxV2PrivacyExportArtifactReferenceSchema
      })
      .strict(),
    z
      .object({
        ...exportJobBaseShape,
        state: z.literal("completed"),
        manifest: inboxV2PrivacyExportManifestReferenceSchema,
        artifact: inboxV2PrivacyExportArtifactReferenceSchema
      })
      .strict()
  ])
  .superRefine((job, context) => {
    const tenantIds = [
      job.governance.tenantId,
      job.policy.tenantId,
      job.requestAuthorization.decision.tenantId,
      ...(job.product.kind === "data_subject"
        ? [
            job.product.request.tenantId,
            job.product.discovery.tenantId,
            job.product.decision.tenantId
          ]
        : []),
      ...(job.approval.kind === "separated_approval"
        ? [job.approval.authorization.tenantId]
        : []),
      ...(job.manifest === null ? [] : [job.manifest.tenantId]),
      ...(job.artifact === null ? [] : [job.artifact.tenantId])
    ];
    if (tenantIds.some((value) => value !== job.tenantId)) {
      addIssue(
        context,
        [],
        "An export job and every policy, request and artifact reference must belong to one tenant."
      );
    }
    if (job.requestAuthorization.phase !== "request") {
      addIssue(
        context,
        ["requestAuthorization", "phase"],
        "An export job starts with request-phase authorization."
      );
    }
    const expectedPermission = requiredExportPermission(job.product);
    if (job.requestAuthorization.decision.permissionId !== expectedPermission) {
      addIssue(
        context,
        ["requestAuthorization", "decision", "permissionId"],
        "Each export product requires its distinct permission family."
      );
    }
    const jobReference = {
      tenantId: job.tenantId,
      jobId: job.id,
      revision: job.revision,
      requestedAt: job.requestedAt
    };
    if (
      !isAuthorizationBoundToExportJob(
        job.requestAuthorization.decision,
        jobReference
      ) ||
      !isTimestampAtOrAfter(job.requestAuthorization.checkedAt, job.requestedAt)
    ) {
      addIssue(
        context,
        ["requestAuthorization"],
        "Request authorization must be current and bound to this exact export job revision."
      );
    }
    if (job.product.kind === "tenant_deployment") {
      if (
        job.approval.kind !== "separated_approval" ||
        job.approval.authorization.outcome !== "allowed" ||
        job.approval.authorization.permissionId !== expectedPermission ||
        !isAuthorizationBoundToExportJob(
          job.approval.authorization,
          jobReference
        ) ||
        !isTimestampWithinAuthorizationWindow(
          job.approval.approvedAt,
          job.approval.authorization
        ) ||
        !isTimestampAtOrAfter(job.approval.approvedAt, job.requestedAt) ||
        authorizationPrincipalKey(job.approval.authorization) ===
          authorizationPrincipalKey(job.requestAuthorization.decision)
      ) {
        addIssue(
          context,
          ["approval"],
          "Tenant/deployment export requires a separate current approver."
        );
      }
    } else {
      const expectedReason =
        job.product.kind === "data_subject"
          ? "verified_data_subject_case"
          : "adr_0013_report_policy";
      if (
        job.approval.kind !== "not_required" ||
        job.approval.reason !== expectedReason
      ) {
        addIssue(
          context,
          ["approval"],
          "Non-tenant export approval basis must match its exact product workflow."
        );
      }
    }
    if (
      job.approval.kind === "separated_approval" &&
      !isInboxV2TimestampOrderValid(job.requestedAt, job.approval.approvedAt)
    ) {
      addIssue(
        context,
        ["approval", "approvedAt"],
        "Export approval cannot precede its request."
      );
    }
    if (
      (job.state === "running" && job.artifact.state !== "building") ||
      (job.state === "ready" && job.artifact.state !== "ready") ||
      ((job.state === "revoked" ||
        job.state === "expired" ||
        job.state === "failed_retryable") &&
        !["quarantined", "deleted"].includes(job.artifact.state)) ||
      (job.state === "completed" && job.artifact.state !== "deleted")
    ) {
      addIssue(
        context,
        ["artifact", "state"],
        "Export job state requires its exact safe artifact lifecycle state."
      );
    }
  });

export const inboxV2PrivacyExportJobEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_PRIVACY_EXPORT_JOB_SCHEMA_ID,
    INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION,
    inboxV2PrivacyExportJobSchema
  );
export const inboxV2PrivacyExportManifestEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_PRIVACY_EXPORT_MANIFEST_SCHEMA_ID,
    INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION,
    inboxV2PrivacyExportManifestSchema
  );
export const inboxV2PrivacyExportArtifactEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_PRIVACY_EXPORT_ARTIFACT_SCHEMA_ID,
    INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION,
    inboxV2PrivacyExportArtifactSchema
  );
export const inboxV2PrivacyExportDownloadReceiptEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_PRIVACY_EXPORT_DOWNLOAD_RECEIPT_SCHEMA_ID,
    INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION,
    inboxV2PrivacyExportDownloadReceiptSchema
  );

export type InboxV2PrivacyExportProduct = z.infer<
  typeof inboxV2PrivacyExportProductSchema
>;
export type InboxV2PrivacyExportScope = z.infer<
  typeof inboxV2PrivacyExportScopeSchema
>;
export type InboxV2PrivacyExportManifest = z.infer<
  typeof inboxV2PrivacyExportManifestSchema
>;
export type InboxV2PrivacyExportArtifact = z.infer<
  typeof inboxV2PrivacyExportArtifactSchema
>;
export type InboxV2PrivacyExportJob = z.infer<
  typeof inboxV2PrivacyExportJobSchema
>;
export type InboxV2PrivacyExportProjectionProfile = z.infer<
  typeof inboxV2PrivacyExportProjectionProfileSchema
>;
export type InboxV2DataSubjectExportScopeProof = z.infer<
  typeof inboxV2DataSubjectExportScopeProofSchema
>;
export type InboxV2ManagerReportExportScopeProof = z.infer<
  typeof inboxV2ManagerReportExportScopeProofSchema
>;
export type InboxV2PrivacyExportDownloadReceipt = z.infer<
  typeof inboxV2PrivacyExportDownloadReceiptSchema
>;

export function calculateInboxV2PrivacyExportProjectionProfileDigest(
  profile: z.input<typeof inboxV2PrivacyExportProjectionProfileSchema>
) {
  const { digest: _digest, ...reference } = profile.reference;
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.privacy-export-projection-profile",
    hashVersion: "v1",
    profile: { ...profile, reference }
  });
}

export function calculateInboxV2PrivacyExportProjectionCatalogDigest(
  catalog: z.input<typeof inboxV2PrivacyExportProjectionCatalogSchema>
) {
  const { digest: _digest, ...body } = catalog;
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.privacy-export-projection-catalog",
    hashVersion: "v1",
    catalog: body
  });
}

export function calculateInboxV2DataSubjectExportScopeProofHash(
  proof: z.input<typeof inboxV2DataSubjectExportScopeProofSchema>
) {
  const { proofHash: _proofHash, evaluatedAt: _evaluatedAt, ...body } = proof;
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.data-subject-export-scope-proof",
    hashVersion: "v1",
    proof: body
  });
}

export function calculateInboxV2ManagerReportAuthorizationManifestDigest(
  manifest: z.input<typeof inboxV2ManagerReportAuthorizationManifestSchema>
) {
  const { digest: _digest, ...body } = manifest;
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.manager-report-authorization-manifest",
    hashVersion: "v1",
    manifest: body
  });
}

export function calculateInboxV2ManagerReportExportScopeProofHash(
  proof: z.input<typeof inboxV2ManagerReportExportScopeProofSchema>
) {
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.manager-report-export-scope-proof",
    hashVersion: "v1",
    proof: {
      kind: proof.kind,
      tenantId: proof.tenantId,
      job: proof.job,
      reportDefinition: proof.reportDefinition,
      reportScope: proof.reportScope,
      projectionProfile: proof.projectionProfile,
      boundary: proof.boundary,
      principalKey: managerReportAuthorizationManifestPrincipalKey(
        proof.authorizationManifest
      ),
      authorizedRoots: proof.authorizationManifest.authorizedRoots.map(
        (authorizedRoot) => ({
          root: authorizedRoot.root,
          expectedEntityRevision: authorizedRoot.expectedEntityRevision,
          expectedLineageRevision: authorizedRoot.expectedLineageRevision,
          permissionIds: authorizedRoot.permissionDecisions.map(
            ({ permissionId }) => permissionId
          ),
          lineagePermissionIds: authorizedRoot.lineagePermissionDecisions.map(
            ({ permissionId }) => permissionId
          )
        })
      )
    }
  });
}

export function calculateInboxV2PrivacyExportVerifiedZeroEvidenceHash(
  evidence: z.input<typeof inboxV2PrivacyExportVerifiedZeroEvidenceSchema>
) {
  const { evidenceHash: _evidenceHash, ...body } = evidence;
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.privacy-export-verified-zero",
    hashVersion: "v1",
    evidence: body
  });
}

export function calculateInboxV2PrivacyExportScopeEnumerationDigest(
  enumeration: z.input<typeof inboxV2PrivacyExportScopeEnumerationSchema>
) {
  const { digest: _digest, ...body } = enumeration;
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.privacy-export-scope-enumeration",
    hashVersion: "v1",
    enumeration: body
  });
}

export function calculateInboxV2PrivacyExportScopeCompletionHash(
  manifest: z.input<typeof inboxV2PrivacyExportManifestSchema>
) {
  const { completionHash: _completionHash, ...completion } =
    manifest.scopeCompletion;
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.privacy-export-scope-completion",
    hashVersion: "v1",
    product: manifest.product,
    scope: manifest.scope,
    boundary: manifest.boundary,
    completion,
    chunks: manifest.chunks.map((chunk) => ({
      ordinal: chunk.ordinal,
      root: chunk.root,
      expectedEntityRevision: chunk.expectedEntityRevision,
      expectedLineageRevision: chunk.expectedLineageRevision,
      payloadDigest: chunk.payload.digest,
      itemCount: chunk.itemCount,
      byteCount: chunk.byteCount
    }))
  });
}

export function calculateInboxV2PrivacyExportManifestHash(
  manifest: z.input<typeof inboxV2PrivacyExportManifestSchema>
) {
  const { manifestHash: _manifestHash, ...body } = manifest;
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.privacy-export-manifest",
    hashVersion: "v1",
    manifest: body
  });
}

export function calculateInboxV2PrivacyExportArchiveCompositionHash(
  manifest: z.input<typeof inboxV2PrivacyExportManifestSchema>
) {
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.privacy-export-archive-composition",
    hashVersion: "v1",
    manifestHash: manifest.manifestHash,
    format: manifest.format,
    chunks: manifest.chunks.map((chunk) => ({
      ordinal: chunk.ordinal,
      root: chunk.root,
      expectedEntityRevision: chunk.expectedEntityRevision,
      expectedLineageRevision: chunk.expectedLineageRevision,
      projectionProfile: chunk.projectionProfile,
      payload: chunk.payload,
      checksum: chunk.checksum,
      itemCount: chunk.itemCount,
      byteCount: chunk.byteCount
    })),
    omissions: manifest.omissions,
    totals: {
      items: manifest.totalItemCount,
      bytes: manifest.totalByteCount
    },
    scopeCompletion: manifest.scopeCompletion
  });
}

export function calculateInboxV2PrivacyExportArtifactPackagingProofHash(
  artifact: Extract<
    z.input<typeof inboxV2PrivacyExportArtifactSchema>,
    { state: "ready" }
  >
) {
  const { packagingProofHash: _packagingProofHash, ...body } = artifact;
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.privacy-export-artifact-packaging",
    hashVersion: "v1",
    artifact: {
      tenantId: body.tenantId,
      id: body.id,
      revision: body.revision,
      job: body.job,
      product: body.product,
      manifest: body.manifest,
      encryptedPayload: body.encryptedPayload,
      encryptedByteCount: body.encryptedByteCount,
      encryptionProfileId: body.encryptionProfileId,
      checksum: body.checksum,
      archiveCompositionHash: body.archiveCompositionHash,
      readyAt: body.readyAt,
      expiresAt: body.expiresAt
    }
  });
}

export function calculateInboxV2PrivacyExportArchiveMaterializationProofHash(
  materialization: z.input<
    typeof inboxV2PrivacyExportArchiveMaterializationSchema
  >
) {
  const { proofHash: _proofHash, ...body } = materialization;
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.privacy-export-archive-materialization",
    hashVersion: "v1",
    materialization: body
  });
}

export function calculateInboxV2PrivacyExportDownloadConsumptionHash(
  receipt: Extract<
    z.input<typeof inboxV2PrivacyExportDownloadReceiptSchema>,
    { state: "consumed" }
  >
) {
  const { consumptionHash: _consumptionHash, ...body } = receipt;
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.privacy-export-download-consumption",
    hashVersion: "v1",
    receipt: body
  });
}

const authenticProjectionProfiles = new WeakSet<object>();
const authenticProjectionCatalogs = new WeakSet<object>();
const authenticDataSubjectScopeProofs = new WeakSet<object>();
const authenticCurrentDataSubjectRequestSources = new WeakSet<object>();
const authenticCurrentDataSubjectScopeProofs = new WeakSet<object>();
const authenticManagerReportAuthoritySources = new WeakSet<object>();
const authenticManagerReportAuthorities = new WeakSet<object>();
const authenticManagerReportScopeProofs = new WeakSet<object>();
const authenticExportAuthoritySources = new WeakSet<object>();
const authenticCurrentBundleSources = new WeakSet<object>();
const authenticScopeEnumerationSources = new WeakSet<object>();
const authenticScopeEnumerations = new WeakSet<object>();
const authenticExportManifests = new WeakSet<object>();
const exportManifestAuthorityBindings = new WeakMap<
  object,
  Readonly<{
    job: InboxV2PrivacyExportJob;
    registry: InboxV2DataLifecycleRegistry;
    scopeProof: InboxV2PrivacyExportProductScopeProof | null;
    authoritySource: InboxV2PrivacyExportAuthoritySource;
  }>
>();
const authenticArchivePackagerSources = new WeakSet<object>();
const authenticArchiveMaterializations = new WeakSet<object>();
const authenticReadyExportArtifacts = new WeakSet<object>();
const authenticTerminalBundles = new WeakSet<object>();
const exportBundleAuthorityBindings = new WeakMap<
  object,
  Readonly<{
    registry: InboxV2DataLifecycleRegistry;
    authoritySource: InboxV2PrivacyExportAuthoritySource;
  }>
>();
const authenticClaimRepositories = new WeakSet<object>();

export type InboxV2PrivacyExportProductScopeProof =
  | InboxV2TenantTerminationScopeManifest
  | InboxV2DataSubjectExportScopeProof
  | InboxV2ManagerReportExportScopeProof;

export type InboxV2PrivacyExportTerminalBundle = Readonly<{
  job: InboxV2PrivacyExportJob & { state: "ready" };
  manifest: InboxV2PrivacyExportManifest;
  artifact: InboxV2PrivacyExportArtifact & { state: "ready" };
  scopeProof: InboxV2PrivacyExportProductScopeProof | null;
}>;

export type InboxV2PrivacyExportProjectionCatalog = z.infer<
  typeof inboxV2PrivacyExportProjectionCatalogSchema
>;
export type InboxV2PrivacyExportScopeEnumeration = z.infer<
  typeof inboxV2PrivacyExportScopeEnumerationSchema
>;
export type InboxV2PrivacyExportArchiveMaterialization = z.infer<
  typeof inboxV2PrivacyExportArchiveMaterializationSchema
>;
export type InboxV2ManagerReportExportAuthority =
  InboxV2ManagerReportExportScopeProof;

/**
 * Executable, non-JSON composition-root capabilities. A service registers
 * these once during bootstrap and injects the returned object; API payloads,
 * deserialized objects and callback lookalikes are deliberately rejected by
 * object-authenticity checks. This boundary does not attempt to sandbox
 * arbitrary code already executing inside the trusted process.
 */
export type InboxV2ManagerReportAuthoritySource = Readonly<{
  id: string;
  resolve(
    input: Readonly<{
      job: z.infer<typeof inboxV2PrivacyExportJobReferenceSchema>;
      principal: z.input<
        typeof inboxV2AuthorizationDecisionReferenceSchema
      >["principal"];
      checkedAt: string;
    }>
  ): z.input<typeof inboxV2ManagerReportExportScopeProofSchema>;
}>;

export type InboxV2DataSubjectCurrentRequestSource = Readonly<{
  id: string;
  loadCurrent(
    input: Readonly<{
      tenantId: string;
      requestId: string;
      checkedAt: string;
    }>
  ): InboxV2PrivacyRequest;
}>;

export type InboxV2PrivacyExportScopeEnumerationSource = Readonly<{
  id: string;
  handlerId: string;
  enumerate(
    input: Readonly<{
      job: z.infer<typeof inboxV2PrivacyExportJobReferenceSchema>;
      product: InboxV2PrivacyExportProduct;
      scope: InboxV2PrivacyExportScope;
      boundary: z.infer<typeof inboxV2PrivacyExportBoundarySchema>;
      productScopeProofHash: string | null;
    }>
  ): z.input<typeof inboxV2PrivacyExportScopeEnumerationSchema>;
}>;

const inboxV2PrivacyExportCurrentJobAuthorityResultSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    job: inboxV2PrivacyExportJobReferenceSchema,
    registryCompositionHash: inboxV2Sha256DigestSchema,
    governance: inboxV2DataGovernanceContextReferenceSchema,
    policy: inboxV2DataLifecyclePolicyReferenceSchema,
    requestAuthorization: inboxV2PrivacyExportAuthorizationCheckpointSchema,
    approval: inboxV2PrivacyExportApprovalSchema,
    checkedAt: inboxV2TimestampSchema,
    governanceCurrent: z.literal(true),
    policyActivationCurrent: z.literal(true)
  })
  .strict();

const inboxV2PrivacyExportCurrentCheckpointResultSchema = z
  .object({
    checkpoint: inboxV2PrivacyExportAuthorizationCheckpointSchema,
    checkedAt: inboxV2TimestampSchema,
    governanceCurrent: z.literal(true),
    policyActivationCurrent: z.literal(true)
  })
  .strict();

const inboxV2PrivacyExportCurrentDecisionResultSchema = z
  .object({
    decision: inboxV2AuthorizationDecisionReferenceSchema,
    checkedAt: inboxV2TimestampSchema,
    governanceCurrent: z.literal(true),
    policyActivationCurrent: z.literal(true)
  })
  .strict();

export type InboxV2PrivacyExportAuthoritySource = Readonly<{
  id: string;
  version: string;
  loadCurrentJobAuthority(
    input: Readonly<{
      job: z.infer<typeof inboxV2PrivacyExportJobReferenceSchema>;
      product: InboxV2PrivacyExportProduct;
      registryCompositionHash: string;
      governance: z.infer<typeof inboxV2DataGovernanceContextReferenceSchema>;
      policy: z.infer<typeof inboxV2DataLifecyclePolicyReferenceSchema>;
      checkedAt: string;
    }>
  ): z.input<typeof inboxV2PrivacyExportCurrentJobAuthorityResultSchema>;
  loadCurrentCheckpoint(
    input: Readonly<{
      job: z.infer<typeof inboxV2PrivacyExportJobReferenceSchema>;
      checkpoint: z.infer<
        typeof inboxV2PrivacyExportAuthorizationCheckpointSchema
      >;
      checkedAt: string;
    }>
  ): z.input<typeof inboxV2PrivacyExportCurrentCheckpointResultSchema>;
  loadCurrentDecision(
    input: Readonly<{
      job: z.infer<typeof inboxV2PrivacyExportJobReferenceSchema>;
      decision: z.infer<typeof inboxV2AuthorizationDecisionReferenceSchema>;
      checkedAt: string;
    }>
  ): z.input<typeof inboxV2PrivacyExportCurrentDecisionResultSchema>;
}>;

const inboxV2PrivacyExportCurrentBundleResultSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    job: inboxV2PrivacyExportJobReferenceSchema,
    manifest: inboxV2PrivacyExportManifestReferenceSchema,
    artifact: inboxV2PrivacyExportArtifactReferenceSchema,
    artifactChecksum: inboxV2Sha256DigestSchema,
    state: z.literal("ready"),
    encryptedPayloadPresent: z.literal(true),
    revoked: z.literal(false),
    checkedAt: inboxV2TimestampSchema
  })
  .strict();

export type InboxV2PrivacyExportCurrentBundleSource = Readonly<{
  id: string;
  version: string;
  loadCurrentBundle(
    input: Readonly<{
      bundle: InboxV2PrivacyExportTerminalBundle;
      checkedAt: string;
    }>
  ): z.input<typeof inboxV2PrivacyExportCurrentBundleResultSchema>;
}>;

export type InboxV2PrivacyExportArchivePackagerSource = Readonly<{
  id: string;
  handlerId: string;
  materialize(
    input: Readonly<{
      manifest: InboxV2PrivacyExportManifest;
      archiveCompositionHash: string;
      checkedAt: string;
    }>
  ): z.input<typeof inboxV2PrivacyExportArchiveMaterializationSchema>;
}>;

export type InboxV2PrivacyExportClaimRepositoryResult =
  | Readonly<{ outcome: "applied"; claimRevision: string }>
  | Readonly<{ outcome: "conflict" }>;

export type InboxV2PrivacyExportClaimLineage = Readonly<{
  job: z.infer<typeof inboxV2PrivacyExportJobReferenceSchema>;
  manifest: z.infer<typeof inboxV2PrivacyExportManifestReferenceSchema>;
  packagingProofHash: string;
  archiveCompositionHash: string;
  issuedReceiptHash: string;
}>;

/**
 * Production implementations must back both methods with a durable unique
 * artifact claim and compare-and-swap receipt row. Process-local memory is not
 * a valid production implementation. This is likewise a bootstrap-injected
 * non-JSON capability; endpoint-supplied repository lookalikes are rejected.
 */
export interface InboxV2PrivacyExportClaimRepository {
  issue(
    input: Readonly<{
      artifactClaimKey: string;
      receiptKey: string;
      principalKey: string;
      issuedRevision: string;
      lineage: InboxV2PrivacyExportClaimLineage;
    }>
  ): Promise<InboxV2PrivacyExportClaimRepositoryResult>;
  consume(
    input: Readonly<{
      artifactClaimKey: string;
      receiptKey: string;
      principalKey: string;
      expectedRevision: string;
      nextRevision: string;
      lineage: InboxV2PrivacyExportClaimLineage;
    }>
  ): Promise<InboxV2PrivacyExportClaimRepositoryResult>;
}

/** Composition-root registration for the durable unique-claim/CAS adapter. */
export function defineInboxV2PrivacyExportClaimRepository(
  repository: InboxV2PrivacyExportClaimRepository
): InboxV2PrivacyExportClaimRepository {
  if (
    typeof repository.issue !== "function" ||
    typeof repository.consume !== "function"
  ) {
    throw new Error("Privacy export claim repository is invalid.");
  }
  const result = Object.freeze({ ...repository });
  authenticClaimRepositories.add(result);
  return result;
}

/** Trusted bootstrap boundary for versioned export projection definitions. */
export function defineInboxV2PrivacyExportProjectionCatalog(input: {
  catalog: z.input<typeof inboxV2PrivacyExportProjectionCatalogSchema>;
  registry: InboxV2DataLifecycleRegistry;
}): InboxV2PrivacyExportProjectionCatalog {
  requireAuthenticLifecycleRegistry(input.registry);
  const profiles = input.catalog.profiles.map((profile) =>
    parseTrustedProjectionProfile(profile, input.registry)
  );
  const catalogBody = { ...input.catalog, profiles };
  const catalog = deepFreezePrivacyExport(
    inboxV2PrivacyExportProjectionCatalogSchema.parse({
      ...catalogBody,
      digest: calculateInboxV2PrivacyExportProjectionCatalogDigest(catalogBody)
    })
  );
  authenticProjectionCatalogs.add(catalog);
  return catalog;
}

/** Resolves an exact profile only from an authentic versioned catalog. */
export function defineInboxV2PrivacyExportProjectionProfile(input: {
  reference: z.input<
    typeof inboxV2PrivacyExportProjectionProfileReferenceSchema
  >;
  catalog: InboxV2PrivacyExportProjectionCatalog;
}): InboxV2PrivacyExportProjectionProfile {
  if (!authenticProjectionCatalogs.has(input.catalog)) {
    throw new Error(
      "Projection profile requires an authentic trusted projection catalog."
    );
  }
  const reference = inboxV2PrivacyExportProjectionProfileReferenceSchema.parse(
    input.reference
  );
  const profile = input.catalog.profiles.find((candidate) =>
    sameStructuredValue(candidate.reference, reference)
  );
  if (profile === undefined) {
    throw new Error(
      "Projection profile reference is not registered in the trusted catalog."
    );
  }
  authenticProjectionProfiles.add(profile);
  return profile;
}

function parseTrustedProjectionProfile(
  rawProfile: z.input<typeof inboxV2PrivacyExportProjectionProfileSchema>,
  registry: InboxV2DataLifecycleRegistry
): InboxV2PrivacyExportProjectionProfile {
  const profile = inboxV2PrivacyExportProjectionProfileSchema.parse({
    ...rawProfile,
    reference: {
      ...rawProfile.reference,
      digest: calculateInboxV2PrivacyExportProjectionProfileDigest(rawProfile)
    }
  });
  const classById = new Map(
    registry.dataClasses.map((entry) => [String(entry.id), entry])
  );
  const handlerById = new Map(
    registry.handlers.map((entry) => [String(entry.id), entry])
  );
  for (const field of profile.fields) {
    const dataClass = classById.get(String(field.dataClassId));
    if (
      dataClass === undefined ||
      dataClass.definition.sensitivity === "secret" ||
      dataClass.definition.exportBehavior === "never"
    ) {
      throw new Error(
        `Projection field ${field.fieldId} uses an unknown or non-exportable class.`
      );
    }
  }
  for (const handlerId of profile.projectionHandlerIds) {
    const handler = handlerById.get(String(handlerId));
    if (
      handler === undefined ||
      handler.definition.kind !== "export_projection" ||
      !handler.definition.supportedOperations.includes("export") ||
      !handler.definition.checksTenantFence ||
      !handler.definition.checksRevisionFence ||
      !registry.dataUses.some(
        (use) => use.exportProjectionHandlerId === handlerId
      )
    ) {
      throw new Error(
        `Projection handler ${handlerId} is not a registered export projection.`
      );
    }
  }
  return deepFreezePrivacyExport(profile);
}

export function defineInboxV2DataSubjectExportScopeProof(input: {
  job: z.input<typeof inboxV2PrivacyExportJobReferenceSchema>;
  request: InboxV2PrivacyRequest;
  evaluatedAt?: string;
}): InboxV2DataSubjectExportScopeProof {
  if (!isInboxV2PrivacyRequest(input.request)) {
    throw new Error(
      "Data-subject export proof requires an authentic loaded privacy request."
    );
  }
  const request = input.request;
  if (
    (request.intent !== "access" && request.intent !== "portability") ||
    !("verification" in request.workflow) ||
    !("discovery" in request.workflow) ||
    !("decision" in request.workflow) ||
    request.workflow.verification.status !== "verified" ||
    !["approved", "partially_approved"].includes(
      request.workflow.decision.result
    )
  ) {
    throw new Error(
      "Data-subject export requires an approved verified access/portability request."
    );
  }
  const approvedDisposition =
    request.intent === "access" ? "include_normalized" : "include_portable";
  const discoveryRoots = request.workflow.decision.rootDecisions.map(
    ({ root }) => root
  );
  const approvedRoots = request.workflow.decision.rootDecisions
    .filter(({ disposition }) => disposition === approvedDisposition)
    .map(({ root }) => root);
  const proofBody = {
    kind: "data_subject_scope_proof" as const,
    tenantId: request.tenantId,
    job: inboxV2PrivacyExportJobReferenceSchema.parse(input.job),
    request: {
      tenantId: request.tenantId,
      requestId: request.id,
      revision: request.revision
    },
    requesterSubject: request.requesterSubject,
    intent: request.intent,
    verification: request.workflow.verification,
    discovery: request.workflow.discovery,
    discoveryRoots,
    decisionReference: {
      tenantId: request.tenantId,
      decisionId: request.workflow.decision.id,
      revision: request.workflow.decision.revision,
      digest: request.workflow.decision.digest
    },
    decision: request.workflow.decision,
    approvedRoots,
    evaluatedAt: input.evaluatedAt ?? input.job.requestedAt
  };
  const proof = deepFreezePrivacyExport(
    inboxV2DataSubjectExportScopeProofSchema.parse({
      ...proofBody,
      proofHash: calculateInboxV2DataSubjectExportScopeProofHash({
        ...proofBody,
        proofHash: `sha256:${"0".repeat(64)}`
      })
    })
  );
  authenticDataSubjectScopeProofs.add(proof);
  return proof;
}

/** Composition-root registration for the authoritative privacy-request reader. */
export function defineInboxV2DataSubjectCurrentRequestSource(
  source: InboxV2DataSubjectCurrentRequestSource
): InboxV2DataSubjectCurrentRequestSource {
  if (source.id.length === 0 || typeof source.loadCurrent !== "function") {
    throw new Error("Current privacy-request source is invalid.");
  }
  const result = Object.freeze({ ...source });
  authenticCurrentDataSubjectRequestSources.add(result);
  return result;
}

/** Reloads current request state/revisions for issue or consume authorization. */
export function defineInboxV2CurrentDataSubjectExportScopeProof(input: {
  source: InboxV2DataSubjectCurrentRequestSource;
  job: z.input<typeof inboxV2PrivacyExportJobReferenceSchema>;
  request: z.input<typeof inboxV2PrivacyRequestReferenceSchema>;
  checkedAt: string;
}): InboxV2DataSubjectExportScopeProof {
  if (!authenticCurrentDataSubjectRequestSources.has(input.source)) {
    throw new Error(
      "Current data-subject proof requires a registered privacy-request source."
    );
  }
  const requestReference = inboxV2PrivacyRequestReferenceSchema.parse(
    input.request
  );
  const checkedAt = inboxV2TimestampSchema.parse(input.checkedAt);
  const currentRequest = input.source.loadCurrent({
    tenantId: requestReference.tenantId,
    requestId: requestReference.requestId,
    checkedAt
  });
  if (
    !isInboxV2PrivacyRequest(currentRequest) ||
    currentRequest.tenantId !== requestReference.tenantId ||
    currentRequest.id !== requestReference.requestId
  ) {
    throw new Error(
      "Current privacy-request source returned the wrong or unauthentic request."
    );
  }
  const proof = defineInboxV2DataSubjectExportScopeProof({
    job: input.job,
    request: currentRequest,
    evaluatedAt: checkedAt
  });
  authenticCurrentDataSubjectScopeProofs.add(proof);
  return proof;
}

/** Composition-root registration for the authoritative report/RBAC reader. */
export function defineInboxV2ManagerReportAuthoritySource(
  source: InboxV2ManagerReportAuthoritySource
): InboxV2ManagerReportAuthoritySource {
  if (source.id.length === 0 || typeof source.resolve !== "function") {
    throw new Error("Manager report authority source is invalid.");
  }
  const result = Object.freeze({ ...source });
  authenticManagerReportAuthoritySources.add(result);
  return result;
}

/** Resolves report authority only through the registered upstream source. */
export function defineInboxV2ManagerReportExportAuthority(input: {
  source: InboxV2ManagerReportAuthoritySource;
  job: z.input<typeof inboxV2PrivacyExportJobReferenceSchema>;
  principal: z.input<
    typeof inboxV2AuthorizationDecisionReferenceSchema
  >["principal"];
  checkedAt: string;
}): InboxV2ManagerReportExportAuthority {
  if (!authenticManagerReportAuthoritySources.has(input.source)) {
    throw new Error(
      "Manager report authority requires a registered composition-root source."
    );
  }
  const sourceResult = input.source.resolve({
    job: inboxV2PrivacyExportJobReferenceSchema.parse(input.job),
    principal: input.principal,
    checkedAt: inboxV2TimestampSchema.parse(input.checkedAt)
  });
  const authorizationManifest = {
    ...sourceResult.authorizationManifest,
    digest: calculateInboxV2ManagerReportAuthorizationManifestDigest(
      sourceResult.authorizationManifest
    )
  };
  const body = {
    ...sourceResult,
    authorizationManifest
  };
  const authority = deepFreezePrivacyExport(
    inboxV2ManagerReportExportScopeProofSchema.parse({
      ...body,
      proofHash: calculateInboxV2ManagerReportExportScopeProofHash(body)
    })
  );
  if (
    !sameStructuredValue(authority.job, input.job) ||
    managerReportAuthorizationManifestPrincipalKey(
      authority.authorizationManifest
    ) !== authorizationPrincipalReferenceKey(input.principal) ||
    authority.authorizationManifest.evaluatedAt !== input.checkedAt
  ) {
    throw new Error(
      "Manager report source result must match the exact job and current check time."
    );
  }
  authenticManagerReportAuthorities.add(authority);
  return authority;
}

export function defineInboxV2ManagerReportExportScopeProof(input: {
  authority: InboxV2ManagerReportExportAuthority;
}): InboxV2ManagerReportExportScopeProof {
  if (!authenticManagerReportAuthorities.has(input.authority)) {
    throw new Error(
      "Manager report export proof requires an authentic current report authority source."
    );
  }
  authenticManagerReportScopeProofs.add(input.authority);
  return input.authority;
}

export function defineInboxV2PrivacyExportAuthoritySource(input: {
  id: string;
  version: string;
  loadCurrentJobAuthority: InboxV2PrivacyExportAuthoritySource["loadCurrentJobAuthority"];
  loadCurrentCheckpoint: InboxV2PrivacyExportAuthoritySource["loadCurrentCheckpoint"];
  loadCurrentDecision: InboxV2PrivacyExportAuthoritySource["loadCurrentDecision"];
}): InboxV2PrivacyExportAuthoritySource {
  const reference = inboxV2VersionedProfileReferenceSchema.parse({
    id: input.id,
    version: input.version
  });
  if (
    typeof input.loadCurrentJobAuthority !== "function" ||
    typeof input.loadCurrentCheckpoint !== "function" ||
    typeof input.loadCurrentDecision !== "function"
  ) {
    throw new Error(
      "Export authority source requires a server-owned current authority loader."
    );
  }
  const source = Object.freeze({
    ...reference,
    loadCurrentJobAuthority: input.loadCurrentJobAuthority,
    loadCurrentCheckpoint: input.loadCurrentCheckpoint,
    loadCurrentDecision: input.loadCurrentDecision
  });
  authenticExportAuthoritySources.add(source);
  return source;
}

export function defineInboxV2PrivacyExportCurrentBundleSource(input: {
  id: string;
  version: string;
  loadCurrentBundle: InboxV2PrivacyExportCurrentBundleSource["loadCurrentBundle"];
}): InboxV2PrivacyExportCurrentBundleSource {
  const reference = inboxV2VersionedProfileReferenceSchema.parse({
    id: input.id,
    version: input.version
  });
  if (typeof input.loadCurrentBundle !== "function") {
    throw new Error(
      "Current export bundle source requires a server-owned state loader."
    );
  }
  const source = Object.freeze({
    ...reference,
    loadCurrentBundle: input.loadCurrentBundle
  });
  authenticCurrentBundleSources.add(source);
  return source;
}

/**
 * Registry-bound constructor used before an export job is persisted. The wire
 * schema stays self-contained, while executable scope cannot trust caller-
 * supplied class metadata, purpose, field IDs or handler lineage.
 */
export function defineInboxV2PrivacyExportScope(input: {
  scope: z.input<typeof inboxV2PrivacyExportScopeSchema>;
  product: z.input<typeof inboxV2PrivacyExportProductSchema>;
  format: z.input<typeof inboxV2PrivacyExportFormatSchema>;
  projectionProfile: InboxV2PrivacyExportProjectionProfile;
  registry: InboxV2DataLifecycleRegistry;
}): InboxV2PrivacyExportScope {
  requireAuthenticLifecycleRegistry(input.registry);
  if (!authenticProjectionProfiles.has(input.projectionProfile)) {
    throw new Error("Export scope requires an authentic projection profile.");
  }
  const scope = inboxV2PrivacyExportScopeSchema.parse(input.scope);
  const product = inboxV2PrivacyExportProductSchema.parse(input.product);
  const format = inboxV2PrivacyExportFormatSchema.parse(input.format);
  const profile = input.projectionProfile;
  if (
    !sameStructuredValue(scope.projectionProfile, profile.reference) ||
    profile.productKind !== product.kind ||
    !profile.formats.some(
      (candidate) => exportFormatKey(candidate) === exportFormatKey(format)
    )
  ) {
    throw new Error(
      "Export scope projection profile does not support its exact product and format."
    );
  }
  const classById = new Map(
    input.registry.dataClasses.map((entry) => [String(entry.id), entry])
  );
  const rootById = new Map(
    input.registry.storageRoots.map((entry) => [String(entry.id), entry])
  );
  const handlerById = new Map(
    input.registry.handlers.map((entry) => [String(entry.id), entry])
  );
  const selectedClassIds = scope.classes.map(({ dataClassId }) =>
    String(dataClassId)
  );
  const projectionClassIds = profile.fields.map(({ dataClassId }) =>
    String(dataClassId)
  );
  if (!sameCanonicalValues(selectedClassIds, projectionClassIds)) {
    throw new Error(
      "Export scope classes must match the registered projection field classes exactly."
    );
  }

  for (const selection of scope.classes) {
    const registered = classById.get(String(selection.dataClassId));
    if (registered === undefined) {
      throw new Error(`Unknown export data class ${selection.dataClassId}.`);
    }
    if (
      registered.definition.sensitivity !== selection.sensitivity ||
      registered.definition.exportBehavior !== selection.exportBehavior ||
      registered.definition.exportBehavior === "never" ||
      !isExportBehaviorAllowedForProduct(selection.exportBehavior, product) ||
      (product.kind !== "tenant_deployment" &&
        !registered.definition.allowedPurposeIds.includes(scope.purposeId))
    ) {
      throw new Error(
        `Export data class ${selection.dataClassId} does not match its registered policy.`
      );
    }
  }

  for (const use of scope.dataUses) {
    const dataClass = classById.get(String(use.dataClassId));
    const root = rootById.get(String(use.storageRootId));
    const projectionHandler = handlerById.get(String(use.projectionHandlerId));
    const exportHandler = handlerById.get(String(use.exportHandlerId));
    if (dataClass === undefined) {
      throw new Error(`Unknown export data class ${use.dataClassId}.`);
    }
    if (root === undefined) {
      throw new Error(`Unknown export storage root ${use.storageRootId}.`);
    }
    if (
      projectionHandler === undefined ||
      projectionHandler.definition.kind !== "export_projection" ||
      !projectionHandler.definition.supportedRootKinds.includes(
        root.definition.kind
      ) ||
      !projectionHandler.definition.supportedOperations.includes("export") ||
      !projectionHandler.definition.checksTenantFence ||
      !projectionHandler.definition.checksRevisionFence ||
      !profile.projectionHandlerIds.includes(use.projectionHandlerId)
    ) {
      throw new Error(
        `Projection handler ${use.projectionHandlerId} is missing or incompatible with ${use.storageRootId}.`
      );
    }
    if (
      exportHandler === undefined ||
      exportHandler.definition.kind !== "export_execution" ||
      !exportHandler.definition.supportedRootKinds.includes(
        root.definition.kind
      ) ||
      !exportHandler.definition.supportedOperations.includes("export") ||
      !exportHandler.definition.checksTenantFence ||
      !exportHandler.definition.checksRevisionFence
    ) {
      throw new Error(
        `Export handler ${use.exportHandlerId} is missing or incompatible with ${use.storageRootId}.`
      );
    }
    const declared = input.registry.dataUses.some(
      (candidate) =>
        candidate.dataClassId === use.dataClassId &&
        candidate.storageRootId === use.storageRootId &&
        (product.kind === "tenant_deployment" ||
          candidate.purposeIds.includes(scope.purposeId)) &&
        candidate.exportProjectionHandlerId === use.projectionHandlerId &&
        candidate.exportHandlerId === use.exportHandlerId &&
        candidate.operations.includes("export")
    );
    if (!declared) {
      throw new Error(
        `Export data use ${use.dataClassId}/${use.storageRootId}/${scope.purposeId} has no registered exact purpose and handler lineage.`
      );
    }
  }

  if (product.kind === "tenant_deployment") {
    const expectedUses = input.registry.dataUses
      .filter((use) => {
        const dataClass = classById.get(String(use.dataClassId));
        const root = rootById.get(String(use.storageRootId));
        return (
          dataClass !== undefined &&
          root !== undefined &&
          root.definition.kind !== "backup" &&
          root.definition.kind !== "external_route" &&
          dataClass.definition.sensitivity !== "secret" &&
          isExportBehaviorAllowedForProduct(
            dataClass.definition.exportBehavior,
            product
          ) &&
          use.exportProjectionHandlerId !== null &&
          use.exportHandlerId !== null
        );
      })
      .map(
        ({ dataClassId, storageRootId }) =>
          `${dataClassId}\u0000${storageRootId}`
      )
      .sort();
    const selectedUses = scope.dataUses
      .map(
        ({ dataClassId, storageRootId }) =>
          `${dataClassId}\u0000${storageRootId}`
      )
      .sort();
    const expectedClasses = [
      ...new Set(expectedUses.map((key) => key.split("\u0000", 1)[0]!))
    ].sort();
    if (
      !sameCanonicalValues(selectedUses, expectedUses) ||
      !sameCanonicalValues([...selectedClassIds].sort(), expectedClasses)
    ) {
      throw new Error(
        "Tenant deployment export scope must include every exportable registry data use and class."
      );
    }
  }

  return scope;
}

/** Registry/projection/product-proof-bound constructor for an executable job. */
export function defineInboxV2PrivacyExportJob(input: {
  job: z.input<typeof inboxV2PrivacyExportJobSchema>;
  registry: InboxV2DataLifecycleRegistry;
  projectionProfile: InboxV2PrivacyExportProjectionProfile;
  scopeProof: InboxV2PrivacyExportProductScopeProof | null;
  authoritySource: InboxV2PrivacyExportAuthoritySource;
}): InboxV2PrivacyExportJob {
  const job = inboxV2PrivacyExportJobSchema.parse(input.job);
  defineInboxV2PrivacyExportScope({
    scope: job.scope,
    product: job.product,
    format: job.format,
    projectionProfile: input.projectionProfile,
    registry: input.registry
  });
  validateExecutableExportProductProof(job, input.scopeProof);
  if (
    job.product.kind === "tenant_deployment" &&
    (input.scopeProof?.kind !== "tenant_termination_scope" ||
      input.scopeProof.registryCompositionHash !==
        input.registry.compositionHash)
  ) {
    throw new Error(
      "Tenant deployment scope proof must match the exact current registry composition."
    );
  }
  const authorityCheckedAt =
    job.approval.kind === "separated_approval"
      ? job.approval.approvedAt
      : job.requestAuthorization.checkedAt;
  assertCurrentPrivacyExportAuthority({
    source: input.authoritySource,
    job,
    registry: input.registry,
    scopeProof: input.scopeProof,
    checkedAt: authorityCheckedAt
  });
  return job;
}

/** Composition-root registration for the complete-root enumeration adapter. */
export function defineInboxV2PrivacyExportScopeEnumerationSource(input: {
  source: InboxV2PrivacyExportScopeEnumerationSource;
  registry: InboxV2DataLifecycleRegistry;
}): InboxV2PrivacyExportScopeEnumerationSource {
  requireAuthenticLifecycleRegistry(input.registry);
  const handler = input.registry.handlers.find(
    ({ id }) => id === input.source.handlerId
  );
  if (
    input.source.id.length === 0 ||
    typeof input.source.enumerate !== "function" ||
    handler === undefined ||
    handler.definition.kind !== "subject_discovery" ||
    !handler.definition.supportedOperations.includes("read") ||
    !handler.definition.checksTenantFence ||
    !handler.definition.checksRevisionFence
  ) {
    throw new Error(
      "Scope enumeration source requires a registered revision-fenced discovery handler."
    );
  }
  const result = Object.freeze({ ...input.source });
  authenticScopeEnumerationSources.add(result);
  return result;
}

/** Resolves the complete boundary-pinned root set only through that adapter. */
export function defineInboxV2PrivacyExportScopeEnumeration(input: {
  source: InboxV2PrivacyExportScopeEnumerationSource;
  job: z.input<typeof inboxV2PrivacyExportJobSchema>;
  registry: InboxV2DataLifecycleRegistry;
  projectionProfile: InboxV2PrivacyExportProjectionProfile;
  scopeProof: InboxV2PrivacyExportProductScopeProof | null;
  authoritySource: InboxV2PrivacyExportAuthoritySource;
}): InboxV2PrivacyExportScopeEnumeration {
  if (!authenticScopeEnumerationSources.has(input.source)) {
    throw new Error(
      "Scope enumeration requires a registered composition-root source."
    );
  }
  const job = defineInboxV2PrivacyExportJob({
    job: input.job,
    registry: input.registry,
    projectionProfile: input.projectionProfile,
    scopeProof: input.scopeProof,
    authoritySource: input.authoritySource
  });
  const body = input.source.enumerate({
    job: exportJobReference(job),
    product: job.product,
    scope: job.scope,
    boundary: job.boundary,
    productScopeProofHash: exportProductScopeProofHash(job.product)
  });
  const enumeration = inboxV2PrivacyExportScopeEnumerationSchema.parse({
    ...body,
    digest: calculateInboxV2PrivacyExportScopeEnumerationDigest(body)
  });
  const sourceHandler = input.registry.handlers.find(
    ({ id }) => id === input.source.handlerId
  );
  const selectedUses = new Set(
    job.scope.dataUses.map(
      ({ dataClassId, storageRootId }) => `${dataClassId}\u0000${storageRootId}`
    )
  );
  if (
    sourceHandler === undefined ||
    sourceHandler.definition.kind !== "subject_discovery" ||
    !sourceHandler.definition.supportedOperations.includes("read") ||
    !sourceHandler.definition.checksTenantFence ||
    !sourceHandler.definition.checksRevisionFence ||
    enumeration.sourceHandlerId !== input.source.handlerId ||
    !sameStructuredValue(enumeration.job, exportJobReference(job)) ||
    !sameStructuredValue(enumeration.product, job.product) ||
    !sameStructuredValue(enumeration.scope, job.scope) ||
    !sameStructuredValue(enumeration.boundary, job.boundary) ||
    !isTimestampAtOrAfter(enumeration.completedAt, job.requestedAt) ||
    enumeration.roots.some(
      ({ root }) =>
        !selectedUses.has(`${root.dataClassId}\u0000${root.storageRootId}`)
    )
  ) {
    throw new Error(
      "Export scope enumeration requires an exact trusted source handler, job, product, scope and boundary."
    );
  }
  const enumeratedRootKeys = enumeration.roots.map(({ root }) =>
    dataRootReferenceKey(root)
  );
  if (
    input.scopeProof?.kind === "tenant_termination_scope" &&
    (!sameCanonicalValues(
      enumeratedRootKeys,
      inboxV2TenantTerminationExportRoots(input.scopeProof).map(({ root }) =>
        dataRootReferenceKey(root)
      )
    ) ||
      enumeration.roots.some((root) => {
        const expected = inboxV2TenantTerminationExportRoots(
          input.scopeProof as InboxV2TenantTerminationScopeManifest
        ).find(
          (candidate) =>
            dataRootReferenceKey(candidate.root) ===
            dataRootReferenceKey(root.root)
        );
        return (
          expected === undefined ||
          expected.expectedEntityRevision !== root.expectedEntityRevision ||
          expected.expectedLineageRevision !== root.expectedLineageRevision
        );
      }))
  ) {
    throw new Error(
      "Tenant deployment enumeration must cover the exact tenant-wide exportable root revisions."
    );
  }
  if (
    input.scopeProof?.kind === "data_subject_scope_proof" &&
    !sameCanonicalValues(
      enumeratedRootKeys,
      input.scopeProof.approvedRoots.map(dataRootReferenceKey)
    )
  ) {
    throw new Error(
      "Data-subject enumeration must cover the exact approved request roots."
    );
  }
  if (
    input.scopeProof?.kind === "manager_report_scope_proof" &&
    (!sameCanonicalValues(
      enumeratedRootKeys,
      input.scopeProof.authorizationManifest.authorizedRoots.map(({ root }) =>
        dataRootReferenceKey(root)
      )
    ) ||
      enumeration.roots.some((root) => {
        const authorized =
          input.scopeProof?.kind === "manager_report_scope_proof"
            ? input.scopeProof.authorizationManifest.authorizedRoots.find(
                (candidate) =>
                  dataRootReferenceKey(candidate.root) ===
                  dataRootReferenceKey(root.root)
              )
            : undefined;
        return (
          authorized === undefined ||
          authorized.expectedEntityRevision !== root.expectedEntityRevision ||
          authorized.expectedLineageRevision !== root.expectedLineageRevision
        );
      }))
  ) {
    throw new Error(
      "Manager enumeration must cover exact currently authorized root revisions."
    );
  }
  const result = deepFreezePrivacyExport(enumeration);
  authenticScopeEnumerations.add(result);
  return result;
}

/**
 * Materializes a canonical immutable manifest from already authorized chunk or
 * verified-zero evidence. Hashes, totals and scope-completion counters are
 * derived here rather than trusted from an API caller.
 */
export function defineInboxV2PrivacyExportManifest(input: {
  manifest: z.input<typeof inboxV2PrivacyExportManifestSchema>;
  job: z.input<typeof inboxV2PrivacyExportJobSchema>;
  registry: InboxV2DataLifecycleRegistry;
  projectionProfile: InboxV2PrivacyExportProjectionProfile;
  scopeProof: InboxV2PrivacyExportProductScopeProof | null;
  enumeration: InboxV2PrivacyExportScopeEnumeration;
  authoritySource: InboxV2PrivacyExportAuthoritySource;
}): InboxV2PrivacyExportManifest {
  if (!authenticScopeEnumerations.has(input.enumeration)) {
    throw new Error(
      "Export manifest requires an authentic complete scope enumeration."
    );
  }
  const job = defineInboxV2PrivacyExportJob({
    job: input.job,
    registry: input.registry,
    projectionProfile: input.projectionProfile,
    scopeProof: input.scopeProof,
    authoritySource: input.authoritySource
  });
  const itemCount = input.manifest.chunks.reduce(
    (total, chunk) => total + BigInt(chunk.itemCount),
    0n
  );
  const byteCount = input.manifest.chunks.reduce(
    (total, chunk) => total + BigInt(chunk.byteCount),
    0n
  );
  const enumeratedRootKeys = input.enumeration.roots.map(({ root }) =>
    dataRootReferenceKey(root)
  );
  const emittedRootKeys = [
    ...new Set(
      input.manifest.chunks.map(({ root }) =>
        unparsedDataRootReferenceKey(root)
      )
    )
  ];
  if (
    !sameCanonicalValues(enumeratedRootKeys, emittedRootKeys) ||
    input.manifest.chunks.some((chunk) => {
      const enumerated = input.enumeration.roots.find(
        ({ root }) =>
          dataRootReferenceKey(root) ===
          unparsedDataRootReferenceKey(chunk.root)
      );
      return (
        enumerated === undefined ||
        String(enumerated.expectedEntityRevision) !==
          String(chunk.expectedEntityRevision) ||
        String(enumerated.expectedLineageRevision) !==
          String(chunk.expectedLineageRevision)
      );
    })
  ) {
    throw new Error(
      "Export manifest must cover the exact enumerated roots and current entity/lineage revisions."
    );
  }
  const enumerationReference = privacyExportEnumerationReference(
    input.enumeration
  );
  const verifiedZeroEvidence =
    input.manifest.verifiedZeroEvidence === null
      ? null
      : {
          ...input.manifest.verifiedZeroEvidence,
          enumeration: enumerationReference,
          evidenceHash: calculateInboxV2PrivacyExportVerifiedZeroEvidenceHash({
            ...input.manifest.verifiedZeroEvidence,
            enumeration: enumerationReference
          })
        };
  const canonicalBase = {
    ...input.manifest,
    verifiedZeroEvidence,
    totalItemCount: String(itemCount),
    totalByteCount: String(byteCount),
    scopeCompletion: {
      ...input.manifest.scopeCompletion,
      enumeration: enumerationReference,
      expectedRootCount: String(enumeratedRootKeys.length),
      emittedRootCount: String(emittedRootKeys.length),
      finalChunkOrdinal: input.manifest.chunks.at(-1)?.ordinal ?? null,
      rootSetHash: calculateInboxV2CanonicalSha256({
        domain: "core:inbox-v2.privacy-export-root-set",
        hashVersion: "v1",
        roots: input.enumeration.roots
      }),
      completionHash: `sha256:${"0".repeat(64)}`
    },
    manifestHash: `sha256:${"0".repeat(64)}`
  };
  const withCompletionHash = {
    ...canonicalBase,
    scopeCompletion: {
      ...canonicalBase.scopeCompletion,
      completionHash:
        calculateInboxV2PrivacyExportScopeCompletionHash(canonicalBase)
    }
  };
  const manifest = inboxV2PrivacyExportManifestSchema.parse({
    ...withCompletionHash,
    manifestHash: calculateInboxV2PrivacyExportManifestHash(withCompletionHash)
  });
  for (const chunk of manifest.chunks) {
    assertCurrentPrivacyExportAuthority({
      source: input.authoritySource,
      job,
      registry: input.registry,
      scopeProof: input.scopeProof,
      checkedAt: chunk.materializedAt
    });
    for (const checkpoint of [
      chunk.authorization,
      ...chunk.rootAuthorizations,
      chunk.lineageAuthorization
    ]) {
      assertCurrentPrivacyExportCheckpoint({
        source: input.authoritySource,
        job,
        checkpoint,
        checkedAt: chunk.materializedAt
      });
    }
  }
  if (manifest.verifiedZeroEvidence !== null) {
    assertCurrentPrivacyExportAuthority({
      source: input.authoritySource,
      job,
      registry: input.registry,
      scopeProof: input.scopeProof,
      checkedAt: manifest.verifiedZeroEvidence.verifiedAt
    });
    assertCurrentPrivacyExportCheckpoint({
      source: input.authoritySource,
      job,
      checkpoint: manifest.verifiedZeroEvidence.authorization,
      checkedAt: manifest.verifiedZeroEvidence.verifiedAt
    });
  }
  if (
    !sameCanonicalValues(enumeratedRootKeys, emittedRootKeys) ||
    input.manifest.chunks.some((chunk) => {
      const enumerated = input.enumeration.roots.find(
        ({ root }) =>
          dataRootReferenceKey(root) ===
          unparsedDataRootReferenceKey(chunk.root)
      );
      return (
        enumerated === undefined ||
        enumerated.expectedEntityRevision !== chunk.expectedEntityRevision ||
        enumerated.expectedLineageRevision !== chunk.expectedLineageRevision
      );
    }) ||
    !sameStructuredValue(input.enumeration.job, exportJobReference(job)) ||
    !sameStructuredValue(manifest.job, exportJobReference(job)) ||
    !sameStructuredValue(manifest.product, job.product) ||
    !sameStructuredValue(manifest.scope, job.scope) ||
    !sameStructuredValue(manifest.boundary, job.boundary) ||
    !sameStructuredValue(manifest.governance, job.governance) ||
    !sameStructuredValue(manifest.policy, job.policy) ||
    !sameStructuredValue(manifest.format, job.format)
  ) {
    throw new Error(
      "Export manifest must cover the exact enumerated roots and executable job scope/policy lineage."
    );
  }
  validateTerminalProductScopeCoverage(manifest, input.scopeProof);
  const result = deepFreezePrivacyExport(manifest);
  authenticExportManifests.add(result);
  exportManifestAuthorityBindings.set(result, {
    job,
    registry: input.registry,
    scopeProof: input.scopeProof,
    authoritySource: input.authoritySource
  });
  return result;
}

/** Composition-root registration for the byte-materializing packager. */
export function defineInboxV2PrivacyExportArchivePackagerSource(input: {
  source: InboxV2PrivacyExportArchivePackagerSource;
  registry: InboxV2DataLifecycleRegistry;
}): InboxV2PrivacyExportArchivePackagerSource {
  requireAuthenticLifecycleRegistry(input.registry);
  const handler = input.registry.handlers.find(
    ({ id }) => id === input.source.handlerId
  );
  if (
    input.source.id.length === 0 ||
    typeof input.source.materialize !== "function" ||
    handler === undefined ||
    handler.definition.kind !== "export_execution" ||
    !handler.definition.supportedOperations.includes("export") ||
    !handler.definition.checksTenantFence ||
    !handler.definition.checksRevisionFence
  ) {
    throw new Error(
      "Archive packager source requires a registered revision-fenced export handler."
    );
  }
  const result = Object.freeze({ ...input.source });
  authenticArchivePackagerSources.add(result);
  return result;
}

/** Resolves proof from the adapter that observed the actual encrypted bytes. */
export function defineInboxV2PrivacyExportArchiveMaterialization(input: {
  source: InboxV2PrivacyExportArchivePackagerSource;
  manifest: InboxV2PrivacyExportManifest;
  registry: InboxV2DataLifecycleRegistry;
  checkedAt: string;
}): InboxV2PrivacyExportArchiveMaterialization {
  if (
    !authenticExportManifests.has(input.manifest) ||
    !authenticArchivePackagerSources.has(input.source)
  ) {
    throw new Error(
      "Archive materialization requires authentic manifest and registered packager source."
    );
  }
  requireAuthenticLifecycleRegistry(input.registry);
  const authority = exportManifestAuthorityBindings.get(input.manifest);
  const checkedAt = inboxV2TimestampSchema.parse(input.checkedAt);
  if (
    authority === undefined ||
    authority.registry.compositionHash !== input.registry.compositionHash
  ) {
    throw new Error(
      "Archive materialization requires the manifest's exact current authority binding."
    );
  }
  assertCurrentPrivacyExportAuthority({
    source: authority.authoritySource,
    job: authority.job,
    registry: authority.registry,
    scopeProof: authority.scopeProof,
    checkedAt
  });
  const archiveCompositionHash =
    calculateInboxV2PrivacyExportArchiveCompositionHash(input.manifest);
  const body = input.source.materialize({
    manifest: input.manifest,
    archiveCompositionHash,
    checkedAt
  });
  const materialization =
    inboxV2PrivacyExportArchiveMaterializationSchema.parse({
      ...body,
      proofHash:
        calculateInboxV2PrivacyExportArchiveMaterializationProofHash(body)
    });
  if (
    materialization.packagerHandlerId !== input.source.handlerId ||
    !sameStructuredValue(
      materialization.manifest,
      exportManifestReference(input.manifest)
    ) ||
    materialization.archiveCompositionHash !== archiveCompositionHash ||
    materialization.materializedAt !== checkedAt ||
    !isTimestampAtOrAfter(
      materialization.materializedAt,
      input.manifest.generatedAt
    )
  ) {
    throw new Error(
      "Packager source result must bind actual encrypted bytes to the exact manifest composition."
    );
  }
  const result = deepFreezePrivacyExport(materialization);
  authenticArchiveMaterializations.add(result);
  return result;
}

/**
 * Seals the immutable archive materialization to one authentic manifest. The
 * archive composition and packaging proof are always derived by this API.
 */
export function defineInboxV2PrivacyExportReadyArtifact(input: {
  artifact: Extract<
    z.input<typeof inboxV2PrivacyExportArtifactSchema>,
    { state: "ready" }
  >;
  manifest: InboxV2PrivacyExportManifest;
  materialization: InboxV2PrivacyExportArchiveMaterialization;
}): InboxV2PrivacyExportArtifact & { state: "ready" } {
  if (!authenticExportManifests.has(input.manifest)) {
    throw new Error(
      "Ready export artifact requires an authentic immutable manifest."
    );
  }
  if (!authenticArchiveMaterializations.has(input.materialization)) {
    throw new Error(
      "Ready export artifact requires an authentic packager materialization result."
    );
  }
  const canonicalBase = {
    ...input.artifact,
    manifest: input.materialization.manifest,
    encryptedPayload: input.materialization.encryptedPayload,
    encryptedByteCount: input.materialization.encryptedByteCount,
    encryptionProfileId: input.materialization.encryptionProfileId,
    checksum: input.materialization.encryptedPayload.digest,
    archiveCompositionHash: input.materialization.archiveCompositionHash,
    readyAt: input.materialization.materializedAt,
    packagingProofHash: `sha256:${"0".repeat(64)}`
  };
  const artifact = inboxV2PrivacyExportArtifactSchema.parse({
    ...canonicalBase,
    packagingProofHash:
      calculateInboxV2PrivacyExportArtifactPackagingProofHash(canonicalBase)
  });
  if (
    artifact.state !== "ready" ||
    !sameStructuredValue(artifact.job, input.manifest.job) ||
    !sameStructuredValue(artifact.product, input.manifest.product) ||
    artifact.encryptedPayload.digest !==
      input.materialization.encryptedPayload.digest ||
    !sameStructuredValue(
      artifact.manifest,
      exportManifestReference(input.manifest)
    ) ||
    !isTimestampAtOrAfter(artifact.readyAt, input.manifest.generatedAt)
  ) {
    throw new Error(
      "Ready export artifact must bind the exact manifest and materialized archive lineage."
    );
  }
  const result = deepFreezePrivacyExport(
    artifact
  ) as InboxV2PrivacyExportArtifact & {
    state: "ready";
  };
  authenticReadyExportArtifacts.add(result);
  return result;
}

/** Exact ready job -> manifest -> artifact composition used by download issue. */
export function defineInboxV2PrivacyExportTerminalBundle(input: {
  job: z.input<typeof inboxV2PrivacyExportJobSchema>;
  manifest: InboxV2PrivacyExportManifest;
  artifact: InboxV2PrivacyExportArtifact & { state: "ready" };
  registry: InboxV2DataLifecycleRegistry;
  projectionProfile: InboxV2PrivacyExportProjectionProfile;
  scopeProof: InboxV2PrivacyExportProductScopeProof | null;
  authoritySource: InboxV2PrivacyExportAuthoritySource;
  currentBundleSource: InboxV2PrivacyExportCurrentBundleSource;
}): InboxV2PrivacyExportTerminalBundle {
  if (
    !authenticExportManifests.has(input.manifest) ||
    !authenticReadyExportArtifacts.has(input.artifact)
  ) {
    throw new Error(
      "Terminal export bundle requires authentic manifest and archive materialization evidence."
    );
  }
  const job = defineInboxV2PrivacyExportJob({
    job: input.job,
    registry: input.registry,
    projectionProfile: input.projectionProfile,
    scopeProof: input.scopeProof,
    authoritySource: input.authoritySource
  });
  const manifest = input.manifest;
  const artifact = input.artifact;
  if (job.state !== "ready") {
    throw new Error(
      "Terminal export bundle requires a ready job and artifact."
    );
  }
  const exactJobReference = exportJobReference(job);
  const exactManifestReference = exportManifestReference(manifest);
  const exactArtifactReference = exportArtifactReference(artifact);
  if (
    !sameStructuredValue(manifest.job, exactJobReference) ||
    !sameStructuredValue(artifact.job, exactJobReference) ||
    !sameStructuredValue(job.manifest, exactManifestReference) ||
    !sameStructuredValue(artifact.manifest, exactManifestReference) ||
    !sameStructuredValue(job.artifact, exactArtifactReference) ||
    !sameStructuredValue(job.product, manifest.product) ||
    !sameStructuredValue(job.product, artifact.product) ||
    !sameStructuredValue(job.scope, manifest.scope) ||
    !sameStructuredValue(job.boundary, manifest.boundary) ||
    !sameStructuredValue(job.governance, manifest.governance) ||
    !sameStructuredValue(job.policy, manifest.policy) ||
    !sameStructuredValue(job.format, manifest.format) ||
    artifact.archiveCompositionHash !==
      calculateInboxV2PrivacyExportArchiveCompositionHash(manifest) ||
    !isTimestampAtOrAfter(artifact.readyAt, manifest.generatedAt)
  ) {
    throw new Error(
      "Terminal export bundle must preserve exact job, manifest, artifact, product, scope, boundary, governance, policy, format and hash lineage."
    );
  }
  const registeredFieldIds = new Set(
    input.projectionProfile.fields.map(({ fieldId }) => String(fieldId))
  );
  const selectedClassIds = new Set(
    job.scope.classes.map(({ dataClassId }) => String(dataClassId))
  );
  const selectedRootIds = new Set(
    job.scope.dataUses.map(({ storageRootId }) => String(storageRootId))
  );
  if (
    manifest.omissions.some((omission) => {
      switch (omission.scopeKind) {
        case "field":
          return !registeredFieldIds.has(String(omission.scopeId));
        case "data_class":
          return !selectedClassIds.has(String(omission.scopeId));
        case "storage_root":
          return !selectedRootIds.has(String(omission.scopeId));
        case "third_party":
          return omission.scopeId !== job.scope.thirdPartyProtectionProfileId;
      }
    })
  ) {
    throw new Error(
      "Export omissions may reference only registered projection fields and exact selected scope."
    );
  }
  validateTerminalProductScopeCoverage(manifest, input.scopeProof);
  const bundle = deepFreezePrivacyExport({
    job,
    manifest,
    artifact,
    scopeProof: input.scopeProof
  });
  assertCurrentPrivacyExportAuthority({
    source: input.authoritySource,
    job,
    registry: input.registry,
    scopeProof: input.scopeProof,
    checkedAt: bundle.artifact.readyAt
  });
  assertCurrentPrivacyExportBundle({
    source: input.currentBundleSource,
    bundle,
    checkedAt: bundle.artifact.readyAt
  });
  registerInboxV2PrivacyTerminalExportAuthenticity(
    bundle,
    {
      tenantId: bundle.job.tenantId,
      productKind: bundle.job.product.kind,
      jobId: bundle.job.id,
      jobRevision: bundle.job.revision,
      manifestId: bundle.manifest.id,
      manifestRevision: bundle.manifest.revision,
      manifestHash: bundle.manifest.manifestHash,
      artifactId: bundle.artifact.id,
      artifactRevision: bundle.artifact.revision,
      artifactChecksum: bundle.artifact.checksum,
      artifactReadyAt: bundle.artifact.readyAt,
      artifactExpiresAt: bundle.artifact.expiresAt,
      governanceContextId: bundle.manifest.governance.id,
      governanceContextVersion: bundle.manifest.governance.version,
      governanceContextHash: bundle.manifest.governance.contextHash,
      policyId: bundle.manifest.policy.id,
      policyVersion: bundle.manifest.policy.version,
      policyHash: bundle.manifest.policy.policyHash,
      rootKeys: [
        ...new Set(
          bundle.manifest.chunks.map(({ root }) => dataRootReferenceKey(root))
        )
      ].sort(),
      rootSetHash: bundle.manifest.scopeCompletion.rootSetHash,
      tenantScopeProofHash:
        bundle.scopeProof?.kind === "tenant_termination_scope"
          ? bundle.scopeProof.proofHash
          : null
    },
    (checkedAt) => {
      assertCurrentPrivacyExportAuthority({
        source: input.authoritySource,
        job,
        registry: input.registry,
        scopeProof: input.scopeProof,
        checkedAt
      });
      assertCurrentPrivacyExportBundle({
        source: input.currentBundleSource,
        bundle,
        checkedAt
      });
    }
  );
  authenticTerminalBundles.add(bundle);
  exportBundleAuthorityBindings.set(bundle, {
    registry: input.registry,
    authoritySource: input.authoritySource
  });
  return bundle;
}

export async function defineInboxV2PrivacyExportDownloadReceipt(input: {
  receipt: z.input<typeof inboxV2PrivacyExportDownloadReceiptSchema>;
  bundle: InboxV2PrivacyExportTerminalBundle;
  currentScopeProof: InboxV2PrivacyExportProductScopeProof | null;
  repository: InboxV2PrivacyExportClaimRepository;
}): Promise<InboxV2PrivacyExportDownloadReceipt & { state: "issued" }> {
  if (!authenticClaimRepositories.has(input.repository)) {
    throw new Error(
      "Download issue requires the registered durable claim repository."
    );
  }
  if (!authenticTerminalBundles.has(input.bundle)) {
    throw new Error("Download receipt requires an authentic terminal bundle.");
  }
  const receipt = inboxV2PrivacyExportDownloadReceiptSchema.parse(
    input.receipt
  );
  if (
    receipt.state !== "issued" ||
    !matchesDownloadReceiptBundle(receipt, input.bundle) ||
    !isCurrentDownloadProductProof(
      input.bundle,
      input.currentScopeProof,
      receipt.issuedAt,
      authorizationPrincipalKey(receipt.issuanceAuthorization.decision)
    ) ||
    !isTimestampAtOrAfter(receipt.issuedAt, input.bundle.artifact.readyAt) ||
    Date.parse(receipt.expiresAt) > Date.parse(input.bundle.artifact.expiresAt)
  ) {
    throw new Error(
      "Issued download receipt must bind the exact unexpired terminal bundle."
    );
  }
  assertInboxV2PrivacyTerminalExportCurrent(input.bundle, receipt.issuedAt);
  const authority = exportBundleAuthorityBindings.get(input.bundle);
  if (authority === undefined) {
    throw new Error(
      "Download receipt lost its current export authority binding."
    );
  }
  assertCurrentPrivacyExportAuthority({
    source: authority.authoritySource,
    job: input.bundle.job,
    registry: authority.registry,
    scopeProof: input.currentScopeProof,
    checkedAt: receipt.issuedAt
  });
  assertCurrentPrivacyExportCheckpoint({
    source: authority.authoritySource,
    job: input.bundle.job,
    checkpoint: receipt.issuanceAuthorization,
    checkedAt: receipt.issuedAt
  });
  assertCurrentPrivacyExportDecision({
    source: authority.authoritySource,
    job: input.bundle.job,
    decision: receipt.issuanceArtifactAuthorization,
    checkedAt: receipt.issuedAt
  });
  const artifactClaimKey = privacyExportTerminalBundleClaimKey(input.bundle);
  const lineage = privacyExportTerminalBundleClaimLineage(
    input.bundle,
    calculateInboxV2PrivacyExportIssuedReceiptHash(receipt)
  );
  const receiptKey = privacyExportDownloadReceiptKey(receipt);
  const principalKey = authorizationPrincipalKey(
    receipt.issuanceAuthorization.decision
  );
  const claim = await input.repository.issue({
    artifactClaimKey,
    receiptKey,
    principalKey,
    issuedRevision: receipt.revision,
    lineage
  });
  if (claim.outcome !== "applied") {
    throw new Error(
      "Durable repository reports that the artifact already has its canonical one-use download claim."
    );
  }
  const result = deepFreezePrivacyExport(receipt);
  return result as InboxV2PrivacyExportDownloadReceipt & { state: "issued" };
}

export async function consumeInboxV2PrivacyExportDownloadReceipt(input: {
  before: z.input<typeof inboxV2PrivacyExportDownloadReceiptSchema>;
  after: z.input<typeof inboxV2PrivacyExportDownloadReceiptSchema>;
  bundle: InboxV2PrivacyExportTerminalBundle;
  currentScopeProof: InboxV2PrivacyExportProductScopeProof | null;
  repository: InboxV2PrivacyExportClaimRepository;
}): Promise<InboxV2PrivacyExportDownloadReceipt & { state: "consumed" }> {
  if (!authenticClaimRepositories.has(input.repository)) {
    throw new Error(
      "Download consume requires the registered durable claim repository."
    );
  }
  const before = inboxV2PrivacyExportDownloadReceiptSchema.parse(input.before);
  const artifactClaimKey = privacyExportTerminalBundleClaimKey(input.bundle);
  const receiptKey = privacyExportDownloadReceiptKey(before);
  if (
    !authenticTerminalBundles.has(input.bundle) ||
    before.state !== "issued"
  ) {
    throw new Error(
      "Download consumption requires authentic current bundle and issued receipt state."
    );
  }
  const lineage = privacyExportTerminalBundleClaimLineage(
    input.bundle,
    calculateInboxV2PrivacyExportIssuedReceiptHash(before)
  );
  const afterCandidate =
    input.after.state === "consumed"
      ? {
          ...input.after,
          consumptionHash: calculateInboxV2PrivacyExportDownloadConsumptionHash(
            input.after
          )
        }
      : input.after;
  const after = inboxV2PrivacyExportDownloadReceiptSchema.parse(afterCandidate);
  if (
    after.state !== "consumed" ||
    !matchesDownloadReceiptBundle(after, input.bundle) ||
    !isCurrentDownloadProductProof(
      input.bundle,
      input.currentScopeProof,
      after.consumedAt,
      authorizationPrincipalKey(after.consumeAuthorization.decision)
    ) ||
    BigInt(after.revision) !== BigInt(before.revision) + 1n ||
    !sameStructuredValue(
      downloadReceiptImmutableState(before),
      downloadReceiptImmutableState(after)
    ) ||
    Date.parse(after.consumedAt) >= Date.parse(input.bundle.artifact.expiresAt)
  ) {
    throw new Error(
      "One-use download consume must CAS the issued receipt revision and keep exact bundle lineage."
    );
  }
  assertInboxV2PrivacyTerminalExportCurrent(input.bundle, after.consumedAt);
  const authority = exportBundleAuthorityBindings.get(input.bundle);
  if (authority === undefined) {
    throw new Error(
      "Download consume lost its current export authority binding."
    );
  }
  assertCurrentPrivacyExportAuthority({
    source: authority.authoritySource,
    job: input.bundle.job,
    registry: authority.registry,
    scopeProof: input.currentScopeProof,
    checkedAt: after.consumedAt
  });
  assertCurrentPrivacyExportCheckpoint({
    source: authority.authoritySource,
    job: input.bundle.job,
    checkpoint: after.consumeAuthorization,
    checkedAt: after.consumedAt
  });
  assertCurrentPrivacyExportDecision({
    source: authority.authoritySource,
    job: input.bundle.job,
    decision: after.consumeArtifactAuthorization,
    checkedAt: after.consumedAt
  });
  const principalKey = authorizationPrincipalKey(
    before.issuanceAuthorization.decision
  );
  const claim = await input.repository.consume({
    artifactClaimKey,
    receiptKey,
    principalKey,
    expectedRevision: before.revision,
    nextRevision: after.revision,
    lineage
  });
  if (claim.outcome !== "applied") {
    throw new Error(
      "Durable repository rejected the one-use receipt compare-and-swap."
    );
  }
  const result = deepFreezePrivacyExport(
    after
  ) as InboxV2PrivacyExportDownloadReceipt & {
    state: "consumed";
  };
  return result;
}

function validateExecutableExportProductProof(
  job: InboxV2PrivacyExportJob,
  proof: InboxV2PrivacyExportProductScopeProof | null,
  checkedAt = job.requestedAt
): void {
  const jobReference = exportJobReference(job);
  if (job.product.kind === "tenant_deployment") {
    if (
      proof === null ||
      proof.kind !== "tenant_termination_scope" ||
      !isInboxV2TenantTerminationScopeManifest(proof) ||
      proof.tenantId !== job.tenantId ||
      proof.proofHash !== job.product.scopeProofHash ||
      !matchesInboxV2TenantTerminationScopeReference({
        manifest: proof,
        reference: job.product.tenantScope
      }) ||
      job.boundary.kind !== "tenant_stream_high_water" ||
      job.boundary.streamEpoch !== proof.boundary.streamEpoch ||
      job.boundary.syncGeneration !== proof.boundary.syncGeneration ||
      job.boundary.highWaterPosition !== proof.boundary.completeThroughPosition
    ) {
      throw new Error(
        "Tenant export requires its exact authentic tenant-wide scope and high-water proof."
      );
    }
    return;
  }
  if (job.product.kind === "data_subject") {
    if (
      proof === null ||
      proof.kind !== "data_subject_scope_proof" ||
      !authenticDataSubjectScopeProofs.has(proof) ||
      !sameStructuredValue(proof.job, jobReference) ||
      !sameStructuredValue(proof.request, job.product.request) ||
      proof.intent !== job.product.intent ||
      !sameStructuredValue(proof.discovery, job.product.discovery) ||
      !sameStructuredValue(proof.decisionReference, job.product.decision) ||
      proof.proofHash !== job.product.scopeProofHash ||
      proof.evaluatedAt !== checkedAt ||
      job.scope.purposeId !== "core:data_subject_request_execution"
    ) {
      throw new Error(
        "Data-subject job requires its authentic verified request/discovery/approved-root proof."
      );
    }
    return;
  }
  if (
    proof === null ||
    proof.kind !== "manager_report_scope_proof" ||
    !authenticManagerReportScopeProofs.has(proof) ||
    !sameStructuredValue(proof.job, jobReference) ||
    !sameStructuredValue(
      proof.reportDefinition,
      job.product.reportDefinition
    ) ||
    !sameStructuredValue(proof.reportScope, job.product.reportScope) ||
    !sameStructuredValue(
      proof.projectionProfile,
      job.scope.projectionProfile
    ) ||
    !sameStructuredValue(proof.boundary, job.boundary) ||
    proof.proofHash !== job.product.scopeProofHash ||
    managerReportAuthorizationManifestPrincipalKey(
      proof.authorizationManifest
    ) !== authorizationPrincipalKey(job.requestAuthorization.decision) ||
    job.scope.purposeId !== "core:manager_reporting" ||
    (proof.reportScope.accessLevel === "aggregate" &&
      job.scope.classes.some(
        ({ exportBehavior }) => exportBehavior !== "anonymous_only"
      )) ||
    (proof.reportScope.accessLevel !== "pii" &&
      job.scope.classes.some(({ sensitivity }) =>
        [
          "personal_identifier",
          "sensitive_personal",
          "personal_operational"
        ].includes(sensitivity)
      )) ||
    Date.parse(proof.authorizationManifest.evaluatedAt) >
      Date.parse(checkedAt) ||
    (checkedAt !== job.requestedAt &&
      proof.authorizationManifest.evaluatedAt !== checkedAt) ||
    Date.parse(proof.authorizationManifest.notAfter) <= Date.parse(checkedAt)
  ) {
    throw new Error(
      "Manager report job requires its authentic report definition/scope and underlying drilldown/PII authority proof."
    );
  }
}

function isCurrentDownloadProductProof(
  bundle: InboxV2PrivacyExportTerminalBundle,
  proof: InboxV2PrivacyExportProductScopeProof | null,
  checkedAt: string,
  expectedPrincipalKey: string
): boolean {
  try {
    validateExecutableExportProductProof(bundle.job, proof, checkedAt);
  } catch {
    return false;
  }
  if (bundle.job.product.kind === "data_subject") {
    return (
      proof !== null &&
      proof.kind === "data_subject_scope_proof" &&
      authenticCurrentDataSubjectScopeProofs.has(proof)
    );
  }
  if (bundle.job.product.kind !== "manager_report") {
    return true;
  }
  if (proof === null || proof.kind !== "manager_report_scope_proof") {
    return false;
  }
  if (
    managerReportAuthorizationManifestPrincipalKey(
      proof.authorizationManifest
    ) !== expectedPrincipalKey
  ) {
    return false;
  }
  return bundle.manifest.chunks.every((chunk) => {
    const authorizedRoot = proof.authorizationManifest.authorizedRoots.find(
      ({ root }) =>
        dataRootReferenceKey(root) === dataRootReferenceKey(chunk.root)
    );
    return (
      authorizedRoot !== undefined &&
      authorizedRoot.expectedEntityRevision === chunk.expectedEntityRevision &&
      authorizedRoot.expectedLineageRevision ===
        chunk.expectedLineageRevision &&
      sameCanonicalValues(
        authorizedRoot.permissionDecisions.map(
          ({ permissionId }) => permissionId
        ),
        chunk.rootAuthorizations.map(({ decision }) => decision.permissionId)
      ) &&
      sameCanonicalValues(
        authorizedRoot.lineagePermissionDecisions.map(
          ({ permissionId }) => permissionId
        ),
        [chunk.lineageAuthorization.decision.permissionId]
      )
    );
  });
}

function validateTerminalProductScopeCoverage(
  manifest: InboxV2PrivacyExportManifest,
  proof: InboxV2PrivacyExportProductScopeProof | null
): void {
  if (manifest.product.kind === "tenant_deployment") {
    if (
      proof === null ||
      proof.kind !== "tenant_termination_scope" ||
      !isInboxV2TenantTerminationScopeManifest(proof) ||
      !sameCanonicalValues(
        manifest.chunks.map(({ root }) => dataRootReferenceKey(root)),
        inboxV2TenantTerminationExportRoots(proof).map(({ root }) =>
          dataRootReferenceKey(root)
        )
      ) ||
      manifest.chunks.some((chunk) => {
        const expected = inboxV2TenantTerminationExportRoots(proof).find(
          ({ root }) =>
            dataRootReferenceKey(root) === dataRootReferenceKey(chunk.root)
        );
        return (
          expected === undefined ||
          expected.expectedEntityRevision !== chunk.expectedEntityRevision ||
          expected.expectedLineageRevision !== chunk.expectedLineageRevision
        );
      })
    ) {
      throw new Error(
        "Tenant deployment manifest must cover the exact exportable tenant-wide root revisions."
      );
    }
    return;
  }
  if (manifest.product.kind === "data_subject") {
    if (proof === null || proof.kind !== "data_subject_scope_proof") {
      throw new Error("Data-subject manifest has no authentic scope proof.");
    }
    if (proof.verification.status !== "verified") {
      throw new Error("Data-subject manifest has no verified subject proof.");
    }
    const verifiedSubjectKeys = new Set(
      proof.verification.verifiedSubjects.map(dataSubjectReferenceKey)
    );
    if (
      !sameCanonicalValues(
        manifest.chunks.map(({ root }) => dataRootReferenceKey(root)),
        proof.approvedRoots.map(dataRootReferenceKey)
      ) ||
      manifest.chunks.some(({ subjects }) =>
        subjects.some(
          (subject) =>
            !verifiedSubjectKeys.has(dataSubjectReferenceKey(subject))
        )
      )
    ) {
      throw new Error(
        "Data-subject manifest chunks must cover the exact approved discovery roots."
      );
    }
    return;
  }
  if (proof === null || proof.kind !== "manager_report_scope_proof") {
    throw new Error("Manager report manifest has no authentic scope proof.");
  }
  const materializationTimes = [
    ...manifest.chunks.map(({ materializedAt }) => materializedAt),
    ...(manifest.verifiedZeroEvidence === null
      ? []
      : [manifest.verifiedZeroEvidence.verifiedAt])
  ];
  if (
    !sameCanonicalValues(
      manifest.chunks.map(({ root }) => dataRootReferenceKey(root)),
      proof.authorizationManifest.authorizedRoots.map(({ root }) =>
        dataRootReferenceKey(root)
      )
    ) ||
    manifest.chunks.some((chunk) => {
      const authorizedRoot = proof.authorizationManifest.authorizedRoots.find(
        ({ root }) =>
          dataRootReferenceKey(root) === dataRootReferenceKey(chunk.root)
      );
      return (
        authorizedRoot === undefined ||
        authorizedRoot.expectedEntityRevision !==
          chunk.expectedEntityRevision ||
        authorizedRoot.expectedLineageRevision !==
          chunk.expectedLineageRevision ||
        authorizationPrincipalKey(chunk.authorization.decision) !==
          managerReportAuthorizationManifestPrincipalKey(
            proof.authorizationManifest
          ) ||
        !sameCanonicalValues(
          authorizedRoot.permissionDecisions.map(
            ({ permissionId }) => permissionId
          ),
          chunk.rootAuthorizations.map(({ decision }) => decision.permissionId)
        ) ||
        !sameCanonicalValues(
          authorizedRoot.lineagePermissionDecisions.map(
            ({ permissionId }) => permissionId
          ),
          [chunk.lineageAuthorization.decision.permissionId]
        )
      );
    }) ||
    materializationTimes.some(
      (value) =>
        Date.parse(value) <
          Date.parse(proof.authorizationManifest.evaluatedAt) ||
        Date.parse(value) >= Date.parse(proof.authorizationManifest.notAfter)
    )
  ) {
    throw new Error(
      "Manager report chunks require current underlying resource authority at materialization."
    );
  }
}

function exportJobReference(
  job: Pick<
    InboxV2PrivacyExportJob,
    "tenantId" | "id" | "revision" | "requestedAt"
  >
) {
  return {
    tenantId: job.tenantId,
    jobId: job.id,
    revision: job.revision,
    requestedAt: job.requestedAt
  };
}

function exportManifestReference(manifest: InboxV2PrivacyExportManifest) {
  return {
    tenantId: manifest.tenantId,
    manifestId: manifest.id,
    revision: manifest.revision,
    manifestHash: manifest.manifestHash
  };
}

function privacyExportEnumerationReference(
  enumeration: InboxV2PrivacyExportScopeEnumeration
) {
  return {
    tenantId: enumeration.tenantId,
    id: enumeration.id,
    revision: enumeration.revision,
    digest: enumeration.digest
  };
}

function exportArtifactReference(
  artifact: InboxV2PrivacyExportArtifact & { state: "ready" }
) {
  return {
    tenantId: artifact.tenantId,
    artifactId: artifact.id,
    revision: artifact.revision,
    state: artifact.state
  };
}

function matchesDownloadReceiptBundle(
  receipt: InboxV2PrivacyExportDownloadReceipt,
  bundle: InboxV2PrivacyExportTerminalBundle
): boolean {
  return (
    sameStructuredValue(receipt.job, exportJobReference(bundle.job)) &&
    sameStructuredValue(
      receipt.artifact,
      exportArtifactReference(bundle.artifact)
    ) &&
    sameStructuredValue(
      receipt.manifest,
      exportManifestReference(bundle.manifest)
    ) &&
    sameStructuredValue(receipt.product, bundle.job.product)
  );
}

function downloadReceiptImmutableState(
  receipt: InboxV2PrivacyExportDownloadReceipt
) {
  return {
    tenantId: receipt.tenantId,
    id: receipt.id,
    job: receipt.job,
    artifact: receipt.artifact,
    manifest: receipt.manifest,
    product: receipt.product,
    issuedAt: receipt.issuedAt,
    expiresAt: receipt.expiresAt,
    issuanceAuthorization: receipt.issuanceAuthorization,
    issuanceArtifactAuthorization: receipt.issuanceArtifactAuthorization,
    oneUse: receipt.oneUse
  };
}

function requireAuthenticLifecycleRegistry(
  registry: InboxV2DataLifecycleRegistry
): void {
  if (!isInboxV2DataLifecycleRegistry(registry)) {
    throw new Error("Export scope requires an authentic composed registry.");
  }
}

function assertCurrentPrivacyExportAuthority(input: {
  source: InboxV2PrivacyExportAuthoritySource;
  job: InboxV2PrivacyExportJob;
  registry: InboxV2DataLifecycleRegistry;
  scopeProof: InboxV2PrivacyExportProductScopeProof | null;
  checkedAt: string;
}): void {
  if (!authenticExportAuthoritySources.has(input.source)) {
    throw new Error(
      "Export requires a registered current governance/policy/RBAC authority source."
    );
  }
  const checkedAt = inboxV2TimestampSchema.parse(input.checkedAt);
  const authority = inboxV2PrivacyExportCurrentJobAuthorityResultSchema.parse(
    input.source.loadCurrentJobAuthority({
      job: exportJobReference(input.job),
      product: input.job.product,
      registryCompositionHash: String(input.registry.compositionHash),
      governance: input.job.governance,
      policy: input.job.policy,
      checkedAt
    })
  );
  const approvalAuthorization =
    input.job.approval.kind === "separated_approval"
      ? input.job.approval.authorization
      : null;
  if (
    authority.tenantId !== input.job.tenantId ||
    authority.checkedAt !== checkedAt ||
    authority.registryCompositionHash !== input.registry.compositionHash ||
    !sameStructuredValue(authority.job, exportJobReference(input.job)) ||
    !sameStructuredValue(authority.governance, input.job.governance) ||
    !sameStructuredValue(authority.policy, input.job.policy) ||
    !sameStructuredValue(
      authority.requestAuthorization,
      input.job.requestAuthorization
    ) ||
    !sameStructuredValue(authority.approval, input.job.approval) ||
    Date.parse(checkedAt) >=
      Date.parse(input.job.requestAuthorization.decision.notAfter) ||
    (approvalAuthorization !== null &&
      Date.parse(checkedAt) >= Date.parse(approvalAuthorization.notAfter))
  ) {
    throw new Error(
      "Export authority is stale or does not match its exact current governance, policy, approval and RBAC fences."
    );
  }
  if (
    input.job.product.kind === "tenant_deployment" &&
    input.scopeProof?.kind === "tenant_termination_scope"
  ) {
    assertInboxV2TenantTerminationScopeCurrentAuthority({
      manifest: input.scopeProof,
      registryCompositionHash: String(input.registry.compositionHash),
      governance: input.job.governance,
      policy: input.job.policy,
      checkedAt
    });
  }
}

function assertCurrentPrivacyExportCheckpoint(input: {
  source: InboxV2PrivacyExportAuthoritySource;
  job: InboxV2PrivacyExportJob;
  checkpoint: z.infer<typeof inboxV2PrivacyExportAuthorizationCheckpointSchema>;
  checkedAt: string;
}): void {
  if (!authenticExportAuthoritySources.has(input.source)) {
    throw new Error(
      "Export checkpoint requires a registered authority source."
    );
  }
  const checkedAt = inboxV2TimestampSchema.parse(input.checkedAt);
  const current = inboxV2PrivacyExportCurrentCheckpointResultSchema.parse(
    input.source.loadCurrentCheckpoint({
      job: exportJobReference(input.job),
      checkpoint: input.checkpoint,
      checkedAt
    })
  );
  if (
    current.checkedAt !== checkedAt ||
    !sameStructuredValue(current.checkpoint, input.checkpoint) ||
    input.checkpoint.checkedAt !== checkedAt ||
    Date.parse(checkedAt) >= Date.parse(input.checkpoint.decision.notAfter)
  ) {
    throw new Error(
      "Export checkpoint is stale or not current for its exact resource revision."
    );
  }
}

function assertCurrentPrivacyExportDecision(input: {
  source: InboxV2PrivacyExportAuthoritySource;
  job: InboxV2PrivacyExportJob;
  decision: z.infer<typeof inboxV2AuthorizationDecisionReferenceSchema>;
  checkedAt: string;
}): void {
  if (!authenticExportAuthoritySources.has(input.source)) {
    throw new Error("Export decision requires a registered authority source.");
  }
  const checkedAt = inboxV2TimestampSchema.parse(input.checkedAt);
  const current = inboxV2PrivacyExportCurrentDecisionResultSchema.parse(
    input.source.loadCurrentDecision({
      job: exportJobReference(input.job),
      decision: input.decision,
      checkedAt
    })
  );
  if (
    current.checkedAt !== checkedAt ||
    !sameStructuredValue(current.decision, input.decision) ||
    current.decision.decidedAt !== checkedAt ||
    Date.parse(checkedAt) >= Date.parse(current.decision.notAfter)
  ) {
    throw new Error(
      "Export decision is stale or not current for its exact resource revision."
    );
  }
}

function assertCurrentPrivacyExportBundle(input: {
  source: InboxV2PrivacyExportCurrentBundleSource;
  bundle: InboxV2PrivacyExportTerminalBundle;
  checkedAt: string;
}): void {
  if (!authenticCurrentBundleSources.has(input.source)) {
    throw new Error(
      "Terminal export requires a registered current bundle-state source."
    );
  }
  const checkedAt = inboxV2TimestampSchema.parse(input.checkedAt);
  const current = inboxV2PrivacyExportCurrentBundleResultSchema.parse(
    input.source.loadCurrentBundle({
      bundle: input.bundle,
      checkedAt
    })
  );
  if (
    current.tenantId !== input.bundle.job.tenantId ||
    current.checkedAt !== checkedAt ||
    !sameStructuredValue(current.job, exportJobReference(input.bundle.job)) ||
    !sameStructuredValue(
      current.manifest,
      exportManifestReference(input.bundle.manifest)
    ) ||
    !sameStructuredValue(
      current.artifact,
      exportArtifactReference(input.bundle.artifact)
    ) ||
    current.artifactChecksum !== input.bundle.artifact.checksum ||
    Date.parse(checkedAt) < Date.parse(input.bundle.artifact.readyAt) ||
    Date.parse(checkedAt) >= Date.parse(input.bundle.artifact.expiresAt)
  ) {
    throw new Error(
      "Terminal export artifact is no longer ready, present and downloadable."
    );
  }
}

function requiredExportPermission(
  product: InboxV2PrivacyExportProduct
):
  | "core:privacy.tenant_export"
  | "core:reports.export"
  | "core:privacy.request.execute" {
  return product.kind === "tenant_deployment"
    ? "core:privacy.tenant_export"
    : product.kind === "manager_report"
      ? "core:reports.export"
      : "core:privacy.request.execute";
}

function isExportBehaviorAllowedForProduct(
  exportBehavior: z.infer<typeof inboxV2DataExportBehaviorSchema>,
  product: InboxV2PrivacyExportProduct
): boolean {
  if (exportBehavior === "never" || exportBehavior === "omit_with_reason") {
    return false;
  }
  if (product.kind === "manager_report") {
    return (
      exportBehavior === "authorized_projection" ||
      exportBehavior === "anonymous_only"
    );
  }
  if (product.kind === "data_subject") {
    return (
      exportBehavior === "normalized_projection" ||
      exportBehavior === "authorized_projection" ||
      (product.intent === "access" &&
        exportBehavior === "reviewed_sensitive_evidence")
    );
  }
  return true;
}

function privacyExportTerminalBundleClaimKey(
  bundle: Pick<
    InboxV2PrivacyExportTerminalBundle,
    "job" | "manifest" | "artifact"
  >
): string {
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.privacy-export-one-use-artifact-claim",
    hashVersion: "v1",
    tenantId: bundle.artifact.tenantId,
    artifactId: bundle.artifact.id,
    artifactRevision: bundle.artifact.revision
  });
}

function privacyExportTerminalBundleClaimLineage(
  bundle: Pick<
    InboxV2PrivacyExportTerminalBundle,
    "job" | "manifest" | "artifact"
  >,
  issuedReceiptHash: string
): InboxV2PrivacyExportClaimLineage {
  return {
    job: exportJobReference(bundle.job),
    manifest: exportManifestReference(bundle.manifest),
    packagingProofHash: bundle.artifact.packagingProofHash,
    archiveCompositionHash: bundle.artifact.archiveCompositionHash,
    issuedReceiptHash
  };
}

function calculateInboxV2PrivacyExportIssuedReceiptHash(
  receipt: InboxV2PrivacyExportDownloadReceipt & { state: "issued" }
) {
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.privacy-export-issued-receipt",
    hashVersion: "v1",
    receipt
  });
}

function privacyExportDownloadReceiptKey(
  receipt: Pick<InboxV2PrivacyExportDownloadReceipt, "tenantId" | "id">
): string {
  return `${receipt.tenantId}\u0000${receipt.id}`;
}

function authorizationPrincipalKey(
  decision: z.input<typeof inboxV2AuthorizationDecisionReferenceSchema>
): string {
  return authorizationPrincipalReferenceKey(decision.principal);
}

function authorizationPrincipalReferenceKey(
  principal: z.input<
    typeof inboxV2AuthorizationDecisionReferenceSchema
  >["principal"]
): string {
  return principal.kind === "employee"
    ? `employee:${principal.employee.id}`
    : `trusted_service:${principal.trustedServiceId}`;
}

function managerReportAuthorizationManifestPrincipalKey(
  manifest: z.input<typeof inboxV2ManagerReportAuthorizationManifestSchema>
): string | null {
  const decision =
    manifest.permissionDecisions[0] ??
    manifest.authorizedRoots[0]?.permissionDecisions[0] ??
    manifest.authorizedRoots[0]?.lineagePermissionDecisions[0];
  return decision === undefined ? null : authorizationPrincipalKey(decision);
}

type PrivacyExportJobAuthorizationTarget = Pick<
  z.infer<typeof inboxV2PrivacyExportJobReferenceSchema>,
  "tenantId" | "jobId" | "revision"
>;

function isAuthorizationBoundToExportJob(
  decision: z.infer<typeof inboxV2AuthorizationDecisionReferenceSchema>,
  job: PrivacyExportJobAuthorizationTarget
): boolean {
  return (
    decision.tenantId === job.tenantId &&
    decision.resourceScopeId === "core:privacy-export-job" &&
    decision.resource.tenantId === job.tenantId &&
    decision.resource.entityTypeId === "core:privacy-export-job" &&
    String(decision.resource.entityId) === String(job.jobId) &&
    String(decision.resourceAccessRevision) === String(job.revision)
  );
}

function isAuthorizationBoundToReadyExportArtifact(
  decision: z.infer<typeof inboxV2AuthorizationDecisionReferenceSchema>,
  artifact: z.infer<typeof inboxV2PrivacyExportArtifactReferenceSchema>,
  permissionId: string,
  checkedAt: string
): boolean {
  return (
    artifact.state === "ready" &&
    decision.outcome === "allowed" &&
    decision.tenantId === artifact.tenantId &&
    decision.permissionId === permissionId &&
    decision.resourceScopeId === "core:privacy-export-artifact" &&
    decision.resource.tenantId === artifact.tenantId &&
    decision.resource.entityTypeId === "core:privacy-export-artifact" &&
    String(decision.resource.entityId) === String(artifact.artifactId) &&
    String(decision.resourceAccessRevision) === String(artifact.revision) &&
    decision.decidedAt === checkedAt &&
    Date.parse(checkedAt) < Date.parse(decision.notAfter)
  );
}

function isTimestampAtOrAfter(value: string, boundary: string): boolean {
  return Date.parse(value) >= Date.parse(boundary);
}

function isTimestampWithinAuthorizationWindow(
  value: string,
  decision: z.infer<typeof inboxV2AuthorizationDecisionReferenceSchema>
): boolean {
  const timestamp = Date.parse(value);
  return (
    timestamp >= Date.parse(decision.decidedAt) &&
    timestamp < Date.parse(decision.notAfter)
  );
}

function exportProductScopeProofHash(
  product: InboxV2PrivacyExportProduct
): string | null {
  return product.scopeProofHash;
}

function exportFormatKey(
  format: z.infer<typeof inboxV2PrivacyExportFormatSchema>
): string {
  return `${format.kind}\u0000${format.schemaId}\u0000${format.schemaVersion}`;
}

function requiredManagerReportPermissions(
  accessLevel: z.infer<
    typeof inboxV2PrivacyExportReportScopeReferenceSchema
  >["accessLevel"]
): readonly string[] {
  if (accessLevel === "aggregate") {
    return ["core:reports.export", "core:reports.view"];
  }
  if (accessLevel === "drilldown") {
    return [
      "core:reports.drilldown",
      "core:reports.export",
      "core:reports.view"
    ];
  }
  return [
    "core:reports.drilldown",
    "core:reports.export",
    "core:reports.pii.export",
    "core:reports.pii.view",
    "core:reports.view"
  ];
}

function privacyExportSubjectTenantId(
  subject: z.infer<typeof inboxV2DataSubjectReferenceSchema>
): string {
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

function unparsedDataRootReferenceKey(root: {
  tenantId: string;
  dataClassId: string;
  storageRootId: string;
  recordId: string;
}): string {
  return `${root.tenantId}\u0000${root.dataClassId}\u0000${root.storageRootId}\u0000${root.recordId}`;
}

function sameCanonicalValues(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    JSON.stringify([...new Set(left)].sort()) ===
    JSON.stringify([...new Set(right)].sort())
  );
}

function sameStructuredValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function deepFreezePrivacyExport<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreezePrivacyExport(child);
  }
  return Object.freeze(value);
}

function addStrictlyIncreasingCounterIssue(
  context: z.RefinementCtx,
  values: readonly string[],
  path: PropertyKey[],
  label: string
): void {
  if (
    values.some(
      (value, index) => index > 0 && BigInt(value) <= BigInt(values[index - 1]!)
    )
  ) {
    addIssue(context, path, `${label} must be strictly increasing.`);
  }
}

function addCanonicalUniqueIssue(
  context: z.RefinementCtx,
  values: readonly string[],
  path: PropertyKey[],
  label: string
): void {
  if (
    new Set(values).size !== values.length ||
    values.some((value, index) => index > 0 && value <= values[index - 1]!)
  ) {
    addIssue(context, path, `${label} must be unique and canonically sorted.`);
  }
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
