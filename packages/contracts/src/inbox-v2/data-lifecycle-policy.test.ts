import { describe, expect, it } from "vitest";

import { defineInboxV2DataLifecycleRegistry } from "./data-lifecycle-catalog";
import { defineInboxV2DataGovernanceContext } from "./data-governance";
import {
  activateInboxV2EffectiveTenantPolicy,
  defineInboxV2LifecycleControlSource,
  defineInboxV2LifecycleControlSnapshot,
  defineInboxV2PolicyActivationLedger,
  defineInboxV2PolicyImpactSource,
  defineInboxV2PolicyImpactPreview,
  defineInboxV2PolicyTemplate,
  evaluateInboxV2Lifecycle,
  inboxV2DataLifecyclePolicySchema,
  inboxV2EffectiveTenantPolicySchema,
  inboxV2LifecycleControlSnapshotSchema,
  inboxV2LifecycleEvaluationSchema,
  inboxV2PolicyActivationSchema,
  inboxV2PolicyImpactPreviewSchema,
  inboxV2PolicyTemplateSchema,
  isInboxV2ActivatedEffectiveTenantPolicy,
  isInboxV2EffectiveTenantPolicy,
  isInboxV2LifecycleEvaluation,
  isInboxV2PolicyTemplate,
  resolveInboxV2LifecycleControlSourceProof,
  resolveInboxV2EffectiveTenantPolicy,
  resolveInboxV2PolicyImpactSourceProof,
  type InboxV2PolicyActivationLedger,
  type InboxV2EffectiveTenantPolicy
} from "./data-lifecycle-policy";
import { defineInboxV2PrivacyScopeManifest } from "./privacy-hold-restriction";
import { assertInboxV2ClosedJsonSchema } from "./schema-safety";

const tenantId = "tenant:tenant-1";
const policyHash = `sha256:${"c".repeat(64)}`;
const dataClassId = "core:message_content_blocks";
const customerPurpose = "core:customer_service_history";
const legalPurpose = "core:legal_claim_or_regulatory_duty";

function lifecycleRegistry() {
  return defineInboxV2DataLifecycleRegistry({
    coreLifecycleHandlerRegistrations: [
      {
        schemaId: "core:inbox-v2.catalog-registration",
        schemaVersion: "v1",
        payload: {
          catalog: "lifecycle-handler",
          owner: { kind: "core" },
          entries: [
            {
              id: "core:condition-resolver",
              definition: {
                kind: "condition_resolution",
                supportedRootKinds: ["sql" as const],
                supportedOperations: ["read"],
                bounded: true as const,
                idempotent: true,
                checksTenantFence: true,
                checksRevisionFence: true,
                checksHoldFence: false,
                verifiesAbsence: false
              }
            },
            {
              id: "core:prospective-scope-matcher",
              definition: {
                kind: "scope_matcher",
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
              id: "core:parent-deadline-resolver",
              definition: {
                kind: "lifecycle",
                supportedRootKinds: ["sql"],
                supportedOperations: ["read"],
                bounded: true,
                idempotent: true as const,
                checksTenantFence: true as const,
                checksRevisionFence: true as const,
                checksHoldFence: true as const,
                verifiesAbsence: false
              }
            }
          ]
        }
      }
    ]
  });
}

function lifecycleRegistryWithCustomerUse() {
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
              id: "core:policy-message-sql",
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
              id: "core:policy-message-lifecycle",
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
              id: "core:condition-resolver",
              definition: {
                kind: "condition_resolution",
                supportedRootKinds: ["sql"],
                supportedOperations: ["read"],
                bounded: true,
                idempotent: true,
                checksTenantFence: true,
                checksRevisionFence: true,
                checksHoldFence: false,
                verifiesAbsence: false
              }
            },
            {
              id: "core:prospective-scope-matcher",
              definition: {
                kind: "scope_matcher",
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
            ...(
              [
                ["subject-discovery", "subject_discovery", "read", false],
                ["export-projection", "export_projection", "export", false],
                ["export", "export_execution", "export", false],
                ["delete", "delete_execution", "delete", false],
                ["verify", "verification", "verify_absence", true]
              ] as const
            ).map(([suffix, kind, operation, verifiesAbsence]) => ({
              id: `core:policy-message-${suffix}`,
              definition: {
                kind,
                supportedRootKinds: ["sql" as const],
                supportedOperations: [operation],
                bounded: true as const,
                idempotent: true as const,
                checksTenantFence: true as const,
                checksRevisionFence: true as const,
                checksHoldFence: true as const,
                verifiesAbsence
              }
            }))
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
              dataClassId,
              storageRootId: "core:policy-message-sql",
              purposeIds: [customerPurpose],
              operations: ["persist", "export", "delete", "verify_absence"],
              canonicalAnchorId: "core:canonical_item_time",
              lifecycleHandlerId: "core:policy-message-lifecycle",
              subjectDiscoveryHandlerId:
                "core:policy-message-subject-discovery",
              exportProjectionHandlerId:
                "core:policy-message-export-projection",
              exportHandlerId: "core:policy-message-export",
              deleteHandlerId: "core:policy-message-delete",
              verificationHandlerId: "core:policy-message-verify"
            }
          ]
        }
      }
    ]
  });
}

function lifecycleRegistryWithModuleAiUse() {
  const prefix = "module:policy-ai-provider";
  const handler = (
    kind:
      | "lifecycle"
      | "subject_discovery"
      | "export_projection"
      | "export_execution"
      | "delete_execution"
      | "verification"
      | "migration_uninstall",
    supportedOperations: Array<
      "read" | "persist" | "export" | "delete" | "verify_absence"
    >,
    verifiesAbsence = false
  ) => ({
    kind,
    supportedRootKinds: ["object" as const],
    supportedOperations,
    bounded: true as const,
    idempotent: true as const,
    checksTenantFence: true as const,
    checksRevisionFence: true as const,
    checksHoldFence: true,
    verifiesAbsence
  });
  return defineInboxV2DataLifecycleRegistry({
    moduleContributions: [
      {
        schemaId: "core:inbox-v2.module-data-governance",
        schemaVersion: "v1",
        payload: {
          moduleId: "policy-ai-provider",
          dataHandling: "tenant_or_customer_data",
          processingPurposes: [
            {
              id: `${prefix}:enrichment`,
              definition: {
                responsibilityRoleRequired: true,
                subjectDiscoveryRequired: true,
                parentCorePurposeId: "core:ai_or_transcription"
              }
            }
          ],
          retentionRules: [
            {
              id: `${prefix}:output-rule`,
              definition: {
                revision: "1",
                dataClassId: `${prefix}:output`,
                purposeId: `${prefix}:enrichment`,
                retentionAnchorId: "core:source_parent_or_last_required_use",
                baselineWindow: {
                  kind: "inherits_all_live_parents",
                  maximumAdditionalPeriod: {
                    kind: "elapsed",
                    seconds: 86_400
                  }
                },
                actionAtExpiry: "hard_delete",
                backupMaximum: { kind: "elapsed", seconds: 3_024_000 },
                holdEligible: true,
                lifecycleHandlerId: `${prefix}:lifecycle`,
                deleteHandlerId: `${prefix}:delete`,
                verificationHandlerId: `${prefix}:verify`
              }
            }
          ],
          retentionAnchors: [],
          handlers: [
            {
              id: `${prefix}:lifecycle`,
              definition: handler("lifecycle", [
                "persist",
                "export",
                "delete",
                "verify_absence"
              ])
            },
            {
              id: `${prefix}:subject-discovery`,
              definition: handler("subject_discovery", ["read"])
            },
            {
              id: `${prefix}:export-projection`,
              definition: handler("export_projection", ["export"])
            },
            {
              id: `${prefix}:export`,
              definition: handler("export_execution", ["export"])
            },
            {
              id: `${prefix}:delete`,
              definition: handler("delete_execution", ["delete"])
            },
            {
              id: `${prefix}:verify`,
              definition: handler("verification", ["verify_absence"], true)
            },
            {
              id: `${prefix}:migration-uninstall`,
              definition: handler("migration_uninstall", ["read"])
            }
          ],
          storageRoots: [
            {
              id: `${prefix}:objects`,
              definition: {
                kind: "object",
                boundary: "operated_data_plane",
                tenantIsolation: "required",
                versionEnumeration: "supported",
                configurationProfileId: `${prefix}:storage-profile`
              }
            }
          ],
          dataClasses: [
            {
              id: `${prefix}:output`,
              parentCoreClassId: "core:ai_prompt_output_embedding",
              storageRootIds: [`${prefix}:objects`],
              sensitivity: "restricted_content",
              allowedPurposeIds: [`${prefix}:enrichment`],
              parentBehavior: "inherits_all_live_parents",
              canonicalAnchorId: null,
              retentionRuleRefs: [
                { id: `${prefix}:output-rule`, revision: "1" }
              ],
              subjectLinkBehavior: "inherits_from_parent",
              exportBehavior: "normalized_projection",
              holdEligible: true,
              allowedExpiryActions: ["hard_delete"],
              immediateTerminalPurge: false,
              lifecycleHandlerId: `${prefix}:lifecycle`,
              subjectDiscoveryHandlerId: `${prefix}:subject-discovery`,
              exportProjectionHandlerId: `${prefix}:export-projection`,
              exportHandlerId: `${prefix}:export`,
              deleteHandlerId: `${prefix}:delete`,
              verificationHandlerId: `${prefix}:verify`
            }
          ],
          dataUses: [
            {
              dataClassId: `${prefix}:output`,
              storageRootId: `${prefix}:objects`,
              purposeIds: [`${prefix}:enrichment`],
              operations: ["persist", "export", "delete", "verify_absence"],
              canonicalAnchorId: "core:source_parent_or_last_required_use",
              lifecycleHandlerId: `${prefix}:lifecycle`,
              subjectDiscoveryHandlerId: `${prefix}:subject-discovery`,
              exportProjectionHandlerId: `${prefix}:export-projection`,
              exportHandlerId: `${prefix}:export`,
              deleteHandlerId: `${prefix}:delete`,
              verificationHandlerId: `${prefix}:verify`
            }
          ],
          externalRoutes: [],
          migrationAndUninstallHandlerId: `${prefix}:migration-uninstall`
        }
      }
    ]
  });
}

function governanceContext() {
  return defineInboxV2DataGovernanceContext({
    tenantId,
    id: "core:governance-profile",
    version: "2",
    policyRevision: "4",
    deploymentProfile: "saas_shared" as const,
    rolesByPurpose: [
      {
        purposeId: customerPurpose,
        roles: [{ regime: "eu" as const, role: "controller" as const }],
        lawfulBasisReferenceCode: "core:basis.customer-service",
        customerInstructionReferenceCode: null
      },
      {
        purposeId: legalPurpose,
        roles: [{ regime: "eu" as const, role: "controller" as const }],
        lawfulBasisReferenceCode: "core:basis.legal-claim",
        customerInstructionReferenceCode: null
      }
    ],
    jurisdictionProfiles: [{ id: "core:jurisdiction-eu", version: "3" }],
    residencyRegionIds: ["core:region-eu"],
    crossBorderRouteIds: [],
    timeZone: "Europe/Berlin",
    tzdbVersion: "2026a",
    calendarPeriodResolver: {
      id: "core:calendar-resolver",
      version: "6"
    },
    calendarBoundaryPolicy: {
      monthOverflow: "constrain" as const,
      ambiguousLocalTime: "reject" as const,
      nonexistentLocalTime: "reject" as const,
      businessDayAnchor: "exclusive" as const
    },
    businessCalendars: [{ id: "core:calendar-eu", version: "5" }],
    requestSlaProfile: { id: "core:request-sla-eu", version: "2" },
    industryProfiles: [],
    approvedAt: "2026-01-01T00:00:00.000Z",
    effectiveAt: "2026-02-01T00:00:00.000Z",
    reviewAt: "2027-02-01T00:00:00.000Z"
  });
}

function moduleGovernanceContext() {
  const context = structuredClone(governanceContext());
  return defineInboxV2DataGovernanceContext({
    ...context,
    id: "module:policy-ai-provider:governance-profile",
    rolesByPurpose: [
      {
        purposeId: "module:policy-ai-provider:enrichment",
        roles: [{ regime: "eu" as const, role: "processor" as const }],
        lawfulBasisReferenceCode: "module:policy-ai-provider:basis.enrichment",
        customerInstructionReferenceCode:
          "module:policy-ai-provider:instruction.enrichment"
      }
    ]
  });
}

function rule(input: {
  id: string;
  purposeId: string;
  baselineDays?: number;
  legalMinimumDays?: number | null;
  legalMaximumDays?: number | null;
  calendar?: boolean;
}) {
  return {
    id: input.id,
    revision: "1",
    dataClassId,
    purposeId: input.purposeId,
    retentionAnchorId: "core:canonical_item_time",
    baselineWindow: {
      kind: "fixed_after_anchor" as const,
      period: input.calendar
        ? ({ kind: "calendar" as const, years: 0, months: 1, days: 0 } as const)
        : ({
            kind: "elapsed" as const,
            seconds: (input.baselineDays ?? 10) * 86_400
          } as const)
    },
    actionAtExpiry: "purge_content_keep_tombstone" as const,
    backupMaximum: { kind: "elapsed" as const, seconds: 35 * 86_400 },
    legalMinimum:
      input.legalMinimumDays === null || input.legalMinimumDays === undefined
        ? null
        : {
            kind: "elapsed" as const,
            seconds: input.legalMinimumDays * 86_400
          },
    legalMaximum:
      input.legalMaximumDays === null || input.legalMaximumDays === undefined
        ? null
        : {
            kind: "elapsed" as const,
            seconds: input.legalMaximumDays * 86_400
          },
    allowTenantShorter: true,
    allowTenantLonger: true,
    holdEligible: true
  };
}

function template(rules: unknown[] = defaultRules()) {
  return defineInboxV2PolicyTemplate({
    kind: "template" as const,
    id: "core:message-policy-template",
    version: "3",
    deploymentProfile: "saas_shared" as const,
    jurisdictionProfiles: [{ id: "core:jurisdiction-eu", version: "3" }],
    effectiveAt: "2026-03-01T00:00:00.000Z",
    reviewAt: "2027-03-01T00:00:00.000Z",
    rules: rules as Parameters<typeof defineInboxV2PolicyTemplate>[0]["rules"]
  });
}

function defaultRules() {
  return [
    rule({
      id: "core:message-customer-rule",
      purposeId: customerPurpose,
      baselineDays: 10
    }),
    rule({
      id: "core:message-legal-rule",
      purposeId: legalPurpose,
      baselineDays: 60,
      legalMaximumDays: 20
    })
  ];
}

function resolvePolicy(input?: {
  rules?: unknown[];
  tenantSelections?: unknown[];
  entitlementAllowances?: unknown[];
  registry?: ReturnType<typeof lifecycleRegistry>;
}): InboxV2EffectiveTenantPolicy {
  return activateBootstrapPolicy(resolvePolicyCandidate(input));
}

function resolvePolicyCandidate(input?: {
  version?: string;
  rules?: unknown[];
  tenantSelections?: unknown[];
  entitlementAllowances?: unknown[];
  registry?: ReturnType<typeof lifecycleRegistry>;
}): InboxV2EffectiveTenantPolicy {
  const result = resolveInboxV2EffectiveTenantPolicy({
    registry: input?.registry ?? lifecycleRegistryWithCustomerUse(),
    tenantId,
    id: "core:tenant-message-policy",
    version: input?.version ?? "8",
    policyHash,
    effectiveAt: "2026-03-01T00:00:00.000Z",
    templates: [template(input?.rules)],
    governanceContext: governanceContext(),
    tenantSelections: input?.tenantSelections ?? [],
    entitlementAllowances: input?.entitlementAllowances ?? []
  });
  if (result.kind !== "resolved") {
    throw new Error(`Policy did not resolve: ${result.errorCode}`);
  }
  return result.policy;
}

function policyAuthorization(
  policy: InboxV2EffectiveTenantPolicy,
  employeeNumber: number
) {
  return {
    tenantId,
    id: `authorization-decision:policy-${employeeNumber}`,
    authorizationEpoch: `authorization-epoch-policy-${employeeNumber}`,
    principal: {
      kind: "employee" as const,
      employee: {
        tenantId,
        kind: "employee" as const,
        id: `employee:policy-${employeeNumber}`
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
    decisionHash: `sha256:${String(employeeNumber).repeat(64)}`,
    outcome: "allowed" as const,
    decidedAt: "2026-03-01T00:00:00.000Z",
    notAfter: "2027-01-01T00:00:00.000Z"
  };
}

function impactPreview(
  candidatePolicy: InboxV2EffectiveTenantPolicy,
  currentPolicy: InboxV2EffectiveTenantPolicy | null = null,
  earliestDestructiveAt: string | null = null
) {
  const source = defineInboxV2PolicyImpactSource({
    id: "core:policy-impact-source",
    version: "1",
    loadCompleteImpact: () => ({
      sourceSnapshot: {
        streamEpoch: "stream:epoch:0001",
        syncGeneration: "1",
        completeThroughPosition: "100",
        snapshotHash: `sha256:${"7".repeat(64)}`
      },
      affectedRootCount: "0",
      affectedByteCount: "0",
      heldRootCount: "0",
      backupCopyCount: "0",
      earliestDestructiveAt,
      resolvedAt: "2026-03-01T00:00:00.000Z"
    }),
    compareAndSetActivationImpact: ({ activatedAt }) => ({
      outcome: "matched",
      currentImpact: {
        sourceSnapshot: {
          streamEpoch: "stream:epoch:0001",
          syncGeneration: "1",
          completeThroughPosition: "100",
          snapshotHash: `sha256:${"7".repeat(64)}`
        },
        affectedRootCount: "0",
        affectedByteCount: "0",
        heldRootCount: "0",
        backupCopyCount: "0",
        earliestDestructiveAt,
        resolvedAt: activatedAt
      }
    })
  });
  const sourceProof = resolveInboxV2PolicyImpactSourceProof({
    source,
    currentPolicy,
    candidatePolicy
  });
  return defineInboxV2PolicyImpactPreview({
    currentPolicy,
    candidatePolicy,
    sourceProof,
    preview: {
      tenantId,
      id: `core:policy-impact-preview-${candidatePolicy.version}`,
      revision: "1",
      previewedAt: "2026-03-01T00:00:00.000Z"
    }
  });
}

function activateBootstrapPolicy(
  candidatePolicy: InboxV2EffectiveTenantPolicy,
  ledger: InboxV2PolicyActivationLedger = defineInboxV2PolicyActivationLedger({
    id: `core:policy-ledger-${candidatePolicy.version}`
  })
) {
  return activateInboxV2EffectiveTenantPolicy({
    ledger,
    currentPolicy: null,
    candidatePolicy,
    impactPreview: impactPreview(candidatePolicy),
    transition: {
      kind: "initial_reviewed_bootstrap",
      reviewedBootstrapProfile: {
        id: "core:policy-bootstrap-reviewed",
        version: "1"
      }
    },
    activation: {
      tenantId,
      id: `core:policy-activation-${candidatePolicy.version}`,
      revision: "1",
      requesterAuthorization: policyAuthorization(candidatePolicy, 1),
      approverAuthorization: policyAuthorization(candidatePolicy, 2),
      requestedAt: "2026-03-02T00:00:00.000Z",
      approvedAt: "2026-03-03T00:00:00.000Z",
      notBefore: "2026-03-04T00:00:00.000Z",
      activatedAt: "2026-03-04T00:00:00.000Z",
      reasonCode: "core:policy-activation-reviewed"
    }
  }).policy;
}

function activateSupersedingPolicy(input: {
  ledger: InboxV2PolicyActivationLedger;
  currentPolicy: InboxV2EffectiveTenantPolicy;
  candidatePolicy: InboxV2EffectiveTenantPolicy;
  activationId?: string;
  requesterEmployee?: number;
  approverEmployee?: number;
  approvedAt?: string;
  notBefore?: string;
  activatedAt?: string;
}) {
  return activateInboxV2EffectiveTenantPolicy({
    ledger: input.ledger,
    currentPolicy: input.currentPolicy,
    candidatePolicy: input.candidatePolicy,
    impactPreview: impactPreview(
      input.candidatePolicy,
      input.currentPolicy,
      "2026-04-01T00:00:00.000Z"
    ),
    transition: { kind: "supersede_current", rollbackOfPolicy: null },
    activation: {
      tenantId,
      id:
        input.activationId ??
        `core:policy-activation-${input.candidatePolicy.version}`,
      revision: "1",
      requesterAuthorization: policyAuthorization(
        input.candidatePolicy,
        input.requesterEmployee ?? 1
      ),
      approverAuthorization: policyAuthorization(
        input.candidatePolicy,
        input.approverEmployee ?? 2
      ),
      requestedAt: "2026-03-02T00:00:00.000Z",
      approvedAt: input.approvedAt ?? "2026-03-03T00:00:00.000Z",
      notBefore: input.notBefore ?? "2026-03-04T00:00:00.000Z",
      activatedAt: input.activatedAt ?? "2026-03-04T00:00:00.000Z",
      reasonCode: "core:policy-supersession-reviewed"
    }
  }).policy;
}

function target() {
  return {
    tenantId,
    root: {
      tenantId,
      dataClassId,
      storageRootId: "core:policy-message-sql",
      recordId: "data_root:message-1"
    },
    entity: {
      tenantId,
      entityTypeId: "core:message",
      entityId: "message:message-1"
    },
    entityRevision: "5",
    lineageRevision: "7",
    dataClassId,
    sensitivity: "restricted_content" as const,
    holdEligible: true,
    anchorAt: "2026-04-01T00:00:00.000Z"
  };
}

function purposes(policy: InboxV2EffectiveTenantPolicy) {
  return policy.rules.map((policyRule) => ({
    purposeId: policyRule.purposeId,
    ruleId: policyRule.id,
    ruleRevision: policyRule.revision,
    anchorAt: "2026-04-01T00:00:00.000Z",
    condition: null,
    parentDeadlineSnapshot: null
  }));
}

function evaluate(
  policy: InboxV2EffectiveTenantPolicy,
  overrides: Partial<Parameters<typeof evaluateInboxV2Lifecycle>[0]> = {}
) {
  return evaluateInboxV2Lifecycle(evaluationInput(policy, overrides));
}

function evaluationInput(
  policy: InboxV2EffectiveTenantPolicy,
  overrides: Partial<Parameters<typeof evaluateInboxV2Lifecycle>[0]> = {}
) {
  const input = {
    policy,
    collectionPolicyRef: {
      tenantId: policy.tenantId,
      id: policy.id,
      version: policy.version,
      policyHash: policy.policyHash
    },
    governanceContext: governanceContext(),
    target: target(),
    registry: lifecycleRegistryWithCustomerUse(),
    purposes: purposes(policy),
    holds: [],
    restrictions: [],
    requestedUse: null,
    now: "2026-04-25T00:00:00.000Z",
    ...overrides
  };
  return completeEvaluationInput(input);
}

type LifecycleEvaluationInput = Parameters<typeof evaluateInboxV2Lifecycle>[0];

function completeEvaluationInput(
  input: Omit<LifecycleEvaluationInput, "controlSnapshot"> & {
    controlSnapshot?: LifecycleEvaluationInput["controlSnapshot"];
  }
): LifecycleEvaluationInput {
  if (input.controlSnapshot !== undefined) {
    return { ...input, controlSnapshot: input.controlSnapshot };
  }
  const source = defineInboxV2LifecycleControlSource({
    id: "core:lifecycle-control-source",
    version: "1",
    loadCompleteControlState: () => ({
      sourceState: {
        streamEpoch: "stream:epoch:0001",
        syncGeneration: "1",
        completeThroughPosition: "200",
        purposeSetRevision: "1",
        legalHoldSetRevision: "1",
        restrictionSetRevision: "1",
        sourceStateHash: `sha256:${"8".repeat(64)}`
      },
      purposes: input.purposes,
      holds: input.holds,
      restrictions: input.restrictions,
      resolvedAt: input.now
    })
  });
  const sourceProof = resolveInboxV2LifecycleControlSourceProof({
    source,
    registry: input.registry,
    policy: input.policy as InboxV2EffectiveTenantPolicy,
    target: input.target,
    capturedAt: input.now
  });
  return {
    ...input,
    holds: sourceProof.holds,
    restrictions: sourceProof.restrictions,
    controlSnapshot: defineInboxV2LifecycleControlSnapshot({
      registry: input.registry,
      policy: input.policy as InboxV2EffectiveTenantPolicy,
      target: input.target,
      sourceProof,
      snapshot: {
        tenantId: input.policy.tenantId,
        id: "core:lifecycle-control-snapshot",
        revision: "1"
      }
    })
  };
}

function exactScope() {
  return {
    kind: "exact" as const,
    targets: [target().entity],
    manifest: defineInboxV2PrivacyScopeManifest({
      tenantId,
      id: "scope-manifest:scope-1",
      revision: "1",
      frozenAt: "2026-03-01T00:00:00.000Z",
      roots: [
        {
          root: {
            tenantId,
            dataClassId,
            storageRootId: "core:policy-message-sql",
            recordId: "data_root:message-1"
          },
          entity: target().entity,
          expectedEntityRevision: target().entityRevision,
          expectedLineageRevision: target().lineageRevision,
          rootKind: "sql" as const,
          boundary: "operated_data_plane" as const,
          copyRole: "primary" as const
        }
      ]
    }),
    futureMatch: "none" as const
  };
}

function hold() {
  return {
    tenantId,
    id: "hold:case-1",
    revision: "7",
    caseId: "case:case-1",
    dataClassIds: [dataClassId],
    scope: exactScope(),
    anchorFrom: null,
    anchorThrough: null,
    owner: { tenantId, kind: "employee" as const, id: "employee:owner" },
    approver: {
      tenantId,
      kind: "employee" as const,
      id: "employee:approver"
    },
    reasonCode: "core:legal-claim",
    legalReferenceCode: "core:case-reference",
    endCondition: {
      id: "core:legal-case-closed",
      version: "1",
      resolverHandlerId: "core:condition-resolver"
    },
    effectiveAt: "2026-03-01T00:00:00.000Z",
    reviewAt: "2026-08-01T00:00:00.000Z",
    state: "active" as const
  };
}

function restriction() {
  return {
    tenantId,
    id: "restriction:case-1",
    revision: "3",
    scope: exactScope(),
    dataClassIds: [dataClassId],
    continuingPurposeIds: [legalPurpose],
    allowedUses: ["legal_claim" as const, "storage" as const],
    owner: { tenantId, kind: "employee" as const, id: "employee:owner" },
    reasonCode: "core:subject-objection",
    endCondition: {
      id: "core:objection-resolved",
      version: "1",
      resolverHandlerId: "core:condition-resolver"
    },
    effectiveAt: "2026-03-01T00:00:00.000Z",
    reviewAt: "2026-08-01T00:00:00.000Z",
    state: "active" as const
  };
}

describe("Inbox V2 lifecycle policy", () => {
  it("keeps policy and decision boundary schemas closed", () => {
    for (const [label, schema] of [
      ["policy template", inboxV2PolicyTemplateSchema],
      ["effective tenant policy", inboxV2EffectiveTenantPolicySchema],
      ["policy impact preview", inboxV2PolicyImpactPreviewSchema],
      ["policy activation", inboxV2PolicyActivationSchema],
      ["lifecycle control snapshot", inboxV2LifecycleControlSnapshotSchema],
      ["lifecycle evaluation", inboxV2LifecycleEvaluationSchema]
    ] as const) {
      expect(() => assertInboxV2ClosedJsonSchema(schema, label)).not.toThrow();
    }
  });

  it("keeps templates non-executable and resolves an exact tenant policy", () => {
    expect(isInboxV2PolicyTemplate(template())).toBe(true);
    expect(isInboxV2PolicyTemplate(structuredClone(template()))).toBe(false);
    expect(inboxV2PolicyTemplateSchema.safeParse(template()).success).toBe(
      true
    );
    expect(inboxV2DataLifecyclePolicySchema.safeParse(template()).success).toBe(
      true
    );
    const policy = resolvePolicy();
    expect(isInboxV2EffectiveTenantPolicy(policy)).toBe(true);
    expect(isInboxV2EffectiveTenantPolicy(structuredClone(policy))).toBe(false);
    expect(policy.tenantId).toBe(tenantId);
    expect(policy.governanceContextRef).toEqual({
      tenantId,
      id: "core:governance-profile",
      version: "2",
      contextHash: governanceContext().contextHash
    });
    expect(
      inboxV2EffectiveTenantPolicySchema.safeParse({
        ...policy,
        tenantId: undefined
      }).success
    ).toBe(false);
    expect(
      inboxV2PolicyTemplateSchema.safeParse({
        ...template(),
        reviewAt: "2027-04-01T00:00:00.000Z"
      }).success
    ).toBe(false);
    expect(
      inboxV2EffectiveTenantPolicySchema.safeParse({
        ...policy,
        effectiveAt: "2026-03-02T00:00:00.000Z"
      }).success
    ).toBe(false);
    expect(evaluate(policy, { registry: lifecycleRegistry() })).toEqual({
      outcome: "rejected",
      errorCode: "privacy.policy_rule_reference_invalid"
    });
    expect(
      resolveInboxV2EffectiveTenantPolicy({
        registry: lifecycleRegistryWithCustomerUse(),
        tenantId,
        id: "core:tenant-message-policy",
        version: "9",
        policyHash,
        effectiveAt: "2026-03-01T00:00:00.000Z",
        templates: [structuredClone(template())],
        governanceContext: governanceContext(),
        tenantSelections: [],
        entitlementAllowances: []
      })
    ).toEqual({ kind: "rejected", errorCode: "privacy.policy_invalid" });
  });

  it("activates only through one CAS ledger with review, cooling and supersession fences", () => {
    const ledger = defineInboxV2PolicyActivationLedger({
      id: "core:policy-ledger-activation-test"
    });
    const initialCandidate = resolvePolicyCandidate({ version: "8" });
    expect(isInboxV2ActivatedEffectiveTenantPolicy(initialCandidate)).toBe(
      false
    );
    const currentPolicy = activateBootstrapPolicy(initialCandidate, ledger);
    expect(isInboxV2ActivatedEffectiveTenantPolicy(currentPolicy)).toBe(true);

    const secondBootstrap = resolvePolicyCandidate({ version: "9" });
    expect(() => activateBootstrapPolicy(secondBootstrap, ledger)).toThrow(
      /empty current-policy fence/u
    );

    const shorterCandidate = resolvePolicyCandidate({
      version: "9",
      rules: [
        rule({
          id: "core:message-customer-rule",
          purposeId: customerPurpose,
          baselineDays: 5
        }),
        defaultRules()[1]!
      ]
    });
    const oldEvaluationInput = evaluationInput(currentPolicy);
    expect(() =>
      activateSupersedingPolicy({
        ledger,
        currentPolicy,
        candidatePolicy: shorterCandidate,
        approvedAt: "2026-03-03T00:00:00.000Z",
        notBefore: "2026-03-03T00:00:00.000Z"
      })
    ).toThrow(/non-zero approval\/cooling/u);

    const activeShorter = activateSupersedingPolicy({
      ledger,
      currentPolicy,
      candidatePolicy: shorterCandidate
    });
    expect(isInboxV2ActivatedEffectiveTenantPolicy(currentPolicy)).toBe(false);
    expect(isInboxV2ActivatedEffectiveTenantPolicy(activeShorter)).toBe(true);
    expect(evaluateInboxV2Lifecycle(oldEvaluationInput)).toEqual({
      outcome: "rejected",
      errorCode: "privacy.policy_invalid"
    });

    const nextCandidate = resolvePolicyCandidate({ version: "10" });
    expect(() =>
      impactPreview(nextCandidate, currentPolicy, "2026-04-01T00:00:00.000Z")
    ).toThrow(/authentic policies/u);
    expect(() =>
      activateSupersedingPolicy({
        ledger,
        currentPolicy: activeShorter,
        candidatePolicy: nextCandidate,
        activationId: "core:policy-activation-9"
      })
    ).toThrow(/already been consumed/u);
  });

  it("rejects activation when the complete impact high-water changed after review", () => {
    const candidatePolicy = resolvePolicyCandidate({ version: "81" });
    const ledger = defineInboxV2PolicyActivationLedger({
      id: "core:policy-ledger-stale-impact"
    });
    const source = defineInboxV2PolicyImpactSource({
      id: "core:policy-impact-source-stale-at-activation",
      version: "1",
      loadCompleteImpact: () => ({
        sourceSnapshot: {
          streamEpoch: "stream:epoch:impact-race",
          syncGeneration: "1",
          completeThroughPosition: "100",
          snapshotHash: `sha256:${"3".repeat(64)}`
        },
        affectedRootCount: "1",
        affectedByteCount: "512",
        heldRootCount: "0",
        backupCopyCount: "0",
        earliestDestructiveAt: null,
        resolvedAt: "2026-03-01T00:00:00.000Z"
      }),
      compareAndSetActivationImpact: ({ activatedAt }) => ({
        outcome: "changed",
        currentImpact: {
          sourceSnapshot: {
            streamEpoch: "stream:epoch:impact-race",
            syncGeneration: "1",
            completeThroughPosition: "101",
            snapshotHash: `sha256:${"4".repeat(64)}`
          },
          affectedRootCount: "2",
          affectedByteCount: "1024",
          heldRootCount: "1",
          backupCopyCount: "1",
          earliestDestructiveAt: null,
          resolvedAt: activatedAt
        }
      })
    });
    const sourceProof = resolveInboxV2PolicyImpactSourceProof({
      source,
      currentPolicy: null,
      candidatePolicy
    });
    const preview = defineInboxV2PolicyImpactPreview({
      currentPolicy: null,
      candidatePolicy,
      sourceProof,
      preview: {
        tenantId,
        id: "core:policy-impact-preview-stale-at-activation",
        revision: "1",
        previewedAt: "2026-03-01T00:00:00.000Z"
      }
    });

    expect(() =>
      activateInboxV2EffectiveTenantPolicy({
        ledger,
        currentPolicy: null,
        candidatePolicy,
        impactPreview: preview,
        transition: {
          kind: "initial_reviewed_bootstrap",
          reviewedBootstrapProfile: {
            id: "core:policy-bootstrap-reviewed",
            version: "1"
          }
        },
        activation: {
          tenantId,
          id: "core:policy-activation-stale-impact",
          revision: "1",
          requesterAuthorization: policyAuthorization(candidatePolicy, 1),
          approverAuthorization: policyAuthorization(candidatePolicy, 2),
          requestedAt: "2026-03-02T00:00:00.000Z",
          approvedAt: "2026-03-03T00:00:00.000Z",
          notBefore: "2026-03-04T00:00:00.000Z",
          activatedAt: "2026-03-04T00:00:00.000Z",
          reasonCode: "core:policy-activation-reviewed"
        }
      })
    ).toThrow(/impact changed after review/u);
    expect(isInboxV2ActivatedEffectiveTenantPolicy(candidatePolicy)).toBe(
      false
    );
  });

  it("requires authentic complete impact and purpose/control source proofs", () => {
    const policy = resolvePolicy();
    const complete = evaluationInput(policy, { holds: [hold()] });
    expect(evaluateInboxV2Lifecycle({ ...complete, holds: [] })).toEqual({
      outcome: "rejected",
      errorCode: "privacy.policy_invalid"
    });
    expect(
      evaluateInboxV2Lifecycle({
        ...complete,
        purposes: complete.purposes.slice(1)
      })
    ).toEqual({ outcome: "rejected", errorCode: "privacy.policy_invalid" });
    expect(
      evaluateInboxV2Lifecycle({
        ...complete,
        controlSnapshot: structuredClone(complete.controlSnapshot)
      })
    ).toEqual({ outcome: "rejected", errorCode: "privacy.policy_invalid" });
    expect(
      evaluateInboxV2Lifecycle({
        ...complete,
        holds: complete.holds.map((entry) => structuredClone(entry))
      })
    ).toEqual({ outcome: "rejected", errorCode: "privacy.policy_invalid" });

    const candidate = resolvePolicyCandidate({ version: "9" });
    const source = defineInboxV2PolicyImpactSource({
      id: "core:policy-impact-adversarial-source",
      version: "1",
      loadCompleteImpact: () => ({
        sourceSnapshot: {
          streamEpoch: "stream:epoch:0001",
          syncGeneration: "1",
          completeThroughPosition: "100",
          snapshotHash: `sha256:${"9".repeat(64)}`
        },
        affectedRootCount: "0",
        affectedByteCount: "0",
        heldRootCount: "0",
        backupCopyCount: "0",
        earliestDestructiveAt: "2026-04-01T00:00:00.000Z",
        resolvedAt: "2026-03-01T00:00:00.000Z"
      }),
      compareAndSetActivationImpact: ({ activatedAt }) => ({
        outcome: "matched",
        currentImpact: {
          sourceSnapshot: {
            streamEpoch: "stream:epoch:0001",
            syncGeneration: "1",
            completeThroughPosition: "100",
            snapshotHash: `sha256:${"9".repeat(64)}`
          },
          affectedRootCount: "0",
          affectedByteCount: "0",
          heldRootCount: "0",
          backupCopyCount: "0",
          earliestDestructiveAt: "2026-04-01T00:00:00.000Z",
          resolvedAt: activatedAt
        }
      })
    });
    const proof = resolveInboxV2PolicyImpactSourceProof({
      source,
      currentPolicy: policy,
      candidatePolicy: candidate
    });
    expect(() =>
      defineInboxV2PolicyImpactPreview({
        currentPolicy: policy,
        candidatePolicy: candidate,
        sourceProof: structuredClone(proof),
        preview: {
          tenantId,
          id: "core:forged-zero-impact-preview",
          revision: "1",
          previewedAt: "2026-03-01T00:00:00.000Z"
        }
      })
    ).toThrow(/authentic complete source proof/u);
  });

  it("refuses activation when a registered data-use purpose has no rule", () => {
    const registry = lifecycleRegistryWithCustomerUse();
    expect(resolvePolicy({ registry }).rules).toHaveLength(2);

    expect(
      resolveInboxV2EffectiveTenantPolicy({
        registry,
        tenantId,
        id: "core:tenant-message-policy",
        version: "8",
        policyHash,
        effectiveAt: "2026-03-01T00:00:00.000Z",
        templates: [template([defaultRules()[1]!])],
        governanceContext: governanceContext(),
        tenantSelections: [],
        entitlementAllowances: []
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "privacy.policy_rule_reference_invalid"
    });
  });

  it("executes only the exact module retention-rule envelope pinned by the registry", () => {
    const registry = lifecycleRegistryWithModuleAiUse();
    const governance = moduleGovernanceContext();
    const moduleRule = {
      id: "module:policy-ai-provider:output-rule",
      revision: "1",
      dataClassId: "module:policy-ai-provider:output",
      purposeId: "module:policy-ai-provider:enrichment",
      retentionAnchorId: "core:source_parent_or_last_required_use",
      baselineWindow: {
        kind: "inherits_all_live_parents" as const,
        maximumAdditionalPeriod: {
          kind: "elapsed" as const,
          seconds: 86_400
        }
      },
      actionAtExpiry: "hard_delete" as const,
      backupMaximum: { kind: "elapsed" as const, seconds: 3_024_000 },
      legalMinimum: null,
      legalMaximum: null,
      allowTenantShorter: false,
      allowTenantLonger: false,
      holdEligible: true
    };
    const resolveModuleRule = (candidateRule: typeof moduleRule) =>
      resolveInboxV2EffectiveTenantPolicy({
        registry,
        tenantId,
        id: "module:policy-ai-provider:tenant-policy",
        version: "1",
        policyHash,
        effectiveAt: "2026-03-01T00:00:00.000Z",
        templates: [
          defineInboxV2PolicyTemplate({
            kind: "template",
            id: "module:policy-ai-provider:policy-template",
            version: "1",
            deploymentProfile: "saas_shared",
            jurisdictionProfiles: [
              { id: "core:jurisdiction-eu", version: "3" }
            ],
            effectiveAt: "2026-03-01T00:00:00.000Z",
            reviewAt: "2027-01-01T00:00:00.000Z",
            rules: [candidateRule]
          })
        ],
        governanceContext: governance,
        tenantSelections: [],
        entitlementAllowances: []
      });

    const resolved = resolveModuleRule(moduleRule);
    expect(resolved.kind).toBe("resolved");
    if (resolved.kind === "resolved") {
      expect(resolved.policy.rules).toEqual([
        expect.objectContaining({
          id: "module:policy-ai-provider:output-rule",
          purposeId: "module:policy-ai-provider:enrichment"
        })
      ]);
    }

    expect(
      resolveModuleRule({
        ...moduleRule,
        id: "module:policy-ai-provider:undefined-rule"
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "privacy.policy_rule_reference_invalid"
    });
    expect(
      resolveModuleRule({
        ...moduleRule,
        backupMaximum: { kind: "elapsed", seconds: 3_024_001 }
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "privacy.policy_rule_reference_invalid"
    });
  });

  it("rejects forever/hold-as-action and incompatible deployment profiles", () => {
    const firstRule = defaultRules()[0]!;
    expect(
      inboxV2PolicyTemplateSchema.safeParse({
        ...template([firstRule]),
        rules: [{ ...firstRule, actionAtExpiry: "hold_no_purge" }]
      }).success
    ).toBe(false);
    expect(
      inboxV2PolicyTemplateSchema.safeParse({
        ...template([firstRule]),
        rules: [{ ...firstRule, retentionWindow: "forever" }]
      }).success
    ).toBe(false);
    expect(
      resolveInboxV2EffectiveTenantPolicy({
        registry: defineInboxV2DataLifecycleRegistry(),
        tenantId,
        id: "core:tenant-message-policy",
        version: "8",
        policyHash,
        effectiveAt: "2026-03-01T00:00:00.000Z",
        templates: [
          defineInboxV2PolicyTemplate({
            ...template(),
            deploymentProfile: "on_prem"
          })
        ],
        governanceContext: governanceContext(),
        tenantSelections: [],
        entitlementAllowances: []
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "privacy.deployment_profile_mismatch"
    });

    expect(
      resolveInboxV2EffectiveTenantPolicy({
        registry: defineInboxV2DataLifecycleRegistry(),
        tenantId,
        id: "core:tenant-message-policy",
        version: "8",
        policyHash,
        effectiveAt: "2026-03-01T00:00:00.000Z",
        templates: [
          template([{ ...firstRule, dataClassId: "core:unknown_data_class" }])
        ],
        governanceContext: governanceContext(),
        tenantSelections: [],
        entitlementAllowances: []
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "privacy.policy_rule_reference_invalid"
    });

    expect(
      resolveInboxV2EffectiveTenantPolicy({
        registry: lifecycleRegistry(),
        tenantId,
        id: "core:tenant-message-policy",
        version: "8",
        policyHash,
        effectiveAt: "2026-03-01T00:00:00.000Z",
        templates: [template()],
        governanceContext: defineInboxV2DataGovernanceContext({
          ...governanceContext(),
          jurisdictionProfiles: [
            { id: "core:jurisdiction-eu", version: "3" },
            { id: "core:jurisdiction-ru", version: "1" }
          ]
        }),
        tenantSelections: [],
        entitlementAllowances: []
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "privacy.jurisdiction_profile_missing"
    });

    expect(
      resolveInboxV2EffectiveTenantPolicy({
        registry: lifecycleRegistry(),
        tenantId,
        id: "core:tenant-message-policy",
        version: "9",
        policyHash,
        effectiveAt: "2028-03-01T00:00:00.000Z",
        templates: [template()],
        governanceContext: governanceContext(),
        tenantSelections: [],
        entitlementAllowances: []
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "privacy.governance_context_mismatch"
    });
  });

  it("uses the latest valid purpose deadline and applies each legal maximum", () => {
    const result = evaluate(resolvePolicy());
    expect(isInboxV2LifecycleEvaluation(result)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(isInboxV2LifecycleEvaluation(structuredClone(result))).toBe(false);
    expect(result.outcome).toBe("eligible_for_action");
    if (result.outcome !== "eligible_for_action") return;
    expect(result.eligibleAt).toBe("2026-04-21T00:00:00.000Z");
    expect(result.purposeDeadlines).toHaveLength(2);
    expect(result.purposeDeadlines[1]).toMatchObject({
      purposeId: legalPurpose,
      baselineAt: "2026-05-31T00:00:00.000Z",
      legalMaximumAt: "2026-04-21T00:00:00.000Z",
      eligibleAt: "2026-04-21T00:00:00.000Z",
      selectedSource: "legal_maximum"
    });
  });

  it("fails closed on shifted anchors, stale control revisions and unknown control handlers", () => {
    const policy = resolvePolicy();
    const shiftedPurposes = purposes(policy);
    shiftedPurposes[0] = {
      ...shiftedPurposes[0]!,
      anchorAt: "2026-04-02T00:00:00.000Z"
    };
    expect(evaluate(policy, { purposes: shiftedPurposes })).toEqual({
      outcome: "rejected",
      errorCode: "privacy.policy_rule_reference_invalid"
    });

    expect(() =>
      evaluate(policy, {
        holds: [hold(), { ...hold(), revision: "8" }]
      })
    ).toThrow(/current revision/u);

    expect(() =>
      evaluate(policy, {
        holds: [
          {
            ...hold(),
            endCondition: {
              ...hold().endCondition,
              resolverHandlerId: "core:unknown-condition-resolver"
            }
          }
        ]
      })
    ).toThrow(/condition_resolution/u);

    expect(
      inboxV2EffectiveTenantPolicySchema.safeParse({
        ...policy,
        rules: policy.rules.map((policyRule, index) =>
          index === 1
            ? { ...policyRule, actionAtExpiry: "hard_delete" }
            : policyRule
        )
      }).success
    ).toBe(false);
  });

  it("lets legal minimum beat a plan cap and never lets plan beat legal maximum", () => {
    const selectedRule = rule({
      id: "core:message-customer-rule",
      purposeId: customerPurpose,
      baselineDays: 10,
      legalMinimumDays: 20,
      legalMaximumDays: 30
    });
    const policy = resolvePolicy({
      rules: [selectedRule],
      tenantSelections: [
        {
          ruleId: selectedRule.id,
          ruleRevision: selectedRule.revision,
          selectedPeriod: { kind: "elapsed", seconds: 60 * 86_400 },
          decisionRef: { id: "core:tenant-retention-choice", version: "1" }
        }
      ],
      entitlementAllowances: [
        {
          ruleId: selectedRule.id,
          ruleRevision: selectedRule.revision,
          optionalLongerMaximum: {
            kind: "elapsed",
            seconds: 15 * 86_400
          },
          decisionRef: { id: "core:plan-retention-allowance", version: "4" }
        }
      ]
    });
    const result = evaluate(policy);
    expect(result.outcome).toBe("eligible_for_action");
    if (result.outcome !== "eligible_for_action") return;
    expect(result.eligibleAt).toBe("2026-04-21T00:00:00.000Z");
    expect(result.purposeDeadlines[0]?.selectedSource).toBe("legal_minimum");

    const legallyRequiredPolicy = resolvePolicy({
      rules: [selectedRule],
      tenantSelections: [
        {
          ruleId: selectedRule.id,
          ruleRevision: selectedRule.revision,
          selectedPeriod: { kind: "elapsed", seconds: 15 * 86_400 },
          decisionRef: { id: "core:tenant-retention-choice", version: "2" }
        }
      ]
    });
    const legallyRequired = evaluate(legallyRequiredPolicy);
    expect(legallyRequired.outcome).toBe("eligible_for_action");
    if (legallyRequired.outcome === "eligible_for_action") {
      expect(legallyRequired.eligibleAt).toBe("2026-04-21T00:00:00.000Z");
      expect(legallyRequired.purposeDeadlines[0]?.selectedSource).toBe(
        "legal_minimum"
      );
    }
  });

  it("requires a trusted version-pinned resolver for calendar periods", () => {
    const calendarRule = rule({
      id: "core:message-customer-rule",
      purposeId: customerPurpose,
      calendar: true
    });
    const policy = resolvePolicy({
      rules: [calendarRule]
    });
    expect(evaluate(policy)).toEqual({
      outcome: "rejected",
      errorCode: "privacy.calendar_resolver_required"
    });

    const result = evaluate(policy, {
      resolveCalendarPeriod: ({ period, anchorAt, governanceContext }) => ({
        resolverId: "core:calendar-resolver",
        resolverVersion: "6",
        governanceContextRef: {
          tenantId: governanceContext.tenantId,
          id: governanceContext.id,
          version: governanceContext.version,
          contextHash: governanceContext.contextHash
        },
        period,
        anchorAt,
        eligibleAt: "2026-05-01T00:00:00.000Z",
        calendar: null
      })
    });
    expect(result.outcome).toBe("retained_until");
    if (result.outcome === "retained_until") {
      expect(result.eligibleAt).toBe("2026-05-01T00:00:00.000Z");
      expect(result.purposeDeadlines[0]?.calendarResolutionEvidence).toEqual([
        expect.objectContaining({
          role: "product_baseline",
          evidence: expect.objectContaining({
            resolverId: "core:calendar-resolver",
            resolverVersion: "6",
            eligibleAt: "2026-05-01T00:00:00.000Z"
          })
        })
      ]);
    }
  });

  it("derives a finite review deadline for an unresolved end condition", () => {
    const conditionalRule = {
      ...rule({
        id: "core:message-customer-rule",
        purposeId: customerPurpose,
        baselineDays: 10
      }),
      baselineWindow: {
        kind: "until_condition_then_period" as const,
        condition: {
          id: "core:service-relationship-ended",
          version: "2",
          resolverHandlerId: "core:condition-resolver"
        },
        period: { kind: "elapsed" as const, seconds: 10 * 86_400 },
        reviewPeriod: { kind: "elapsed" as const, seconds: 7 * 86_400 }
      }
    };
    const policy = resolvePolicy({
      rules: [conditionalRule],
      registry: lifecycleRegistry()
    });
    const unresolvedPurpose = {
      purposeId: customerPurpose,
      ruleId: conditionalRule.id,
      ruleRevision: conditionalRule.revision,
      anchorAt: "2026-04-01T00:00:00.000Z",
      condition: {
        state: "unresolved" as const,
        conditionId: "core:service-relationship-ended",
        conditionVersion: "2",
        resolverHandlerId: "core:condition-resolver",
        resolutionRevision: "4",
        evidenceHash: `sha256:${"e".repeat(64)}`,
        reviewedAt: "2026-04-01T00:00:00.000Z"
      },
      parentDeadlineSnapshot: null
    };
    const result = evaluate(policy, {
      registry: lifecycleRegistry(),
      purposes: [unresolvedPurpose]
    });
    expect(result).toMatchObject({
      outcome: "review_required",
      nextReviewAt: "2026-04-08T00:00:00.000Z"
    });
    expect(
      evaluate(policy, {
        registry: lifecycleRegistry(),
        purposes: [
          {
            ...unresolvedPurpose,
            condition: {
              ...unresolvedPurpose.condition,
              reviewedAt: "2026-05-01T00:00:00.000Z"
            }
          }
        ]
      })
    ).toEqual({
      outcome: "rejected",
      errorCode: "privacy.condition_resolution_required"
    });
  });

  it("keeps pseudonymization distinct from irreversible anonymization", () => {
    const reportingPurpose = "core:manager_reporting";
    const anonymousClass = "core:analytics_anonymous_rollup";
    const anonymousRule = {
      id: "core:anonymous-rollup-rule",
      revision: "1",
      dataClassId: anonymousClass,
      purposeId: reportingPurpose,
      retentionAnchorId: "core:rollup_window_close",
      baselineWindow: {
        kind: "fixed_after_anchor" as const,
        period: { kind: "elapsed" as const, seconds: 86_400 }
      },
      actionAtExpiry: "anonymize_and_reaggregate" as const,
      backupMaximum: { kind: "elapsed" as const, seconds: 35 * 86_400 },
      legalMinimum: null,
      legalMaximum: null,
      allowTenantShorter: true,
      allowTenantLonger: false,
      holdEligible: false
    };
    const reportingGovernance = defineInboxV2DataGovernanceContext({
      ...governanceContext(),
      rolesByPurpose: [
        {
          purposeId: reportingPurpose,
          roles: [{ regime: "eu" as const, role: "controller" as const }],
          lawfulBasisReferenceCode: "core:basis.anonymous-reporting",
          customerInstructionReferenceCode: null
        }
      ]
    });
    const resolved = resolveInboxV2EffectiveTenantPolicy({
      registry: lifecycleRegistry(),
      tenantId,
      id: "core:tenant-reporting-policy",
      version: "1",
      policyHash,
      effectiveAt: "2026-03-01T00:00:00.000Z",
      templates: [template([anonymousRule])],
      governanceContext: reportingGovernance,
      tenantSelections: [],
      entitlementAllowances: []
    });
    expect(resolved.kind).toBe("resolved");
    if (resolved.kind !== "resolved") return;
    const reportingPolicy = activateBootstrapPolicy(resolved.policy);

    const analyticsEntity = {
      tenantId,
      entityTypeId: "core:analytics_rollup",
      entityId: "rollup:rollup-1"
    };
    const decision = evaluateInboxV2Lifecycle(
      completeEvaluationInput({
        registry: lifecycleRegistry(),
        policy: reportingPolicy,
        collectionPolicyRef: {
          tenantId,
          id: reportingPolicy.id,
          version: reportingPolicy.version,
          policyHash: reportingPolicy.policyHash
        },
        governanceContext: reportingGovernance,
        target: {
          tenantId,
          root: {
            tenantId,
            dataClassId: anonymousClass,
            storageRootId: "core:analytics-rollup-sql",
            recordId: "data_root:rollup-1"
          },
          entity: analyticsEntity,
          entityRevision: "3",
          lineageRevision: "4",
          dataClassId: anonymousClass,
          sensitivity: "non_personal_aggregate",
          holdEligible: false,
          anchorAt: "2026-04-01T00:00:00.000Z"
        },
        purposes: [
          {
            purposeId: reportingPurpose,
            ruleId: anonymousRule.id,
            ruleRevision: anonymousRule.revision,
            anchorAt: "2026-04-01T00:00:00.000Z",
            condition: null,
            parentDeadlineSnapshot: null
          }
        ],
        holds: [],
        restrictions: [],
        requestedUse: null,
        now: "2026-04-03T00:00:00.000Z"
      })
    );
    expect(decision).toMatchObject({
      outcome: "eligible_for_action",
      action: "anonymize_and_reaggregate"
    });

    expect(
      resolveInboxV2EffectiveTenantPolicy({
        registry: lifecycleRegistry(),
        tenantId,
        id: "core:tenant-reporting-policy",
        version: "2",
        policyHash,
        effectiveAt: "2026-03-01T00:00:00.000Z",
        templates: [
          template([{ ...anonymousRule, actionAtExpiry: "pseudonymize" }])
        ],
        governanceContext: reportingGovernance,
        tenantSelections: [],
        entitlementAllowances: []
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "privacy.policy_rule_reference_invalid"
    });

    const foreignTenant = "tenant:tenant-2";
    const foreignEntity = { ...analyticsEntity, tenantId: foreignTenant };
    expect(() =>
      completeEvaluationInput({
        registry: lifecycleRegistry(),
        policy: reportingPolicy,
        collectionPolicyRef: {
          tenantId,
          id: reportingPolicy.id,
          version: reportingPolicy.version,
          policyHash: reportingPolicy.policyHash
        },
        governanceContext: reportingGovernance,
        target: {
          tenantId,
          root: {
            tenantId,
            dataClassId: anonymousClass,
            storageRootId: "core:analytics-rollup-sql",
            recordId: "data_root:rollup-1"
          },
          entity: analyticsEntity,
          entityRevision: "3",
          lineageRevision: "4",
          dataClassId: anonymousClass,
          sensitivity: "non_personal_aggregate",
          holdEligible: false,
          anchorAt: "2026-04-01T00:00:00.000Z"
        },
        purposes: [
          {
            purposeId: reportingPurpose,
            ruleId: anonymousRule.id,
            ruleRevision: anonymousRule.revision,
            anchorAt: "2026-04-01T00:00:00.000Z",
            condition: null,
            parentDeadlineSnapshot: null
          }
        ],
        holds: [
          {
            ...hold(),
            tenantId: foreignTenant,
            dataClassIds: [anonymousClass],
            scope: {
              ...exactScope(),
              targets: [foreignEntity],
              manifest: defineInboxV2PrivacyScopeManifest({
                ...exactScope().manifest,
                tenantId: foreignTenant,
                roots: exactScope().manifest.roots.map((entry) => ({
                  ...entry,
                  root: { ...entry.root, tenantId: foreignTenant },
                  entity: foreignEntity
                }))
              })
            },
            owner: {
              tenantId: foreignTenant,
              kind: "employee",
              id: "employee:owner"
            },
            approver: {
              tenantId: foreignTenant,
              kind: "employee",
              id: "employee:approver"
            }
          }
        ],
        restrictions: [],
        requestedUse: null,
        now: "2026-04-03T00:00:00.000Z"
      })
    ).toThrow(/not hold eligible/u);
  });

  it("requires current epoch-fenced proof of every live parent deadline", () => {
    const fileClass = "core:file_original_binary";
    const fileRule = {
      id: "core:file-original-rule",
      revision: "1",
      dataClassId: fileClass,
      purposeId: customerPurpose,
      retentionAnchorId: "core:all_parent_links_and_purposes_end",
      baselineWindow: {
        kind: "inherits_all_live_parents" as const,
        maximumAdditionalPeriod: null
      },
      actionAtExpiry: "hard_delete" as const,
      backupMaximum: { kind: "elapsed" as const, seconds: 35 * 86_400 },
      legalMinimum: null,
      legalMaximum: null,
      allowTenantShorter: false,
      allowTenantLonger: false,
      holdEligible: true
    };
    const resolved = resolveInboxV2EffectiveTenantPolicy({
      registry: lifecycleRegistry(),
      tenantId,
      id: "core:tenant-file-policy",
      version: "1",
      policyHash,
      effectiveAt: "2026-03-01T00:00:00.000Z",
      templates: [template([fileRule])],
      governanceContext: governanceContext(),
      tenantSelections: [],
      entitlementAllowances: []
    });
    expect(resolved.kind).toBe("resolved");
    if (resolved.kind !== "resolved") return;
    const filePolicy = activateBootstrapPolicy(resolved.policy);

    const fileEntity = {
      tenantId,
      entityTypeId: "core:file",
      entityId: "file:file-1"
    };
    const policyRef = {
      tenantId,
      id: filePolicy.id,
      version: filePolicy.version,
      policyHash: filePolicy.policyHash
    };
    const parentSnapshot = {
      child: fileEntity,
      childRevision: "5",
      lineageRevision: "9",
      streamEpoch: "epoch:file-1",
      syncGeneration: "2",
      completeThroughPosition: "150",
      completeness: "all_live_parents" as const,
      resolverHandlerId: "core:parent-deadline-resolver",
      resolverVersion: "1",
      resolvedAt: "2026-04-25T00:00:00.000Z",
      snapshotHash: `sha256:${"f".repeat(64)}`,
      parentSet: {
        kind: "live_parents" as const,
        parents: [
          {
            parent: {
              tenantId,
              entityTypeId: "core:message",
              entityId: "message:message-2"
            },
            parentRevision: "5",
            eligibleAt: "2026-05-01T00:00:00.000Z",
            policyRef,
            decisionHash: `sha256:${"1".repeat(64)}`
          }
        ]
      }
    };
    const input = {
      registry: lifecycleRegistry(),
      policy: filePolicy,
      collectionPolicyRef: policyRef,
      governanceContext: governanceContext(),
      target: {
        tenantId,
        root: {
          tenantId,
          dataClassId: fileClass,
          storageRootId: "core:file-object",
          recordId: "data_root:file-1"
        },
        entity: fileEntity,
        entityRevision: "5",
        lineageRevision: "9",
        dataClassId: fileClass,
        sensitivity: "restricted_content" as const,
        holdEligible: true,
        anchorAt: "2026-04-01T00:00:00.000Z"
      },
      purposes: [
        {
          purposeId: customerPurpose,
          ruleId: fileRule.id,
          ruleRevision: fileRule.revision,
          anchorAt: "2026-04-01T00:00:00.000Z",
          condition: null,
          parentDeadlineSnapshot: parentSnapshot
        }
      ],
      holds: [],
      restrictions: [],
      requestedUse: null,
      now: "2026-04-25T00:00:00.000Z"
    };
    expect(
      evaluateInboxV2Lifecycle(completeEvaluationInput(input))
    ).toMatchObject({
      outcome: "retained_until",
      eligibleAt: "2026-05-01T00:00:00.000Z",
      purposeDeadlines: [
        {
          parentDeadlineSnapshot: {
            streamEpoch: "epoch:file-1",
            syncGeneration: "2",
            completeThroughPosition: "150",
            snapshotHash: `sha256:${"f".repeat(64)}`
          }
        }
      ]
    });
    expect(
      evaluateInboxV2Lifecycle(
        completeEvaluationInput({
          ...input,
          purposes: [{ ...input.purposes[0]!, parentDeadlineSnapshot: null }]
        })
      )
    ).toEqual({
      outcome: "rejected",
      errorCode: "privacy.parent_deadline_required"
    });
    expect(
      evaluateInboxV2Lifecycle(
        completeEvaluationInput({
          ...input,
          purposes: [
            {
              ...input.purposes[0]!,
              parentDeadlineSnapshot: {
                ...parentSnapshot,
                resolvedAt: "2026-04-24T00:00:00.000Z"
              }
            }
          ]
        })
      )
    ).toEqual({
      outcome: "rejected",
      errorCode: "privacy.parent_deadline_required"
    });
    expect(
      evaluateInboxV2Lifecycle({
        ...completeEvaluationInput(input),
        purposes: [
          {
            ...input.purposes[0]!,
            parentDeadlineSnapshot: {
              ...parentSnapshot,
              parentSet: { kind: "live_parents", parents: [] }
            }
          }
        ]
      })
    ).toEqual({ outcome: "rejected", errorCode: "privacy.policy_invalid" });
  });

  it("returns exact hold revision/review and does not let restriction extend retention", () => {
    const policy = resolvePolicy();
    const blocked = evaluate(policy, { holds: [hold()] });
    expect(blocked).toMatchObject({
      outcome: "blocked_by_legal_hold",
      hold: { tenantId, holdId: "hold:case-1", revision: "7" },
      reviewAt: "2026-08-01T00:00:00.000Z"
    });
    const heldWithProspectiveRestriction = evaluate(policy, {
      holds: [hold()],
      restrictions: [
        {
          ...restriction(),
          scope: {
            kind: "prospective",
            matcherHandlerId: "core:prospective-scope-matcher",
            matcherVersion: "1",
            predicateHash: `sha256:${"2".repeat(64)}`,
            manifest: exactScope().manifest,
            futureMatch: "match_until_release"
          }
        }
      ]
    });
    expect(heldWithProspectiveRestriction).toMatchObject({
      outcome: "blocked_by_legal_hold",
      restriction: { state: "not_evaluated_due_to_hold" }
    });

    const unrestricted = evaluate(policy);
    const restricted = evaluate(policy, {
      restrictions: [restriction()],
      requestedUse: "manager_reporting"
    });
    expect(restricted.outcome).toBe(unrestricted.outcome);
    if (
      restricted.outcome === "eligible_for_action" &&
      unrestricted.outcome === "eligible_for_action"
    ) {
      expect(restricted.eligibleAt).toBe(unrestricted.eligibleAt);
      expect(restricted.restriction.references).toEqual([
        { tenantId, restrictionId: "restriction:case-1", revision: "3" }
      ]);
      expect(restricted.restriction.requestedUseAllowed).toBe(false);
    }
    expect(() =>
      evaluate(policy, {
        restrictions: [
          {
            ...restriction(),
            continuingPurposeIds: ["core:manager_reporting"]
          }
        ]
      })
    ).toThrow(/not registered/u);
  });
});
