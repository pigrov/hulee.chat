import { describe, expect, it } from "vitest";

import {
  defineInboxV2PrivacyRequestAuthoritySource,
  defineInboxV2PrivacyRequest,
  inboxV2PrivacyRequestEnvelopeSchema,
  inboxV2PrivacyRequestReferenceSchema,
  inboxV2PrivacyRequestSchema,
  inboxV2PrivacyRequestStateSchema,
  isInboxV2PrivacyRequest
} from "./privacy-request";
import {
  defineInboxV2DataLifecycleRegistry,
  type InboxV2LifecycleHandlerDefinition
} from "./data-lifecycle-catalog";
import {
  defineInboxV2SubjectDiscoverySource,
  resolveInboxV2SubjectDiscoveryManifest
} from "./data-subject-discovery";
import {
  defineInboxV2DeletionExecutionSource,
  calculateInboxV2DeletionPlanHash,
  defineInboxV2DeletionPlan,
  defineInboxV2DeletionRun,
  resolveInboxV2DeletionExecutionProof
} from "./privacy-deletion";
import { defineInboxV2DataGovernanceContext } from "./data-governance";
import {
  activateInboxV2EffectiveTenantPolicy,
  defineInboxV2PolicyActivationLedger,
  defineInboxV2PolicyImpactPreview,
  defineInboxV2PolicyImpactSource,
  defineInboxV2PolicyTemplate,
  resolveInboxV2EffectiveTenantPolicy,
  resolveInboxV2PolicyImpactSourceProof,
  type InboxV2EffectiveTenantPolicy
} from "./data-lifecycle-policy";
import { defineInboxV2PrivacyScopeManifest } from "./privacy-hold-restriction";
import { registerInboxV2PrivacyTerminalExportAuthenticity } from "./privacy-authenticity";
import {
  compareAndSetInboxV2TenantTerminationDestructiveScope,
  defineInboxV2TenantTerminationScopeSource,
  inboxV2TenantTerminationScopeManifestReference,
  resolveInboxV2TenantTerminationScopeManifest
} from "./tenant-termination-scope";
import { assertInboxV2ClosedJsonSchema } from "./schema-safety";

const tenantId = "tenant:tenant-1";
const otherTenantId = "tenant:tenant-2";
const hashA = `sha256:${"a".repeat(64)}`;
const hashB = `sha256:${"b".repeat(64)}`;
type MutableRecord = Record<string, unknown>;

function mutableRecord(value: unknown): MutableRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Expected a mutable record fixture.");
  }
  return value as MutableRecord;
}

function childRecord(value: MutableRecord, key: string): MutableRecord {
  return mutableRecord(value[key]);
}

function childArray(value: MutableRecord, key: string): unknown[] {
  const child = value[key];
  if (!Array.isArray(child)) {
    throw new TypeError("Expected a mutable array fixture.");
  }
  return child;
}
const requester = {
  kind: "client_contact" as const,
  clientContact: {
    kind: "client_contact" as const,
    tenantId,
    id: "client_contact:client-1"
  }
};
const reviewer = {
  kind: "employee" as const,
  tenantId,
  id: "employee:privacy-reviewer-1"
};
const employeeSubject = {
  kind: "employee" as const,
  employee: reviewer
};
const victimAlias = {
  kind: "client_contact" as const,
  clientContact: {
    kind: "client_contact" as const,
    tenantId,
    id: "client_contact:victim-2"
  }
};
const rootA = {
  tenantId,
  dataClassId: "core:message_content_blocks",
  storageRootId: "core:a-message-content",
  recordId: "data_root:message-1"
};
const rootB = {
  tenantId,
  dataClassId: "core:staff_note_content_blocks",
  storageRootId: "core:b-staff-note-content",
  recordId: "data_root:staff-note-1"
};
const rootC = {
  tenantId,
  dataClassId: "core:message_content_blocks",
  storageRootId: "core:c-extra-content",
  recordId: "data_root:extra-1"
};
const backupRoot = {
  tenantId,
  dataClassId: "core:backup_copy_or_object_version",
  storageRootId: "core:message-content-backup",
  recordId: "data_root:message-backup-1"
};
const externalRoot = {
  tenantId,
  dataClassId: "core:raw_provider_payload",
  storageRootId: "module:privacy-request-test:provider-route",
  recordId: "data_root:provider-copy-1"
};

function evidence(suffix = "1") {
  return {
    tenantId,
    dataClassId: "core:privacy_sensitive_evidence",
    storageRootId: "core:privacy-evidence-object",
    payload: {
      tenantId,
      recordId: `payload:privacy-evidence-${suffix}`,
      schemaId: "core:inbox-v2.privacy-evidence-payload",
      schemaVersion: "v1",
      digest: hashA
    }
  };
}

function verification() {
  return {
    tenantId,
    id: "privacy_verification:verification-1",
    revision: "1",
    status: "verified" as const,
    methods: ["authenticated_account" as const],
    evidence: [evidence("verification")],
    verificationProfile: {
      id: "core:privacy-verification.default",
      version: "1"
    },
    verifiedSubjects: [requester],
    startedAt: "2026-07-12T09:00:00.000Z",
    completedAt: "2026-07-12T09:05:00.000Z"
  };
}

function discoveryReference() {
  return {
    tenantId,
    id: "subject_discovery:request-1",
    revision: "1",
    digest: hashA
  };
}

function deletionProof(
  root: typeof rootA,
  cause:
    | "privacy_erasure"
    | "tenant_offboarding"
    | "administrative_policy_purge" = "privacy_erasure"
) {
  return {
    tenantId,
    root,
    cause,
    plan: {
      tenantId,
      planId: "deletion-plan:privacy-request-1",
      revision: "1",
      planHash: hashA
    },
    run: {
      tenantId,
      runId: "deletion-run:privacy-request-1",
      revision: "1"
    }
  };
}

function lifecycleHandler(
  kind: InboxV2LifecycleHandlerDefinition["kind"],
  supportedOperations: InboxV2LifecycleHandlerDefinition["supportedOperations"],
  supportedRootKinds: InboxV2LifecycleHandlerDefinition["supportedRootKinds"] = [
    "sql",
    "backup"
  ],
  verifiesAbsence = false
): InboxV2LifecycleHandlerDefinition {
  return {
    kind,
    supportedRootKinds,
    supportedOperations,
    bounded: true,
    idempotent: true,
    checksTenantFence: true,
    checksRevisionFence: true,
    checksHoldFence: true,
    verifiesAbsence
  };
}

function privacyRequestRegistry() {
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
              id: rootA.storageRootId,
              definition: {
                kind: "sql",
                boundary: "operated_data_plane",
                tenantIsolation: "required",
                versionEnumeration: "not_applicable",
                configurationProfileId: "core:storage-profile.sql"
              }
            },
            {
              id: rootB.storageRootId,
              definition: {
                kind: "sql",
                boundary: "operated_data_plane",
                tenantIsolation: "required",
                versionEnumeration: "not_applicable",
                configurationProfileId: "core:storage-profile.sql"
              }
            },
            {
              id: backupRoot.storageRootId,
              definition: {
                kind: "backup",
                boundary: "operated_data_plane",
                tenantIsolation: "required",
                versionEnumeration: "expiry_ledger",
                configurationProfileId: "core:storage-profile.backup"
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
              id: "core:lifecycle.privacy-request",
              definition: lifecycleHandler("lifecycle", [
                "persist",
                "export",
                "delete",
                "verify_absence"
              ])
            },
            {
              id: "core:lifecycle.privacy-request-subject-discovery",
              definition: lifecycleHandler("subject_discovery", ["read"])
            },
            {
              id: "core:lifecycle.privacy-request-export-projection",
              definition: lifecycleHandler("export_projection", ["export"])
            },
            {
              id: "core:lifecycle.privacy-request-export",
              definition: lifecycleHandler("export_execution", ["export"])
            },
            {
              id: "core:lifecycle.privacy-request-delete",
              definition: lifecycleHandler("delete_execution", ["delete"])
            },
            {
              id: "core:lifecycle.privacy-request-verify",
              definition: lifecycleHandler(
                "verification",
                ["verify_absence"],
                ["sql", "backup"],
                true
              )
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
              dataClassId: rootA.dataClassId,
              storageRootId: rootA.storageRootId,
              purposeIds: ["core:customer_service_history"],
              operations: ["persist", "export", "delete", "verify_absence"],
              canonicalAnchorId: "core:canonical_item_time",
              lifecycleHandlerId: "core:lifecycle.privacy-request",
              subjectDiscoveryHandlerId:
                "core:lifecycle.privacy-request-subject-discovery",
              exportProjectionHandlerId:
                "core:lifecycle.privacy-request-export-projection",
              exportHandlerId: "core:lifecycle.privacy-request-export",
              deleteHandlerId: "core:lifecycle.privacy-request-delete",
              verificationHandlerId: "core:lifecycle.privacy-request-verify"
            },
            {
              dataClassId: rootB.dataClassId,
              storageRootId: rootB.storageRootId,
              purposeIds: ["core:legal_claim_or_regulatory_duty"],
              operations: ["persist", "export", "delete", "verify_absence"],
              canonicalAnchorId: "core:canonical_item_time",
              lifecycleHandlerId: "core:lifecycle.privacy-request",
              subjectDiscoveryHandlerId:
                "core:lifecycle.privacy-request-subject-discovery",
              exportProjectionHandlerId:
                "core:lifecycle.privacy-request-export-projection",
              exportHandlerId: "core:lifecycle.privacy-request-export",
              deleteHandlerId: "core:lifecycle.privacy-request-delete",
              verificationHandlerId: "core:lifecycle.privacy-request-verify"
            },
            {
              dataClassId: backupRoot.dataClassId,
              storageRootId: backupRoot.storageRootId,
              purposeIds: ["core:legal_claim_or_regulatory_duty"],
              operations: ["persist", "delete", "verify_absence"],
              canonicalAnchorId: "core:backup_or_version_creation",
              lifecycleHandlerId: "core:lifecycle.privacy-request",
              subjectDiscoveryHandlerId:
                "core:lifecycle.privacy-request-subject-discovery",
              exportProjectionHandlerId: null,
              exportHandlerId: null,
              deleteHandlerId: "core:lifecycle.privacy-request-delete",
              verificationHandlerId: "core:lifecycle.privacy-request-verify"
            }
          ]
        }
      }
    ],
    moduleContributions: [
      {
        schemaId: "core:inbox-v2.module-data-governance",
        schemaVersion: "v1",
        payload: {
          moduleId: "privacy-request-test",
          dataHandling: "tenant_or_customer_data",
          processingPurposes: [],
          retentionAnchors: [],
          handlers: [
            {
              id: "module:privacy-request-test:external-lifecycle",
              definition: lifecycleHandler(
                "lifecycle",
                ["transmit_external"],
                ["external_route"]
              )
            },
            {
              id: "module:privacy-request-test:subject-discovery",
              definition: lifecycleHandler(
                "subject_discovery",
                ["read"],
                ["external_route"]
              )
            },
            {
              id: "module:privacy-request-test:external-delete",
              definition: lifecycleHandler(
                "external_deletion",
                ["transmit_external"],
                ["external_route"]
              )
            },
            {
              id: "module:privacy-request-test:migration-uninstall",
              definition: lifecycleHandler(
                "migration_uninstall",
                ["delete"],
                ["external_route"]
              )
            }
          ],
          storageRoots: [
            {
              id: externalRoot.storageRootId,
              definition: {
                kind: "external_route",
                boundary: "outside_operated_data_plane",
                tenantIsolation: "required",
                versionEnumeration: "not_applicable",
                configurationProfileId: "core:storage-profile.external-provider"
              }
            }
          ],
          dataClasses: [],
          dataUses: [
            {
              dataClassId: externalRoot.dataClassId,
              storageRootId: externalRoot.storageRootId,
              purposeIds: ["core:source_replay_and_diagnostics"],
              operations: ["transmit_external"],
              canonicalAnchorId: "core:terminal_processing",
              lifecycleHandlerId:
                "module:privacy-request-test:external-lifecycle",
              subjectDiscoveryHandlerId:
                "module:privacy-request-test:subject-discovery",
              exportProjectionHandlerId: null,
              exportHandlerId: null,
              deleteHandlerId: null,
              verificationHandlerId: null
            }
          ],
          externalRoutes: [
            {
              id: "module:privacy-request-test:provider-processing-route",
              storageRootId: externalRoot.storageRootId,
              dataClassIds: [externalRoot.dataClassId],
              purposeId: "core:source_replay_and_diagnostics",
              recipientCategoryId: "core:provider-subprocessor",
              regionProfile: { id: "core:region-profile.eu", version: "1" },
              deleteCapabilityHandlerId:
                "module:privacy-request-test:external-delete"
            }
          ],
          migrationAndUninstallHandlerId:
            "module:privacy-request-test:migration-uninstall"
        }
      }
    ]
  });
}

function privacyDeletionPolicyAuthority(
  registry: ReturnType<typeof privacyRequestRegistry>
) {
  const governanceContext = defineInboxV2DataGovernanceContext({
    tenantId,
    id: "core:governance-context.privacy-erasure",
    version: "1",
    policyRevision: "1",
    deploymentProfile: "saas_shared",
    rolesByPurpose: [
      {
        purposeId: "core:customer_service_history",
        roles: [{ regime: "eu", role: "controller" }],
        lawfulBasisReferenceCode: "core:basis.customer-service",
        customerInstructionReferenceCode: null
      },
      {
        purposeId: "core:legal_claim_or_regulatory_duty",
        roles: [{ regime: "eu", role: "controller" }],
        lawfulBasisReferenceCode: "core:basis.legal-duty",
        customerInstructionReferenceCode: null
      },
      {
        purposeId: "core:source_replay_and_diagnostics",
        roles: [{ regime: "eu", role: "controller" }],
        lawfulBasisReferenceCode: "core:basis.security-diagnostics",
        customerInstructionReferenceCode: null
      }
    ],
    jurisdictionProfiles: [
      { id: "core:jurisdiction.eu-default", version: "2" }
    ],
    residencyRegionIds: ["core:region-eu"],
    crossBorderRouteIds: [],
    timeZone: "Europe/Berlin",
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
    id: "core:privacy-erasure-policy-template",
    version: "1",
    deploymentProfile: "saas_shared",
    jurisdictionProfiles: [
      { id: "core:jurisdiction.eu-default", version: "2" }
    ],
    effectiveAt: "2026-01-03T00:00:00.000Z",
    reviewAt: "2027-01-03T00:00:00.000Z",
    rules: [
      {
        id: "core:retention-rule.privacy-erasure-backup",
        revision: "1",
        dataClassId: backupRoot.dataClassId,
        purposeId: "core:legal_claim_or_regulatory_duty",
        retentionAnchorId: "core:backup_or_version_creation",
        baselineWindow: {
          kind: "fixed_after_anchor",
          period: { kind: "elapsed", seconds: 35 * 86_400 }
        },
        actionAtExpiry: "hard_delete",
        backupMaximum: { kind: "elapsed", seconds: 35 * 86_400 },
        legalMinimum: null,
        legalMaximum: null,
        allowTenantShorter: false,
        allowTenantLonger: false,
        holdEligible: true
      },
      {
        id: "core:retention-rule.privacy-erasure-message",
        revision: "1",
        dataClassId: rootA.dataClassId,
        purposeId: "core:customer_service_history",
        retentionAnchorId: "core:canonical_item_time",
        baselineWindow: {
          kind: "fixed_after_anchor",
          period: { kind: "elapsed", seconds: 365 * 86_400 }
        },
        actionAtExpiry: "purge_content_keep_tombstone",
        backupMaximum: { kind: "elapsed", seconds: 35 * 86_400 },
        legalMinimum: null,
        legalMaximum: null,
        allowTenantShorter: false,
        allowTenantLonger: false,
        holdEligible: true
      },
      {
        id: "core:retention-rule.privacy-erasure-provider-payload",
        revision: "1",
        dataClassId: externalRoot.dataClassId,
        purposeId: "core:source_replay_and_diagnostics",
        retentionAnchorId: "core:terminal_processing",
        baselineWindow: {
          kind: "fixed_after_anchor",
          period: { kind: "elapsed", seconds: 30 * 86_400 }
        },
        actionAtExpiry: "hard_delete",
        backupMaximum: { kind: "elapsed", seconds: 35 * 86_400 },
        legalMinimum: null,
        legalMaximum: null,
        allowTenantShorter: false,
        allowTenantLonger: false,
        holdEligible: true
      },
      {
        id: "core:retention-rule.privacy-erasure-staff-note",
        revision: "1",
        dataClassId: rootB.dataClassId,
        purposeId: "core:legal_claim_or_regulatory_duty",
        retentionAnchorId: "core:canonical_item_time",
        baselineWindow: {
          kind: "fixed_after_anchor",
          period: { kind: "elapsed", seconds: 365 * 86_400 }
        },
        actionAtExpiry: "purge_content_keep_tombstone",
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
    id: "core:privacy-erasure-policy",
    version: "1",
    policyHash: hashA,
    effectiveAt: "2026-02-01T00:00:00.000Z",
    templates: [template],
    governanceContext,
    tenantSelections: [],
    entitlementAllowances: []
  });
  if (resolution.kind !== "resolved") {
    throw new Error(
      `Privacy erasure policy fixture failed: ${resolution.errorCode}`
    );
  }
  const candidatePolicy = resolution.policy;
  const impactSource = defineInboxV2PolicyImpactSource({
    id: "core:privacy-erasure-impact-source",
    version: "1",
    loadCompleteImpact: () => ({
      sourceSnapshot: {
        streamEpoch: "stream:epoch:privacy-erasure-impact",
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
          streamEpoch: "stream:epoch:privacy-erasure-impact",
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
      id: "core:privacy-erasure-impact-preview",
      revision: "1",
      previewedAt: "2026-02-01T00:00:00.000Z"
    }
  });
  const activationLedger = defineInboxV2PolicyActivationLedger({
    id: "core:privacy-erasure-policy-ledger"
  });
  const activationAuthorization = (
    policy: InboxV2EffectiveTenantPolicy,
    employeeNumber: number
  ) => ({
    tenantId,
    id: `authorization-decision:privacy-policy-${employeeNumber}`,
    authorizationEpoch: `authorization-epoch-privacy-policy-${employeeNumber}`,
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
      entityId: policy.id
    },
    resourceAccessRevision: policy.version,
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
        id: "core:privacy-erasure-bootstrap",
        version: "1"
      }
    },
    activation: {
      tenantId,
      id: "core:privacy-erasure-policy-activation",
      revision: "1",
      requesterAuthorization: activationAuthorization(candidatePolicy, 1),
      approverAuthorization: activationAuthorization(candidatePolicy, 2),
      requestedAt: "2026-02-02T00:00:00.000Z",
      approvedAt: "2026-02-03T00:00:00.000Z",
      notBefore: "2026-02-04T00:00:00.000Z",
      activatedAt: "2026-02-04T00:00:00.000Z",
      reasonCode: "core:privacy-erasure-policy-reviewed"
    }
  }).policy;
  return { governanceContext, policy, activationLedger };
}

const sharedPrivacyRegistry = privacyRequestRegistry();
const sharedPrivacyAuthority = privacyDeletionPolicyAuthority(
  sharedPrivacyRegistry
);

function createTenantTerminationScopeManifest() {
  const source = defineInboxV2TenantTerminationScopeSource({
    id: "core:privacy-request-tenant-scope-source",
    version: "1",
    loadCompleteTenantScope: ({ expectedDataUses }) => ({
      kind: "tenant_termination_scope",
      tenantId,
      id: "core:tenant-termination-scope-request-1",
      revision: "1",
      boundary: {
        streamEpoch: "stream:epoch:privacy-request-tenant-scope",
        syncGeneration: "1",
        completeThroughPosition: "210",
        snapshotHash: hashA
      },
      scannedDataUses: [...expectedDataUses],
      roots: [
        {
          root: rootA,
          expectedEntityRevision: "1",
          expectedLineageRevision: "1",
          handling: "export_then_erase"
        }
      ],
      generatedAt: "2026-07-12T09:40:00.000Z"
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
    registry: sharedPrivacyRegistry,
    governanceContext: sharedPrivacyAuthority.governanceContext,
    policy: sharedPrivacyAuthority.policy,
    activationLedger: sharedPrivacyAuthority.activationLedger,
    tenantId
  });
}

const sharedTenantTerminationScope = createTenantTerminationScopeManifest();

function discoveryManifestFor(
  roots: Array<typeof rootA> = [rootA, rootB],
  registry = sharedPrivacyRegistry,
  discoveredSubjects: Array<typeof requester | typeof victimAlias> = [requester]
) {
  const canonicalRoots = [...roots].sort((left, right) => {
    const leftKey = `${left.tenantId}\u0000${left.dataClassId}\u0000${left.storageRootId}\u0000${left.recordId}`;
    const rightKey = `${right.tenantId}\u0000${right.dataClassId}\u0000${right.storageRootId}\u0000${right.recordId}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  const body = {
    tenantId,
    id: "subject_discovery:request-1",
    requesterSubject: requester,
    discoveredSubjects,
    subjectLinks: [],
    roots: canonicalRoots.map((root) => ({
      root,
      subjects: [requester],
      relationshipToRequester: "requester_only" as const,
      thirdPartyProtection: null
    })),
    coverage: canonicalRoots.map((root) => ({
      kind: "deterministic" as const,
      root,
      method: "structured_subject_link" as const,
      outcome: "matched" as const
    })),
    revision: "1",
    generatedAt: "2026-07-12T09:10:00.000Z"
  };
  const scannedDiscoveryHandlerIds = [
    ...new Set(
      registry.dataUses.flatMap((use) =>
        use.subjectDiscoveryHandlerId === null
          ? []
          : [String(use.subjectDiscoveryHandlerId)]
      )
    )
  ].sort();
  const source = defineInboxV2SubjectDiscoverySource({
    id: "core:privacy-request-discovery-source",
    version: "1",
    loadCompleteDiscovery: () => ({
      ...body,
      streamEpoch: "stream:epoch:privacy-request-discovery",
      syncGeneration: "1",
      completeThroughPosition: "200",
      scannedDiscoveryHandlerIds
    })
  });
  return resolveInboxV2SubjectDiscoveryManifest({
    source,
    registry,
    tenantId,
    requesterSubject: requester
  });
}

function mixedDiscoveryManifestFor(registry = sharedPrivacyRegistry) {
  const body = {
    tenantId,
    id: "subject_discovery:request-1",
    requesterSubject: requester,
    discoveredSubjects: [requester, employeeSubject],
    subjectLinks: [],
    roots: [
      {
        root: rootA,
        subjects: [requester, employeeSubject],
        relationshipToRequester: "mixed" as const,
        thirdPartyProtection: {
          kind: "redact_or_omit" as const,
          status: "redacted" as const,
          policyProfile: {
            id: "core:governance-profile.third-party",
            version: "1"
          },
          reasonCode: "core:privacy.third-party-redaction"
        }
      }
    ],
    coverage: [
      {
        kind: "deterministic" as const,
        root: rootA,
        method: "structured_subject_link" as const,
        outcome: "matched" as const
      }
    ],
    revision: "1",
    generatedAt: "2026-07-12T09:10:00.000Z"
  };
  const scannedDiscoveryHandlerIds = [
    ...new Set(
      registry.dataUses.flatMap((use) =>
        use.subjectDiscoveryHandlerId === null
          ? []
          : [String(use.subjectDiscoveryHandlerId)]
      )
    )
  ].sort();
  return resolveInboxV2SubjectDiscoveryManifest({
    source: defineInboxV2SubjectDiscoverySource({
      id: "core:privacy-request-mixed-discovery-source",
      version: "1",
      loadCompleteDiscovery: () => ({
        ...body,
        streamEpoch: "stream:epoch:privacy-request-mixed-discovery",
        syncGeneration: "1",
        completeThroughPosition: "201",
        scannedDiscoveryHandlerIds
      })
    }),
    registry,
    tenantId,
    requesterSubject: requester
  });
}

function bindDiscovery<T extends { workflow: object }>(
  request: T,
  manifest: ReturnType<typeof discoveryManifestFor>
): T {
  return {
    ...request,
    workflow: {
      ...request.workflow,
      discovery: {
        tenantId: manifest.tenantId,
        id: manifest.id,
        revision: manifest.revision,
        digest: manifest.digest
      }
    }
  } as T;
}

function decision() {
  return {
    tenantId,
    id: "privacy_decision:decision-1",
    revision: "1",
    result: "partially_approved" as const,
    policyProfile: {
      id: sharedPrivacyAuthority.policy.id,
      version: sharedPrivacyAuthority.policy.version
    },
    reviewer,
    rootDecisions: [
      {
        root: rootA,
        dataClassId: rootA.dataClassId,
        purposeIds: ["core:customer_service_history"],
        policyRules: [
          {
            id: "core:retention-rule.privacy-erasure-message",
            revision: "1"
          }
        ],
        disposition: "include_normalized" as const,
        followUpDisposition: null,
        externalRouteIds: [],
        thirdPartyHandling: { kind: "not_applicable" as const },
        exceptions: []
      },
      {
        root: rootB,
        dataClassId: rootB.dataClassId,
        purposeIds: ["core:legal_claim_or_regulatory_duty"],
        policyRules: [
          {
            id: "core:retention-rule.privacy-erasure-staff-note",
            revision: "1"
          }
        ],
        disposition: "retain_with_exception" as const,
        followUpDisposition: null,
        externalRouteIds: [],
        thirdPartyHandling: { kind: "not_applicable" as const },
        exceptions: [
          {
            kind: "legal_claim_or_regulatory_duty" as const,
            reasonCode: "core:privacy.exception.legal-duty",
            policyProfile: {
              id: sharedPrivacyAuthority.policy.id,
              version: sharedPrivacyAuthority.policy.version
            },
            evidence: [evidence("third-party-review")]
          }
        ]
      }
    ],
    holdReferences: [],
    reasonCode: "core:privacy.decision.partially-approved",
    decidedAt: "2026-07-12T09:30:00.000Z",
    digest: hashB
  };
}

function execution() {
  return {
    reference: {
      tenantId,
      execution: {
        tenantId,
        entityTypeId: "core:privacy-execution",
        entityId: "privacy-execution:execution-1"
      },
      revision: "1"
    },
    handlerExecutions: [
      {
        tenantId,
        root: rootA,
        disposition: "include_normalized" as const,
        handlerId: "core:lifecycle.privacy-request-export",
        execution: {
          tenantId,
          entityTypeId: "core:privacy-handler-execution",
          entityId: "privacy-handler-execution:handler-1"
        },
        status: "succeeded_verified" as const,
        evidence: evidence("handler-1"),
        deletionProof: null
      }
    ],
    backupExecutions: [],
    externalResiduals: [],
    terminalExport: null
  };
}

function handlerExecution(
  root: typeof rootA,
  disposition:
    | "include_normalized"
    | "include_portable"
    | "correct"
    | "erase"
    | "restrict_processing"
    | "stop_objected_processing",
  suffix: string,
  deletionCause:
    | "privacy_erasure"
    | "tenant_offboarding"
    | "administrative_policy_purge" = "privacy_erasure"
) {
  return {
    tenantId,
    root,
    disposition,
    handlerId:
      disposition === "include_normalized" || disposition === "include_portable"
        ? "core:lifecycle.privacy-request-export"
        : disposition === "erase"
          ? "core:lifecycle.privacy-request-verify"
          : "core:lifecycle.privacy-request",
    execution: {
      tenantId,
      entityTypeId: "core:privacy-handler-execution",
      entityId: `privacy-handler-execution:${suffix}`
    },
    status: "succeeded_verified" as const,
    evidence: evidence(`handler-${suffix}`),
    deletionProof:
      disposition === "erase" ? deletionProof(root, deletionCause) : null
  };
}

function twoInternalRootCompletedRequest() {
  const value = completedRequest();
  const baseDecision = decision();
  const secondRootDecision = baseDecision.rootDecisions[1];
  return {
    ...value,
    workflow: {
      ...value.workflow,
      decision: {
        ...baseDecision,
        result: "approved" as const,
        rootDecisions: [
          baseDecision.rootDecisions[0],
          {
            ...secondRootDecision,
            disposition: "include_normalized" as const,
            externalRouteIds: [],
            thirdPartyHandling: { kind: "not_applicable" as const },
            exceptions: []
          }
        ]
      },
      execution: {
        ...execution(),
        handlerExecutions: [
          handlerExecution(rootA, "include_normalized", "root-a"),
          handlerExecution(rootB, "include_normalized", "root-b")
        ]
      }
    }
  };
}

function externalRootCompletedRequest() {
  const value = completedRequest();
  const baseDecision = decision();
  const firstRootDecision = baseDecision.rootDecisions[0];
  const secondRootDecision = baseDecision.rootDecisions[1];
  return {
    ...value,
    intent: "erasure" as const,
    workflow: {
      ...value.workflow,
      decision: {
        ...baseDecision,
        result: "approved" as const,
        rootDecisions: [
          {
            ...firstRootDecision,
            disposition: "erase" as const
          },
          {
            ...secondRootDecision,
            root: externalRoot,
            dataClassId: externalRoot.dataClassId,
            purposeIds: ["core:source_replay_and_diagnostics"],
            policyRules: [
              {
                id: "core:retention-rule.privacy-erasure-provider-payload",
                revision: "1"
              }
            ],
            disposition: "external_action_required" as const,
            externalRouteIds: [
              "module:privacy-request-test:provider-processing-route"
            ],
            thirdPartyHandling: { kind: "not_applicable" as const },
            exceptions: []
          }
        ]
      },
      execution: {
        ...execution(),
        handlerExecutions: [handlerExecution(rootA, "erase", "root-a")],
        externalResiduals: [
          {
            tenantId,
            root: externalRoot,
            disposition: "external_action_required" as const,
            routeId: "module:privacy-request-test:provider-processing-route",
            residual: {
              tenantId,
              entityTypeId: "core:external-residual",
              entityId: "external-residual:telegram-1"
            },
            outcome: "confirmed" as const,
            lastVerifiedAt: "2026-07-12T10:00:00.000Z",
            evidence: evidence("external-telegram"),
            deletionProof: deletionProof(externalRoot)
          }
        ]
      }
    }
  };
}

function backupPendingRequest() {
  const value = completedRequest();
  const rootDecision = decision().rootDecisions[0];
  return {
    ...value,
    intent: "erasure" as const,
    workflow: {
      ...value.workflow,
      state: "primary_purged_backup_expiry_pending" as const,
      decision: {
        ...decision(),
        result: "approved" as const,
        rootDecisions: [
          {
            ...rootDecision,
            root: backupRoot,
            dataClassId: backupRoot.dataClassId,
            purposeIds: ["core:legal_claim_or_regulatory_duty"],
            policyRules: [
              {
                id: "core:retention-rule.privacy-erasure-backup",
                revision: "1"
              }
            ],
            disposition: "erase" as const,
            thirdPartyHandling: { kind: "not_applicable" as const }
          }
        ]
      },
      execution: {
        ...execution(),
        handlerExecutions: [],
        backupExecutions: [
          {
            tenantId,
            root: backupRoot,
            disposition: "erase" as const,
            execution: {
              tenantId,
              entityTypeId: "core:privacy-backup-execution",
              entityId: "privacy-backup-execution:backup-1"
            },
            outcome: "finite_expiry_pending" as const,
            checkedAt: "2026-07-12T10:00:00.000Z",
            latestPossibleExpiryAt: "2026-08-12T10:00:00.000Z",
            evidence: evidence("backup-ledger"),
            deletionProof: deletionProof(backupRoot)
          }
        ]
      }
    }
  };
}

function tenantTerminationRequest() {
  const value = completedRequest();
  const rootDecision = decision().rootDecisions[0];
  return {
    ...value,
    intent: "tenant_termination_export_delete" as const,
    tenantTerminationScope: inboxV2TenantTerminationScopeManifestReference(
      sharedTenantTerminationScope
    ),
    workflow: {
      ...value.workflow,
      decision: {
        ...decision(),
        result: "approved" as const,
        rootDecisions: [
          {
            ...rootDecision,
            disposition: "include_normalized" as const,
            followUpDisposition: "erase" as const,
            thirdPartyHandling: { kind: "not_applicable" as const }
          }
        ]
      },
      execution: {
        ...execution(),
        handlerExecutions: [
          handlerExecution(rootA, "include_normalized", "termination-export"),
          handlerExecution(
            rootA,
            "erase",
            "termination-erase",
            "tenant_offboarding"
          )
        ]
      }
    }
  };
}

function terminalExportFixture(artifactExpiresAt = "2026-07-13T09:45:00.000Z") {
  const bundle = Object.freeze({ kind: "authentic-terminal-export" });
  const descriptor = {
    tenantId,
    productKind: "tenant_deployment" as const,
    jobId: "privacy-export-job:tenant-termination-1",
    jobRevision: "1",
    manifestId: "privacy-export-manifest:tenant-termination-1",
    manifestRevision: "1",
    manifestHash: hashA,
    artifactId: "privacy-export-artifact:tenant-termination-1",
    artifactRevision: "1",
    artifactChecksum: hashB,
    artifactReadyAt: "2026-07-12T09:45:00.000Z",
    artifactExpiresAt,
    governanceContextId: sharedPrivacyAuthority.governanceContext.id,
    governanceContextVersion: sharedPrivacyAuthority.governanceContext.version,
    governanceContextHash: sharedPrivacyAuthority.governanceContext.contextHash,
    policyId: sharedPrivacyAuthority.policy.id,
    policyVersion: sharedPrivacyAuthority.policy.version,
    policyHash: sharedPrivacyAuthority.policy.policyHash,
    rootKeys: [
      `${rootA.tenantId}\u0000${rootA.dataClassId}\u0000${rootA.storageRootId}\u0000${rootA.recordId}`
    ],
    rootSetHash: hashA,
    tenantScopeProofHash: sharedTenantTerminationScope.proofHash
  };
  registerInboxV2PrivacyTerminalExportAuthenticity(
    bundle,
    descriptor,
    () => undefined
  );
  return {
    bundle,
    reference: {
      tenantId,
      productKind: descriptor.productKind,
      job: { id: descriptor.jobId, revision: descriptor.jobRevision },
      manifest: {
        id: descriptor.manifestId,
        revision: descriptor.manifestRevision,
        manifestHash: descriptor.manifestHash
      },
      artifact: {
        id: descriptor.artifactId,
        revision: descriptor.artifactRevision,
        checksum: descriptor.artifactChecksum,
        readyAt: descriptor.artifactReadyAt,
        expiresAt: descriptor.artifactExpiresAt
      },
      governanceContext: {
        tenantId,
        id: descriptor.governanceContextId,
        version: descriptor.governanceContextVersion,
        contextHash: descriptor.governanceContextHash
      },
      policy: {
        tenantId,
        id: descriptor.policyId,
        version: descriptor.policyVersion,
        policyHash: descriptor.policyHash
      },
      rootSetHash: descriptor.rootSetHash,
      tenantScopeProofHash: descriptor.tenantScopeProofHash
    }
  };
}

function completedRequest() {
  return {
    tenantId,
    id: "privacy_request:request-1",
    revision: "4",
    intent: "access" as const,
    tenantTerminationScope: null,
    governanceContext: {
      tenantId,
      id: sharedPrivacyAuthority.governanceContext.id,
      version: sharedPrivacyAuthority.governanceContext.version,
      contextHash: sharedPrivacyAuthority.governanceContext.contextHash
    },
    jurisdictionProfile: {
      id: "core:jurisdiction.eu-default",
      version: "2"
    },
    responsibilityRole: { regime: "eu" as const, role: "controller" as const },
    requesterSubject: requester,
    claimedSubjectAliases: [requester],
    requestEvidence: [],
    receivedAt: "2026-07-12T08:55:00.000Z",
    dueAt: "2026-08-12T08:55:00.000Z",
    extendedDueAt: null,
    extensionReasonCode: null,
    workflow: {
      state: "completed" as const,
      verification: verification(),
      discovery: discoveryReference(),
      decision: decision(),
      execution: execution(),
      completedAt: "2026-07-12T10:00:00.000Z"
    },
    updatedAt: "2026-07-12T10:00:00.000Z"
  };
}

type TrustedPrivacyRequestInput = Pick<
  Parameters<typeof defineInboxV2PrivacyRequest>[0],
  | "request"
  | "discoveryManifest"
  | "registry"
  | "deletionExecutions"
  | "terminalExportProofs"
  | "tenantTerminationScope"
>;

function defineTrustedPrivacyRequest(
  input: TrustedPrivacyRequestInput,
  authority = sharedPrivacyAuthority
) {
  const parsed = inboxV2PrivacyRequestSchema.parse(input.request);
  if (!("decision" in parsed.workflow)) {
    throw new Error("Trusted request test fixture requires a decision.");
  }
  const authorityReviewer = parsed.workflow.decision.reviewer;
  const authorityVerifiedSubjects =
    parsed.workflow.verification.verifiedSubjects;
  const source = defineInboxV2PrivacyRequestAuthoritySource({
    id: "core:privacy-request-authority-source",
    version: "1",
    loadCurrentAuthority: ({ checkedAt }) => ({
      tenantId: parsed.tenantId,
      reviewer: authorityReviewer,
      verifiedSubjects: authorityVerifiedSubjects,
      authorizedAliases: parsed.claimedSubjectAliases,
      checkedAt
    })
  });
  return defineInboxV2PrivacyRequest({
    ...input,
    governanceContext: authority.governanceContext,
    policy: authority.policy,
    policyActivationLedger: authority.activationLedger,
    authoritySource: source,
    tenantTerminationScope:
      input.tenantTerminationScope ??
      (parsed.intent === "tenant_termination_export_delete"
        ? sharedTenantTerminationScope
        : undefined)
  });
}

describe("Inbox V2 privacy request", () => {
  it("accepts a versioned partially approved mixed/group request and envelope", () => {
    const value = completedRequest();
    expect(inboxV2PrivacyRequestSchema.safeParse(value).success).toBe(true);
    expect(
      inboxV2PrivacyRequestEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.privacy-request",
        schemaVersion: "v1",
        payload: value
      }).success
    ).toBe(true);
    expect(
      inboxV2PrivacyRequestReferenceSchema.safeParse({
        tenantId,
        requestId: value.id,
        revision: value.revision
      }).success
    ).toBe(true);
    expect(inboxV2PrivacyRequestStateSchema.options).toHaveLength(15);
  });

  it("defines only authentic registry- and discovery-bound requests with exact roots", () => {
    const registry = privacyRequestRegistry();
    const manifest = discoveryManifestFor();
    const request = bindDiscovery(completedRequest(), manifest);
    const defined = defineTrustedPrivacyRequest({
      request,
      discoveryManifest: manifest,
      registry
    });
    expect(isInboxV2PrivacyRequest(defined)).toBe(true);
    expect(Object.isFrozen(defined)).toBe(true);
    expect(Object.isFrozen(defined.workflow)).toBe(true);
    expect(isInboxV2PrivacyRequest(structuredClone(defined))).toBe(false);

    expect(() =>
      defineTrustedPrivacyRequest({
        request,
        discoveryManifest: manifest,
        registry: structuredClone(registry) as typeof registry
      })
    ).toThrow(/authentic composed lifecycle registry/u);

    expect(() =>
      defineTrustedPrivacyRequest({
        request,
        discoveryManifest: structuredClone(manifest),
        registry
      })
    ).toThrow(/authentic immutable discovery manifest/u);

    const incompleteManifest = discoveryManifestFor([rootA]);
    expect(() =>
      defineTrustedPrivacyRequest({
        request: bindDiscovery(completedRequest(), incompleteManifest),
        discoveryManifest: incompleteManifest,
        registry
      })
    ).toThrow(/cover every root/u);
  });

  it("rejects victim aliases, stale policy rules and unregistered authority lookalikes", () => {
    const registry = privacyRequestRegistry();
    const aliasManifest = discoveryManifestFor([rootA, rootB], registry, [
      requester,
      victimAlias
    ]);
    const aliasRequest = bindDiscovery(
      {
        ...completedRequest(),
        claimedSubjectAliases: [requester, victimAlias]
      },
      aliasManifest
    );
    expect(() =>
      defineTrustedPrivacyRequest({
        request: aliasRequest,
        discoveryManifest: aliasManifest,
        registry
      })
    ).toThrow(/aliases, verified subjects and reviewer/u);

    const manifest = discoveryManifestFor(undefined, registry);
    const staleRule = structuredClone(
      bindDiscovery(completedRequest(), manifest)
    );
    staleRule.workflow.decision.rootDecisions[0]!.policyRules[0]!.revision =
      "2";
    expect(() =>
      defineTrustedPrivacyRequest({
        request: staleRule,
        discoveryManifest: manifest,
        registry
      })
    ).toThrow(/policy rules are stale or incomplete/u);

    const request = bindDiscovery(completedRequest(), manifest);
    const parsed = inboxV2PrivacyRequestSchema.parse(request);
    if (!("decision" in parsed.workflow)) {
      throw new Error("Authority lookalike fixture requires a decision.");
    }
    const verifiedSubjects = parsed.workflow.verification.verifiedSubjects;
    const checkedAt = parsed.workflow.decision.decidedAt;
    const source = defineInboxV2PrivacyRequestAuthoritySource({
      id: "core:privacy-request-authority-lookalike-test",
      version: "1",
      loadCurrentAuthority: () => ({
        tenantId,
        reviewer,
        verifiedSubjects,
        authorizedAliases: parsed.claimedSubjectAliases,
        checkedAt
      })
    });
    expect(() =>
      defineInboxV2PrivacyRequest({
        request,
        discoveryManifest: manifest,
        registry,
        governanceContext: sharedPrivacyAuthority.governanceContext,
        policy: sharedPrivacyAuthority.policy,
        policyActivationLedger: sharedPrivacyAuthority.activationLedger,
        authoritySource: { ...source }
      })
    ).toThrow(/server authority/u);
    expect(() =>
      defineInboxV2PrivacyRequest({
        request,
        discoveryManifest: manifest,
        registry,
        governanceContext: sharedPrivacyAuthority.governanceContext,
        policy: structuredClone(sharedPrivacyAuthority.policy),
        policyActivationLedger: sharedPrivacyAuthority.activationLedger,
        authoritySource: source
      })
    ).toThrow(/authentic current governance/u);
  });

  it("binds mixed group disclosure to the exact discovery redaction", () => {
    const registry = privacyRequestRegistry();
    const manifest = mixedDiscoveryManifestFor(registry);
    const base = completedRequest();
    const rootDecision = decision().rootDecisions[0]!;
    const unsafe = bindDiscovery(
      {
        ...base,
        workflow: {
          ...base.workflow,
          decision: {
            ...decision(),
            result: "approved" as const,
            rootDecisions: [rootDecision]
          }
        }
      },
      manifest
    );
    expect(() =>
      defineTrustedPrivacyRequest({
        request: unsafe,
        discoveryManifest: manifest,
        registry
      })
    ).toThrow(/exact discovered redaction/u);

    const protectedRequest = {
      ...unsafe,
      workflow: {
        ...unsafe.workflow,
        decision: {
          ...unsafe.workflow.decision,
          rootDecisions: [
            {
              ...rootDecision,
              thirdPartyHandling: {
                kind: "redacted" as const,
                policyProfile: {
                  id: "core:governance-profile.third-party",
                  version: "1"
                },
                reasonCode: "core:privacy.third-party-redaction"
              }
            }
          ]
        }
      }
    };
    expect(
      isInboxV2PrivacyRequest(
        defineTrustedPrivacyRequest({
          request: protectedRequest,
          discoveryManifest: manifest,
          registry
        })
      )
    ).toBe(true);
  });

  it("rejects fake handlers and unregistered purpose/root lineage", () => {
    const registry = privacyRequestRegistry();
    const manifest = discoveryManifestFor();
    const fakeHandler = mutableRecord(
      structuredClone(bindDiscovery(completedRequest(), manifest))
    );
    const fakeExecution = childRecord(
      childRecord(fakeHandler, "workflow"),
      "execution"
    );
    mutableRecord(childArray(fakeExecution, "handlerExecutions")[0]).handlerId =
      "core:lifecycle.caller-authored";
    const parsedFakeHandler = inboxV2PrivacyRequestSchema.parse(fakeHandler);
    expect(() =>
      defineTrustedPrivacyRequest({
        request: parsedFakeHandler,
        discoveryManifest: manifest,
        registry
      })
    ).toThrow(/does not match registered lineage/u);

    const wrongPurpose = mutableRecord(
      structuredClone(bindDiscovery(completedRequest(), manifest))
    );
    const wrongPurposeDecision = childRecord(
      childRecord(wrongPurpose, "workflow"),
      "decision"
    );
    mutableRecord(
      childArray(wrongPurposeDecision, "rootDecisions")[0]
    ).purposeIds = ["core:data_subject_request_execution"];
    expect(() =>
      defineTrustedPrivacyRequest({
        request: inboxV2PrivacyRequestSchema.parse(wrongPurpose),
        discoveryManifest: manifest,
        registry
      })
    ).toThrow(/one exact rule|purpose is not registered/u);
  });

  it("binds completed erasure to an authentic plan and terminal deletion run", () => {
    const registry = privacyRequestRegistry();
    const deletionAuthority = privacyDeletionPolicyAuthority(registry);
    const manifest = discoveryManifestFor([rootA]);
    const erasure = externalRootCompletedRequest();
    const erasureDecision = {
      ...erasure.workflow.decision,
      result: "approved" as const,
      rootDecisions: [erasure.workflow.decision.rootDecisions[0]!]
    };
    const approvedCandidate = bindDiscovery(
      {
        ...erasure,
        workflow: {
          state: "approved" as const,
          verification: erasure.workflow.verification,
          discovery: erasure.workflow.discovery,
          decision: erasureDecision
        },
        updatedAt: "2026-07-12T09:30:00.000Z"
      },
      manifest
    );
    const approved = defineTrustedPrivacyRequest({
      request: approvedCandidate,
      discoveryManifest: manifest,
      registry
    });
    const planId = "privacy-deletion-plan:request-1";
    const planRevision = "1";
    const requestedAt = "2026-07-12T09:31:00.000Z";
    const executeNotBefore = "2026-07-12T09:40:00.000Z";
    const deletionEntity = {
      tenantId,
      entityTypeId: "core:message",
      entityId: "message:message-1"
    };
    const authorization = (
      principal: number,
      permissionId:
        | "core:privacy.deletion.preview"
        | "core:privacy.deletion.approve"
        | "core:privacy.deletion.execute",
      decidedAt: string
    ) => ({
      tenantId,
      id: `authorization-decision:privacy-deletion-${principal}`,
      authorizationEpoch: `authorization-epoch-privacy-${principal}`,
      principal: {
        kind: "employee" as const,
        employee: {
          tenantId,
          kind: "employee" as const,
          id: `employee:privacy-deletion-${principal}`
        }
      },
      permissionId,
      resourceScopeId: "core:privacy-deletion-plan",
      resource: {
        tenantId,
        entityTypeId: "core:privacy-deletion-plan",
        entityId: planId
      },
      resourceAccessRevision: planRevision,
      decisionRevision: "1",
      decisionHash: hashA,
      outcome: "allowed" as const,
      decidedAt,
      notAfter: "2026-07-12T12:00:00.000Z"
    });
    const governance = {
      tenantId,
      id: deletionAuthority.governanceContext.id,
      version: deletionAuthority.governanceContext.version,
      contextHash: deletionAuthority.governanceContext.contextHash
    };
    const policy = {
      tenantId,
      id: deletionAuthority.policy.id,
      version: deletionAuthority.policy.version,
      policyHash: deletionAuthority.policy.policyHash
    };
    const planInput = {
      tenantId,
      id: planId,
      revision: planRevision,
      planHash: hashA,
      cause: "privacy_erasure" as const,
      decisionBasis: {
        kind: "privacy_request" as const,
        request: {
          tenantId,
          requestId: approved.id,
          revision: approved.revision
        },
        decisionId: erasureDecision.id,
        decisionRevision: erasureDecision.revision,
        decisionDigest: erasureDecision.digest
      },
      lifecycleEvaluationHashes: [],
      scopeKind: "exact" as const,
      scopeManifest: defineInboxV2PrivacyScopeManifest({
        tenantId,
        id: "privacy-scope:request-erasure-1",
        revision: "1",
        frozenAt: requestedAt,
        roots: [
          {
            root: rootA,
            entity: deletionEntity,
            expectedEntityRevision: "1",
            expectedLineageRevision: "1",
            rootKind: "sql" as const,
            boundary: "operated_data_plane" as const,
            copyRole: "primary" as const
          }
        ]
      }),
      governance,
      policy,
      previewAuthorization: authorization(
        1,
        "core:privacy.deletion.preview",
        requestedAt
      ),
      approval: {
        kind: "separated_approval" as const,
        authorization: authorization(
          2,
          "core:privacy.deletion.approve",
          "2026-07-12T09:35:00.000Z"
        ),
        approvedAt: "2026-07-12T09:35:00.000Z"
      },
      executeAuthorization: authorization(
        3,
        "core:privacy.deletion.execute",
        executeNotBefore
      ),
      requestedAt,
      executeNotBefore,
      operatedCheckpoints: [
        {
          checkpointId: "checkpoint:request-operated-1",
          target: {
            tenantId,
            root: rootA,
            entity: deletionEntity,
            expectedEntityRevision: "1",
            expectedLineageRevision: "1",
            rootKind: "sql" as const,
            boundary: "operated_data_plane" as const,
            action: "purge_content_keep_tombstone" as const,
            deleteHandlerId: "core:lifecycle.privacy-request-delete",
            verificationHandlerId: "core:lifecycle.privacy-request-verify",
            sharedParentProof: { kind: "not_shared" as const }
          }
        }
      ],
      backupCheckpoints: [],
      externalCheckpoints: []
    };
    planInput.planHash = calculateInboxV2DeletionPlanHash(planInput);
    const deletionPlan = defineInboxV2DeletionPlan({
      plan: planInput,
      registry,
      policy: deletionAuthority.policy,
      activationLedger: deletionAuthority.activationLedger,
      privacyRequest: approved
    });
    const planReference = {
      tenantId,
      planId: deletionPlan.id,
      revision: deletionPlan.revision,
      planHash: deletionPlan.planHash
    };
    const checkedAt = "2026-07-12T09:50:00.000Z";
    const fence = {
      tenantId,
      plan: planReference,
      governance,
      policy,
      executionAuthorization: planInput.executeAuthorization,
      revision: {
        kind: "matched" as const,
        expectedRevision: "1",
        observedRevision: "1"
      },
      lineage: {
        kind: "matched" as const,
        expectedRevision: "1",
        observedRevision: "1"
      },
      hold: { kind: "clear" as const },
      restriction: {
        tenantId,
        restrictions: [],
        evaluatedAt: checkedAt,
        decisionHash: hashA,
        restrictionExtendedRetention: false as const
      },
      checkedAt
    };
    const runInput = {
      tenantId,
      id: "privacy-deletion-run:request-1",
      revision: "1",
      plan: planReference,
      stageOne: {
        state: "content_unavailable" as const,
        targets: [
          {
            checkpointId: "checkpoint:request-operated-1",
            root: rootA,
            entity: deletionEntity,
            expectedRevision: "1",
            resultingRevision: "2",
            tombstoneManifest: evidence("request-tombstone").payload,
            invalidationDigest: hashA,
            committedAt: "2026-07-12T09:45:00.000Z"
          }
        ]
      },
      requiredOperatedCheckpointIds: ["checkpoint:request-operated-1"],
      requiredBackupCheckpointIds: [],
      requiredExternalCheckpointIds: [],
      operatedOutcomes: [
        {
          tenantId,
          checkpointId: "checkpoint:request-operated-1",
          target: rootA,
          deleteHandlerId: "core:lifecycle.privacy-request-delete",
          verificationHandlerId: "core:lifecycle.privacy-request-verify",
          attempt: "1",
          fence,
          outcome: {
            kind: "verified_absent" as const,
            evidence: evidence("request-absence").payload
          },
          checkedAt
        }
      ],
      backupOutcomes: [],
      externalResiduals: [],
      startedAt: executeNotBefore,
      evaluatedAt: checkedAt,
      state: "terminal" as const,
      result: "completed" as const
    };
    const executionSource = defineInboxV2DeletionExecutionSource({
      id: "core:privacy-erasure-execution-source",
      version: "1",
      handlerIds: [
        "core:lifecycle.privacy-request-delete",
        "core:lifecycle.privacy-request-verify"
      ],
      loadCompleteExecution: () => ({
        executionControlHighWater: {
          streamEpoch: "stream:epoch:privacy-erasure-execution",
          syncGeneration: "1",
          completeThroughPosition: "120",
          legalHoldSetRevision: "1",
          restrictionSetRevision: "1",
          sourceStateHash: hashB,
          capturedAt: checkedAt
        },
        stageOne: runInput.stageOne,
        operatedOutcomes: runInput.operatedOutcomes,
        backupOutcomes: runInput.backupOutcomes,
        externalResiduals: runInput.externalResiduals,
        resolvedAt: checkedAt
      })
    });
    const executionProof = resolveInboxV2DeletionExecutionProof({
      source: executionSource,
      registry,
      plan: deletionPlan,
      policy: deletionAuthority.policy,
      activationLedger: deletionAuthority.activationLedger,
      privacyRequest: approved,
      startedAt: runInput.startedAt
    });
    const deletionRun = defineInboxV2DeletionRun({
      run: runInput,
      plan: deletionPlan,
      registry,
      policy: deletionAuthority.policy,
      activationLedger: deletionAuthority.activationLedger,
      privacyRequest: approved,
      executionProof
    });
    const proof = {
      tenantId,
      root: rootA,
      cause: "privacy_erasure" as const,
      plan: planReference,
      run: {
        tenantId,
        runId: deletionRun.id,
        revision: deletionRun.revision
      }
    };
    const completedCandidate = {
      ...approvedCandidate,
      revision: "5",
      workflow: {
        state: "completed" as const,
        verification: approvedCandidate.workflow.verification,
        discovery: approvedCandidate.workflow.discovery,
        decision: erasureDecision,
        execution: {
          ...execution(),
          handlerExecutions: [
            {
              ...handlerExecution(rootA, "erase", "authenticated-erasure"),
              deletionProof: proof
            }
          ]
        },
        completedAt: "2026-07-12T09:55:00.000Z"
      },
      updatedAt: "2026-07-12T09:55:00.000Z"
    };
    const completed = defineTrustedPrivacyRequest({
      request: completedCandidate,
      discoveryManifest: manifest,
      registry,
      deletionExecutions: [{ plan: deletionPlan, run: deletionRun }]
    });
    expect(isInboxV2PrivacyRequest(completed)).toBe(true);
    expect(() =>
      defineTrustedPrivacyRequest({
        request: completedCandidate,
        discoveryManifest: manifest,
        registry,
        deletionExecutions: [
          {
            plan: structuredClone(deletionPlan) as typeof deletionPlan,
            run: structuredClone(deletionRun) as typeof deletionRun
          }
        ]
      })
    ).toThrow(/authentic exact plan and run/u);
  });

  it("classifies local, backup and external execution from the authentic registry", () => {
    const registry = privacyRequestRegistry();

    const externalManifest = discoveryManifestFor([rootA, externalRoot]);
    expect(() =>
      defineTrustedPrivacyRequest({
        request: bindDiscovery(
          externalRootCompletedRequest(),
          externalManifest
        ),
        discoveryManifest: externalManifest,
        registry
      })
    ).toThrow(/exact authentic deletion plan\/run coverage/u);

    const backupManifest = discoveryManifestFor([backupRoot]);
    expect(() =>
      defineTrustedPrivacyRequest({
        request: bindDiscovery(backupPendingRequest(), backupManifest),
        discoveryManifest: backupManifest,
        registry
      })
    ).toThrow(/exact authentic deletion plan\/run coverage/u);

    const backupAsLocal = mutableRecord(
      structuredClone(bindDiscovery(backupPendingRequest(), backupManifest))
    );
    const backupAsLocalWorkflow = childRecord(backupAsLocal, "workflow");
    backupAsLocalWorkflow.state = "completed";
    const backupAsLocalExecution = childRecord(
      backupAsLocalWorkflow,
      "execution"
    );
    backupAsLocalExecution.backupExecutions = [];
    backupAsLocalExecution.handlerExecutions = [
      handlerExecution(backupRoot, "erase", "backup-as-local")
    ];
    expect(() =>
      defineTrustedPrivacyRequest({
        request: inboxV2PrivacyRequestSchema.parse(backupAsLocal),
        discoveryManifest: backupManifest,
        registry
      })
    ).toThrow(/not a local operated root/u);

    const localManifest = discoveryManifestFor([rootA]);
    const localAsBackup = mutableRecord(
      structuredClone(
        bindDiscovery(externalRootCompletedRequest(), localManifest)
      )
    );
    const localAsBackupWorkflow = childRecord(localAsBackup, "workflow");
    const localAsBackupDecision = childRecord(
      localAsBackupWorkflow,
      "decision"
    );
    localAsBackupDecision.rootDecisions = [
      childArray(localAsBackupDecision, "rootDecisions")[0]!
    ];
    const localAsBackupExecution = childRecord(
      localAsBackupWorkflow,
      "execution"
    );
    localAsBackupExecution.externalResiduals = [];
    localAsBackupExecution.handlerExecutions = [];
    localAsBackupExecution.backupExecutions = [
      {
        tenantId,
        root: rootA,
        disposition: "erase",
        execution: {
          tenantId,
          entityTypeId: "core:privacy-backup-execution",
          entityId: "privacy-backup-execution:local-as-backup"
        },
        outcome: "expiry_verified",
        checkedAt: "2026-08-12T10:00:00.000Z",
        latestPossibleExpiryAt: "2026-08-12T10:00:00.000Z",
        evidence: evidence("local-as-backup"),
        deletionProof: deletionProof(rootA)
      }
    ];
    expect(() =>
      defineTrustedPrivacyRequest({
        request: inboxV2PrivacyRequestSchema.parse(localAsBackup),
        discoveryManifest: localManifest,
        registry
      })
    ).toThrow(/registered backup\/deletion lineage/u);

    const externalOnlyManifest = discoveryManifestFor([externalRoot]);
    const externalAsLocal = mutableRecord(
      structuredClone(
        bindDiscovery(externalRootCompletedRequest(), externalOnlyManifest)
      )
    );
    const externalAsLocalWorkflow = childRecord(externalAsLocal, "workflow");
    const externalAsLocalDecision = childRecord(
      externalAsLocalWorkflow,
      "decision"
    );
    const externalDecision = mutableRecord(
      childArray(externalAsLocalDecision, "rootDecisions")[1]
    );
    externalDecision.disposition = "erase";
    externalDecision.externalRouteIds = [];
    externalAsLocalDecision.rootDecisions = [externalDecision];
    const externalAsLocalExecution = childRecord(
      externalAsLocalWorkflow,
      "execution"
    );
    externalAsLocalExecution.handlerExecutions = [
      handlerExecution(externalRoot, "erase", "external-as-local")
    ];
    externalAsLocalExecution.backupExecutions = [];
    externalAsLocalExecution.externalResiduals = [];
    expect(() =>
      defineTrustedPrivacyRequest({
        request: inboxV2PrivacyRequestSchema.parse(externalAsLocal),
        discoveryManifest: externalOnlyManifest,
        registry
      })
    ).toThrow(/misclassified as local, backup or external/u);
  });

  it("represents every pre-completion checkpoint without optional-state ambiguity", () => {
    const workflows = [
      { state: "received" },
      {
        state: "identity_verification",
        verification: {
          tenantId,
          id: "privacy_verification:verification-1",
          revision: "1",
          status: "pending",
          methods: [],
          evidence: [],
          verificationProfile: {
            id: "core:privacy-verification.default",
            version: "1"
          },
          startedAt: "2026-07-12T09:00:00.000Z"
        }
      },
      { state: "scope_discovery", verification: verification() },
      {
        state: "policy_and_exception_review",
        verification: verification(),
        discovery: discoveryReference()
      },
      {
        state: "partially_approved",
        verification: verification(),
        discovery: discoveryReference(),
        decision: decision()
      },
      {
        state: "executing",
        verification: verification(),
        discovery: discoveryReference(),
        decision: decision(),
        execution: { ...execution(), handlerExecutions: [] }
      },
      {
        state: "verification_pending",
        verification: verification(),
        discovery: discoveryReference(),
        decision: decision(),
        execution: execution()
      }
    ];

    for (const workflow of workflows) {
      expect(
        inboxV2PrivacyRequestSchema.safeParse({
          ...completedRequest(),
          workflow
        }).success
      ).toBe(true);
    }
  });

  it("derives completion taxonomy from handler, backup and external outcomes", () => {
    const falseCompleted = mutableRecord(
      structuredClone(externalRootCompletedRequest())
    );
    const falseCompletedWorkflow = childRecord(falseCompleted, "workflow");
    const falseCompletedExecution = childRecord(
      falseCompletedWorkflow,
      "execution"
    );
    mutableRecord(
      childArray(falseCompletedExecution, "externalResiduals")[0]
    ).outcome = "unsupported";
    expect(inboxV2PrivacyRequestSchema.safeParse(falseCompleted).success).toBe(
      false
    );

    falseCompletedWorkflow.state = "completed_with_external_residuals";
    expect(inboxV2PrivacyRequestSchema.safeParse(falseCompleted).success).toBe(
      true
    );

    const internalResidual = mutableRecord(structuredClone(completedRequest()));
    const internalWorkflow = childRecord(internalResidual, "workflow");
    const internalExecution = childRecord(internalWorkflow, "execution");
    mutableRecord(
      childArray(internalExecution, "handlerExecutions")[0]
    ).status = "unverified";
    expect(
      inboxV2PrivacyRequestSchema.safeParse(internalResidual).success
    ).toBe(false);
    internalWorkflow.state = "verification_blocked_internal_residual";
    expect(
      inboxV2PrivacyRequestSchema.safeParse(internalResidual).success
    ).toBe(true);

    const backupPending = mutableRecord(
      structuredClone(backupPendingRequest())
    );
    expect(inboxV2PrivacyRequestSchema.safeParse(backupPending).success).toBe(
      true
    );

    const unprovenBackup = mutableRecord(
      structuredClone(backupPendingRequest())
    );
    const unprovenBackupExecution = childRecord(
      childRecord(unprovenBackup, "workflow"),
      "execution"
    );
    mutableRecord(
      childArray(unprovenBackupExecution, "backupExecutions")[0]
    ).evidence = null;
    expect(inboxV2PrivacyRequestSchema.safeParse(unprovenBackup).success).toBe(
      false
    );

    const retryable = mutableRecord(structuredClone(completedRequest()));
    const retryableWorkflow = childRecord(retryable, "workflow");
    retryableWorkflow.state = "failed_retryable";
    const retryableExecution = childRecord(retryableWorkflow, "execution");
    mutableRecord(
      childArray(retryableExecution, "handlerExecutions")[0]
    ).status = "failed_retryable";
    expect(inboxV2PrivacyRequestSchema.safeParse(retryable).success).toBe(true);
  });

  it("requires evidence for every terminal succeeded, confirmed or backup-verified outcome", () => {
    const localWithoutEvidence = mutableRecord(
      structuredClone(completedRequest())
    );
    const localExecution = childRecord(
      childRecord(localWithoutEvidence, "workflow"),
      "execution"
    );
    mutableRecord(childArray(localExecution, "handlerExecutions")[0]).evidence =
      null;
    expect(
      inboxV2PrivacyRequestSchema.safeParse(localWithoutEvidence).success
    ).toBe(false);

    const externalWithoutEvidence = mutableRecord(
      structuredClone(externalRootCompletedRequest())
    );
    const externalExecution = childRecord(
      childRecord(externalWithoutEvidence, "workflow"),
      "execution"
    );
    mutableRecord(
      childArray(externalExecution, "externalResiduals")[0]
    ).evidence = null;
    expect(
      inboxV2PrivacyRequestSchema.safeParse(externalWithoutEvidence).success
    ).toBe(false);

    const backupWithoutEvidence = mutableRecord(
      structuredClone(backupPendingRequest())
    );
    const backupWorkflow = childRecord(backupWithoutEvidence, "workflow");
    backupWorkflow.state = "completed";
    const backupExecution = childRecord(backupWorkflow, "execution");
    const backupOutcome = mutableRecord(
      childArray(backupExecution, "backupExecutions")[0]
    );
    backupOutcome.outcome = "expiry_verified";
    backupOutcome.checkedAt = "2026-08-12T10:00:00.000Z";
    backupOutcome.evidence = null;
    expect(
      inboxV2PrivacyRequestSchema.safeParse(backupWithoutEvidence).success
    ).toBe(false);
  });

  it("requires exact approved-root handler coverage without omission, extras or reuse", () => {
    const validMultiRoot = twoInternalRootCompletedRequest();
    expect(inboxV2PrivacyRequestSchema.safeParse(validMultiRoot).success).toBe(
      true
    );

    const arbitraryRoot = mutableRecord(structuredClone(completedRequest()));
    const arbitraryExecution = childRecord(
      childRecord(arbitraryRoot, "workflow"),
      "execution"
    );
    mutableRecord(childArray(arbitraryExecution, "handlerExecutions")[0]).root =
      rootB;
    expect(inboxV2PrivacyRequestSchema.safeParse(arbitraryRoot).success).toBe(
      false
    );

    const missingRoot = mutableRecord(structuredClone(validMultiRoot));
    const missingExecution = childRecord(
      childRecord(missingRoot, "workflow"),
      "execution"
    );
    childArray(missingExecution, "handlerExecutions").pop();
    expect(inboxV2PrivacyRequestSchema.safeParse(missingRoot).success).toBe(
      false
    );

    const extraRoot = mutableRecord(structuredClone(validMultiRoot));
    const extraExecution = childRecord(
      childRecord(extraRoot, "workflow"),
      "execution"
    );
    childArray(extraExecution, "handlerExecutions").push(
      handlerExecution(rootC, "include_normalized", "root-c")
    );
    expect(inboxV2PrivacyRequestSchema.safeParse(extraRoot).success).toBe(
      false
    );

    const wrongDisposition = mutableRecord(structuredClone(validMultiRoot));
    const wrongDispositionExecution = childRecord(
      childRecord(wrongDisposition, "workflow"),
      "execution"
    );
    mutableRecord(
      childArray(wrongDispositionExecution, "handlerExecutions")[1]
    ).disposition = "include_portable";
    expect(
      inboxV2PrivacyRequestSchema.safeParse(wrongDisposition).success
    ).toBe(false);

    const reusedExecution = mutableRecord(structuredClone(validMultiRoot));
    const reusedExecutionProgress = childRecord(
      childRecord(reusedExecution, "workflow"),
      "execution"
    );
    const handlers = childArray(reusedExecutionProgress, "handlerExecutions");
    mutableRecord(handlers[1]).execution = mutableRecord(handlers[0]).execution;
    expect(inboxV2PrivacyRequestSchema.safeParse(reusedExecution).success).toBe(
      false
    );
  });

  it("binds every external residual to the exact approved root and declared route", () => {
    const validExternal = externalRootCompletedRequest();
    expect(inboxV2PrivacyRequestSchema.safeParse(validExternal).success).toBe(
      true
    );

    const wrongRoot = mutableRecord(structuredClone(validExternal));
    const wrongRootExecution = childRecord(
      childRecord(wrongRoot, "workflow"),
      "execution"
    );
    mutableRecord(childArray(wrongRootExecution, "externalResiduals")[0]).root =
      rootA;
    expect(inboxV2PrivacyRequestSchema.safeParse(wrongRoot).success).toBe(
      false
    );

    const wrongRoute = mutableRecord(structuredClone(validExternal));
    const wrongRouteExecution = childRecord(
      childRecord(wrongRoute, "workflow"),
      "execution"
    );
    mutableRecord(
      childArray(wrongRouteExecution, "externalResiduals")[0]
    ).routeId = "core:external-route.whatsapp";
    expect(inboxV2PrivacyRequestSchema.safeParse(wrongRoute).success).toBe(
      false
    );

    const missingResidual = mutableRecord(structuredClone(validExternal));
    const missingResidualExecution = childRecord(
      childRecord(missingResidual, "workflow"),
      "execution"
    );
    childArray(missingResidualExecution, "externalResiduals").pop();
    expect(inboxV2PrivacyRequestSchema.safeParse(missingResidual).success).toBe(
      false
    );
  });

  it("rejects caller-selected decisions, incompatible intents and unsafe group handling", () => {
    const falseApproval = mutableRecord(structuredClone(completedRequest()));
    const approvalWorkflow = childRecord(falseApproval, "workflow");
    childRecord(approvalWorkflow, "decision").result = "approved";
    expect(inboxV2PrivacyRequestSchema.safeParse(falseApproval).success).toBe(
      false
    );

    const wrongIntent = mutableRecord(structuredClone(completedRequest()));
    wrongIntent.intent = "portability";
    expect(inboxV2PrivacyRequestSchema.safeParse(wrongIntent).success).toBe(
      false
    );

    const missingProtection = mutableRecord(
      structuredClone(completedRequest())
    );
    const protectionDecision = childRecord(
      childRecord(missingProtection, "workflow"),
      "decision"
    );
    mutableRecord(
      childArray(protectionDecision, "rootDecisions")[1]
    ).disposition = "omit_with_reason";
    expect(
      inboxV2PrivacyRequestSchema.safeParse(missingProtection).success
    ).toBe(false);

    const missingException = mutableRecord(structuredClone(completedRequest()));
    const exceptionDecision = childRecord(
      childRecord(missingException, "workflow"),
      "decision"
    );
    mutableRecord(
      childArray(exceptionDecision, "rootDecisions")[1]
    ).exceptions = [];
    expect(
      inboxV2PrivacyRequestSchema.safeParse(missingException).success
    ).toBe(false);
  });

  it("seals complete tenant scope independently of subject discovery and classifies backups", () => {
    const backupSource = defineInboxV2TenantTerminationScopeSource({
      id: "core:privacy-request-backup-tenant-scope-source",
      version: "1",
      loadCompleteTenantScope: ({ expectedDataUses }) => ({
        kind: "tenant_termination_scope",
        tenantId,
        id: "core:tenant-termination-scope-backup-only",
        revision: "1",
        boundary: {
          streamEpoch: "stream:epoch:privacy-request-backup-scope",
          syncGeneration: "1",
          completeThroughPosition: "211",
          snapshotHash: hashA
        },
        scannedDataUses: [...expectedDataUses],
        roots: [
          {
            root: backupRoot,
            expectedEntityRevision: "3",
            expectedLineageRevision: "4",
            handling: "erase_without_export" as const,
            omissionReason: "backup_copy" as const
          }
        ],
        generatedAt: "2026-07-12T09:41:00.000Z"
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
    const backupScope = resolveInboxV2TenantTerminationScopeManifest({
      source: backupSource,
      registry: sharedPrivacyRegistry,
      governanceContext: sharedPrivacyAuthority.governanceContext,
      policy: sharedPrivacyAuthority.policy,
      activationLedger: sharedPrivacyAuthority.activationLedger,
      tenantId
    });
    expect(backupScope.roots).toEqual([
      expect.objectContaining({
        handling: "erase_without_export",
        omissionReason: "backup_copy"
      })
    ]);

    const incompleteSource = defineInboxV2TenantTerminationScopeSource({
      id: "core:privacy-request-incomplete-tenant-scope-source",
      version: "1",
      loadCompleteTenantScope: ({ expectedDataUses }) => ({
        kind: "tenant_termination_scope",
        tenantId,
        id: "core:tenant-termination-scope-incomplete",
        revision: "1",
        boundary: {
          streamEpoch: "stream:epoch:privacy-request-incomplete-scope",
          syncGeneration: "1",
          completeThroughPosition: "212",
          snapshotHash: hashA
        },
        scannedDataUses: expectedDataUses.slice(1),
        roots: [],
        generatedAt: "2026-07-12T09:42:00.000Z"
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
    expect(() =>
      resolveInboxV2TenantTerminationScopeManifest({
        source: incompleteSource,
        registry: sharedPrivacyRegistry,
        governanceContext: sharedPrivacyAuthority.governanceContext,
        policy: sharedPrivacyAuthority.policy,
        activationLedger: sharedPrivacyAuthority.activationLedger,
        tenantId
      })
    ).toThrow(/exact current registry data-use set/u);

    const driftSource = defineInboxV2TenantTerminationScopeSource({
      id: "core:privacy-request-drifted-tenant-scope-source",
      version: "1",
      loadCompleteTenantScope: ({ expectedDataUses }) => ({
        kind: "tenant_termination_scope",
        tenantId,
        id: "core:tenant-termination-scope-drifted",
        revision: "1",
        boundary: {
          streamEpoch: "stream:epoch:privacy-request-drifted-scope",
          syncGeneration: "1",
          completeThroughPosition: "213",
          snapshotHash: hashA
        },
        scannedDataUses: [...expectedDataUses],
        roots: [
          {
            root: rootA,
            expectedEntityRevision: "1",
            expectedLineageRevision: "1",
            handling: "export_then_erase" as const
          }
        ],
        generatedAt: "2026-07-12T09:43:00.000Z"
      }),
      compareAndSetDestructiveScope: ({ manifest, checkedAt }) => ({
        outcome: "changed",
        tenantId: manifest.tenantId,
        registryCompositionHash: manifest.registryCompositionHash,
        boundary: manifest.boundary,
        rootSetHash: manifest.rootSetHash,
        exportRootSetHash: manifest.exportRootSetHash,
        checkedAt
      })
    });
    const driftedScope = resolveInboxV2TenantTerminationScopeManifest({
      source: driftSource,
      registry: sharedPrivacyRegistry,
      governanceContext: sharedPrivacyAuthority.governanceContext,
      policy: sharedPrivacyAuthority.policy,
      activationLedger: sharedPrivacyAuthority.activationLedger,
      tenantId
    });
    expect(() =>
      compareAndSetInboxV2TenantTerminationDestructiveScope({
        manifest: driftedScope,
        checkedAt: "2026-07-12T10:00:00.000Z"
      })
    ).toThrow(/changed after export/u);

    const broaderSource = defineInboxV2TenantTerminationScopeSource({
      id: "core:privacy-request-broader-tenant-scope-source",
      version: "1",
      loadCompleteTenantScope: ({ expectedDataUses }) => ({
        kind: "tenant_termination_scope",
        tenantId,
        id: "core:tenant-termination-scope-two-roots",
        revision: "1",
        boundary: {
          streamEpoch: "stream:epoch:privacy-request-two-root-scope",
          syncGeneration: "1",
          completeThroughPosition: "214",
          snapshotHash: hashA
        },
        scannedDataUses: [...expectedDataUses],
        roots: [
          {
            root: rootA,
            expectedEntityRevision: "1",
            expectedLineageRevision: "1",
            handling: "export_then_erase" as const
          },
          {
            root: rootB,
            expectedEntityRevision: "1",
            expectedLineageRevision: "1",
            handling: "export_then_erase" as const
          }
        ],
        generatedAt: "2026-07-12T09:44:00.000Z"
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
    const broaderScope = resolveInboxV2TenantTerminationScopeManifest({
      source: broaderSource,
      registry: sharedPrivacyRegistry,
      governanceContext: sharedPrivacyAuthority.governanceContext,
      policy: sharedPrivacyAuthority.policy,
      activationLedger: sharedPrivacyAuthority.activationLedger,
      tenantId
    });
    const subjectOnlyManifest = discoveryManifestFor([rootA]);
    const subjectOnlyRequest = {
      ...bindDiscovery(tenantTerminationRequest(), subjectOnlyManifest),
      tenantTerminationScope:
        inboxV2TenantTerminationScopeManifestReference(broaderScope)
    };
    expect(() =>
      defineTrustedPrivacyRequest({
        request: subjectOnlyRequest,
        discoveryManifest: subjectOnlyManifest,
        registry: sharedPrivacyRegistry,
        tenantTerminationScope: broaderScope
      })
    ).toThrow(/cover every root/u);
  });

  it("requires tenant termination to export then erase with exactly two ordered slots", () => {
    const registry = privacyRequestRegistry();
    const manifest = discoveryManifestFor([rootA]);
    const valid = bindDiscovery(tenantTerminationRequest(), manifest);
    expect(inboxV2PrivacyRequestSchema.safeParse(valid).success).toBe(true);
    expect(
      valid.workflow.execution.handlerExecutions.map(
        ({ disposition }) => disposition
      )
    ).toEqual(["include_normalized", "erase"]);
    expect(() =>
      defineTrustedPrivacyRequest({
        request: valid,
        discoveryManifest: manifest,
        registry
      })
    ).toThrow(/exactly one authentic ready export bundle/u);

    const terminal = terminalExportFixture();
    const withTerminalExport = {
      ...valid,
      workflow: {
        ...valid.workflow,
        execution: {
          ...valid.workflow.execution,
          terminalExport: terminal.reference
        }
      }
    };
    expect(() =>
      defineTrustedPrivacyRequest({
        request: withTerminalExport,
        discoveryManifest: manifest,
        registry,
        terminalExportProofs: [structuredClone(terminal.bundle)]
      })
    ).toThrow(/stale, incomplete or not bound/u);
    expect(() =>
      defineTrustedPrivacyRequest({
        request: withTerminalExport,
        discoveryManifest: manifest,
        registry,
        terminalExportProofs: [terminal.bundle]
      })
    ).toThrow(/exact authentic deletion plan\/run coverage/u);

    const expiringAtCompletion = terminalExportFixture(
      valid.workflow.completedAt
    );
    const expiredAtCompletion = {
      ...valid,
      workflow: {
        ...valid.workflow,
        execution: {
          ...valid.workflow.execution,
          terminalExport: expiringAtCompletion.reference
        }
      }
    };
    expect(() =>
      defineTrustedPrivacyRequest({
        request: expiredAtCompletion,
        discoveryManifest: manifest,
        registry,
        terminalExportProofs: [expiringAtCompletion.bundle]
      })
    ).toThrow(/stale, incomplete or not bound/u);

    const reversed = mutableRecord(structuredClone(valid));
    const reversedExecution = childRecord(
      childRecord(reversed, "workflow"),
      "execution"
    );
    childArray(reversedExecution, "handlerExecutions").reverse();
    expect(inboxV2PrivacyRequestSchema.safeParse(reversed).success).toBe(false);

    const missing = mutableRecord(structuredClone(valid));
    const missingExecution = childRecord(
      childRecord(missing, "workflow"),
      "execution"
    );
    childArray(missingExecution, "handlerExecutions").pop();
    expect(inboxV2PrivacyRequestSchema.safeParse(missing).success).toBe(false);

    const extra = mutableRecord(structuredClone(valid));
    const extraExecution = childRecord(
      childRecord(extra, "workflow"),
      "execution"
    );
    childArray(extraExecution, "handlerExecutions").push(
      handlerExecution(rootA, "correct", "termination-extra")
    );
    expect(inboxV2PrivacyRequestSchema.safeParse(extra).success).toBe(false);

    const wrongCause = mutableRecord(structuredClone(valid));
    const wrongCauseExecution = childRecord(
      childRecord(wrongCause, "workflow"),
      "execution"
    );
    const erase = mutableRecord(
      childArray(wrongCauseExecution, "handlerExecutions")[1]
    );
    childRecord(erase, "deletionProof").cause = "privacy_erasure";
    expect(() =>
      defineTrustedPrivacyRequest({
        request: inboxV2PrivacyRequestSchema.parse(wrongCause),
        discoveryManifest: manifest,
        registry
      })
    ).toThrow(/does not match request intent/u);
  });

  it("requires exact hold identity, revision and review time for a blocked decision", () => {
    const blockedDecision = mutableRecord(structuredClone(decision()));
    blockedDecision.result = "blocked_by_legal_hold";
    const exception = {
      kind: "legal_claim_or_regulatory_duty",
      reasonCode: "core:privacy.exception.active-hold",
      policyProfile: {
        id: "core:governance-profile.default",
        version: "1"
      },
      evidence: []
    };
    for (const rootDecision of childArray(blockedDecision, "rootDecisions")) {
      const root = mutableRecord(rootDecision);
      root.disposition = "retain_with_exception";
      root.thirdPartyHandling = { kind: "not_applicable" };
      root.exceptions = [exception];
    }
    blockedDecision.holdReferences = [
      {
        hold: {
          tenantId,
          holdId: "privacy-hold:hold-1",
          revision: "3"
        },
        reviewAt: "2026-08-01T00:00:00.000Z"
      }
    ];
    const blocked = {
      ...completedRequest(),
      workflow: {
        state: "blocked_by_legal_hold",
        verification: verification(),
        discovery: discoveryReference(),
        decision: blockedDecision
      },
      updatedAt: "2026-07-12T09:30:00.000Z"
    };
    expect(inboxV2PrivacyRequestSchema.safeParse(blocked).success).toBe(true);

    const missingReview = mutableRecord(structuredClone(blocked));
    const blockedWorkflow = childRecord(missingReview, "workflow");
    const decisionWithMissingReview = childRecord(blockedWorkflow, "decision");
    const holdReference = mutableRecord(
      childArray(decisionWithMissingReview, "holdReferences")[0]
    );
    delete holdReference.reviewAt;
    expect(inboxV2PrivacyRequestSchema.safeParse(missingReview).success).toBe(
      false
    );
  });

  it("rejects cross-tenant request, discovery, verification and execution references", () => {
    const mutations: Array<(value: MutableRecord) => void> = [
      (value) => {
        childRecord(value, "governanceContext").tenantId = otherTenantId;
      },
      (value) => {
        childRecord(childRecord(value, "workflow"), "discovery").tenantId =
          otherTenantId;
      },
      (value) => {
        const verificationRecord = childRecord(
          childRecord(value, "workflow"),
          "verification"
        );
        const subject = mutableRecord(
          childArray(verificationRecord, "verifiedSubjects")[0]
        );
        childRecord(subject, "clientContact").tenantId = otherTenantId;
      },
      (value) => {
        const executionRecord = childRecord(
          childRecord(value, "workflow"),
          "execution"
        );
        mutableRecord(
          childArray(executionRecord, "handlerExecutions")[0]
        ).tenantId = otherTenantId;
      },
      (value) => {
        const decisionRecord = childRecord(
          childRecord(value, "workflow"),
          "decision"
        );
        mutableRecord(
          childArray(decisionRecord, "rootDecisions")[0]
        ).exceptions = [
          {
            kind: "approved_profile_exception",
            reasonCode: "core:privacy.exception.profile",
            policyProfile: {
              id: "core:governance-profile.default",
              version: "1"
            },
            evidence: [{ ...evidence("cross-tenant"), tenantId: otherTenantId }]
          }
        ];
      }
    ];
    for (const mutate of mutations) {
      const value = mutableRecord(structuredClone(completedRequest()));
      mutate(value);
      expect(inboxV2PrivacyRequestSchema.safeParse(value).success).toBe(false);
    }
  });

  it("requires canonical unique scope and pins verified identity to evidence/profile", () => {
    const duplicateAlias = mutableRecord(structuredClone(completedRequest()));
    childArray(duplicateAlias, "claimedSubjectAliases").push(
      duplicateAlias.requesterSubject
    );
    expect(inboxV2PrivacyRequestSchema.safeParse(duplicateAlias).success).toBe(
      false
    );

    const reorderedRoots = mutableRecord(structuredClone(completedRequest()));
    const reorderedDecision = childRecord(
      childRecord(reorderedRoots, "workflow"),
      "decision"
    );
    childArray(reorderedDecision, "rootDecisions").reverse();
    expect(inboxV2PrivacyRequestSchema.safeParse(reorderedRoots).success).toBe(
      false
    );

    const noVerificationEvidence = mutableRecord(
      structuredClone(completedRequest())
    );
    childRecord(
      childRecord(noVerificationEvidence, "workflow"),
      "verification"
    ).evidence = [];
    expect(
      inboxV2PrivacyRequestSchema.safeParse(noVerificationEvidence).success
    ).toBe(false);

    const wrongVerifiedSubject = mutableRecord(
      structuredClone(completedRequest())
    );
    childRecord(
      childRecord(wrongVerifiedSubject, "workflow"),
      "verification"
    ).verifiedSubjects = [
      {
        kind: "employee",
        employee: reviewer
      }
    ];
    expect(
      inboxV2PrivacyRequestSchema.safeParse(wrongVerifiedSubject).success
    ).toBe(false);
  });

  it("keeps request/evidence contracts free of copied PII, content and arbitrary JSON", () => {
    for (const forbidden of [
      { phone: "+70000000000" },
      { messageText: "copied group message" },
      { rawProviderPayload: { sender: "hidden" } },
      { metadata: { arbitrary: true } },
      { verificationDocument: "base64-secret" }
    ]) {
      expect(
        inboxV2PrivacyRequestSchema.safeParse({
          ...completedRequest(),
          ...forbidden
        }).success
      ).toBe(false);
    }
    expect(() =>
      assertInboxV2ClosedJsonSchema(
        inboxV2PrivacyRequestSchema,
        "privacy request"
      )
    ).not.toThrow();
  });
});
