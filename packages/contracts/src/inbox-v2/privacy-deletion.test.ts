import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineInboxV2DataLifecycleRegistry } from "./data-lifecycle-catalog";
import { defineInboxV2DataGovernanceContext } from "./data-governance";
import {
  calculateInboxV2DeletionLifecycleEvaluationHash,
  calculateInboxV2DeletionExecutionProofHash,
  calculateInboxV2DeletionOutcomesProofHash,
  calculateInboxV2DeletionPlanHash,
  defineInboxV2DeletionExecutionSource,
  defineInboxV2DeletionPlan,
  defineInboxV2DeletionRun,
  deriveInboxV2DeletionCompletionResult,
  inboxV2BackupDeletionOutcomeSchema,
  inboxV2DeletionCompletionResultSchema,
  inboxV2DeletionExecutionProofSchema,
  inboxV2DeletionPlanEnvelopeSchema,
  inboxV2DeletionPlanSchema,
  inboxV2DeletionRunEnvelopeSchema,
  inboxV2DeletionRunSchema,
  inboxV2ExternalDeletionResidualSchema,
  inboxV2OperatedDeletionHandlerOutcomeSchema,
  resolveInboxV2DeletionExecutionProof,
  type InboxV2DeletionPlan
} from "./privacy-deletion";
import {
  activateInboxV2EffectiveTenantPolicy,
  defineInboxV2LifecycleControlSource,
  defineInboxV2LifecycleControlSnapshot,
  defineInboxV2PolicyActivationLedger,
  defineInboxV2PolicyImpactPreview,
  defineInboxV2PolicyImpactSource,
  defineInboxV2PolicyTemplate,
  evaluateInboxV2Lifecycle,
  resolveInboxV2LifecycleControlSourceProof,
  resolveInboxV2EffectiveTenantPolicy,
  resolveInboxV2PolicyImpactSourceProof,
  type InboxV2EffectiveTenantPolicy
} from "./data-lifecycle-policy";
import { defineInboxV2PrivacyScopeManifest } from "./privacy-hold-restriction";
import { assertInboxV2ClosedJsonSchema } from "./schema-safety";

const tenantId = "tenant:tenant-1";
const requestedAt = "2026-07-12T10:00:00.000Z";
const checkedAt = "2026-07-12T10:30:00.000Z";
const hashA = `sha256:${"a".repeat(64)}`;
const hashB = `sha256:${"b".repeat(64)}`;
const hashC = `sha256:${"c".repeat(64)}`;

function governance() {
  return {
    tenantId,
    id: "core:governance-profile.default",
    version: "1",
    contextHash: hashA
  };
}

function policy() {
  return {
    tenantId,
    id: "core:data-lifecycle-policy.default",
    version: "1",
    policyHash: hashB
  };
}

function entity(entityId = "message:message-1") {
  return { tenantId, entityTypeId: "core:message", entityId };
}

function root(
  dataClassId = "core:message_content_blocks",
  storageRootId = "core:message-content-sql",
  recordId = "data_root:message-1"
) {
  return { tenantId, dataClassId, storageRootId, recordId };
}

function payload(recordId: string, digest = hashA) {
  return {
    tenantId,
    recordId,
    schemaId: "core:privacy-deletion-evidence",
    schemaVersion: "v1",
    digest
  };
}

function authorization(employeeNumber: number, permissionId: string) {
  return {
    tenantId,
    id: `authorization-decision:deletion-${employeeNumber}`,
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
    resourceScopeId: "core:privacy-deletion-plan",
    resource: {
      tenantId,
      entityTypeId: "core:privacy-deletion-plan",
      entityId: "privacy-deletion-plan:plan-1"
    },
    resourceAccessRevision: "1",
    decisionRevision: "1",
    decisionHash: hashA,
    outcome: "allowed" as const,
    decidedAt: requestedAt,
    notAfter: "2026-07-12T12:00:00.000Z"
  };
}

function plan() {
  const value = {
    tenantId,
    id: "privacy-deletion-plan:plan-1",
    revision: "1",
    planHash: hashC,
    cause: "privacy_erasure" as const,
    decisionBasis: {
      kind: "privacy_request" as const,
      request: {
        tenantId,
        requestId: "privacy_request:request-1",
        revision: "4"
      },
      decisionId: "privacy_decision:decision-1",
      decisionRevision: "1",
      decisionDigest: hashB
    },
    lifecycleEvaluationHashes: [hashA],
    scopeKind: "exact" as const,
    scopeManifest: defineInboxV2PrivacyScopeManifest({
      tenantId,
      id: "privacy-scope:scope-1",
      revision: "1",
      frozenAt: requestedAt,
      roots: [
        {
          root: root(
            "core:backup_copy_or_object_version",
            "core:backup-ledger",
            "data_root:backup-1"
          ),
          entity: entity("backup:backup-1"),
          expectedEntityRevision: "2",
          expectedLineageRevision: "2",
          rootKind: "backup" as const,
          boundary: "operated_data_plane" as const,
          copyRole: "backup" as const
        },
        {
          root: root(),
          entity: entity(),
          expectedEntityRevision: "5",
          expectedLineageRevision: "5",
          rootKind: "sql" as const,
          boundary: "operated_data_plane" as const,
          copyRole: "primary" as const
        },
        {
          root: root(
            "core:raw_provider_payload",
            "core:telegram-external-route",
            "data_root:telegram-external-1"
          ),
          entity: entity(),
          expectedEntityRevision: "7",
          expectedLineageRevision: "7",
          rootKind: "external_route" as const,
          boundary: "outside_operated_data_plane" as const,
          copyRole: "external" as const
        }
      ]
    }),
    governance: governance(),
    policy: policy(),
    previewAuthorization: authorization(1, "core:privacy.deletion.preview"),
    approval: {
      kind: "separated_approval" as const,
      authorization: authorization(2, "core:privacy.deletion.approve"),
      approvedAt: "2026-07-12T10:05:00.000Z"
    },
    executeAuthorization: authorization(3, "core:privacy.deletion.execute"),
    requestedAt,
    executeNotBefore: "2026-07-12T10:10:00.000Z",
    operatedCheckpoints: [
      {
        checkpointId: "checkpoint:operated-1",
        target: {
          tenantId,
          root: root(),
          entity: entity(),
          expectedEntityRevision: "5",
          expectedLineageRevision: "5",
          rootKind: "sql" as const,
          boundary: "operated_data_plane" as const,
          action: "purge_content_keep_tombstone" as const,
          deleteHandlerId: "core:lifecycle.message-content-delete",
          verificationHandlerId: "core:lifecycle.message-content-verify",
          sharedParentProof: { kind: "not_shared" as const }
        }
      }
    ],
    backupCheckpoints: [
      {
        checkpointId: "checkpoint:backup-1",
        backupRoot: root(
          "core:backup_copy_or_object_version",
          "core:backup-ledger",
          "data_root:backup-1"
        ),
        entity: entity("backup:backup-1"),
        expectedRootRevision: "2",
        expectedLineageRevision: "2",
        purposeId: "core:legal_claim_or_regulatory_duty",
        policyRuleId: "core:retention-rule.backup",
        policyRuleRevision: "1",
        latestPermittedExpiryAt: "2026-08-16T10:00:00.000Z",
        action: "hard_delete" as const,
        rootKind: "backup" as const,
        boundary: "operated_data_plane" as const,
        expiryLedgerHandlerId: "core:lifecycle.backup-expiry-ledger",
        verificationHandlerId: "core:lifecycle.backup-expiry-verify"
      }
    ],
    externalCheckpoints: [
      {
        checkpointId: "checkpoint:external-1",
        routeId: "core:external-route.telegram",
        root: root(
          "core:raw_provider_payload",
          "core:telegram-external-route",
          "data_root:telegram-external-1"
        ),
        rootKind: "external_route" as const,
        boundary: "outside_operated_data_plane" as const,
        externalDeleteHandlerId: "core:lifecycle.telegram-external-delete",
        target: entity(),
        expectedEntityRevision: "7",
        expectedLineageRevision: "7",
        action: "external_delete_request_then_track" as const
      }
    ]
  };
  return {
    ...value,
    planHash: calculateInboxV2DeletionPlanHash(value)
  };
}

function deletionRegistry() {
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
              id: "core:message-content-sql",
              definition: {
                kind: "sql",
                boundary: "operated_data_plane",
                tenantIsolation: "required",
                versionEnumeration: "not_applicable",
                configurationProfileId: "core:storage-profile.sql"
              }
            },
            {
              id: "core:backup-ledger",
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
              id: "core:lifecycle.message-content",
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
                checksHoldFence: true,
                verifiesAbsence: false
              }
            },
            {
              id: "core:lifecycle.message-content-subject-discovery",
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
              id: "core:lifecycle.message-content-export-projection",
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
              id: "core:lifecycle.message-content-export",
              definition: {
                kind: "export_execution",
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
              id: "core:lifecycle.message-content-delete",
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
              id: "core:lifecycle.message-content-verify",
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
            },
            {
              id: "core:lifecycle.backup",
              definition: {
                kind: "lifecycle",
                supportedRootKinds: ["backup"],
                supportedOperations: ["persist", "delete", "verify_absence"],
                bounded: true,
                idempotent: true,
                checksTenantFence: true,
                checksRevisionFence: true,
                checksHoldFence: true,
                verifiesAbsence: false
              }
            },
            {
              id: "core:lifecycle.backup-subject-discovery",
              definition: {
                kind: "subject_discovery",
                supportedRootKinds: ["backup"],
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
              id: "core:lifecycle.backup-expiry-ledger",
              definition: {
                kind: "delete_execution",
                supportedRootKinds: ["backup"],
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
              id: "core:lifecycle.backup-expiry-verify",
              definition: {
                kind: "verification",
                supportedRootKinds: ["backup"],
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
              dataClassId: "core:message_content_blocks",
              storageRootId: "core:message-content-sql",
              purposeIds: ["core:customer_service_history"],
              operations: ["persist", "export", "delete", "verify_absence"],
              canonicalAnchorId: "core:canonical_item_time",
              lifecycleHandlerId: "core:lifecycle.message-content",
              subjectDiscoveryHandlerId:
                "core:lifecycle.message-content-subject-discovery",
              exportProjectionHandlerId:
                "core:lifecycle.message-content-export-projection",
              exportHandlerId: "core:lifecycle.message-content-export",
              deleteHandlerId: "core:lifecycle.message-content-delete",
              verificationHandlerId: "core:lifecycle.message-content-verify"
            },
            {
              dataClassId: "core:backup_copy_or_object_version",
              storageRootId: "core:backup-ledger",
              purposeIds: ["core:legal_claim_or_regulatory_duty"],
              operations: ["persist", "delete", "verify_absence"],
              canonicalAnchorId: "core:backup_or_version_creation",
              lifecycleHandlerId: "core:lifecycle.backup",
              subjectDiscoveryHandlerId:
                "core:lifecycle.backup-subject-discovery",
              exportProjectionHandlerId: null,
              exportHandlerId: null,
              deleteHandlerId: "core:lifecycle.backup-expiry-ledger",
              verificationHandlerId: "core:lifecycle.backup-expiry-verify"
            }
          ]
        }
      }
    ]
  });
}

function policyActivationAuthorization(
  policy: InboxV2EffectiveTenantPolicy,
  employeeNumber: number
) {
  return {
    tenantId,
    id: `authorization-decision:policy-deletion-${employeeNumber}`,
    authorizationEpoch: `authorization-epoch-policy-deletion-${employeeNumber}`,
    principal: {
      kind: "employee" as const,
      employee: {
        tenantId,
        kind: "employee" as const,
        id: `employee:policy-deletion-${employeeNumber}`
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
  };
}

function backupLifecycleDecision() {
  const registry = deletionRegistry();
  const governanceContext = defineInboxV2DataGovernanceContext({
    tenantId,
    id: "core:governance-profile.deletion",
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
      }
    ],
    jurisdictionProfiles: [{ id: "core:jurisdiction-eu", version: "1" }],
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
    id: "core:deletion-policy-template",
    version: "1",
    deploymentProfile: "saas_shared",
    jurisdictionProfiles: [{ id: "core:jurisdiction-eu", version: "1" }],
    effectiveAt: "2026-01-03T00:00:00.000Z",
    reviewAt: "2027-01-03T00:00:00.000Z",
    rules: [
      {
        id: "core:retention-rule.backup",
        revision: "1",
        dataClassId: "core:backup_copy_or_object_version",
        purposeId: "core:legal_claim_or_regulatory_duty",
        retentionAnchorId: "core:backup_or_version_creation",
        baselineWindow: {
          kind: "fixed_after_anchor",
          period: { kind: "elapsed", seconds: 86_400 }
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
        id: "core:retention-rule.message-content",
        revision: "1",
        dataClassId: "core:message_content_blocks",
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
      }
    ]
  });
  const resolution = resolveInboxV2EffectiveTenantPolicy({
    registry,
    tenantId,
    id: "core:deletion-policy",
    version: "1",
    policyHash: hashA,
    effectiveAt: "2026-02-01T00:00:00.000Z",
    templates: [template],
    governanceContext,
    tenantSelections: [],
    entitlementAllowances: []
  });
  if (resolution.kind !== "resolved") {
    throw new Error(`Deletion policy fixture failed: ${resolution.errorCode}`);
  }
  const candidatePolicy = resolution.policy;
  const impactSource = defineInboxV2PolicyImpactSource({
    id: "core:deletion-policy-impact-source",
    version: "1",
    loadCompleteImpact: () => ({
      sourceSnapshot: {
        streamEpoch: "stream:epoch:deletion-policy",
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
          streamEpoch: "stream:epoch:deletion-policy",
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
      id: "core:deletion-policy-impact-preview",
      revision: "1",
      previewedAt: "2026-02-01T00:00:00.000Z"
    }
  });
  const activationLedger = defineInboxV2PolicyActivationLedger({
    id: "core:deletion-policy-ledger"
  });
  const activatedPolicy = activateInboxV2EffectiveTenantPolicy({
    ledger: activationLedger,
    currentPolicy: null,
    candidatePolicy,
    impactPreview,
    transition: {
      kind: "initial_reviewed_bootstrap",
      reviewedBootstrapProfile: {
        id: "core:deletion-policy-bootstrap",
        version: "1"
      }
    },
    activation: {
      tenantId,
      id: "core:deletion-policy-activation",
      revision: "1",
      requesterAuthorization: policyActivationAuthorization(candidatePolicy, 1),
      approverAuthorization: policyActivationAuthorization(candidatePolicy, 2),
      requestedAt: "2026-02-02T00:00:00.000Z",
      approvedAt: "2026-02-03T00:00:00.000Z",
      notBefore: "2026-02-04T00:00:00.000Z",
      activatedAt: "2026-02-04T00:00:00.000Z",
      reasonCode: "core:deletion-policy-reviewed"
    }
  });
  const policy = activatedPolicy.policy;
  const lifecycleTarget = {
    tenantId,
    root: {
      tenantId,
      dataClassId: "core:backup_copy_or_object_version",
      storageRootId: "core:backup-root",
      recordId: "data_root:backup-1"
    },
    entity: entity("backup:backup-1"),
    entityRevision: "2",
    lineageRevision: "2",
    dataClassId: "core:backup_copy_or_object_version",
    sensitivity: "restricted_content" as const,
    holdEligible: true,
    anchorAt: requestedAt
  };
  const lifecyclePurposes = [
    {
      purposeId: "core:legal_claim_or_regulatory_duty",
      ruleId: "core:retention-rule.backup",
      ruleRevision: "1",
      anchorAt: requestedAt,
      condition: null,
      parentDeadlineSnapshot: null
    }
  ];
  const controlSource = defineInboxV2LifecycleControlSource({
    id: "core:deletion-lifecycle-control-source",
    version: "1",
    loadCompleteControlState: () => ({
      sourceState: {
        streamEpoch: "stream:epoch:deletion-control",
        syncGeneration: "1",
        completeThroughPosition: "110",
        purposeSetRevision: "1",
        legalHoldSetRevision: "1",
        restrictionSetRevision: "1",
        sourceStateHash: hashB
      },
      purposes: lifecyclePurposes,
      holds: [],
      restrictions: [],
      resolvedAt: requestedAt
    })
  });
  const controlProof = resolveInboxV2LifecycleControlSourceProof({
    source: controlSource,
    registry,
    policy,
    target: lifecycleTarget,
    capturedAt: requestedAt
  });
  const controlSnapshot = defineInboxV2LifecycleControlSnapshot({
    registry,
    policy,
    target: lifecycleTarget,
    sourceProof: controlProof,
    snapshot: {
      tenantId,
      id: "core:deletion-lifecycle-control-snapshot",
      revision: "1"
    }
  });
  const evaluation = evaluateInboxV2Lifecycle({
    policy,
    collectionPolicyRef: {
      tenantId,
      id: policy.id,
      version: policy.version,
      policyHash: policy.policyHash
    },
    governanceContext,
    target: lifecycleTarget,
    controlSnapshot,
    registry,
    purposes: lifecyclePurposes,
    holds: [],
    restrictions: [],
    requestedUse: null,
    now: requestedAt
  });
  if (evaluation.outcome === "rejected") {
    throw new Error(
      `Deletion evaluation fixture failed: ${evaluation.errorCode}`
    );
  }
  return {
    registry,
    governanceContext,
    policy,
    activation: activatedPolicy.activation,
    activationLedger,
    template,
    evaluation
  };
}

function supersedeDeletionPolicy(
  authority: ReturnType<typeof backupLifecycleDecision>
) {
  const resolution = resolveInboxV2EffectiveTenantPolicy({
    registry: authority.registry,
    tenantId,
    id: authority.policy.id,
    version: "2",
    policyHash: hashC,
    effectiveAt: "2026-07-12T10:01:00.000Z",
    templates: [authority.template],
    governanceContext: authority.governanceContext,
    tenantSelections: [],
    entitlementAllowances: []
  });
  if (resolution.kind !== "resolved") {
    throw new Error(
      `Superseding policy fixture failed: ${resolution.errorCode}`
    );
  }
  const candidatePolicy = resolution.policy;
  const impactSource = defineInboxV2PolicyImpactSource({
    id: "core:deletion-policy-impact-source.supersede",
    version: "1",
    loadCompleteImpact: () => ({
      sourceSnapshot: {
        streamEpoch: "stream:epoch:deletion-policy-supersede",
        syncGeneration: "1",
        completeThroughPosition: "130",
        snapshotHash: hashC
      },
      affectedRootCount: "0",
      affectedByteCount: "0",
      heldRootCount: "0",
      backupCopyCount: "0",
      earliestDestructiveAt: null,
      resolvedAt: "2026-07-12T10:01:00.000Z"
    }),
    compareAndSetActivationImpact: ({ activatedAt }) => ({
      outcome: "matched",
      currentImpact: {
        sourceSnapshot: {
          streamEpoch: "stream:epoch:deletion-policy-supersede",
          syncGeneration: "1",
          completeThroughPosition: "130",
          snapshotHash: hashC
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
    currentPolicy: authority.policy,
    candidatePolicy
  });
  const impactPreview = defineInboxV2PolicyImpactPreview({
    currentPolicy: authority.policy,
    candidatePolicy,
    sourceProof: impactProof,
    preview: {
      tenantId,
      id: "core:deletion-policy-impact-preview.supersede",
      revision: "1",
      previewedAt: "2026-07-12T10:01:00.000Z"
    }
  });
  return activateInboxV2EffectiveTenantPolicy({
    ledger: authority.activationLedger,
    currentPolicy: authority.policy,
    candidatePolicy,
    impactPreview,
    transition: {
      kind: "supersede_current",
      rollbackOfPolicy: null
    },
    activation: {
      tenantId,
      id: "core:deletion-policy-activation.supersede",
      revision: "1",
      requesterAuthorization: policyActivationAuthorization(candidatePolicy, 3),
      approverAuthorization: policyActivationAuthorization(candidatePolicy, 4),
      requestedAt: "2026-07-12T10:01:00.000Z",
      approvedAt: "2026-07-12T10:02:00.000Z",
      notBefore: "2026-07-12T10:04:00.000Z",
      activatedAt: "2026-07-12T10:05:00.000Z",
      reasonCode: "core:deletion-policy-superseded"
    }
  });
}

function lifecycleBoundBackupPlan(
  lifecycle: ReturnType<typeof backupLifecycleDecision>
): z.input<typeof inboxV2DeletionPlanSchema> {
  const boundedPlan: z.input<typeof inboxV2DeletionPlanSchema> =
    structuredClone(plan());
  boundedPlan.cause = "provider_message_delete";
  boundedPlan.decisionBasis = {
    kind: "provider_lifecycle_event",
    event: {
      tenantId,
      entityTypeId: "core:provider-lifecycle-event",
      entityId: "provider-lifecycle-event:event-1"
    },
    eventRevision: "1",
    eventHash: hashA
  };
  boundedPlan.scopeManifest = defineInboxV2PrivacyScopeManifest({
    ...boundedPlan.scopeManifest,
    roots: boundedPlan.scopeManifest.roots.slice(0, 2)
  });
  boundedPlan.externalCheckpoints = [];
  boundedPlan.governance = {
    tenantId,
    id: lifecycle.governanceContext.id,
    version: lifecycle.governanceContext.version,
    contextHash: lifecycle.governanceContext.contextHash
  };
  boundedPlan.policy = {
    tenantId,
    id: lifecycle.policy.id,
    version: lifecycle.policy.version,
    policyHash: lifecycle.policy.policyHash
  };
  boundedPlan.lifecycleEvaluationHashes = [
    calculateInboxV2DeletionLifecycleEvaluationHash(lifecycle.evaluation)
  ];
  boundedPlan.backupCheckpoints[0]!.latestPermittedExpiryAt =
    lifecycle.evaluation.purposeDeadlines[0]!.backupMaximumAt;
  boundedPlan.planHash = calculateInboxV2DeletionPlanHash(boundedPlan);
  return boundedPlan;
}

function clearFence(
  expectedRevision = "5",
  expectedLineageRevision = expectedRevision
) {
  return {
    tenantId,
    plan: {
      tenantId,
      planId: "privacy-deletion-plan:plan-1",
      revision: "1",
      planHash: plan().planHash
    },
    governance: governance(),
    policy: policy(),
    executionAuthorization: authorization(3, "core:privacy.deletion.execute"),
    revision: {
      kind: "matched" as const,
      expectedRevision,
      observedRevision: expectedRevision
    },
    lineage: {
      kind: "matched" as const,
      expectedRevision: expectedLineageRevision,
      observedRevision: expectedLineageRevision
    },
    hold: { kind: "clear" as const },
    restriction: {
      tenantId,
      restrictions: [],
      evaluatedAt: checkedAt,
      decisionHash: hashC,
      restrictionExtendedRetention: false as const
    },
    checkedAt
  };
}

function operated(
  outcome:
    | z.input<typeof inboxV2OperatedDeletionHandlerOutcomeSchema>["outcome"]
    | undefined = undefined,
  fence: z.input<
    typeof inboxV2OperatedDeletionHandlerOutcomeSchema
  >["fence"] = clearFence()
): z.input<typeof inboxV2OperatedDeletionHandlerOutcomeSchema> {
  return {
    tenantId,
    checkpointId: "checkpoint:operated-1",
    target: root(),
    deleteHandlerId: "core:lifecycle.message-content-delete",
    verificationHandlerId: "core:lifecycle.message-content-verify",
    attempt: "1",
    fence,
    outcome: outcome ?? {
      kind: "verified_absent",
      evidence: payload("deletion-evidence:operated-1")
    },
    checkedAt
  };
}

function backup(
  state: "finite_expiry_pending" | "expiry_verified" = "expiry_verified"
): z.input<typeof inboxV2BackupDeletionOutcomeSchema> {
  return {
    tenantId,
    checkpointId: "checkpoint:backup-1",
    backupRoot: root(
      "core:backup_copy_or_object_version",
      "core:backup-ledger",
      "data_root:backup-1"
    ),
    rootKind: "backup",
    boundary: "operated_data_plane",
    expiryLedgerHandlerId: "core:lifecycle.backup-expiry-ledger",
    verificationHandlerId: "core:lifecycle.backup-expiry-verify",
    attempt: "1",
    fence: clearFence("2"),
    primaryAbsenceEvidence: payload("deletion-evidence:primary-absence", hashB),
    expiryLedgerEvidence: payload("deletion-evidence:backup-ledger", hashC),
    latestPossibleExpiryAt:
      state === "finite_expiry_pending"
        ? "2026-08-12T10:00:00.000Z"
        : "2026-07-11T10:00:00.000Z",
    checkedAt,
    state
  };
}

function external(
  outcome:
    | "requested"
    | "confirmed"
    | "unsupported"
    | "unknown"
    | "failed_retryable"
    | "blocked_by_legal_hold"
    | "stale_revision" = "confirmed"
): z.input<typeof inboxV2ExternalDeletionResidualSchema> {
  return {
    tenantId,
    checkpointId: "checkpoint:external-1",
    routeId: "core:external-route.telegram",
    root: root(
      "core:raw_provider_payload",
      "core:telegram-external-route",
      "data_root:telegram-external-1"
    ),
    boundary: "outside_operated_data_plane",
    externalDeleteHandlerId: "core:lifecycle.telegram-external-delete",
    target: entity(),
    attempt: "1",
    fence: clearFence("7"),
    outcome,
    evidence: payload("deletion-evidence:external-1"),
    nextRetryAt:
      outcome === "failed_retryable" ? "2026-07-12T10:35:00.000Z" : null,
    checkedAt
  };
}

function terminalRun(
  result: z.input<typeof inboxV2DeletionCompletionResultSchema>
) {
  return {
    tenantId,
    id: "privacy-deletion-run:run-1",
    revision: "1",
    plan: {
      tenantId,
      planId: "privacy-deletion-plan:plan-1",
      revision: "1",
      planHash: plan().planHash
    },
    stageOne: {
      state: "content_unavailable" as const,
      targets: [
        {
          checkpointId: "checkpoint:operated-1",
          root: root(),
          entity: entity(),
          expectedRevision: "5",
          resultingRevision: "6",
          tombstoneManifest: payload("deletion-evidence:tombstone"),
          invalidationDigest: hashB,
          committedAt: "2026-07-12T10:15:00.000Z"
        }
      ]
    },
    requiredOperatedCheckpointIds: ["checkpoint:operated-1"],
    requiredBackupCheckpointIds: ["checkpoint:backup-1"],
    requiredExternalCheckpointIds: ["checkpoint:external-1"],
    operatedOutcomes: [operated()],
    backupOutcomes: [backup()],
    externalResiduals: [external()],
    startedAt: "2026-07-12T10:10:00.000Z",
    evaluatedAt: checkedAt,
    state: "terminal" as const,
    result
  };
}

function bindRunToPlan(
  run: ReturnType<typeof terminalRun>,
  deletionPlan: z.input<typeof inboxV2DeletionPlanSchema>
) {
  const reference: typeof run.plan = {
    tenantId: deletionPlan.tenantId,
    planId: deletionPlan.id,
    revision: deletionPlan.revision,
    planHash: deletionPlan.planHash as typeof run.plan.planHash
  };
  run.plan = reference;
  for (const outcome of [
    ...run.operatedOutcomes,
    ...run.backupOutcomes,
    ...run.externalResiduals
  ]) {
    outcome.fence.plan = { ...reference };
    outcome.fence.governance = { ...deletionPlan.governance };
    outcome.fence.policy = { ...deletionPlan.policy };
  }
}

function deletionPlanHandlerIds(deletionPlan: InboxV2DeletionPlan) {
  return [
    ...deletionPlan.operatedCheckpoints.flatMap(({ target }) => [
      target.deleteHandlerId,
      target.verificationHandlerId
    ]),
    ...deletionPlan.backupCheckpoints.flatMap((checkpoint) => [
      checkpoint.expiryLedgerHandlerId,
      checkpoint.verificationHandlerId
    ]),
    ...deletionPlan.externalCheckpoints.map(
      ({ externalDeleteHandlerId }) => externalDeleteHandlerId
    )
  ].filter((value, index, values) => values.indexOf(value) === index);
}

function executionProofFor(input: {
  run: z.input<typeof inboxV2DeletionRunSchema>;
  plan: InboxV2DeletionPlan;
  authority: ReturnType<typeof backupLifecycleDecision>;
  lifecycleEvaluations?: readonly ReturnType<
    typeof backupLifecycleDecision
  >["evaluation"][];
}) {
  const source = defineInboxV2DeletionExecutionSource({
    id: "core:deletion-execution-source.fixture",
    version: "1",
    handlerIds: deletionPlanHandlerIds(input.plan),
    loadCompleteExecution: () => ({
      executionControlHighWater: {
        streamEpoch: "stream:epoch:deletion-execution",
        syncGeneration: "1",
        completeThroughPosition: "120",
        legalHoldSetRevision: "1",
        restrictionSetRevision: "1",
        sourceStateHash: hashC,
        capturedAt: input.run.evaluatedAt
      },
      stageOne: structuredClone(input.run.stageOne),
      operatedOutcomes: structuredClone(input.run.operatedOutcomes),
      backupOutcomes: structuredClone(input.run.backupOutcomes),
      externalResiduals: structuredClone(input.run.externalResiduals),
      resolvedAt: input.run.evaluatedAt
    })
  });
  return resolveInboxV2DeletionExecutionProof({
    source,
    registry: input.authority.registry,
    plan: input.plan,
    policy: input.authority.policy,
    activationLedger: input.authority.activationLedger,
    lifecycleEvaluations: input.lifecycleEvaluations,
    startedAt: input.run.startedAt
  });
}

describe("Inbox V2 deletion and erasure contracts", () => {
  it("accepts approved two-stage deletion and exact envelopes", () => {
    expect(inboxV2DeletionPlanSchema.safeParse(plan()).success).toBe(true);
    expect(
      inboxV2DeletionRunSchema.safeParse(terminalRun("completed")).success
    ).toBe(true);
    expect(
      inboxV2DeletionPlanEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.deletion-plan",
        schemaVersion: "v1",
        payload: plan()
      }).success
    ).toBe(true);
    expect(
      inboxV2DeletionRunEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.deletion-run",
        schemaVersion: "v1",
        payload: terminalRun("completed")
      }).success
    ).toBe(true);
    expect(() =>
      assertInboxV2ClosedJsonSchema(
        inboxV2DeletionPlanSchema,
        "privacy deletion plan"
      )
    ).not.toThrow();
    expect(() =>
      assertInboxV2ClosedJsonSchema(
        inboxV2DeletionRunSchema,
        "privacy deletion run"
      )
    ).not.toThrow();
  });

  it("derives internal, backup and external result taxonomy", () => {
    expect(
      deriveInboxV2DeletionCompletionResult({
        operatedOutcomes: [operated()],
        backupOutcomes: [backup()],
        externalResiduals: [external()]
      })
    ).toBe("completed");
    expect(
      deriveInboxV2DeletionCompletionResult({
        operatedOutcomes: [operated()],
        backupOutcomes: [backup()],
        externalResiduals: [external("unknown")]
      })
    ).toBe("completed_with_external_residuals");
    expect(
      deriveInboxV2DeletionCompletionResult({
        operatedOutcomes: [operated()],
        backupOutcomes: [backup("finite_expiry_pending")],
        externalResiduals: [external("unknown")]
      })
    ).toBe("primary_purged_backup_expiry_pending");
    expect(
      deriveInboxV2DeletionCompletionResult({
        operatedOutcomes: [
          operated({
            kind: "unverified_terminal",
            errorCode: "core:privacy.error.internal-copy-unverified"
          })
        ],
        backupOutcomes: [backup()],
        externalResiduals: [external("unknown")]
      })
    ).toBe("verification_blocked_internal_residual");
    expect(
      deriveInboxV2DeletionCompletionResult({
        operatedOutcomes: [
          operated({
            kind: "failed_retryable",
            errorCode: "core:privacy.error.handler-temporary-failure",
            nextRetryAt: "2026-07-12T10:35:00.000Z"
          })
        ],
        backupOutcomes: [backup()],
        externalResiduals: [external()]
      })
    ).toBe("failed_retryable");
    expect(
      deriveInboxV2DeletionCompletionResult({
        operatedOutcomes: [operated()],
        backupOutcomes: [backup()],
        externalResiduals: [external("failed_retryable")]
      })
    ).toBe("failed_retryable");
  });

  it("rejects caller-selected completion and incomplete proof", () => {
    expect(
      inboxV2DeletionRunSchema.safeParse(
        terminalRun("completed_with_external_residuals")
      ).success
    ).toBe(false);

    const missingBackup = terminalRun("completed");
    missingBackup.backupOutcomes = [];
    expect(inboxV2DeletionRunSchema.safeParse(missingBackup).success).toBe(
      false
    );

    const beforeStageOne = terminalRun("completed");
    Object.assign(beforeStageOne, {
      state: "verification_pending",
      result: null,
      stageOne: { state: "pending" }
    });
    expect(inboxV2DeletionRunSchema.safeParse(beforeStageOne).success).toBe(
      false
    );
  });

  it("keeps legal hold separate and requires the current hold revision/review", () => {
    const blockedFence = {
      ...clearFence(),
      hold: {
        kind: "blocked_by_legal_hold" as const,
        hold: { tenantId, holdId: "privacy-hold:hold-1", revision: "3" },
        reviewAt: "2026-08-01T00:00:00.000Z"
      }
    };
    const blocked = operated({ kind: "blocked_by_legal_hold" }, blockedFence);
    expect(
      deriveInboxV2DeletionCompletionResult({
        operatedOutcomes: [blocked],
        backupOutcomes: [],
        externalResiduals: []
      })
    ).toBeNull();

    const run = terminalRun("completed");
    run.operatedOutcomes = [blocked];
    expect(inboxV2DeletionRunSchema.safeParse(run).success).toBe(false);

    expect(
      inboxV2OperatedDeletionHandlerOutcomeSchema.safeParse({
        ...blocked,
        fence: {
          ...blockedFence,
          hold: {
            kind: "blocked_by_legal_hold",
            reviewAt: blockedFence.hold.reviewAt
          }
        }
      }).success
    ).toBe(false);
  });

  it("requires separated approval, cooling and same-tenant destructive scope", () => {
    expect(
      inboxV2DeletionPlanSchema.safeParse({
        ...plan(),
        approval: { kind: "not_required", reason: "automatic_retention" }
      }).success
    ).toBe(false);
    expect(
      inboxV2DeletionPlanSchema.safeParse({
        ...plan(),
        executeNotBefore: requestedAt
      }).success
    ).toBe(false);
    expect(
      inboxV2DeletionPlanSchema.safeParse({
        ...plan(),
        policy: { ...policy(), tenantId: "tenant:tenant-2" }
      }).success
    ).toBe(false);
    expect(
      inboxV2DeletionPlanSchema.safeParse({
        ...plan(),
        previewAuthorization: authorization(1, "core:privacy.deletion.execute")
      }).success
    ).toBe(false);
    expect(
      inboxV2DeletionPlanSchema.safeParse({
        ...plan(),
        executeAuthorization: {
          ...authorization(3, "core:privacy.deletion.execute"),
          notAfter: "2026-07-12T10:09:00.000Z"
        }
      }).success
    ).toBe(false);
  });

  it("requires a composed registry for every destructive root and handler", () => {
    const authority = backupLifecycleDecision();
    const executablePlan = {
      ...plan(),
      cause: "provider_message_delete" as const,
      decisionBasis: {
        kind: "provider_lifecycle_event" as const,
        event: {
          tenantId,
          entityTypeId: "core:provider-lifecycle-event",
          entityId: "provider-lifecycle-event:event-1"
        },
        eventRevision: "1",
        eventHash: hashA
      },
      lifecycleEvaluationHashes: [],
      scopeManifest: defineInboxV2PrivacyScopeManifest({
        ...plan().scopeManifest,
        roots: [plan().scopeManifest.roots[1]!]
      }),
      backupCheckpoints: [],
      externalCheckpoints: [],
      governance: {
        tenantId,
        id: authority.governanceContext.id,
        version: authority.governanceContext.version,
        contextHash: authority.governanceContext.contextHash
      },
      policy: {
        tenantId,
        id: authority.policy.id,
        version: authority.policy.version,
        policyHash: authority.policy.policyHash
      }
    };
    executablePlan.planHash = calculateInboxV2DeletionPlanHash(executablePlan);
    const validatedPlan = defineInboxV2DeletionPlan({
      plan: executablePlan,
      registry: authority.registry,
      policy: authority.policy,
      activationLedger: authority.activationLedger
    });
    expect(validatedPlan.id).toBe(executablePlan.id);
    const clonedManifestPlan = structuredClone(executablePlan);
    expect(() =>
      defineInboxV2DeletionPlan({
        plan: clonedManifestPlan,
        registry: authority.registry,
        policy: authority.policy,
        activationLedger: authority.activationLedger
      })
    ).toThrow(/authentic frozen privacy scope manifest/u);

    const tamperedPlan = structuredClone(executablePlan);
    tamperedPlan.scopeManifest = executablePlan.scopeManifest;
    tamperedPlan.operatedCheckpoints[0]!.target.expectedLineageRevision = "2";
    expect(() =>
      defineInboxV2DeletionPlan({
        plan: tamperedPlan,
        registry: authority.registry,
        policy: authority.policy,
        activationLedger: authority.activationLedger
      })
    ).toThrow(/canonical destructive scope and fences/u);

    const unboundPrivacyPlan: z.input<typeof inboxV2DeletionPlanSchema> = {
      ...executablePlan,
      cause: "privacy_erasure",
      decisionBasis: plan().decisionBasis
    };
    unboundPrivacyPlan.planHash =
      calculateInboxV2DeletionPlanHash(unboundPrivacyPlan);
    expect(() =>
      defineInboxV2DeletionPlan({
        plan: unboundPrivacyPlan,
        registry: authority.registry,
        policy: authority.policy,
        activationLedger: authority.activationLedger
      })
    ).toThrow(/authentic immutable privacy request/u);

    const executableRun = terminalRun("completed");
    executableRun.requiredBackupCheckpointIds = [];
    executableRun.requiredExternalCheckpointIds = [];
    executableRun.backupOutcomes = [];
    executableRun.externalResiduals = [];
    bindRunToPlan(executableRun, executablePlan);
    const executionProof = executionProofFor({
      run: executableRun,
      plan: validatedPlan,
      authority
    });
    expect(
      defineInboxV2DeletionRun({
        run: executableRun,
        plan: validatedPlan,
        registry: authority.registry,
        policy: authority.policy,
        activationLedger: authority.activationLedger,
        executionProof
      }).id
    ).toBe(executableRun.id);

    const clonedProof = structuredClone(executionProof);
    expect(
      inboxV2DeletionExecutionProofSchema.safeParse(clonedProof).success
    ).toBe(true);
    expect(() =>
      defineInboxV2DeletionRun({
        run: executableRun,
        plan: validatedPlan,
        registry: authority.registry,
        policy: authority.policy,
        activationLedger: authority.activationLedger,
        executionProof: clonedProof
      })
    ).toThrow(/execution-source proof/u);

    const forgedRun = structuredClone(executableRun);
    if (forgedRun.operatedOutcomes[0]!.outcome.kind !== "verified_absent") {
      throw new Error("Expected verified-absence fixture.");
    }
    forgedRun.operatedOutcomes[0]!.outcome.evidence.digest = hashC;
    const forgedProof: z.input<typeof inboxV2DeletionExecutionProofSchema> =
      structuredClone(executionProof);
    forgedProof.operatedOutcomes = structuredClone(forgedRun.operatedOutcomes);
    forgedProof.outcomesHash = calculateInboxV2DeletionOutcomesProofHash({
      operatedOutcomes: forgedProof.operatedOutcomes,
      backupOutcomes: forgedProof.backupOutcomes,
      externalResiduals: forgedProof.externalResiduals
    });
    forgedProof.proofHash =
      calculateInboxV2DeletionExecutionProofHash(forgedProof);
    expect(
      inboxV2DeletionExecutionProofSchema.safeParse(forgedProof).success
    ).toBe(true);
    expect(() =>
      defineInboxV2DeletionRun({
        run: forgedRun,
        plan: validatedPlan,
        registry: authority.registry,
        policy: authority.policy,
        activationLedger: authority.activationLedger,
        executionProof: forgedProof
      })
    ).toThrow(/execution-source proof/u);

    const holdEvidenceRun: z.input<typeof inboxV2DeletionRunSchema> =
      structuredClone(executableRun);
    holdEvidenceRun.operatedOutcomes[0]!.outcome = {
      kind: "blocked_by_legal_hold"
    };
    holdEvidenceRun.operatedOutcomes[0]!.fence.hold = {
      kind: "blocked_by_legal_hold",
      hold: { tenantId, holdId: "privacy-hold:new-hold", revision: "1" },
      reviewAt: "2026-08-01T00:00:00.000Z"
    };
    Object.assign(holdEvidenceRun, {
      state: "verification_pending",
      result: null
    });
    const newHoldProof = executionProofFor({
      run: holdEvidenceRun,
      plan: validatedPlan,
      authority
    });
    expect(() =>
      defineInboxV2DeletionRun({
        run: executableRun,
        plan: validatedPlan,
        registry: authority.registry,
        policy: authority.policy,
        activationLedger: authority.activationLedger,
        executionProof: newHoldProof
      })
    ).toThrow(/execution-source proof/u);

    const selfDeclaredCoverage = structuredClone(executableRun);
    selfDeclaredCoverage.requiredOperatedCheckpointIds = [
      "checkpoint:forged-operated"
    ];
    if (selfDeclaredCoverage.stageOne.state === "content_unavailable") {
      selfDeclaredCoverage.stageOne.targets[0]!.checkpointId =
        "checkpoint:forged-operated";
    }
    selfDeclaredCoverage.operatedOutcomes[0]!.checkpointId =
      "checkpoint:forged-operated";
    expect(
      inboxV2DeletionRunSchema.safeParse(selfDeclaredCoverage).success
    ).toBe(true);
    expect(() =>
      defineInboxV2DeletionRun({
        run: selfDeclaredCoverage,
        plan: validatedPlan,
        registry: authority.registry,
        policy: authority.policy,
        activationLedger: authority.activationLedger,
        executionProof
      })
    ).toThrow(/execution-source proof/u);

    const wrongRoot = structuredClone(executableRun);
    wrongRoot.operatedOutcomes[0]!.target.recordId = "data_root:other";
    expect(() =>
      defineInboxV2DeletionRun({
        run: wrongRoot,
        plan: validatedPlan,
        registry: authority.registry,
        policy: authority.policy,
        activationLedger: authority.activationLedger,
        executionProof
      })
    ).toThrow(/execution-source proof/u);

    const wrongFencePlan = structuredClone(executableRun);
    wrongFencePlan.operatedOutcomes[0]!.fence.plan.planHash = hashA;
    expect(() =>
      defineInboxV2DeletionRun({
        run: wrongFencePlan,
        plan: validatedPlan,
        registry: authority.registry,
        policy: authority.policy,
        activationLedger: authority.activationLedger,
        executionProof
      })
    ).toThrow(/execution-source proof/u);

    const emptyRegistry = defineInboxV2DataLifecycleRegistry();
    expect(() =>
      defineInboxV2DeletionPlan({
        plan: executablePlan,
        registry: emptyRegistry,
        policy: authority.policy,
        activationLedger: authority.activationLedger
      })
    ).toThrow(/activated-policy composition/u);

    const unknownClass = structuredClone(executablePlan);
    unknownClass.operatedCheckpoints[0]!.target.root.dataClassId =
      "core:unknown_data_class";
    unknownClass.scopeManifest.roots[0]!.root.dataClassId =
      "core:unknown_data_class" as (typeof unknownClass.scopeManifest.roots)[number]["root"]["dataClassId"];
    unknownClass.scopeManifest = defineInboxV2PrivacyScopeManifest(
      unknownClass.scopeManifest
    );
    unknownClass.planHash = calculateInboxV2DeletionPlanHash(unknownClass);
    expect(() =>
      defineInboxV2DeletionPlan({
        plan: unknownClass,
        registry: authority.registry,
        policy: authority.policy,
        activationLedger: authority.activationLedger
      })
    ).toThrow(/Unknown deletion data class/u);
  });

  it("never labels unproven backups as a bounded tail", () => {
    expect(
      inboxV2BackupDeletionOutcomeSchema.safeParse({
        ...backup("finite_expiry_pending"),
        primaryAbsenceEvidence: undefined
      }).success
    ).toBe(false);
    expect(
      inboxV2BackupDeletionOutcomeSchema.safeParse({
        ...backup("finite_expiry_pending"),
        state: "expiry_verified"
      }).success
    ).toBe(false);
    expect(
      inboxV2ExternalDeletionResidualSchema.safeParse({
        ...external("unknown"),
        boundary: "operated_data_plane"
      }).success
    ).toBe(false);
    const staleBackup = backup();
    staleBackup.fence.revision = {
      kind: "stale",
      expectedRevision: "2",
      observedRevision: "3"
    };
    expect(
      inboxV2BackupDeletionOutcomeSchema.safeParse(staleBackup).success
    ).toBe(false);
    const staleLineageBackup = backup();
    staleLineageBackup.fence.lineage = {
      kind: "stale",
      expectedRevision: "2",
      observedRevision: "3"
    };
    expect(
      inboxV2BackupDeletionOutcomeSchema.safeParse(staleLineageBackup).success
    ).toBe(false);

    const overlongBackupRun = terminalRun(
      "primary_purged_backup_expiry_pending"
    );
    const lifecycle = backupLifecycleDecision();
    const boundedBackupPlan: z.input<typeof inboxV2DeletionPlanSchema> =
      structuredClone(plan());
    boundedBackupPlan.cause = "provider_message_delete";
    boundedBackupPlan.decisionBasis = {
      kind: "provider_lifecycle_event",
      event: {
        tenantId,
        entityTypeId: "core:provider-lifecycle-event",
        entityId: "provider-lifecycle-event:event-1"
      },
      eventRevision: "1",
      eventHash: hashA
    };
    boundedBackupPlan.scopeManifest = defineInboxV2PrivacyScopeManifest({
      ...boundedBackupPlan.scopeManifest,
      roots: boundedBackupPlan.scopeManifest.roots.slice(0, 2)
    });
    boundedBackupPlan.externalCheckpoints = [];
    boundedBackupPlan.governance = {
      tenantId,
      id: lifecycle.governanceContext.id,
      version: lifecycle.governanceContext.version,
      contextHash: lifecycle.governanceContext.contextHash
    };
    boundedBackupPlan.policy = {
      tenantId,
      id: lifecycle.policy.id,
      version: lifecycle.policy.version,
      policyHash: lifecycle.policy.policyHash
    };
    boundedBackupPlan.lifecycleEvaluationHashes = [
      calculateInboxV2DeletionLifecycleEvaluationHash(lifecycle.evaluation)
    ];
    boundedBackupPlan.backupCheckpoints[0]!.latestPermittedExpiryAt =
      lifecycle.evaluation.purposeDeadlines[0]!.backupMaximumAt;
    boundedBackupPlan.planHash =
      calculateInboxV2DeletionPlanHash(boundedBackupPlan);
    const overlongBackup = backup("finite_expiry_pending");
    if (overlongBackup.state !== "finite_expiry_pending") {
      throw new Error("Expected a pending backup fixture.");
    }
    overlongBackup.latestPossibleExpiryAt = "2126-08-12T10:00:00.000Z";
    overlongBackupRun.backupOutcomes = [overlongBackup];
    overlongBackupRun.requiredExternalCheckpointIds = [];
    overlongBackupRun.externalResiduals = [];
    for (const outcome of [
      ...overlongBackupRun.operatedOutcomes,
      ...overlongBackupRun.backupOutcomes
    ]) {
      outcome.fence.governance = boundedBackupPlan.governance;
      outcome.fence.policy = boundedBackupPlan.policy;
    }
    bindRunToPlan(overlongBackupRun, boundedBackupPlan);
    expect(inboxV2DeletionRunSchema.safeParse(overlongBackupRun).success).toBe(
      true
    );
    const validatedBoundedPlan = defineInboxV2DeletionPlan({
      plan: boundedBackupPlan,
      registry: lifecycle.registry,
      policy: lifecycle.policy,
      activationLedger: lifecycle.activationLedger,
      lifecycleEvaluations: [lifecycle.evaluation]
    });
    const overlongExecutionProof = executionProofFor({
      run: overlongBackupRun,
      plan: validatedBoundedPlan,
      authority: lifecycle,
      lifecycleEvaluations: [lifecycle.evaluation]
    });
    expect(() =>
      defineInboxV2DeletionRun({
        run: overlongBackupRun,
        plan: validatedBoundedPlan,
        registry: lifecycle.registry,
        policy: lifecycle.policy,
        activationLedger: lifecycle.activationLedger,
        lifecycleEvaluations: [lifecycle.evaluation],
        executionProof: overlongExecutionProof
      })
    ).toThrow(/does not match its plan checkpoint/u);
    const blockedExternal = external();
    blockedExternal.fence.hold = {
      kind: "blocked_by_legal_hold",
      hold: { tenantId, holdId: "privacy-hold:hold-1", revision: "3" },
      reviewAt: "2026-08-01T00:00:00.000Z"
    };
    expect(
      inboxV2ExternalDeletionResidualSchema.safeParse(blockedExternal).success
    ).toBe(false);
    expect(
      deriveInboxV2DeletionCompletionResult({
        operatedOutcomes: [operated()],
        backupOutcomes: [staleBackup],
        externalResiduals: [blockedExternal]
      })
    ).toBe("verification_blocked_internal_residual");
    expect(
      inboxV2OperatedDeletionHandlerOutcomeSchema.safeParse({
        ...operated(),
        fence: {
          ...clearFence(),
          restriction: {
            ...clearFence().restriction,
            restrictionExtendedRetention: true
          }
        }
      }).success
    ).toBe(false);
    const expiredExecutionFence = clearFence();
    expiredExecutionFence.executionAuthorization.notAfter = checkedAt;
    expect(
      inboxV2OperatedDeletionHandlerOutcomeSchema.safeParse({
        ...operated(),
        fence: expiredExecutionFence
      }).success
    ).toBe(false);
  });

  it("rejects a retained v1 evaluation and plan after v2 supersession", () => {
    const lifecycle = backupLifecycleDecision();
    const v1PlanInput = lifecycleBoundBackupPlan(lifecycle);
    const v1Plan = defineInboxV2DeletionPlan({
      plan: v1PlanInput,
      registry: lifecycle.registry,
      policy: lifecycle.policy,
      activationLedger: lifecycle.activationLedger,
      lifecycleEvaluations: [lifecycle.evaluation]
    });
    const v1Run = terminalRun("completed");
    v1Run.requiredExternalCheckpointIds = [];
    v1Run.externalResiduals = [];
    bindRunToPlan(v1Run, v1PlanInput);
    const v1ExecutionProof = executionProofFor({
      run: v1Run,
      plan: v1Plan,
      authority: lifecycle,
      lifecycleEvaluations: [lifecycle.evaluation]
    });

    const v2 = supersedeDeletionPolicy(lifecycle);
    expect(v2.policy.version).toBe("2");
    expect(() =>
      defineInboxV2DeletionPlan({
        plan: v1PlanInput,
        registry: lifecycle.registry,
        policy: lifecycle.policy,
        activationLedger: lifecycle.activationLedger,
        lifecycleEvaluations: [lifecycle.evaluation]
      })
    ).toThrow(/currently activated lifecycle policy/u);
    expect(() =>
      defineInboxV2DeletionRun({
        run: v1Run,
        plan: v1Plan,
        registry: lifecycle.registry,
        policy: lifecycle.policy,
        activationLedger: lifecycle.activationLedger,
        lifecycleEvaluations: [lifecycle.evaluation],
        executionProof: v1ExecutionProof
      })
    ).toThrow(/currently activated lifecycle policy/u);
  });
});
