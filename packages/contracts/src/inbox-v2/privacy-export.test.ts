import { describe, expect, it } from "vitest";

import { defineInboxV2DataLifecycleRegistry } from "./data-lifecycle-catalog";
import { defineInboxV2DataGovernanceContext } from "./data-governance";
import {
  activateInboxV2EffectiveTenantPolicy,
  defineInboxV2PolicyActivationLedger,
  defineInboxV2PolicyImpactPreview,
  defineInboxV2PolicyImpactSource,
  defineInboxV2PolicyTemplate,
  resolveInboxV2EffectiveTenantPolicy,
  resolveInboxV2PolicyImpactSourceProof
} from "./data-lifecycle-policy";
import {
  defineInboxV2SubjectDiscoverySource,
  resolveInboxV2SubjectDiscoveryManifest
} from "./data-subject-discovery";
import {
  consumeInboxV2PrivacyExportDownloadReceipt,
  defineInboxV2CurrentDataSubjectExportScopeProof,
  defineInboxV2DataSubjectExportScopeProof,
  defineInboxV2DataSubjectCurrentRequestSource,
  defineInboxV2ManagerReportAuthoritySource,
  defineInboxV2ManagerReportExportAuthority,
  defineInboxV2ManagerReportExportScopeProof,
  defineInboxV2PrivacyExportArchiveMaterialization,
  defineInboxV2PrivacyExportArchivePackagerSource,
  defineInboxV2PrivacyExportAuthoritySource,
  defineInboxV2PrivacyExportClaimRepository,
  defineInboxV2PrivacyExportCurrentBundleSource,
  defineInboxV2PrivacyExportDownloadReceipt,
  defineInboxV2PrivacyExportJob,
  defineInboxV2PrivacyExportManifest,
  defineInboxV2PrivacyExportProjectionCatalog,
  defineInboxV2PrivacyExportProjectionProfile,
  defineInboxV2PrivacyExportReadyArtifact,
  defineInboxV2PrivacyExportScope,
  defineInboxV2PrivacyExportScopeEnumeration,
  defineInboxV2PrivacyExportScopeEnumerationSource,
  defineInboxV2PrivacyExportTerminalBundle,
  inboxV2PrivacyExportArtifactEnvelopeSchema,
  inboxV2PrivacyExportArtifactSchema,
  inboxV2PrivacyExportDownloadReceiptEnvelopeSchema,
  inboxV2PrivacyExportDownloadReceiptSchema,
  inboxV2PrivacyExportJobEnvelopeSchema,
  inboxV2PrivacyExportJobSchema,
  inboxV2PrivacyExportManifestEnvelopeSchema,
  inboxV2PrivacyExportManifestSchema,
  inboxV2PrivacyExportScopeSchema,
  type InboxV2PrivacyExportClaimRepository,
  type InboxV2PrivacyExportProductScopeProof,
  type InboxV2PrivacyExportTerminalBundle
} from "./privacy-export";
import {
  defineInboxV2PrivacyRequest,
  defineInboxV2PrivacyRequestAuthoritySource
} from "./privacy-request";
import { assertInboxV2ClosedJsonSchema } from "./schema-safety";
import {
  defineInboxV2TenantTerminationScopeSource,
  inboxV2TenantTerminationScopeManifestReference,
  resolveInboxV2TenantTerminationScopeManifest
} from "./tenant-termination-scope";

const tenantId = "tenant:tenant-1";
const requestedAt = "2026-07-12T10:00:00.000Z";
const materializedAt = "2026-07-12T10:02:00.000Z";
const generatedAt = "2026-07-12T10:03:00.000Z";
const readyAt = "2026-07-12T10:05:00.000Z";
const exportJobId = "privacy-export-job:job-1";
const exportJobRevision = "1";
const hashA = `sha256:${"a".repeat(64)}`;
const hashB = `sha256:${"b".repeat(64)}`;
const hashC = `sha256:${"c".repeat(64)}`;
const hashD = `sha256:${"d".repeat(64)}`;

function entity(entityTypeId = "core:privacy-export-job") {
  return {
    tenantId,
    entityTypeId,
    entityId: exportJobId
  };
}

function jobReference() {
  return {
    tenantId,
    jobId: exportJobId,
    revision: exportJobRevision,
    requestedAt
  };
}

function authorization(
  phase: "request" | "chunk" | "manifest_zero" | "download",
  ordinal: string | null,
  permissionId = "core:privacy.request.execute",
  employeeNumber = 1,
  checkedAt = requestedAt,
  decisionTag = checkedAt.replaceAll(/[^0-9A-Za-z]/gu, "")
) {
  return {
    phase,
    chunkOrdinal: ordinal,
    checkedAt,
    restriction: {
      tenantId,
      requestedUse: "export" as const,
      restrictions: [],
      outcome: "allowed" as const,
      evaluatedAt: checkedAt,
      decisionHash: hashC
    },
    decision: {
      tenantId,
      id: `authorization-decision:${phase}-${employeeNumber}-${decisionTag}`,
      authorizationEpoch: `authorization-epoch-${employeeNumber}`,
      principal: {
        kind: "employee" as const,
        employee: {
          tenantId,
          kind: "employee" as const,
          id: `employee:employee-${employeeNumber}`
        }
      },
      permissionId,
      resourceScopeId: "core:privacy-export-job",
      resource: entity(),
      resourceAccessRevision: exportJobRevision,
      decisionRevision: "1",
      decisionHash: hashA,
      outcome: "allowed" as const,
      decidedAt: checkedAt,
      notAfter: "2026-07-12T11:00:00.000Z"
    }
  };
}

function rootAuthorization(
  root: typeof exportRoot,
  permissionId: string,
  ordinal: string,
  checkedAt = materializedAt,
  employeeNumber = 1,
  expectedEntityRevision = "1"
) {
  const checkpoint = authorization(
    "chunk",
    ordinal,
    permissionId,
    employeeNumber,
    checkedAt,
    `root-${root.recordId}-${checkedAt}`
  );
  return {
    ...checkpoint,
    decision: {
      ...checkpoint.decision,
      resourceScopeId: "core:privacy-export-root",
      resource: {
        tenantId,
        entityTypeId: root.dataClassId,
        entityId: root.recordId
      },
      resourceAccessRevision: expectedEntityRevision
    }
  };
}

function lineageAuthorization(
  root: typeof exportRoot,
  permissionId: string,
  ordinal: string,
  checkedAt = materializedAt,
  employeeNumber = 1,
  expectedLineageRevision = "1"
) {
  const checkpoint = authorization(
    "chunk",
    ordinal,
    permissionId,
    employeeNumber,
    checkedAt,
    `lineage-${root.recordId}-${checkedAt}`
  );
  return {
    ...checkpoint,
    decision: {
      ...checkpoint.decision,
      resourceScopeId: "core:privacy-export-root-lineage",
      resource: {
        tenantId,
        entityTypeId: "core:data-root-lineage",
        entityId: root.recordId
      },
      resourceAccessRevision: expectedLineageRevision
    }
  };
}

function artifactAuthorization(
  artifact: InboxV2PrivacyExportTerminalBundle["artifact"],
  permissionId: string,
  checkedAt: string,
  employeeNumber = 1,
  decisionTag = checkedAt.replaceAll(/[^0-9A-Za-z]/gu, "")
) {
  const decision = authorization(
    "download",
    null,
    permissionId,
    employeeNumber,
    checkedAt,
    `artifact-${decisionTag}`
  ).decision;
  return {
    ...decision,
    resourceScopeId: "core:privacy-export-artifact",
    resource: {
      tenantId,
      entityTypeId: "core:privacy-export-artifact",
      entityId: artifact.id
    },
    resourceAccessRevision: artifact.revision
  };
}

function governance() {
  return {
    tenantId,
    id: sharedExportPolicyAuthority.governanceContext.id,
    version: sharedExportPolicyAuthority.governanceContext.version,
    contextHash: sharedExportPolicyAuthority.governanceContext.contextHash
  };
}

function policy() {
  return {
    tenantId,
    id: sharedExportPolicyAuthority.policy.id,
    version: sharedExportPolicyAuthority.policy.version,
    policyHash: sharedExportPolicyAuthority.policy.policyHash
  };
}

const subject = {
  kind: "client_contact" as const,
  clientContact: {
    tenantId,
    kind: "client_contact" as const,
    id: "client_contact:client-1"
  }
};
const exportRoot = {
  tenantId,
  dataClassId: "core:client_contact_profile",
  storageRootId: "core:client-profile-sql",
  recordId: "data_root:client-profile-1"
};
const managerExportRoot = {
  tenantId,
  dataClassId: "core:crm_value_and_history",
  storageRootId: "core:crm-history-sql",
  recordId: "data_root:crm-history-1"
};

function scope(purposeId = "core:data_subject_request_execution") {
  return {
    purposeId,
    classes: [
      {
        dataClassId: "core:client_contact_profile",
        sensitivity: "personal_identifier" as const,
        exportBehavior: "authorized_projection" as const
      }
    ],
    dataUses: [
      {
        dataClassId: "core:client_contact_profile",
        storageRootId: "core:client-profile-sql",
        projectionHandlerId: "core:lifecycle.client-profile-export-projection",
        exportHandlerId: "core:lifecycle.client-profile-export"
      }
    ],
    projectionProfile: definedProjectionProfile("data_subject").reference,
    thirdPartyProtectionProfileId: "core:privacy-export.third-party-v1"
  };
}

function managerScope() {
  return {
    purposeId: "core:manager_reporting",
    classes: [
      {
        dataClassId: "core:crm_value_and_history",
        sensitivity: "personal_identifier" as const,
        exportBehavior: "authorized_projection" as const
      }
    ],
    dataUses: [
      {
        dataClassId: "core:crm_value_and_history",
        storageRootId: "core:crm-history-sql",
        projectionHandlerId: "core:lifecycle.client-profile-export-projection",
        exportHandlerId: "core:lifecycle.client-profile-export"
      }
    ],
    projectionProfile: definedProjectionProfile("manager_report").reference,
    thirdPartyProtectionProfileId: "core:privacy-export.third-party-v1"
  };
}

function tenantScope() {
  return {
    ...scope(),
    classes: [...scope().classes, ...managerScope().classes],
    dataUses: [...scope().dataUses, ...managerScope().dataUses],
    projectionProfile: definedProjectionProfile("tenant_deployment").reference
  };
}

function decision(intent: "access" | "portability" = "access") {
  return {
    tenantId,
    id: "privacy_decision:decision-1",
    revision: "1",
    result: "approved" as const,
    policyProfile: {
      id: "core:governance-profile.default",
      version: "1"
    },
    reviewer: {
      tenantId,
      kind: "employee" as const,
      id: "employee:privacy-reviewer-1"
    },
    rootDecisions: [
      {
        root: exportRoot,
        dataClassId: exportRoot.dataClassId,
        purposeIds: ["core:data_subject_request_execution"],
        policyRules: [
          {
            id: "core:retention-rule.client-contact-profile",
            revision: "1"
          }
        ],
        disposition:
          intent === "access"
            ? ("include_normalized" as const)
            : ("include_portable" as const),
        followUpDisposition: null,
        externalRouteIds: [],
        thirdPartyHandling: { kind: "not_applicable" as const },
        exceptions: []
      }
    ],
    holdReferences: [],
    reasonCode: "core:privacy.decision.approved",
    decidedAt: "2026-07-12T09:30:00.000Z",
    digest: hashB
  };
}

function classifiedEvidence() {
  return {
    tenantId,
    dataClassId: "core:privacy_sensitive_evidence",
    storageRootId: "core:privacy-evidence-object",
    payload: {
      tenantId,
      recordId: "privacy-evidence:verification-1",
      schemaId: "core:inbox-v2.privacy-evidence-payload",
      schemaVersion: "v1",
      digest: hashA
    }
  };
}

function verifiedIdentity() {
  return {
    tenantId,
    id: "privacy_verification:verification-1",
    revision: "1",
    status: "verified" as const,
    methods: ["authenticated_account" as const],
    evidence: [classifiedEvidence()],
    verificationProfile: {
      id: "core:privacy-verification.default",
      version: "1"
    },
    verifiedSubjects: [subject],
    startedAt: "2026-07-12T09:00:00.000Z",
    completedAt: "2026-07-12T09:05:00.000Z"
  };
}

function product(intent: "access" | "portability" = "access") {
  return dataSubjectProduct(dataSubjectProof(intent));
}

function dataSubjectProduct(proof: ReturnType<typeof dataSubjectProof>) {
  return {
    kind: "data_subject" as const,
    intent: proof.intent,
    request: proof.request,
    discovery: proof.discovery,
    decision: proof.decisionReference,
    scopeProofHash: proof.proofHash
  };
}

function managerProduct(
  accessLevel: "aggregate" | "drilldown" | "pii" = "pii"
) {
  const proof = managerProof(accessLevel);
  return {
    kind: "manager_report" as const,
    reportDefinition: proof.reportDefinition,
    reportScope: proof.reportScope,
    scopeProofHash: proof.proofHash
  };
}

function tenantProduct(scopeProof = sharedTenantTerminationScopeProof) {
  return {
    kind: "tenant_deployment" as const,
    tenantScope: inboxV2TenantTerminationScopeManifestReference(scopeProof),
    scopeProofHash: scopeProof.proofHash
  };
}

type ExportProductFixture =
  | ReturnType<typeof product>
  | ReturnType<typeof managerProduct>
  | ReturnType<typeof tenantProduct>;

function format() {
  return {
    kind: "json" as const,
    schemaId: "core:privacy-export.normalized",
    schemaVersion: "v1"
  };
}

function projectionProfileInput() {
  return {
    reference: {
      id: "core:privacy-export.projection.client-contact",
      revision: "1",
      digest: hashA
    },
    productKind: "data_subject" as const,
    formats: [format()],
    fields: [
      {
        fieldId: "core:client-contact.display-name",
        dataClassId: "core:client_contact_profile"
      }
    ],
    projectionHandlerIds: ["core:lifecycle.client-profile-export-projection"]
  };
}

function managerProjectionProfileInput() {
  return {
    reference: {
      id: "core:privacy-export.projection.manager-crm",
      revision: "1",
      digest: hashB
    },
    productKind: "manager_report" as const,
    formats: [format()],
    fields: [
      {
        fieldId: "core:crm-history.event-time-value",
        dataClassId: "core:crm_value_and_history"
      }
    ],
    projectionHandlerIds: ["core:lifecycle.client-profile-export-projection"]
  };
}

function tenantProjectionProfileInput() {
  return {
    ...projectionProfileInput(),
    reference: {
      id: "core:privacy-export.projection.tenant-client-contact",
      revision: "1",
      digest: hashC
    },
    productKind: "tenant_deployment" as const,
    fields: [
      ...projectionProfileInput().fields,
      ...managerProjectionProfileInput().fields
    ]
  };
}

function definedProjectionProfile(
  productKind: "data_subject" | "manager_report" | "tenant_deployment",
  registry = exportRegistry()
) {
  const catalog = definedProjectionCatalog(registry);
  const profile = catalog.profiles.find(
    (candidate) => candidate.productKind === productKind
  );
  if (profile === undefined) {
    throw new TypeError("Missing projection profile fixture.");
  }
  return defineInboxV2PrivacyExportProjectionProfile({
    reference: profile.reference,
    catalog
  });
}

function definedProjectionCatalog(registry = exportRegistry()) {
  return defineInboxV2PrivacyExportProjectionCatalog({
    catalog: {
      id: "core:privacy-export.projection-catalog",
      revision: "1",
      profiles: [
        projectionProfileInput(),
        managerProjectionProfileInput(),
        tenantProjectionProfileInput()
      ],
      digest: hashD
    },
    registry
  });
}

function boundary() {
  return {
    kind: "tenant_stream_high_water" as const,
    streamEpoch: "stream-epoch-1",
    syncGeneration: "1",
    highWaterPosition: "100"
  };
}

function payload(recordId: string, digest = hashA) {
  return {
    tenantId,
    recordId,
    schemaId: format().schemaId,
    schemaVersion: format().schemaVersion,
    digest
  };
}

function defaultScopeForProduct(exportProduct: ExportProductFixture) {
  return exportProduct.kind === "tenant_deployment"
    ? tenantScope()
    : exportProduct.kind === "manager_report"
      ? managerScope()
      : scope();
}

function proofForProduct(
  exportProduct: ExportProductFixture
): InboxV2PrivacyExportProductScopeProof | null {
  return exportProduct.kind === "tenant_deployment"
    ? sharedTenantTerminationScopeProof
    : exportProduct.kind === "manager_report"
      ? managerProof(exportProduct.reportScope.accessLevel)
      : dataSubjectProof(exportProduct.intent);
}

function manifestInput(
  exportProduct: ExportProductFixture,
  exportScope: ReturnType<typeof scope> | ReturnType<typeof managerScope>,
  empty = false
) {
  const selectedRoot =
    exportScope.classes[0]?.dataClassId === "core:crm_value_and_history"
      ? managerExportRoot
      : exportRoot;
  const proofHash = exportProduct.scopeProofHash;
  const requiredPermission =
    exportProduct.kind === "tenant_deployment"
      ? "core:privacy.tenant_export"
      : exportProduct.kind === "manager_report"
        ? "core:reports.export"
        : "core:privacy.request.execute";
  const rootPermission =
    exportProduct.kind === "manager_report"
      ? managerRootPermission(exportProduct.reportScope.accessLevel)
      : requiredPermission;
  const chunks = empty
    ? []
    : [
        {
          ordinal: "1",
          dataCategory: "subject_provided" as const,
          root: selectedRoot,
          expectedEntityRevision: "1",
          expectedLineageRevision: "1",
          subjects: [subject],
          projectionProfile: exportScope.projectionProfile,
          projectionHandlerId:
            "core:lifecycle.client-profile-export-projection",
          productScopeProofHash: proofHash,
          payload: payload("privacy-export-chunk:chunk-1"),
          itemCount: "2",
          byteCount: "128",
          checksum: hashA,
          authorization: authorization(
            "chunk",
            "1",
            requiredPermission,
            1,
            materializedAt
          ),
          rootAuthorizations: [
            rootAuthorization(selectedRoot, rootPermission, "1", materializedAt)
          ],
          lineageAuthorization: lineageAuthorization(
            selectedRoot,
            rootPermission,
            "1",
            materializedAt
          ),
          materializedAt
        }
      ];
  const zeroAuthorization = authorization(
    "manifest_zero",
    null,
    requiredPermission,
    1,
    materializedAt
  );
  return {
    tenantId,
    id: "privacy-export-manifest:manifest-1",
    revision: "1",
    job: jobReference(),
    product: exportProduct,
    scope: exportScope,
    boundary: boundary(),
    governance: governance(),
    policy: policy(),
    format: format(),
    chunks,
    verifiedZeroEvidence: empty
      ? {
          kind: "verified_zero_scope" as const,
          productScopeProofHash: proofHash,
          enumeration: {
            tenantId,
            id: "core:privacy-export-enumeration.fixture",
            revision: "1",
            digest: hashA
          },
          authorization: zeroAuthorization,
          verifiedAt: materializedAt,
          evidenceHash: hashA
        }
      : null,
    omissions: [],
    externalResiduals: [],
    totalItemCount: empty ? "0" : "2",
    totalByteCount: empty ? "0" : "128",
    scopeCompletion: {
      kind: "complete_for_scope" as const,
      enumeration: {
        tenantId,
        id: "core:privacy-export-enumeration.fixture",
        revision: "1",
        digest: hashA
      },
      expectedRootCount: empty ? "0" : "1",
      emittedRootCount: empty ? "0" : "1",
      finalChunkOrdinal: empty ? null : "1",
      rootSetHash: hashA,
      completedAt: "2026-07-12T10:02:30.000Z",
      completionHash: hashB
    },
    generatedAt,
    manifestHash: hashC
  };
}

function manifest(
  exportProduct: ExportProductFixture = product(),
  exportScope = defaultScopeForProduct(exportProduct),
  scopeProof = proofForProduct(exportProduct),
  empty = false
) {
  const registry = exportRegistry();
  const projectionProfile = definedProjectionProfile(
    exportProduct.kind,
    registry
  );
  const enumeration = exportEnumeration(
    exportProduct,
    exportScope,
    scopeProof,
    empty,
    registry,
    projectionProfile
  );
  return defineInboxV2PrivacyExportManifest({
    manifest: manifestInput(exportProduct, exportScope, empty),
    job: queuedJob(exportProduct, exportScope),
    registry,
    projectionProfile,
    scopeProof,
    enumeration,
    authoritySource: exportAuthoritySource()
  });
}

function exportEnumeration(
  exportProduct: ExportProductFixture,
  exportScope: ReturnType<typeof scope> | ReturnType<typeof managerScope>,
  scopeProof: InboxV2PrivacyExportProductScopeProof | null,
  empty: boolean,
  registry: ReturnType<typeof exportRegistry>,
  projectionProfile: ReturnType<typeof definedProjectionProfile>
) {
  const selectedRoot =
    exportScope.classes[0]?.dataClassId === "core:crm_value_and_history"
      ? managerExportRoot
      : exportRoot;
  const source = defineInboxV2PrivacyExportScopeEnumerationSource({
    source: {
      id: "core:privacy-export-enumeration-source.fixture",
      handlerId: "core:lifecycle.client-profile-subject-discovery",
      enumerate: ({
        job,
        product: sourceProduct,
        scope: sourceScope,
        boundary: sourceBoundary,
        productScopeProofHash
      }) => ({
        tenantId,
        id: "core:privacy-export-enumeration.fixture",
        revision: "1",
        job,
        product: sourceProduct,
        scope: sourceScope,
        boundary: sourceBoundary,
        productScopeProofHash,
        sourceHandlerId: "core:lifecycle.client-profile-subject-discovery",
        sourceResult: payload("privacy-export-enumeration:result-1", hashC),
        outcome: empty ? ("verified_zero" as const) : ("complete" as const),
        roots: empty
          ? []
          : [
              {
                root: selectedRoot,
                expectedEntityRevision: "1",
                expectedLineageRevision: "1"
              }
            ],
        completedAt: "2026-07-12T10:01:30.000Z",
        digest: hashA
      })
    },
    registry
  });
  return defineInboxV2PrivacyExportScopeEnumeration({
    source,
    job: queuedJob(exportProduct, exportScope),
    registry,
    projectionProfile,
    scopeProof,
    authoritySource: exportAuthoritySource()
  });
}

function readyArtifact(
  exportProduct: ExportProductFixture = product(),
  exactManifest = manifest(exportProduct),
  encryptedPayloadDigest = hashB
) {
  const registry = exportRegistry();
  const packagerSource = defineInboxV2PrivacyExportArchivePackagerSource({
    source: {
      id: "core:privacy-export-packager.fixture",
      handlerId: "core:lifecycle.client-profile-export",
      materialize: ({
        manifest: sourceManifest,
        archiveCompositionHash,
        checkedAt
      }) => ({
        tenantId,
        id: "core:privacy-export-archive-materialization.fixture",
        revision: "1",
        manifest: {
          tenantId: sourceManifest.tenantId,
          manifestId: sourceManifest.id,
          revision: sourceManifest.revision,
          manifestHash: sourceManifest.manifestHash
        },
        archiveCompositionHash,
        encryptedPayload: payload(
          "privacy-export-artifact:artifact-1",
          encryptedPayloadDigest
        ),
        encryptedByteCount: "512",
        encryptionProfileId: "core:encryption.export-artifact",
        packagerHandlerId: "core:lifecycle.client-profile-export",
        materializedAt: checkedAt,
        proofHash: hashA
      })
    },
    registry
  });
  const materialization = defineInboxV2PrivacyExportArchiveMaterialization({
    source: packagerSource,
    manifest: exactManifest,
    registry,
    checkedAt: readyAt
  });
  return defineInboxV2PrivacyExportReadyArtifact({
    manifest: exactManifest,
    materialization,
    artifact: {
      tenantId,
      id: "privacy-export-artifact:artifact-1",
      revision: "2",
      job: jobReference(),
      product: exportProduct,
      createdAt: requestedAt,
      state: "ready" as const,
      manifest: {
        tenantId,
        manifestId: "privacy-export-manifest:manifest-1",
        revision: "1",
        manifestHash: exactManifest.manifestHash
      },
      encryptedPayload: payload(
        "privacy-export-artifact:artifact-1",
        encryptedPayloadDigest
      ),
      encryptedByteCount: "512",
      encryptionProfileId: "core:encryption.export-artifact",
      checksum: encryptedPayloadDigest,
      archiveCompositionHash: hashA,
      packagingProofHash: hashB,
      readyAt,
      expiresAt: "2026-07-13T10:05:00.000Z",
      oneUse: true as const,
      revocable: true as const,
      currentAuthorizationRequired: true as const
    }
  });
}

function queuedJob(
  exportProduct: ExportProductFixture = product(),
  exportScope = scope()
) {
  return {
    tenantId,
    id: exportJobId,
    revision: exportJobRevision,
    product: exportProduct,
    scope: exportScope,
    boundary: boundary(),
    governance: governance(),
    policy: policy(),
    format: format(),
    requestAuthorization: authorization(
      "request",
      null,
      exportProduct.kind === "tenant_deployment"
        ? "core:privacy.tenant_export"
        : exportProduct.kind === "manager_report"
          ? "core:reports.export"
          : "core:privacy.request.execute"
    ),
    approval:
      exportProduct.kind === "tenant_deployment"
        ? {
            kind: "separated_approval" as const,
            authorization: authorization(
              "request",
              null,
              "core:privacy.tenant_export",
              2
            ).decision,
            approvedAt: requestedAt
          }
        : {
            kind: "not_required" as const,
            reason:
              exportProduct.kind === "data_subject"
                ? ("verified_data_subject_case" as const)
                : ("adr_0013_report_policy" as const)
          },
    requestedAt,
    state: "queued" as const,
    manifest: null,
    artifact: null
  };
}

function exportAuthoritySource(
  state: { governanceCurrent: boolean; policyActivationCurrent: boolean } = {
    governanceCurrent: true,
    policyActivationCurrent: true
  }
) {
  return defineInboxV2PrivacyExportAuthoritySource({
    id: "core:privacy-export-current-authority-source",
    version: "1",
    loadCurrentJobAuthority: ({
      job,
      product: exportProduct,
      registryCompositionHash,
      governance: currentGovernance,
      policy: currentPolicy,
      checkedAt
    }) => {
      const canonical = queuedJob(
        exportProduct as ExportProductFixture,
        defaultScopeForProduct(exportProduct as ExportProductFixture)
      );
      return {
        tenantId,
        job,
        registryCompositionHash,
        governance: currentGovernance,
        policy: currentPolicy,
        requestAuthorization: canonical.requestAuthorization,
        approval: canonical.approval,
        checkedAt,
        governanceCurrent: state.governanceCurrent as true,
        policyActivationCurrent: state.policyActivationCurrent as true
      };
    },
    loadCurrentCheckpoint: ({ checkpoint, checkedAt }) => ({
      checkpoint,
      checkedAt,
      governanceCurrent: state.governanceCurrent as true,
      policyActivationCurrent: state.policyActivationCurrent as true
    }),
    loadCurrentDecision: ({ decision, checkedAt }) => ({
      decision,
      checkedAt,
      governanceCurrent: state.governanceCurrent as true,
      policyActivationCurrent: state.policyActivationCurrent as true
    })
  });
}

function currentBundleSource(
  state: { revoked: boolean; encryptedPayloadPresent: boolean } = {
    revoked: false,
    encryptedPayloadPresent: true
  }
) {
  return defineInboxV2PrivacyExportCurrentBundleSource({
    id: "core:privacy-export-current-bundle-source",
    version: "1",
    loadCurrentBundle: ({ bundle, checkedAt }) => ({
      tenantId,
      job: {
        tenantId: bundle.job.tenantId,
        jobId: bundle.job.id,
        revision: bundle.job.revision,
        requestedAt: bundle.job.requestedAt
      },
      manifest: {
        tenantId: bundle.manifest.tenantId,
        manifestId: bundle.manifest.id,
        revision: bundle.manifest.revision,
        manifestHash: bundle.manifest.manifestHash
      },
      artifact: {
        tenantId: bundle.artifact.tenantId,
        artifactId: bundle.artifact.id,
        revision: bundle.artifact.revision,
        state: "ready"
      },
      artifactChecksum: bundle.artifact.checksum,
      state: "ready",
      encryptedPayloadPresent: state.encryptedPayloadPresent as true,
      revoked: state.revoked as false,
      checkedAt
    })
  });
}

function readyJob(
  exportProduct: ExportProductFixture = product(),
  exportScope = defaultScopeForProduct(exportProduct),
  exactManifest = manifest(
    exportProduct,
    exportScope,
    proofForProduct(exportProduct)
  )
) {
  return {
    ...queuedJob(exportProduct, exportScope),
    state: "ready" as const,
    manifest: {
      tenantId,
      manifestId: "privacy-export-manifest:manifest-1",
      revision: "1",
      manifestHash: exactManifest.manifestHash
    },
    artifact: {
      tenantId,
      artifactId: "privacy-export-artifact:artifact-1",
      revision: "2",
      state: "ready" as const
    }
  };
}

function subjectDiscoveryManifest(registry: ReturnType<typeof exportRegistry>) {
  const source = defineInboxV2SubjectDiscoverySource({
    id: "core:subject-discovery-source.privacy-export-fixture",
    version: "1",
    loadCompleteDiscovery: () => ({
      tenantId,
      id: "subject_discovery:request-1",
      requesterSubject: subject,
      discoveredSubjects: [subject],
      subjectLinks: [],
      roots: [
        {
          root: exportRoot,
          subjects: [subject],
          relationshipToRequester: "requester_only" as const,
          thirdPartyProtection: null
        }
      ],
      coverage: [
        {
          kind: "deterministic" as const,
          root: exportRoot,
          method: "structured_subject_link" as const,
          outcome: "matched" as const
        }
      ],
      revision: "1",
      generatedAt: "2026-07-12T09:10:00.000Z",
      streamEpoch: "stream-epoch-1",
      syncGeneration: "1",
      completeThroughPosition: "100",
      scannedDiscoveryHandlerIds: [
        "core:lifecycle.client-profile-subject-discovery"
      ]
    })
  });
  return resolveInboxV2SubjectDiscoveryManifest({
    source,
    registry,
    tenantId,
    requesterSubject: subject
  });
}

function privacyRequestPolicyAuthority(
  registry: ReturnType<typeof exportRegistry>
) {
  const governanceContext = defineInboxV2DataGovernanceContext({
    tenantId,
    id: "core:governance-profile.default",
    version: "1",
    policyRevision: "1",
    deploymentProfile: "saas_shared",
    rolesByPurpose: [
      {
        purposeId: "core:data_subject_request_execution",
        roles: [{ regime: "eu", role: "controller" }],
        lawfulBasisReferenceCode: "core:basis.data-subject-request",
        customerInstructionReferenceCode: null
      },
      {
        purposeId: "core:manager_reporting",
        roles: [{ regime: "eu", role: "controller" }],
        lawfulBasisReferenceCode: "core:basis.manager-reporting",
        customerInstructionReferenceCode: null
      }
    ],
    jurisdictionProfiles: [
      { id: "core:jurisdiction.eu-default", version: "1" }
    ],
    residencyRegionIds: ["core:region-eu"],
    crossBorderRouteIds: [],
    timeZone: "Europe/Moscow",
    tzdbVersion: "2026a",
    calendarPeriodResolver: {
      id: "core:calendar-resolver",
      version: "1"
    },
    calendarBoundaryPolicy: {
      monthOverflow: "constrain",
      ambiguousLocalTime: "reject",
      nonexistentLocalTime: "reject",
      businessDayAnchor: "exclusive"
    },
    businessCalendars: [],
    requestSlaProfile: { id: "core:request-sla-eu", version: "1" },
    industryProfiles: [],
    approvedAt: "2026-01-01T00:00:00.000Z",
    effectiveAt: "2026-01-02T00:00:00.000Z",
    reviewAt: "2027-01-02T00:00:00.000Z"
  });
  const template = defineInboxV2PolicyTemplate({
    kind: "template",
    id: "core:privacy-export-policy-template",
    version: "1",
    deploymentProfile: "saas_shared",
    jurisdictionProfiles: [
      { id: "core:jurisdiction.eu-default", version: "1" }
    ],
    effectiveAt: "2026-01-03T00:00:00.000Z",
    reviewAt: "2027-01-03T00:00:00.000Z",
    rules: [
      {
        id: "core:retention-rule.client-contact-profile",
        revision: "1",
        dataClassId: "core:client_contact_profile",
        purposeId: "core:data_subject_request_execution",
        retentionAnchorId: "core:relationship_end",
        baselineWindow: {
          kind: "fixed_after_anchor",
          period: { kind: "elapsed", seconds: 365 * 86_400 }
        },
        actionAtExpiry: "remove_identity_resolution_keep_subjectless_fact",
        backupMaximum: { kind: "elapsed", seconds: 35 * 86_400 },
        legalMinimum: null,
        legalMaximum: null,
        allowTenantShorter: false,
        allowTenantLonger: false,
        holdEligible: true
      },
      {
        id: "core:retention-rule.crm-history",
        revision: "1",
        dataClassId: "core:crm_value_and_history",
        purposeId: "core:manager_reporting",
        retentionAnchorId: "core:relationship_or_case_end",
        baselineWindow: {
          kind: "fixed_after_anchor",
          period: { kind: "elapsed", seconds: 365 * 86_400 }
        },
        actionAtExpiry: "remove_identity_resolution_keep_subjectless_fact",
        backupMaximum: { kind: "elapsed", seconds: 35 * 86_400 },
        legalMinimum: null,
        legalMaximum: null,
        allowTenantShorter: false,
        allowTenantLonger: false,
        holdEligible: true
      }
    ]
  });
  const resolution = resolveInboxV2EffectiveTenantPolicy({
    registry,
    tenantId,
    id: "core:privacy-export-policy",
    version: "1",
    policyHash: hashA,
    effectiveAt: "2026-02-01T00:00:00.000Z",
    templates: [template],
    governanceContext,
    tenantSelections: [],
    entitlementAllowances: []
  });
  if (resolution.kind !== "resolved") {
    throw new Error(`Privacy export policy fixture: ${resolution.errorCode}`);
  }
  const candidatePolicy = resolution.policy;
  const impactSource = defineInboxV2PolicyImpactSource({
    id: "core:privacy-export-impact-source",
    version: "1",
    loadCompleteImpact: () => ({
      sourceSnapshot: {
        streamEpoch: "stream:epoch:privacy-export-impact",
        syncGeneration: "1",
        completeThroughPosition: "100",
        snapshotHash: hashA
      },
      affectedRootCount: "0",
      affectedByteCount: "0",
      heldRootCount: "0",
      backupCopyCount: "0",
      earliestDestructiveAt: null,
      resolvedAt: "2026-02-01T00:00:00.000Z"
    }),
    compareAndSetActivationImpact: ({ activatedAt }) => ({
      outcome: "matched",
      currentImpact: {
        sourceSnapshot: {
          streamEpoch: "stream:epoch:privacy-export-impact",
          syncGeneration: "1",
          completeThroughPosition: "100",
          snapshotHash: hashA
        },
        affectedRootCount: "0",
        affectedByteCount: "0",
        heldRootCount: "0",
        backupCopyCount: "0",
        earliestDestructiveAt: null,
        resolvedAt: activatedAt
      }
    })
  });
  const impactProof = resolveInboxV2PolicyImpactSourceProof({
    source: impactSource,
    currentPolicy: null,
    candidatePolicy
  });
  const impactPreview = defineInboxV2PolicyImpactPreview({
    currentPolicy: null,
    candidatePolicy,
    sourceProof: impactProof,
    preview: {
      tenantId,
      id: "core:privacy-export-impact-preview",
      revision: "1",
      previewedAt: "2026-02-01T00:00:00.000Z"
    }
  });
  const activationLedger = defineInboxV2PolicyActivationLedger({
    id: "core:privacy-export-policy-ledger"
  });
  const activationAuthorization = (employeeNumber: number) => ({
    tenantId,
    id: `authorization-decision:privacy-export-policy-${employeeNumber}`,
    authorizationEpoch: `authorization-epoch-export-policy-${employeeNumber}`,
    principal: {
      kind: "employee" as const,
      employee: {
        tenantId,
        kind: "employee" as const,
        id: `employee:privacy-policy-${employeeNumber}`
      }
    },
    permissionId: "core:privacy.policy.manage",
    resourceScopeId: "core:data-lifecycle-policy",
    resource: {
      tenantId,
      entityTypeId: "core:data-lifecycle-policy",
      entityId: candidatePolicy.id
    },
    resourceAccessRevision: candidatePolicy.version,
    decisionRevision: "1",
    decisionHash: employeeNumber === 1 ? hashA : hashB,
    outcome: "allowed" as const,
    decidedAt: "2026-02-01T00:00:00.000Z",
    notAfter: "2026-12-01T00:00:00.000Z"
  });
  const policy = activateInboxV2EffectiveTenantPolicy({
    ledger: activationLedger,
    currentPolicy: null,
    candidatePolicy,
    impactPreview,
    transition: {
      kind: "initial_reviewed_bootstrap",
      reviewedBootstrapProfile: {
        id: "core:privacy-export-bootstrap",
        version: "1"
      }
    },
    activation: {
      tenantId,
      id: "core:privacy-export-policy-activation",
      revision: "1",
      requesterAuthorization: activationAuthorization(1),
      approverAuthorization: activationAuthorization(2),
      requestedAt: "2026-02-02T00:00:00.000Z",
      approvedAt: "2026-02-03T00:00:00.000Z",
      notBefore: "2026-02-04T00:00:00.000Z",
      activatedAt: "2026-02-04T00:00:00.000Z",
      reasonCode: "core:privacy-export-policy-reviewed"
    }
  }).policy;
  return { governanceContext, policy, activationLedger };
}

const sharedExportRegistry = exportRegistry();
const sharedExportPolicyAuthority =
  privacyRequestPolicyAuthority(sharedExportRegistry);

function tenantTerminationScopeProof(empty = false) {
  const source = defineInboxV2TenantTerminationScopeSource({
    id: "core:privacy-export-tenant-scope-source",
    version: "1",
    loadCompleteTenantScope: ({ expectedDataUses }) => ({
      kind: "tenant_termination_scope",
      tenantId,
      id: "core:tenant-termination-scope-export-1",
      revision: "1",
      boundary: {
        streamEpoch: "stream-epoch-1",
        syncGeneration: "1",
        completeThroughPosition: "100",
        snapshotHash: hashD
      },
      scannedDataUses: [...expectedDataUses],
      roots: empty
        ? []
        : [
            {
              root: exportRoot,
              expectedEntityRevision: "1",
              expectedLineageRevision: "1",
              handling: "export_then_erase" as const
            }
          ],
      generatedAt: requestedAt
    }),
    compareAndSetDestructiveScope: ({ manifest, checkedAt }) => ({
      outcome: "matched_and_sealed",
      tenantId: manifest.tenantId,
      registryCompositionHash: manifest.registryCompositionHash,
      boundary: manifest.boundary,
      rootSetHash: manifest.rootSetHash,
      exportRootSetHash: manifest.exportRootSetHash,
      checkedAt
    })
  });
  return resolveInboxV2TenantTerminationScopeManifest({
    source,
    registry: sharedExportRegistry,
    governanceContext: sharedExportPolicyAuthority.governanceContext,
    policy: sharedExportPolicyAuthority.policy,
    activationLedger: sharedExportPolicyAuthority.activationLedger,
    tenantId
  });
}

const sharedTenantTerminationScopeProof = tenantTerminationScopeProof();

function authenticPrivacyRequest(
  intent: "access" | "portability" = "access",
  registry = exportRegistry(),
  revision = "2"
) {
  const discovery = subjectDiscoveryManifest(registry);
  const authority = privacyRequestPolicyAuthority(registry);
  const pinnedDecision = {
    ...decision(intent),
    policyProfile: {
      id: authority.policy.id,
      version: authority.policy.version
    }
  };
  const authoritySource = defineInboxV2PrivacyRequestAuthoritySource({
    id: "core:privacy-export-request-authority",
    version: "1",
    loadCurrentAuthority: () => ({
      tenantId,
      reviewer: pinnedDecision.reviewer,
      verifiedSubjects: verifiedIdentity().verifiedSubjects,
      authorizedAliases: [subject],
      checkedAt: pinnedDecision.decidedAt
    })
  });
  return defineInboxV2PrivacyRequest({
    request: {
      tenantId,
      id: "privacy_request:request-1",
      revision,
      intent,
      tenantTerminationScope: null,
      governanceContext: {
        tenantId: authority.governanceContext.tenantId,
        id: authority.governanceContext.id,
        version: authority.governanceContext.version,
        contextHash: authority.governanceContext.contextHash
      },
      jurisdictionProfile: {
        id: "core:jurisdiction.eu-default",
        version: "1"
      },
      responsibilityRole: {
        regime: "eu" as const,
        role: "controller" as const
      },
      requesterSubject: subject,
      claimedSubjectAliases: [subject],
      requestEvidence: [classifiedEvidence()],
      receivedAt: "2026-07-12T08:55:00.000Z",
      dueAt: "2026-08-12T08:55:00.000Z",
      extendedDueAt: null,
      extensionReasonCode: null,
      workflow: {
        state: "approved" as const,
        verification: verifiedIdentity(),
        discovery: {
          tenantId: discovery.tenantId,
          id: discovery.id,
          revision: discovery.revision,
          digest: discovery.digest
        },
        decision: pinnedDecision
      },
      updatedAt: "2026-07-12T09:30:00.000Z"
    },
    discoveryManifest: discovery,
    registry,
    governanceContext: authority.governanceContext,
    policy: authority.policy,
    policyActivationLedger: authority.activationLedger,
    authoritySource
  });
}

function dataSubjectProof(
  intent: "access" | "portability" = "access",
  registry = exportRegistry(),
  evaluatedAt = requestedAt,
  requestRevision = "2"
) {
  return defineInboxV2DataSubjectExportScopeProof({
    job: jobReference(),
    request: authenticPrivacyRequest(intent, registry, requestRevision),
    evaluatedAt
  });
}

function currentDataSubjectProof(
  registry: ReturnType<typeof exportRegistry>,
  checkedAt: string,
  requestRevision = "2"
) {
  const currentRequest = authenticPrivacyRequest(
    "access",
    registry,
    requestRevision
  );
  const source = defineInboxV2DataSubjectCurrentRequestSource({
    id: "core:privacy-request-current-source.fixture",
    loadCurrent: () => currentRequest
  });
  return defineInboxV2CurrentDataSubjectExportScopeProof({
    source,
    job: jobReference(),
    request: {
      tenantId,
      requestId: "privacy_request:request-1",
      revision: "2"
    },
    checkedAt
  });
}

function managerProof(
  accessLevel: "aggregate" | "drilldown" | "pii" = "pii",
  evaluatedAt = requestedAt,
  notAfter = "2026-07-12T11:00:00.000Z",
  employeeNumber = 1
) {
  const reportDefinition = {
    id: "core:report.team-performance",
    revision: "3",
    digest: hashA
  };
  const reportScope = {
    id: "core:report-scope.team-performance",
    revision: "4",
    accessLevel,
    scopeHash: hashB
  };
  const permissions =
    accessLevel === "aggregate"
      ? ["core:reports.export", "core:reports.view"]
      : accessLevel === "drilldown"
        ? ["core:reports.drilldown", "core:reports.export", "core:reports.view"]
        : [
            "core:reports.drilldown",
            "core:reports.export",
            "core:reports.pii.export",
            "core:reports.pii.view",
            "core:reports.view"
          ];
  const permissionDecisions = permissions.map((permissionId) => {
    const decision = authorization(
      "request",
      null,
      permissionId,
      employeeNumber,
      evaluatedAt,
      `report-${permissionId}-${evaluatedAt}`
    ).decision;
    return {
      ...decision,
      resourceScopeId: "core:manager-report-scope",
      resource: {
        tenantId,
        entityTypeId: "core:manager-report-scope",
        entityId: reportScope.id
      },
      resourceAccessRevision: reportScope.revision
    };
  });
  const rootPermission = managerRootPermission(accessLevel);
  const authorityInput = {
    kind: "manager_report_scope_proof" as const,
    tenantId,
    job: jobReference(),
    reportDefinition,
    reportScope,
    projectionProfile: definedProjectionProfile("manager_report").reference,
    boundary: boundary(),
    authorizationManifest: {
      tenantId,
      id: "core:report-authorization-manifest.team-performance",
      revision: "5",
      reportScopeHash: reportScope.scopeHash,
      permissionDecisions,
      authorizedRoots: [
        {
          root: managerExportRoot,
          expectedEntityRevision: "1",
          expectedLineageRevision: "1",
          permissionDecisions: [
            rootAuthorization(
              managerExportRoot,
              rootPermission,
              "1",
              evaluatedAt,
              employeeNumber
            ).decision
          ],
          lineagePermissionDecisions: [
            lineageAuthorization(
              managerExportRoot,
              rootPermission,
              "1",
              evaluatedAt,
              employeeNumber
            ).decision
          ]
        }
      ],
      resourceCount: "1",
      evaluatedAt,
      notAfter,
      allResourcesAuthorized: true as const,
      digest: hashC
    },
    proofHash: hashD
  };
  const source = defineInboxV2ManagerReportAuthoritySource({
    id: "core:manager-report-authority.fixture",
    resolve: () => authorityInput
  });
  const authority = defineInboxV2ManagerReportExportAuthority({
    source,
    job: jobReference(),
    principal: permissionDecisions[0]!.principal,
    checkedAt: evaluatedAt
  });
  return defineInboxV2ManagerReportExportScopeProof({ authority });
}

function managerRootPermission(accessLevel: "aggregate" | "drilldown" | "pii") {
  return accessLevel === "pii"
    ? "core:reports.pii.view"
    : accessLevel === "drilldown"
      ? "core:reports.drilldown"
      : "core:reports.view";
}

function issuedReceiptInput(
  bundle: InboxV2PrivacyExportTerminalBundle,
  id = "privacy-export-download:receipt-1",
  employeeNumber = 1
) {
  const exportProduct = bundle.job.product;
  const permissionId =
    exportProduct.kind === "tenant_deployment"
      ? "core:privacy.tenant_export"
      : exportProduct.kind === "manager_report"
        ? "core:reports.export"
        : "core:privacy.request.execute";
  return {
    tenantId,
    id,
    revision: "1",
    job: jobReference(),
    artifact: {
      tenantId,
      artifactId: "privacy-export-artifact:artifact-1",
      revision: "2",
      state: "ready" as const
    },
    manifest: {
      tenantId,
      manifestId: "privacy-export-manifest:manifest-1",
      revision: "1",
      manifestHash: bundle.manifest.manifestHash
    },
    product: exportProduct,
    issuedAt: readyAt,
    expiresAt: "2026-07-12T10:10:00.000Z",
    issuanceAuthorization: authorization(
      "download",
      null,
      permissionId,
      employeeNumber,
      readyAt
    ),
    issuanceArtifactAuthorization: artifactAuthorization(
      bundle.artifact,
      permissionId,
      readyAt,
      employeeNumber,
      "issue"
    ),
    oneUse: true as const,
    state: "issued" as const
  };
}

function testDurableClaimRepository(): InboxV2PrivacyExportClaimRepository {
  const artifactClaims = new Map<
    string,
    { receiptKey: string; principalKey: string; lineage: string }
  >();
  const receiptRevisions = new Map<string, string>();
  return defineInboxV2PrivacyExportClaimRepository({
    async issue(input) {
      const existingClaim = artifactClaims.get(input.artifactClaimKey);
      if (existingClaim !== undefined) {
        expect(existingClaim.lineage).not.toBe("");
        return { outcome: "conflict" as const };
      }
      if (receiptRevisions.has(input.receiptKey)) {
        return { outcome: "conflict" as const };
      }
      artifactClaims.set(input.artifactClaimKey, {
        receiptKey: input.receiptKey,
        principalKey: input.principalKey,
        lineage: JSON.stringify(input.lineage)
      });
      receiptRevisions.set(input.receiptKey, input.issuedRevision);
      return { outcome: "applied" as const, claimRevision: "1" };
    },
    async consume(input) {
      const claim = artifactClaims.get(input.artifactClaimKey);
      if (
        claim?.receiptKey !== input.receiptKey ||
        claim.principalKey !== input.principalKey ||
        claim.lineage !== JSON.stringify(input.lineage) ||
        receiptRevisions.get(input.receiptKey) !== input.expectedRevision
      ) {
        return { outcome: "conflict" as const };
      }
      receiptRevisions.set(input.receiptKey, input.nextRevision);
      return { outcome: "applied" as const, claimRevision: "2" };
    }
  });
}

function exportRegistry() {
  return defineInboxV2DataLifecycleRegistry({
    coreStorageRootRegistrations: [
      {
        schemaId: "core:inbox-v2.catalog-registration",
        schemaVersion: "v1",
        payload: {
          catalog: "storage-root",
          owner: { kind: "core" },
          entries: [
            {
              id: "core:client-profile-sql",
              definition: {
                kind: "sql",
                boundary: "operated_data_plane",
                tenantIsolation: "required",
                versionEnumeration: "not_applicable",
                configurationProfileId: "core:storage-profile.sql"
              }
            },
            {
              id: "core:crm-history-sql",
              definition: {
                kind: "sql",
                boundary: "operated_data_plane",
                tenantIsolation: "required",
                versionEnumeration: "not_applicable",
                configurationProfileId: "core:storage-profile.sql"
              }
            }
          ]
        }
      }
    ],
    coreLifecycleHandlerRegistrations: [
      {
        schemaId: "core:inbox-v2.catalog-registration",
        schemaVersion: "v1",
        payload: {
          catalog: "lifecycle-handler",
          owner: { kind: "core" },
          entries: [
            {
              id: "core:lifecycle.client-profile",
              definition: {
                kind: "lifecycle",
                supportedRootKinds: ["sql"],
                supportedOperations: [
                  "persist",
                  "export",
                  "delete",
                  "verify_absence"
                ],
                bounded: true,
                idempotent: true,
                checksTenantFence: true,
                checksRevisionFence: true,
                checksHoldFence: false,
                verifiesAbsence: false
              }
            },
            {
              id: "core:lifecycle.client-profile-subject-discovery",
              definition: {
                kind: "subject_discovery",
                supportedRootKinds: ["sql"],
                supportedOperations: ["read"],
                bounded: true,
                idempotent: true,
                checksTenantFence: true,
                checksRevisionFence: true,
                checksHoldFence: true,
                verifiesAbsence: false
              }
            },
            {
              id: "core:lifecycle.client-profile-export-projection",
              definition: {
                kind: "export_projection",
                supportedRootKinds: ["sql"],
                supportedOperations: ["export"],
                bounded: true,
                idempotent: true,
                checksTenantFence: true,
                checksRevisionFence: true,
                checksHoldFence: true,
                verifiesAbsence: false
              }
            },
            {
              id: "core:lifecycle.client-profile-export",
              definition: {
                kind: "export_execution",
                supportedRootKinds: ["sql"],
                supportedOperations: ["export"],
                bounded: true,
                idempotent: true,
                checksTenantFence: true,
                checksRevisionFence: true,
                checksHoldFence: false,
                verifiesAbsence: false
              }
            },
            {
              id: "core:lifecycle.client-profile-delete",
              definition: {
                kind: "delete_execution",
                supportedRootKinds: ["sql"],
                supportedOperations: ["delete"],
                bounded: true,
                idempotent: true,
                checksTenantFence: true,
                checksRevisionFence: true,
                checksHoldFence: true,
                verifiesAbsence: false
              }
            },
            {
              id: "core:lifecycle.client-profile-verify",
              definition: {
                kind: "verification",
                supportedRootKinds: ["sql"],
                supportedOperations: ["verify_absence"],
                bounded: true,
                idempotent: true,
                checksTenantFence: true,
                checksRevisionFence: true,
                checksHoldFence: true,
                verifiesAbsence: true
              }
            }
          ]
        }
      }
    ],
    coreDataUseRegistrations: [
      {
        schemaId: "core:inbox-v2.core-data-use-registration",
        schemaVersion: "v1",
        payload: {
          dataUses: [
            {
              dataClassId: "core:client_contact_profile",
              storageRootId: "core:client-profile-sql",
              purposeIds: ["core:data_subject_request_execution"],
              operations: ["persist", "export", "delete", "verify_absence"],
              canonicalAnchorId: "core:relationship_end",
              lifecycleHandlerId: "core:lifecycle.client-profile",
              subjectDiscoveryHandlerId:
                "core:lifecycle.client-profile-subject-discovery",
              exportProjectionHandlerId:
                "core:lifecycle.client-profile-export-projection",
              exportHandlerId: "core:lifecycle.client-profile-export",
              deleteHandlerId: "core:lifecycle.client-profile-delete",
              verificationHandlerId: "core:lifecycle.client-profile-verify"
            },
            {
              dataClassId: "core:crm_value_and_history",
              storageRootId: "core:crm-history-sql",
              purposeIds: ["core:manager_reporting"],
              operations: ["persist", "export", "delete", "verify_absence"],
              canonicalAnchorId: "core:relationship_or_case_end",
              lifecycleHandlerId: "core:lifecycle.client-profile",
              subjectDiscoveryHandlerId:
                "core:lifecycle.client-profile-subject-discovery",
              exportProjectionHandlerId:
                "core:lifecycle.client-profile-export-projection",
              exportHandlerId: "core:lifecycle.client-profile-export",
              deleteHandlerId: "core:lifecycle.client-profile-delete",
              verificationHandlerId: "core:lifecycle.client-profile-verify"
            }
          ]
        }
      }
    ]
  });
}

describe("Inbox V2 privacy export contracts", () => {
  it("accepts a pinned, authorized subject export and exact envelopes", () => {
    expect(inboxV2PrivacyExportJobSchema.safeParse(queuedJob()).success).toBe(
      true
    );
    expect(
      inboxV2PrivacyExportManifestSchema.safeParse(manifest()).success
    ).toBe(true);
    expect(
      inboxV2PrivacyExportArtifactSchema.safeParse(readyArtifact()).success
    ).toBe(true);

    expect(
      inboxV2PrivacyExportJobEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.privacy-export-job",
        schemaVersion: "v1",
        payload: queuedJob()
      }).success
    ).toBe(true);
    expect(
      inboxV2PrivacyExportManifestEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.privacy-export-manifest",
        schemaVersion: "v1",
        payload: manifest()
      }).success
    ).toBe(true);
    expect(
      inboxV2PrivacyExportArtifactEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.privacy-export-artifact",
        schemaVersion: "v1",
        payload: readyArtifact()
      }).success
    ).toBe(true);
    for (const [label, schema] of [
      ["privacy export job", inboxV2PrivacyExportJobSchema],
      ["privacy export manifest", inboxV2PrivacyExportManifestSchema],
      ["privacy export artifact", inboxV2PrivacyExportArtifactSchema],
      [
        "privacy export download receipt",
        inboxV2PrivacyExportDownloadReceiptSchema
      ]
    ] as const) {
      expect(() => assertInboxV2ClosedJsonSchema(schema, label)).not.toThrow();
    }
  });

  it("structurally excludes secrets and never-export classes", () => {
    for (const selection of [
      {
        dataClassId: "core:auth_credential_session_challenge_secret",
        sensitivity: "secret",
        exportBehavior: "normalized_projection"
      },
      {
        dataClassId: "core:client_contact_profile",
        sensitivity: "sensitive_personal",
        exportBehavior: "never"
      }
    ]) {
      expect(
        inboxV2PrivacyExportScopeSchema.safeParse({
          ...scope(),
          classes: [selection]
        }).success
      ).toBe(false);
    }
    expect(
      inboxV2PrivacyExportScopeSchema.safeParse({
        ...scope(),
        fieldIds: ["core:caller-controlled-field"]
      }).success
    ).toBe(false);
  });

  it("requires a composed registry instead of trusting scope IDs or metadata", () => {
    const registry = exportRegistry();
    const projectionProfile = definedProjectionProfile(
      "data_subject",
      registry
    );
    expect(
      defineInboxV2PrivacyExportJob({
        job: queuedJob(),
        registry,
        projectionProfile,
        scopeProof: dataSubjectProof(),
        authoritySource: exportAuthoritySource()
      }).state
    ).toBe("queued");
    const emptyRegistry = defineInboxV2DataLifecycleRegistry();
    expect(() =>
      defineInboxV2PrivacyExportScope({
        scope: scope(),
        product: product(),
        format: format(),
        projectionProfile,
        registry: emptyRegistry
      })
    ).toThrow(/Unknown export storage root/u);
    expect(() =>
      defineInboxV2PrivacyExportScope({
        scope: {
          ...scope(),
          classes: [
            {
              ...scope().classes[0]!,
              sensitivity: "sensitive_personal"
            }
          ]
        },
        product: product(),
        format: format(),
        projectionProfile,
        registry
      })
    ).toThrow(/does not match its registered policy/u);
    expect(() =>
      defineInboxV2PrivacyExportScope({
        scope: scope("core:manager_reporting"),
        product: product(),
        format: format(),
        projectionProfile,
        registry
      })
    ).toThrow(/registered policy|exact purpose/u);
    expect(() =>
      defineInboxV2PrivacyExportScope({
        scope: scope(),
        product: product(),
        format: format(),
        projectionProfile: structuredClone(projectionProfile),
        registry
      })
    ).toThrow(/authentic projection profile/u);
    const catalog = definedProjectionCatalog(registry);
    expect(() =>
      defineInboxV2PrivacyExportProjectionProfile({
        reference: catalog.profiles[0]!.reference,
        catalog: structuredClone(catalog)
      })
    ).toThrow(/authentic trusted projection catalog/u);
    expect(() =>
      defineInboxV2PrivacyExportProjectionProfile({
        reference: {
          ...catalog.profiles[0]!.reference,
          digest: hashD
        },
        catalog
      })
    ).toThrow(/not registered in the trusted catalog/u);
  });

  it("requires an authentic verified request with exact discovery and approved roots", () => {
    const registry = exportRegistry();
    const projectionProfile = definedProjectionProfile(
      "data_subject",
      registry
    );
    const proof = dataSubjectProof();
    expect(() =>
      defineInboxV2PrivacyExportJob({
        job: queuedJob(),
        registry,
        projectionProfile,
        scopeProof: structuredClone(proof),
        authoritySource: exportAuthoritySource()
      })
    ).toThrow(/authentic verified request/u);

    const wrongDiscoveryJob = structuredClone(queuedJob());
    if (wrongDiscoveryJob.product.kind !== "data_subject") {
      throw new TypeError("Expected data-subject export fixture.");
    }
    wrongDiscoveryJob.product.discovery.digest = hashC as never;
    expect(() =>
      defineInboxV2PrivacyExportJob({
        job: wrongDiscoveryJob,
        registry,
        projectionProfile,
        scopeProof: proof,
        authoritySource: exportAuthoritySource()
      })
    ).toThrow(/verified request\/discovery\/approved-root proof/u);

    expect(() =>
      defineInboxV2DataSubjectExportScopeProof({
        job: jobReference(),
        request: structuredClone(authenticPrivacyRequest())
      })
    ).toThrow(/authentic loaded privacy request/u);
  });

  it("keeps tenant, manager and verified-subject export permissions separate", async () => {
    const tenantExportProduct = tenantProduct();
    const tenantExport = {
      ...queuedJob(tenantExportProduct, tenantScope()),
      requestAuthorization: authorization(
        "request",
        null,
        "core:privacy.tenant_export",
        1
      ),
      approval: {
        kind: "separated_approval" as const,
        authorization: authorization(
          "request",
          null,
          "core:privacy.tenant_export",
          2
        ).decision,
        approvedAt: requestedAt
      }
    };
    expect(inboxV2PrivacyExportJobSchema.safeParse(tenantExport).success).toBe(
      true
    );
    expect(
      inboxV2PrivacyExportJobSchema.safeParse({
        ...tenantExport,
        approval: {
          ...tenantExport.approval,
          authorization: authorization(
            "request",
            null,
            "core:privacy.tenant_export",
            1
          ).decision
        }
      }).success
    ).toBe(false);

    const wrongApprovalJob = authorization(
      "request",
      null,
      "core:privacy.tenant_export",
      2
    ).decision;
    wrongApprovalJob.resource = {
      ...wrongApprovalJob.resource,
      entityId: "privacy-export-job:job-2"
    };
    expect(
      inboxV2PrivacyExportJobSchema.safeParse({
        ...tenantExport,
        approval: {
          ...tenantExport.approval,
          authorization: wrongApprovalJob
        }
      }).success
    ).toBe(false);

    const wrongApprovalRevision = authorization(
      "request",
      null,
      "core:privacy.tenant_export",
      2
    ).decision;
    wrongApprovalRevision.resourceAccessRevision = "2";
    expect(
      inboxV2PrivacyExportJobSchema.safeParse({
        ...tenantExport,
        approval: {
          ...tenantExport.approval,
          authorization: wrongApprovalRevision
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2PrivacyExportJobSchema.safeParse({
        ...tenantExport,
        approval: {
          ...tenantExport.approval,
          approvedAt: tenantExport.approval.authorization.notAfter
        }
      }).success
    ).toBe(false);

    const managerExport = queuedJob(managerProduct(), managerScope());
    expect(inboxV2PrivacyExportJobSchema.safeParse(managerExport).success).toBe(
      true
    );
    expect(
      inboxV2PrivacyExportJobSchema.safeParse({
        ...managerExport,
        requestAuthorization: authorization("request", null)
      }).success
    ).toBe(false);
    const registry = exportRegistry();
    const managerProjection = definedProjectionProfile(
      "manager_report",
      registry
    );
    expect(
      defineInboxV2PrivacyExportJob({
        job: managerExport,
        registry,
        projectionProfile: managerProjection,
        scopeProof: managerProof(),
        authoritySource: exportAuthoritySource()
      }).state
    ).toBe("queued");
    const otherPrincipalProof = managerProof(
      "pii",
      requestedAt,
      "2026-07-12T11:00:00.000Z",
      2
    );
    expect(() =>
      defineInboxV2PrivacyExportJob({
        job: managerExport,
        registry,
        projectionProfile: managerProjection,
        scopeProof: otherPrincipalProof,
        authoritySource: exportAuthoritySource()
      })
    ).toThrow(/underlying drilldown\/PII authority proof/u);
    for (const accessLevel of ["aggregate", "drilldown"] as const) {
      const restrictedProof = managerProof(accessLevel);
      const restrictedProduct = managerProduct(accessLevel);
      expect(() =>
        defineInboxV2PrivacyExportJob({
          job: queuedJob(restrictedProduct, managerScope()),
          registry,
          projectionProfile: managerProjection,
          scopeProof: restrictedProof,
          authoritySource: exportAuthoritySource()
        })
      ).toThrow(/underlying drilldown\/PII authority proof/u);
    }
    const managerExportProduct = managerProduct();
    const managerExportScope = managerScope();
    const managerExportProof = managerProof();
    const managerExportManifest = manifest(
      managerExportProduct,
      managerExportScope,
      managerExportProof
    );
    const managerExportArtifact = readyArtifact(
      managerExportProduct,
      managerExportManifest
    );
    const managerBundle = defineInboxV2PrivacyExportTerminalBundle({
      job: readyJob(
        managerExportProduct,
        managerExportScope,
        managerExportManifest
      ),
      manifest: managerExportManifest,
      artifact: managerExportArtifact,
      registry,
      projectionProfile: managerProjection,
      scopeProof: managerExportProof,
      authoritySource: exportAuthoritySource(),
      currentBundleSource: currentBundleSource()
    });
    expect(managerBundle.artifact.state).toBe("ready");
    const currentManagerProof = managerProof("pii", readyAt);
    const managerClaimRepository = testDurableClaimRepository();
    await expect(
      defineInboxV2PrivacyExportDownloadReceipt({
        receipt: issuedReceiptInput(
          managerBundle,
          "privacy-export-download:manager-principal-b",
          2
        ),
        bundle: managerBundle,
        currentScopeProof: currentManagerProof,
        repository: managerClaimRepository
      })
    ).rejects.toThrow(/exact unexpired terminal bundle/u);
    const managerIssued = await defineInboxV2PrivacyExportDownloadReceipt({
      receipt: issuedReceiptInput(
        managerBundle,
        "privacy-export-download:manager-principal-a"
      ),
      bundle: managerBundle,
      currentScopeProof: currentManagerProof,
      repository: managerClaimRepository
    });
    expect(managerIssued.state).toBe("issued");
    const crossPrincipalManifest = manifestInput(
      managerExportProduct,
      managerExportScope
    );
    crossPrincipalManifest.chunks[0]!.authorization = authorization(
      "chunk",
      "1",
      "core:reports.export",
      2,
      materializedAt
    );
    crossPrincipalManifest.chunks[0]!.rootAuthorizations = [
      rootAuthorization(
        managerExportRoot,
        "core:reports.pii.view",
        "1",
        materializedAt,
        2
      )
    ];
    crossPrincipalManifest.chunks[0]!.lineageAuthorization =
      lineageAuthorization(
        managerExportRoot,
        "core:reports.pii.view",
        "1",
        materializedAt,
        2
      );
    expect(() =>
      defineInboxV2PrivacyExportManifest({
        manifest: crossPrincipalManifest,
        job: queuedJob(managerExportProduct, managerExportScope),
        registry,
        projectionProfile: managerProjection,
        scopeProof: managerExportProof,
        enumeration: exportEnumeration(
          managerExportProduct,
          managerExportScope,
          managerExportProof,
          false,
          registry,
          managerProjection
        ),
        authoritySource: exportAuthoritySource()
      })
    ).toThrow(/current underlying resource authority/u);
    const missingPiiAuthority = structuredClone(managerProof());
    missingPiiAuthority.authorizationManifest.permissionDecisions.splice(2, 1);
    expect(() =>
      defineInboxV2ManagerReportExportScopeProof({
        authority: missingPiiAuthority
      })
    ).toThrow(/authentic current report authority source/u);
    const wrongReportScopeAuthority = structuredClone(managerProof());
    wrongReportScopeAuthority.authorizationManifest.permissionDecisions[0]!.resource.entityId =
      "core:report-scope.other" as never;
    expect(() =>
      defineInboxV2ManagerReportExportScopeProof({
        authority: wrongReportScopeAuthority
      })
    ).toThrow(/authentic current report authority source/u);
    const staleManagerProof = managerProof(
      "pii",
      requestedAt,
      "2026-07-12T10:01:00.000Z"
    );
    expect(() =>
      defineInboxV2PrivacyExportTerminalBundle({
        job: readyJob(managerProduct(), managerScope()),
        manifest: manifest(managerProduct(), managerScope()),
        artifact: readyArtifact(managerProduct()),
        registry,
        projectionProfile: managerProjection,
        scopeProof: staleManagerProof,
        authoritySource: exportAuthoritySource(),
        currentBundleSource: currentBundleSource()
      })
    ).toThrow(/current underlying resource authority/u);
    expect(
      inboxV2PrivacyExportArtifactSchema.safeParse({
        ...readyArtifact(),
        downloadAuthorization: authorization("download", null)
      }).success
    ).toBe(false);
  });

  it("binds request authorization to the exact job revision and request time", () => {
    const preRequestAuthorization = authorization("request", null);
    preRequestAuthorization.checkedAt = "2026-07-12T09:59:00.000Z";
    preRequestAuthorization.restriction.evaluatedAt =
      preRequestAuthorization.checkedAt;
    preRequestAuthorization.decision.decidedAt = "2026-07-12T09:00:00.000Z";
    expect(
      inboxV2PrivacyExportJobSchema.safeParse({
        ...queuedJob(),
        requestAuthorization: preRequestAuthorization
      }).success
    ).toBe(false);

    const wrongJobAuthorization = authorization("request", null);
    wrongJobAuthorization.decision.resource = {
      ...wrongJobAuthorization.decision.resource,
      entityId: "privacy-export-job:job-2"
    };
    expect(
      inboxV2PrivacyExportJobSchema.safeParse({
        ...queuedJob(),
        requestAuthorization: wrongJobAuthorization
      }).success
    ).toBe(false);

    const wrongEntityTypeAuthorization = authorization("request", null);
    wrongEntityTypeAuthorization.decision.resource = {
      ...wrongEntityTypeAuthorization.decision.resource,
      entityTypeId: "core:privacy-request"
    };
    expect(
      inboxV2PrivacyExportJobSchema.safeParse({
        ...queuedJob(),
        requestAuthorization: wrongEntityTypeAuthorization
      }).success
    ).toBe(false);

    const wrongRevisionAuthorization = authorization("request", null);
    wrongRevisionAuthorization.decision.resourceAccessRevision = "2";
    expect(
      inboxV2PrivacyExportJobSchema.safeParse({
        ...queuedJob(),
        requestAuthorization: wrongRevisionAuthorization
      }).success
    ).toBe(false);
  });

  it("requires a fresh exact-job authorization for every manifest chunk", () => {
    const freshManifest = manifest();
    expect(
      inboxV2PrivacyExportManifestSchema.safeParse(freshManifest).success
    ).toBe(true);

    const staleManifest = structuredClone(freshManifest);
    staleManifest.chunks[0]!.authorization.checkedAt = requestedAt;
    staleManifest.chunks[0]!.authorization.restriction.evaluatedAt =
      requestedAt;
    expect(
      inboxV2PrivacyExportManifestSchema.safeParse(staleManifest).success
    ).toBe(false);

    const wrongJobManifest = structuredClone(freshManifest);
    wrongJobManifest.chunks[0]!.authorization.decision.resource = {
      ...wrongJobManifest.chunks[0]!.authorization.decision.resource,
      entityId: "privacy-export-job:job-2" as never
    };
    expect(
      inboxV2PrivacyExportManifestSchema.safeParse(wrongJobManifest).success
    ).toBe(false);

    const wrongRevisionManifest = structuredClone(freshManifest);
    wrongRevisionManifest.chunks[0]!.authorization.decision.resourceAccessRevision =
      "2" as never;
    expect(
      inboxV2PrivacyExportManifestSchema.safeParse(wrongRevisionManifest)
        .success
    ).toBe(false);

    const registry = exportRegistry();
    const projectionProfile = definedProjectionProfile(
      "data_subject",
      registry
    );
    const scopeProof = dataSubjectProof("access", registry);
    const exportProduct = dataSubjectProduct(scopeProof);
    const staleLineageInput = manifestInput(exportProduct, scope());
    staleLineageInput.chunks[0]!.expectedLineageRevision = "0";
    staleLineageInput.chunks[0]!.lineageAuthorization.decision.resourceAccessRevision =
      "0";
    expect(() =>
      defineInboxV2PrivacyExportManifest({
        manifest: staleLineageInput,
        job: queuedJob(exportProduct, scope()),
        registry,
        projectionProfile,
        scopeProof,
        enumeration: exportEnumeration(
          exportProduct,
          scope(),
          scopeProof,
          false,
          registry,
          projectionProfile
        ),
        authoritySource: exportAuthoritySource()
      })
    ).toThrow(/exact enumerated roots/u);

    const wrongPayloadSchema = structuredClone(freshManifest);
    wrongPayloadSchema.chunks[0]!.payload.schemaId =
      "core:privacy-export.raw-storage-dump" as never;
    expect(
      inboxV2PrivacyExportManifestSchema.safeParse(wrongPayloadSchema).success
    ).toBe(false);

    const generatedBeforeChunk = structuredClone(freshManifest);
    generatedBeforeChunk.generatedAt = requestedAt;
    expect(
      inboxV2PrivacyExportManifestSchema.safeParse(generatedBeforeChunk).success
    ).toBe(false);

    const callerSuppliedTotals = structuredClone(freshManifest);
    callerSuppliedTotals.totalItemCount = "3" as never;
    expect(
      inboxV2PrivacyExportManifestSchema.safeParse(callerSuppliedTotals).success
    ).toBe(false);

    const disguisedZeroResult = structuredClone(freshManifest);
    disguisedZeroResult.chunks[0]!.itemCount = "0" as never;
    disguisedZeroResult.totalItemCount = "0" as never;
    expect(
      inboxV2PrivacyExportManifestSchema.safeParse(disguisedZeroResult).success
    ).toBe(false);

    const zeroTenantScopeProof = tenantTerminationScopeProof(true);
    const tenantExportProduct = tenantProduct(zeroTenantScopeProof);
    const zeroManifest = manifest(
      tenantExportProduct,
      tenantScope(),
      zeroTenantScopeProof,
      true
    );
    const emptyWithoutEvidence = structuredClone(zeroManifest);
    emptyWithoutEvidence.verifiedZeroEvidence = null;
    expect(
      inboxV2PrivacyExportManifestSchema.safeParse(emptyWithoutEvidence).success
    ).toBe(false);

    expect(
      inboxV2PrivacyExportManifestSchema.safeParse(zeroManifest).success
    ).toBe(true);
    const zeroRegistry = exportRegistry();
    const zeroProjection = definedProjectionProfile(
      "tenant_deployment",
      zeroRegistry
    );
    const zeroArtifact = readyArtifact(tenantExportProduct, zeroManifest);
    expect(
      defineInboxV2PrivacyExportTerminalBundle({
        job: readyJob(tenantExportProduct, tenantScope(), zeroManifest),
        manifest: zeroManifest,
        artifact: zeroArtifact,
        registry: zeroRegistry,
        projectionProfile: zeroProjection,
        scopeProof: zeroTenantScopeProof,
        authoritySource: exportAuthoritySource(),
        currentBundleSource: currentBundleSource()
      }).manifest.totalItemCount
    ).toBe("0");

    const nonEmptyTenantProduct = tenantProduct();
    const nonEmptyEnumeration = exportEnumeration(
      nonEmptyTenantProduct,
      tenantScope(),
      sharedTenantTerminationScopeProof,
      false,
      zeroRegistry,
      zeroProjection
    );
    expect(() =>
      defineInboxV2PrivacyExportManifest({
        manifest: manifestInput(nonEmptyTenantProduct, tenantScope(), true),
        job: queuedJob(nonEmptyTenantProduct, tenantScope()),
        registry: zeroRegistry,
        projectionProfile: zeroProjection,
        scopeProof: sharedTenantTerminationScopeProof,
        enumeration: nonEmptyEnumeration,
        authoritySource: exportAuthoritySource()
      })
    ).toThrow(/exact enumerated roots/u);
  });

  it("keeps portability narrower than access and protects third parties", () => {
    const portableProduct = product("portability");
    expect(
      inboxV2PrivacyExportManifestSchema.safeParse(
        manifest(portableProduct, scope())
      ).success
    ).toBe(true);

    const portabilityManifest = manifest(portableProduct, scope());
    const tooBroad = {
      ...portabilityManifest,
      chunks: [
        {
          ...portabilityManifest.chunks[0]!,
          dataCategory: "tenant_decision" as const
        }
      ]
    };
    expect(inboxV2PrivacyExportManifestSchema.safeParse(tooBroad).success).toBe(
      false
    );
  });

  it("binds an exact terminal bundle and consumes a separately authorized receipt once", async () => {
    const registry = exportRegistry();
    const projectionProfile = definedProjectionProfile(
      "data_subject",
      registry
    );
    const scopeProof = dataSubjectProof("access", registry);
    const exportProduct = dataSubjectProduct(scopeProof);
    const exportScope = scope();
    const exactManifest = manifest(exportProduct, exportScope, scopeProof);
    const exactArtifact = readyArtifact(exportProduct, exactManifest);
    const terminalJob = readyJob(exportProduct, exportScope, exactManifest);
    expect(inboxV2PrivacyExportJobSchema.safeParse(terminalJob).success).toBe(
      true
    );
    expect(
      inboxV2PrivacyExportJobSchema.safeParse({
        ...terminalJob,
        artifact: { ...terminalJob.artifact, state: "building" }
      }).success
    ).toBe(false);
    const currentBundleState = {
      revoked: false,
      encryptedPayloadPresent: true
    };
    const currentAuthorityState = {
      governanceCurrent: true,
      policyActivationCurrent: true
    };
    const bundle = defineInboxV2PrivacyExportTerminalBundle({
      job: terminalJob,
      manifest: exactManifest,
      artifact: exactArtifact,
      registry,
      projectionProfile,
      scopeProof,
      authoritySource: exportAuthoritySource(currentAuthorityState),
      currentBundleSource: currentBundleSource(currentBundleState)
    });
    expect(bundle.artifact.state).toBe("ready");
    const repository = testDurableClaimRepository();
    currentAuthorityState.policyActivationCurrent = false;
    await expect(
      defineInboxV2PrivacyExportDownloadReceipt({
        receipt: issuedReceiptInput(bundle),
        bundle,
        currentScopeProof: currentDataSubjectProof(registry, readyAt),
        repository
      })
    ).rejects.toThrow();
    currentAuthorityState.policyActivationCurrent = true;
    currentBundleState.revoked = true;
    await expect(
      defineInboxV2PrivacyExportDownloadReceipt({
        receipt: issuedReceiptInput(bundle),
        bundle,
        currentScopeProof: currentDataSubjectProof(registry, readyAt),
        repository
      })
    ).rejects.toThrow();
    currentBundleState.revoked = false;
    currentBundleState.encryptedPayloadPresent = false;
    await expect(
      defineInboxV2PrivacyExportDownloadReceipt({
        receipt: issuedReceiptInput(bundle),
        bundle,
        currentScopeProof: currentDataSubjectProof(registry, readyAt),
        repository
      })
    ).rejects.toThrow();
    currentBundleState.encryptedPayloadPresent = true;
    await expect(
      defineInboxV2PrivacyExportDownloadReceipt({
        receipt: issuedReceiptInput(bundle),
        bundle,
        currentScopeProof: currentDataSubjectProof(registry, readyAt),
        repository: { ...repository }
      })
    ).rejects.toThrow(/registered durable claim repository/u);

    const thirdPartyChunk = manifestInput(exportProduct, exportScope);
    thirdPartyChunk.chunks[0]!.subjects = [
      {
        kind: "client_contact",
        clientContact: {
          tenantId: tenantId as never,
          kind: "client_contact",
          id: "client_contact:third-party" as never
        }
      }
    ];
    expect(() =>
      defineInboxV2PrivacyExportManifest({
        manifest: thirdPartyChunk,
        job: queuedJob(exportProduct, exportScope),
        registry,
        projectionProfile,
        scopeProof,
        enumeration: exportEnumeration(
          exportProduct,
          exportScope,
          scopeProof,
          false,
          registry,
          projectionProfile
        ),
        authoritySource: exportAuthoritySource()
      })
    ).toThrow(/exact approved discovery roots/u);

    const arbitraryFieldOmissionInput = manifestInput(
      exportProduct,
      exportScope
    );
    arbitraryFieldOmissionInput.omissions.push({
      scopeKind: "field",
      scopeId: "core:unregistered.secret-field",
      reasonCode: "core:privacy-export.reason.omitted",
      itemCount: "1"
    } as never);
    const arbitraryFieldOmission = defineInboxV2PrivacyExportManifest({
      manifest: arbitraryFieldOmissionInput,
      job: queuedJob(exportProduct, exportScope),
      registry,
      projectionProfile,
      scopeProof,
      enumeration: exportEnumeration(
        exportProduct,
        exportScope,
        scopeProof,
        false,
        registry,
        projectionProfile
      ),
      authoritySource: exportAuthoritySource()
    });
    const omissionArtifact = readyArtifact(
      exportProduct,
      arbitraryFieldOmission
    );
    expect(() =>
      defineInboxV2PrivacyExportTerminalBundle({
        job: readyJob(exportProduct, exportScope, arbitraryFieldOmission),
        manifest: arbitraryFieldOmission,
        artifact: omissionArtifact,
        registry,
        projectionProfile,
        scopeProof,
        authoritySource: exportAuthoritySource(),
        currentBundleSource: currentBundleSource()
      })
    ).toThrow(/registered projection fields/u);

    const rawArtifactLookalike = structuredClone(exactArtifact);
    expect(() =>
      defineInboxV2PrivacyExportTerminalBundle({
        job: terminalJob,
        manifest: exactManifest,
        artifact: rawArtifactLookalike,
        registry,
        projectionProfile,
        scopeProof,
        authoritySource: exportAuthoritySource(),
        currentBundleSource: currentBundleSource()
      })
    ).toThrow(/authentic manifest and archive materialization/u);

    const packagerSource = defineInboxV2PrivacyExportArchivePackagerSource({
      source: {
        id: "core:privacy-export-packager.lookalike-test",
        handlerId: "core:lifecycle.client-profile-export",
        materialize: ({
          manifest: sourceManifest,
          archiveCompositionHash,
          checkedAt
        }) => ({
          tenantId,
          id: "core:privacy-export-archive-materialization.lookalike-test",
          revision: "1",
          manifest: {
            tenantId,
            manifestId: sourceManifest.id,
            revision: sourceManifest.revision,
            manifestHash: sourceManifest.manifestHash
          },
          archiveCompositionHash,
          encryptedPayload: payload(
            "privacy-export-artifact:artifact-1",
            hashB
          ),
          encryptedByteCount: "512",
          encryptionProfileId: "core:encryption.export-artifact",
          packagerHandlerId: "core:lifecycle.client-profile-export",
          materializedAt: checkedAt,
          proofHash: hashA
        })
      },
      registry
    });
    const authenticMaterialization =
      defineInboxV2PrivacyExportArchiveMaterialization({
        source: packagerSource,
        manifest: exactManifest,
        registry,
        checkedAt: readyAt
      });
    expect(() =>
      defineInboxV2PrivacyExportReadyArtifact({
        artifact: structuredClone(exactArtifact),
        manifest: exactManifest,
        materialization: structuredClone(authenticMaterialization)
      })
    ).toThrow(/authentic packager materialization result/u);

    expect(
      inboxV2PrivacyExportArtifactSchema.safeParse({
        ...exactArtifact,
        expiresAt: exactArtifact.readyAt
      }).success
    ).toBe(false);
    expect(
      inboxV2PrivacyExportArtifactSchema.safeParse({
        ...exactArtifact,
        expiresAt: "2026-07-13T10:05:00.001Z"
      }).success
    ).toBe(false);
    expect(
      inboxV2PrivacyExportArtifactSchema.safeParse({
        ...exactArtifact,
        downloadAuthorization: authorization("download", null)
      }).success
    ).toBe(false);

    await expect(
      defineInboxV2PrivacyExportDownloadReceipt({
        receipt: issuedReceiptInput(bundle),
        bundle,
        currentScopeProof: scopeProof,
        repository
      })
    ).rejects.toThrow(/exact unexpired terminal bundle/u);

    const callerRetimestampedOldRequest = dataSubjectProof(
      "access",
      registry,
      readyAt
    );
    await expect(
      defineInboxV2PrivacyExportDownloadReceipt({
        receipt: issuedReceiptInput(bundle),
        bundle,
        currentScopeProof: callerRetimestampedOldRequest,
        repository
      })
    ).rejects.toThrow(/exact unexpired terminal bundle/u);

    const driftedCurrentProof = currentDataSubjectProof(registry, readyAt, "3");
    await expect(
      defineInboxV2PrivacyExportDownloadReceipt({
        receipt: issuedReceiptInput(bundle),
        bundle,
        currentScopeProof: driftedCurrentProof,
        repository
      })
    ).rejects.toThrow(/exact unexpired terminal bundle/u);

    const issueScopeProof = currentDataSubjectProof(registry, readyAt);
    const issued = await defineInboxV2PrivacyExportDownloadReceipt({
      receipt: issuedReceiptInput(bundle),
      bundle,
      currentScopeProof: issueScopeProof,
      repository
    });
    expect(
      inboxV2PrivacyExportDownloadReceiptSchema.safeParse(issued).success
    ).toBe(true);
    expect(
      inboxV2PrivacyExportDownloadReceiptEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.privacy-export-download-receipt",
        schemaVersion: "v1",
        payload: issued
      }).success
    ).toBe(true);

    const consumedAt = "2026-07-12T10:06:00.000Z";
    const principalSwap = {
      ...issued,
      revision: "2",
      state: "consumed" as const,
      consumedAt,
      consumeAuthorization: authorization(
        "download",
        null,
        "core:privacy.request.execute",
        2,
        consumedAt
      ),
      consumeArtifactAuthorization: artifactAuthorization(
        bundle.artifact,
        "core:privacy.request.execute",
        consumedAt,
        2,
        "principal-swap"
      ),
      consumptionHash: hashD
    };
    expect(
      inboxV2PrivacyExportDownloadReceiptSchema.safeParse(principalSwap).success
    ).toBe(false);

    const consumedInput = {
      ...issued,
      revision: "2",
      state: "consumed" as const,
      consumedAt,
      consumeAuthorization: authorization(
        "download",
        null,
        "core:privacy.request.execute",
        1,
        consumedAt,
        "consume"
      ),
      consumeArtifactAuthorization: artifactAuthorization(
        bundle.artifact,
        "core:privacy.request.execute",
        consumedAt,
        1,
        "consume"
      ),
      consumptionHash: hashD
    };
    const consumeScopeProof = currentDataSubjectProof(registry, consumedAt);
    const forgedBefore = {
      ...issued,
      expiresAt: "2026-07-12T10:09:00.000Z"
    };
    const forgedAfter = {
      ...consumedInput,
      expiresAt: forgedBefore.expiresAt
    };
    await expect(
      consumeInboxV2PrivacyExportDownloadReceipt({
        before: forgedBefore,
        after: forgedAfter,
        bundle,
        currentScopeProof: consumeScopeProof,
        repository
      })
    ).rejects.toThrow(/compare-and-swap/u);
    const consumed = await consumeInboxV2PrivacyExportDownloadReceipt({
      before: issued,
      after: consumedInput,
      bundle,
      currentScopeProof: consumeScopeProof,
      repository
    });
    expect(consumed.state).toBe("consumed");

    await expect(
      consumeInboxV2PrivacyExportDownloadReceipt({
        before: issued,
        after: consumedInput,
        bundle,
        currentScopeProof: consumeScopeProof,
        repository
      })
    ).rejects.toThrow(/compare-and-swap/u);

    await expect(
      defineInboxV2PrivacyExportDownloadReceipt({
        receipt: issuedReceiptInput(
          bundle,
          "privacy-export-download:receipt-2"
        ),
        bundle,
        currentScopeProof: issueScopeProof,
        repository
      })
    ).rejects.toThrow(/canonical one-use download claim/u);

    const recreatedBundle = defineInboxV2PrivacyExportTerminalBundle({
      job: structuredClone(terminalJob),
      manifest: exactManifest,
      artifact: exactArtifact,
      registry,
      projectionProfile,
      scopeProof,
      authoritySource: exportAuthoritySource(),
      currentBundleSource: currentBundleSource()
    });
    await expect(
      defineInboxV2PrivacyExportDownloadReceipt({
        receipt: issuedReceiptInput(
          recreatedBundle,
          "privacy-export-download:receipt-3"
        ),
        bundle: recreatedBundle,
        currentScopeProof: issueScopeProof,
        repository
      })
    ).rejects.toThrow(/canonical one-use download claim/u);

    const reencryptedArtifact = readyArtifact(
      exportProduct,
      exactManifest,
      hashC
    );
    expect(reencryptedArtifact.id).toBe(exactArtifact.id);
    expect(reencryptedArtifact.revision).toBe(exactArtifact.revision);
    expect(reencryptedArtifact.packagingProofHash).not.toBe(
      exactArtifact.packagingProofHash
    );
    const reencryptedBundle = defineInboxV2PrivacyExportTerminalBundle({
      job: structuredClone(terminalJob),
      manifest: exactManifest,
      artifact: reencryptedArtifact,
      registry,
      projectionProfile,
      scopeProof,
      authoritySource: exportAuthoritySource(),
      currentBundleSource: currentBundleSource()
    });
    await expect(
      defineInboxV2PrivacyExportDownloadReceipt({
        receipt: issuedReceiptInput(
          reencryptedBundle,
          "privacy-export-download:receipt-4"
        ),
        bundle: reencryptedBundle,
        currentScopeProof: issueScopeProof,
        repository
      })
    ).rejects.toThrow(/canonical one-use download claim/u);
  });

  it("quarantines revoked/failed artifacts and rejects cross-tenant or raw content", () => {
    const failedJob = {
      ...queuedJob(),
      state: "failed_retryable" as const,
      manifest: null,
      artifact: {
        tenantId,
        artifactId: "privacy-export-artifact:artifact-1",
        revision: "3",
        state: "quarantined" as const
      }
    };
    expect(inboxV2PrivacyExportJobSchema.safeParse(failedJob).success).toBe(
      true
    );
    expect(
      inboxV2PrivacyExportJobSchema.safeParse({
        ...failedJob,
        artifact: { ...failedJob.artifact, state: "ready" }
      }).success
    ).toBe(false);
    expect(
      inboxV2PrivacyExportJobSchema.safeParse({
        ...queuedJob(),
        policy: { ...policy(), tenantId: "tenant:tenant-2" }
      }).success
    ).toBe(false);
    expect(
      inboxV2PrivacyExportManifestSchema.safeParse({
        ...manifest(),
        messageText: "must never enter an export manifest"
      }).success
    ).toBe(false);
    const quarantinedArtifact = {
      tenantId,
      id: "privacy-export-artifact:artifact-1",
      revision: "3",
      job: jobReference(),
      product: product(),
      createdAt: requestedAt,
      state: "quarantined" as const,
      encryptedPayload: payload("privacy-export-artifact:artifact-1", hashB),
      reasonCode: "core:privacy-export.authorization-revoked",
      quarantinedAt: readyAt,
      deleteBy: "2026-07-12T11:05:00.000Z",
      downloadDisabled: true as const
    };
    expect(
      inboxV2PrivacyExportArtifactSchema.safeParse(quarantinedArtifact).success
    ).toBe(true);
    expect(
      inboxV2PrivacyExportArtifactSchema.safeParse({
        ...quarantinedArtifact,
        deleteBy: "2026-07-12T11:05:00.001Z"
      }).success
    ).toBe(false);
  });
});
