import {
  INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION,
  INBOX_V2_LEGAL_HOLD_SCHEMA_ID,
  calculateInboxV2PrivacyScopeManifestHash,
  inboxV2EmployeeIdSchema,
  inboxV2LegalHoldSchema,
  type InboxV2EntityKey
} from "@hulee/contracts";
import {
  type InboxV2AuthorizationPlanInput,
  type InboxV2PermissionId,
  type InboxV2PolicyGrant,
  type InboxV2PolicyGuardEvidence
} from "@hulee/core";
import { describe, expect, it } from "vitest";

import {
  createInboxV2ScenarioAuthorization,
  inboxV2CanonicalScenarioGuard,
  inboxV2ScenarioContractIds,
  inboxV2ScenarioEntity,
  inboxV2ScenarioLater,
  inboxV2ScenarioNotAfter,
  inboxV2ScenarioNow,
  inboxV2ScenarioStateSchema,
  type InboxV2ScenarioState
} from "./scenario-fixtures";
import {
  createInboxV2ScenarioWorld,
  executeInboxV2ScenarioStep,
  getInboxV2ScenarioRecord,
  snapshotInboxV2ScenarioWorld,
  type InboxV2ScenarioSeedRecord,
  type InboxV2ScenarioStep
} from "./scenario-world";

const tenantId = "tenant:scenario-privacy";
const actorId = inboxV2EmployeeIdSchema.parse("employee:privacy-executor");
const requesterId = inboxV2EmployeeIdSchema.parse("employee:privacy-requester");
const approverId = inboxV2EmployeeIdSchema.parse("employee:privacy-approver");

const policyResource = entity(
  "core:data-lifecycle-policy",
  "data_lifecycle_policy:scenario"
);
const policyGovernanceResource = entity(
  "core:governance-context",
  "governance_context:scenario"
);
const policyGovernanceRelationResource = entity(
  "core:privacy-policy-governance-binding",
  "privacy_policy_governance_binding:scenario"
);
const holdResource = entity("core:privacy-hold", "hold:scenario-active");
const unrelatedHoldResource = entity(
  "core:privacy-hold",
  "hold:scenario-unrelated"
);
const holdManifestResource = entity(
  "core:privacy-hold-scope-manifest",
  "privacy_hold_scope_manifest:scenario-active"
);
const holdRootResource = entity(
  "core:storage-root",
  "storage_root:scenario-hold"
);
const exportResource = entity(
  "core:privacy-export-job",
  "privacy_export_job:scenario"
);
const exportManifestResource = entity(
  "core:privacy-tenant-export-manifest",
  "privacy_tenant_export_manifest:scenario"
);
const exportGraphResource = entity(
  "core:tenant-resource-graph",
  "tenant_resource_graph:scenario"
);
const exportRootResource = entity(
  "core:storage-root",
  "storage_root:scenario-export"
);
const exportApprovalResource = entity(
  "core:privacy-tenant-export-approval",
  "privacy_tenant_export_approval:scenario"
);
const exportRequesterRelationResource = entity(
  "core:privacy-tenant-export-requester",
  "privacy_tenant_export_requester:scenario"
);
const deletionPlanResource = entity(
  "core:privacy-deletion-plan",
  "privacy_deletion_plan:scenario"
);
const deletionManifestResource = entity(
  "core:privacy-scope-manifest",
  "privacy_scope_manifest:scenario"
);
const deletionHoldIndexResource = entity(
  "core:privacy-deletion-hold-index",
  "privacy_deletion_hold_index:scenario"
);
const deletionApprovalResource = entity(
  "core:privacy-deletion-approval",
  "privacy_deletion_approval:scenario"
);
const deletionRequesterRelationResource = entity(
  "core:privacy-deletion-plan-requester",
  "privacy_deletion_plan_requester:scenario"
);
const deletionRootResource = entity(
  "core:conversation",
  "conversation:privacy-scenario"
);
const unrelatedDeletionRootResource = entity(
  "core:conversation",
  "conversation:privacy-unrelated"
);
const deletionRootRelationResource = entity(
  "core:privacy-deletion-plan-root",
  "privacy_deletion_plan_root:scenario"
);
const deletionHandlerResource = entity(
  "core:privacy-delete-handler",
  "privacy_delete_handler:scenario"
);
const deletionHandlerRelationResource = entity(
  "core:privacy-deletion-plan-handler",
  "privacy_deletion_plan_handler:scenario"
);
const actorResource = employeeResource(actorId);
const requesterResource = employeeResource(requesterId);
const approverResource = employeeResource(approverId);

type DeletionGuard = Extract<
  InboxV2PolicyGuardEvidence,
  { profileId: "core:rbac.guard.privacy_deletion_plan_revisions" }
>;
type EmployeePolicyGrant = Extract<
  InboxV2PolicyGrant,
  { principal: { kind: "employee" } }
>;

describe("INB2-CON-009 privacy and lifecycle scenarios", () => {
  it("routes lifecycle policy, hold, export and deletion decisions through their exact permissions", () => {
    const cases = [
      {
        action: "policy_view",
        permissionId: "core:privacy.policy.view",
        authorization: policyViewAuthorization()
      },
      {
        action: "hold_view",
        permissionId: "core:privacy.hold.view",
        authorization: holdViewAuthorization()
      },
      {
        action: "tenant_export",
        permissionId: "core:privacy.tenant_export",
        authorization: tenantExportAuthorization()
      },
      {
        action: "deletion_preview",
        permissionId: "core:privacy.deletion.preview",
        authorization: deletionPreviewAuthorization()
      }
    ] as const;
    let world = privacyWorld();

    for (const scenario of cases) {
      const result = executeInboxV2ScenarioStep(
        world,
        decisionStep(scenario.action, scenario.authorization)
      );
      expect(result.outcome, decisionDetails(result)).toBe("committed");
      if (result.outcome !== "committed") return;
      expect(result.authorization.requirements[0]).toMatchObject({
        permissionId: scenario.permissionId
      });
      expect(privacyState(result.world)).toMatchObject({
        action: scenario.action,
        status: "allowed"
      });
      world = result.world;
    }

    expect(world.commits).toHaveLength(cases.length);
    expect(world.events).toHaveLength(cases.length);
    expect(world.outboxIntents).toHaveLength(0);

    const initial = privacyWorld();
    const before = snapshotInboxV2ScenarioWorld(initial);
    for (const [index, authorization] of [
      holdViewAuthorization(),
      tenantExportAuthorization(),
      deletionPreviewAuthorization()
    ].entries()) {
      const denied = executeInboxV2ScenarioStep(
        initial,
        deniedStep(
          `wrong-permission-${index + 1}`,
          withOnlyPermissionGrant(authorization, "core:privacy.policy.view")
        )
      );
      expect(denied.outcome).toBe("rejected");
      expect(denied.world).toBe(initial);
      expect(snapshotInboxV2ScenarioWorld(denied.world)).toEqual(before);
    }
  });

  it.each([
    { label: "no legal hold", legalHold: "none" as const },
    { label: "an unrelated active legal hold", legalHold: "unrelated" as const }
  ])("allows deletion execute with $label", ({ label, legalHold }) => {
    const world = privacyWorld({ legalHold });
    const persistedHolds = world.records.filter(
      (record) => record.schemaId === INBOX_V2_LEGAL_HOLD_SCHEMA_ID
    );
    expect(persistedHolds, label).toHaveLength(legalHold === "none" ? 0 : 1);
    if (legalHold === "unrelated") {
      expect(
        inboxV2LegalHoldSchema.parse(persistedHolds[0]?.value)
      ).toMatchObject({
        state: "active",
        scope: {
          kind: "exact",
          targets: [unrelatedDeletionRootResource]
        }
      });
    }
    const authorization = deletionExecuteAuthorization(world);
    expect(deletionGuardFrom(authorization).holdState, label).toBe("clear");

    const result = executeInboxV2ScenarioStep(
      world,
      decisionStep(`delete-${legalHold}`, authorization)
    );

    expect(result.outcome, decisionDetails(result)).toBe("committed");
    if (result.outcome !== "committed") return;
    expect(privacyState(result.world)).toMatchObject({
      action: `delete-${legalHold}`,
      status: "allowed"
    });
    expect(result.world.commits).toHaveLength(1);
    expect(result.world.events).toHaveLength(1);
    expect(result.world.outboxIntents).toHaveLength(0);
  });

  it("blocks deletion behind an exact active legal hold without changing state, events or outbox", () => {
    const world = privacyWorld({ legalHold: "exact" });
    const before = snapshotInboxV2ScenarioWorld(world);
    const holdRecord = getInboxV2ScenarioRecord(world, holdResource);
    expect(holdRecord).not.toBeNull();
    expect(inboxV2LegalHoldSchema.parse(holdRecord?.value)).toMatchObject({
      state: "active",
      id: holdResource.entityId,
      scope: { kind: "exact", targets: [deletionRootResource] }
    });
    const authorization = deletionExecuteAuthorization(world);
    expect(deletionGuardFrom(authorization).holdState).toBe("active");

    const result = executeInboxV2ScenarioStep(
      world,
      deniedStep("delete-active-hold", authorization)
    );

    expect(result).toMatchObject({
      outcome: "rejected",
      authorization: { publicErrorCode: "privacy.hold_active" }
    });
    expect(result.world).toBe(world);
    expect(result.world.events).toHaveLength(before.events.length);
    expect(result.world.outboxIntents).toHaveLength(
      before.outboxIntents.length
    );
    expect(snapshotInboxV2ScenarioWorld(result.world)).toEqual(before);
  });
});

function policyViewAuthorization() {
  return createInboxV2ScenarioAuthorization({
    tenantId,
    employeeId: actorId,
    requirements: [
      {
        id: "privacy-policy-view",
        permissionId: "core:privacy.policy.view",
        resource: policyResource,
        guard: privacyPolicyViewGuard()
      }
    ],
    grants: [
      {
        id: "privacy-policy-view-grant",
        permissionId: "core:privacy.policy.view"
      }
    ]
  });
}

function holdViewAuthorization() {
  return createInboxV2ScenarioAuthorization({
    tenantId,
    employeeId: actorId,
    requirements: [
      {
        id: "privacy-hold-view",
        permissionId: "core:privacy.hold.view",
        resource: holdResource,
        guard: privacyHoldViewGuard()
      }
    ],
    grants: [
      { id: "privacy-hold-view-grant", permissionId: "core:privacy.hold.view" }
    ]
  });
}

function tenantExportAuthorization(): InboxV2AuthorizationPlanInput {
  const guard = privacyTenantExportGuard();
  const authorization = createInboxV2ScenarioAuthorization({
    tenantId,
    employeeId: actorId,
    requirements: [
      {
        id: "privacy-tenant-export",
        permissionId: "core:privacy.tenant_export",
        resource: exportResource,
        guard
      },
      {
        id: guard.approverDirectoryRequirementId,
        permissionId: "core:employee.directory.view",
        resource: approverResource,
        guard: inboxV2CanonicalScenarioGuard("none"),
        visibility: "secondary_hidden"
      }
    ],
    grants: [
      {
        id: "privacy-tenant-export-actor-grant",
        permissionId: "core:privacy.tenant_export"
      },
      {
        id: "privacy-tenant-export-directory-grant",
        permissionId: "core:employee.directory.view"
      }
    ]
  });
  return addIndependentEmployeeGrant(authorization, {
    id: guard.approverGrantId,
    employeeId: approverId,
    permissionId: "core:privacy.tenant_export"
  });
}

function deletionPreviewAuthorization() {
  return createInboxV2ScenarioAuthorization({
    tenantId,
    employeeId: actorId,
    requirements: [
      {
        id: "privacy-deletion-preview",
        permissionId: "core:privacy.deletion.preview",
        resource: deletionPlanResource,
        guard: privacyDeletionGuard("preview", "clear")
      }
    ],
    grants: [
      {
        id: "privacy-deletion-preview-grant",
        permissionId: "core:privacy.deletion.preview"
      }
    ]
  });
}

function deletionExecuteAuthorization(
  world: ReturnType<typeof privacyWorld>
): InboxV2AuthorizationPlanInput {
  const guard = privacyDeletionGuard("execute", deriveDeletionHoldState(world));
  const approval = guard.approvalEvidence;
  if (approval === null) {
    throw new Error("Execute guard requires approval evidence.");
  }
  const authorization = createInboxV2ScenarioAuthorization({
    tenantId,
    employeeId: actorId,
    requirements: [
      {
        id: "privacy-deletion-execute",
        permissionId: "core:privacy.deletion.execute",
        resource: deletionPlanResource,
        guard
      },
      {
        id: approval.approverDirectoryRequirementId,
        permissionId: "core:employee.directory.view",
        resource: approval.approverEmployeeResource,
        guard: inboxV2CanonicalScenarioGuard("none"),
        visibility: "secondary_hidden"
      }
    ],
    grants: [
      {
        id: "privacy-deletion-execute-grant",
        permissionId: "core:privacy.deletion.execute"
      },
      {
        id: "privacy-deletion-approver-directory-grant",
        permissionId: "core:employee.directory.view"
      }
    ]
  });
  return addIndependentEmployeeGrant(authorization, {
    id: approval.approverGrantId,
    employeeId: approverId,
    permissionId: "core:privacy.deletion.approve"
  });
}

function privacyPolicyViewGuard(): InboxV2PolicyGuardEvidence {
  return {
    profileId: "core:rbac.guard.privacy_policy_revision",
    targetResource: policyResource,
    policyId: "scenario",
    governanceContextId: "scenario",
    governanceContextResource: policyGovernanceResource,
    governanceRelationResource: policyGovernanceRelationResource,
    governancePolicyResource: policyResource,
    governanceRelationContextResource: policyGovernanceResource,
    governanceRevisionChecks: keyed([
      policyGovernanceRelationResource,
      policyResource,
      policyGovernanceResource
    ]),
    expectedGovernanceRevision: "1",
    currentGovernanceRevision: "1",
    expectedPolicyRevision: "1",
    currentPolicyRevision: "1",
    phase: "view",
    actingEmployeeId: actorId,
    requesterEmployeeId: actorId,
    approverEmployeeId: null,
    activationEvidence: null,
    contentAuthorityRequested: false
  };
}

function privacyHoldViewGuard(): InboxV2PolicyGuardEvidence {
  return {
    profileId: "core:rbac.guard.privacy_hold_manifest_revision",
    targetResource: holdResource,
    holdId: "scenario-active",
    manifestAuthenticity: "authentic",
    manifestResource: holdManifestResource,
    manifestHoldResource: holdResource,
    rootResources: [holdRootResource],
    manifestRootResources: [holdRootResource],
    manifestRevisionChecks: keyed([
      holdManifestResource,
      holdResource,
      holdRootResource
    ]),
    expectedManifestRevision: "1",
    currentManifestRevision: "1",
    lastReviewedAt: "2026-07-13T08:00:00.000Z",
    nextReviewAt: inboxV2ScenarioNotAfter,
    phase: "view",
    actingEmployeeId: actorId,
    reason: "",
    reviewerEmployeeId: null,
    issuerEmployeeId: null,
    releaserEmployeeId: null,
    issuerEvidence: null,
    approvalEvidence: null,
    contentAuthorityRequested: false
  };
}

function privacyTenantExportGuard() {
  const approverDirectoryRequirementId =
    "privacy-export-approver-directory-scenario";
  const approverGrantId = "privacy-export-approver-grant-scenario";
  return {
    profileId: "core:rbac.guard.privacy_tenant_export_high_water" as const,
    targetResource: exportResource,
    exportId: "scenario",
    manifestResource: exportManifestResource,
    manifestExportResource: exportResource,
    manifestRequesterEmployeeResource: actorResource,
    manifestRequesterRelationResource: exportRequesterRelationResource,
    graphResource: exportGraphResource,
    manifestGraphResource: exportGraphResource,
    rootResources: [exportRootResource],
    manifestRootResources: [exportRootResource],
    manifestRevisionChecks: keyed([
      exportManifestResource,
      exportResource,
      exportRequesterRelationResource,
      actorResource,
      exportGraphResource,
      exportRootResource
    ]),
    expectedGraphHighWater: "10",
    currentGraphHighWater: "10",
    actingEmployeeId: actorId,
    requesterEmployeeId: actorId,
    requesterEmployeeResource: actorResource,
    requesterRelationResource: exportRequesterRelationResource,
    requesterRelationExportResource: exportResource,
    requesterRelationEmployeeResource: actorResource,
    requesterRevisionChecks: keyed([
      exportRequesterRelationResource,
      exportResource,
      actorResource
    ]),
    approverEmployeeId: approverId,
    approvalResource: exportApprovalResource,
    approvalExportResource: exportResource,
    approvalManifestResource: exportManifestResource,
    approvalRequesterEmployeeResource: actorResource,
    approvalRequesterRelationResource: exportRequesterRelationResource,
    approvalGraphResource: exportGraphResource,
    approvalGraphHighWater: "10",
    approvalRootResources: [exportRootResource],
    approvalPiiAuthorityResource: null,
    approvalApproverEmployeeResource: approverResource,
    approverLifecycle: "active" as const,
    approverDirectoryRequirementId,
    approverGrantId,
    approvalState: "approved" as const,
    approvalRevisionChecks: keyed([
      exportApprovalResource,
      exportResource,
      exportManifestResource,
      exportRequesterRelationResource,
      actorResource,
      exportGraphResource,
      approverResource,
      exportRootResource
    ]),
    approvalNotAfter: inboxV2ScenarioNotAfter,
    authorizationAppliedBeforePaginationAndMaterialization: true,
    secretsIncluded: false as const,
    piiIncluded: false,
    piiAuthorityResource: null,
    piiRequirementId: null
  } satisfies InboxV2PolicyGuardEvidence;
}

function privacyDeletionGuard(
  phase: "preview" | "execute",
  holdState: "clear" | "active"
): DeletionGuard {
  const requesterEmployeeId = phase === "preview" ? actorId : requesterId;
  const requesterEmployeeResource =
    phase === "preview" ? actorResource : requesterResource;
  const roots = [
    {
      resource: deletionRootResource,
      rootKind: "sql" as const,
      boundary: "operated_data_plane" as const,
      relationResource: deletionRootRelationResource,
      relationPlanResource: deletionPlanResource,
      relationRootResource: deletionRootResource,
      revisionChecks: keyed([
        deletionRootRelationResource,
        deletionPlanResource,
        deletionRootResource
      ])
    }
  ];
  const handlers = [
    {
      resource: deletionHandlerResource,
      rootResource: deletionRootResource,
      relationResource: deletionHandlerRelationResource,
      relationPlanResource: deletionPlanResource,
      relationRootResource: deletionRootResource,
      relationHandlerResource: deletionHandlerResource,
      revisionChecks: keyed([
        deletionHandlerRelationResource,
        deletionPlanResource,
        deletionRootResource,
        deletionHandlerResource
      ]),
      surfaceKind: "sql" as const,
      executionMode:
        phase === "execute" ? ("operated_io" as const) : ("none" as const),
      externalOutcome: null,
      externalProvider: null
    }
  ];
  const manifestResources = [
    deletionManifestResource,
    deletionPlanResource,
    deletionRequesterRelationResource,
    requesterEmployeeResource,
    deletionRootResource,
    deletionHandlerResource
  ];
  const approvalEvidence =
    phase === "execute"
      ? {
          resource: deletionApprovalResource,
          planResource: deletionPlanResource,
          manifestResource: deletionManifestResource,
          requesterEmployeeResource,
          requesterRelationResource: deletionRequesterRelationResource,
          approverEmployeeResource: approverResource,
          approverEmployeeId: approverId,
          approverLifecycle: "active" as const,
          approverDirectoryRequirementId:
            "privacy-deletion-approver-directory-scenario",
          approverGrantId: "privacy-deletion-approver-grant-scenario",
          state: "approved" as const,
          revisionChecks: keyed([
            deletionApprovalResource,
            deletionPlanResource,
            deletionManifestResource,
            deletionRequesterRelationResource,
            requesterEmployeeResource,
            approverResource,
            deletionRootResource,
            deletionHandlerResource
          ]),
          notAfter: inboxV2ScenarioNotAfter
        }
      : null;

  return {
    profileId: "core:rbac.guard.privacy_deletion_plan_revisions",
    targetResource: deletionPlanResource,
    deletionPlanId: "scenario",
    expectedPlanRevision: "1",
    currentPlanRevision: "1",
    manifestResource: deletionManifestResource,
    manifestTargetResource: deletionPlanResource,
    manifestRequesterEmployeeResource: requesterEmployeeResource,
    manifestRequesterRelationResource: deletionRequesterRelationResource,
    manifestRootResources: [deletionRootResource],
    manifestHandlerResources: [deletionHandlerResource],
    manifestRevisionChecks: keyed(manifestResources),
    roots,
    handlers,
    requesterEmployeeResource,
    requesterRelationResource: deletionRequesterRelationResource,
    requesterRelationPlanResource: deletionPlanResource,
    requesterRelationEmployeeResource: requesterEmployeeResource,
    requesterRevisionChecks: keyed([
      deletionRequesterRelationResource,
      deletionPlanResource,
      requesterEmployeeResource
    ]),
    holdIndexResource: deletionHoldIndexResource,
    holdIndexPlanResource: deletionPlanResource,
    holdIndexRootResources: [deletionRootResource],
    holdState,
    holdRevisionChecks: keyed([
      deletionHoldIndexResource,
      deletionPlanResource,
      deletionRootResource
    ]),
    holdFenceCheckedAt: inboxV2ScenarioNow,
    holdFenceNotAfter: inboxV2ScenarioNotAfter,
    phase,
    actingEmployeeId: actorId,
    requesterEmployeeId,
    approverEmployeeId: phase === "execute" ? approverId : null,
    executorEmployeeId: phase === "execute" ? actorId : null,
    approvalEvidence,
    coolingPeriodEndsAt: "2026-07-13T08:00:00.000Z",
    ioRequested: phase === "execute"
  };
}

function privacyWorld(
  input: { legalHold?: "none" | "exact" | "unrelated" } = {}
) {
  const state: InboxV2ScenarioState = {
    tenantId,
    kind: "privacy_decision",
    conversationId: null,
    clientIds: [],
    participantIds: [],
    employeeAnchorIds: [],
    ownerEmployeeIds: [],
    workItemId: null,
    primaryResponsibleEmployeeId: null,
    groupBindingId: null,
    senderPrivateIdentityId: null,
    physicalMessageIds: [],
    action: null,
    status: "ready",
    revision: "1"
  };
  const stateRecord: InboxV2ScenarioSeedRecord<InboxV2ScenarioState> = {
    entity: privacyStateEntity(),
    revision: "1",
    schemaId: inboxV2ScenarioContractIds.scenarioState,
    schemaVersion: "v1",
    schema: inboxV2ScenarioStateSchema,
    value: state
  };
  const records: readonly InboxV2ScenarioSeedRecord[] = [
    stateRecord,
    ...(input.legalHold === "exact"
      ? [
          {
            entity: holdResource,
            revision: "1",
            schemaId: INBOX_V2_LEGAL_HOLD_SCHEMA_ID,
            schemaVersion: INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION,
            schema: inboxV2LegalHoldSchema,
            value: activeLegalHold()
          }
        ]
      : input.legalHold === "unrelated"
        ? [
            {
              entity: unrelatedHoldResource,
              revision: "1",
              schemaId: INBOX_V2_LEGAL_HOLD_SCHEMA_ID,
              schemaVersion: INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION,
              schema: inboxV2LegalHoldSchema,
              value: activeLegalHold({
                hold: unrelatedHoldResource,
                target: unrelatedDeletionRootResource,
                manifestId: "scope-manifest:scenario-unrelated",
                recordId: "data_root:privacy-unrelated"
              })
            }
          ]
        : [])
  ];
  return createInboxV2ScenarioWorld({ tenantId, records });
}

function activeLegalHold(
  input: {
    hold?: InboxV2EntityKey;
    target?: InboxV2EntityKey;
    manifestId?: string;
    recordId?: string;
  } = {}
) {
  const hold = input.hold ?? holdResource;
  const target = input.target ?? deletionRootResource;
  const manifestWithoutHash = {
    tenantId,
    id: input.manifestId ?? "scope-manifest:scenario-active",
    revision: "1",
    frozenAt: inboxV2ScenarioNow,
    roots: [
      {
        root: {
          tenantId,
          dataClassId: "core:message_content_blocks",
          storageRootId: "core:message-content-sql",
          recordId: input.recordId ?? "data_root:privacy-scenario"
        },
        entity: target,
        expectedEntityRevision: "1",
        expectedLineageRevision: "1",
        rootKind: "sql" as const,
        boundary: "operated_data_plane" as const,
        copyRole: "primary" as const
      }
    ]
  };
  const manifest = {
    ...manifestWithoutHash,
    manifestHash: calculateInboxV2PrivacyScopeManifestHash(manifestWithoutHash)
  };
  return inboxV2LegalHoldSchema.parse({
    tenantId,
    id: hold.entityId,
    revision: "1",
    caseId: "case:privacy-scenario",
    dataClassIds: ["core:message_content_blocks"],
    scope: {
      kind: "exact",
      targets: [target],
      manifest,
      futureMatch: "none"
    },
    anchorFrom: "2026-01-01T00:00:00.000Z",
    anchorThrough: "2026-12-31T23:59:59.999Z",
    owner: { tenantId, kind: "employee", id: actorId },
    approver: { tenantId, kind: "employee", id: approverId },
    reasonCode: "core:legal-claim",
    legalReferenceCode: "core:case-reference",
    endCondition: {
      id: "core:legal-case-closed",
      version: "1",
      resolverHandlerId: "core:condition-resolver"
    },
    effectiveAt: "2026-01-01T00:00:00.000Z",
    reviewAt: "2026-12-01T00:00:00.000Z",
    state: "active"
  });
}

function deriveDeletionHoldState(
  world: ReturnType<typeof privacyWorld>
): "clear" | "active" {
  const hasExactActiveHold = world.records.some((record) => {
    if (
      record.state !== "upsert" ||
      record.schemaId !== INBOX_V2_LEGAL_HOLD_SCHEMA_ID ||
      record.entity.entityTypeId !== "core:privacy-hold"
    ) {
      return false;
    }
    const hold = inboxV2LegalHoldSchema.parse(record.value);
    return (
      String(hold.id) === String(record.entity.entityId) &&
      hold.revision === record.revision &&
      hold.tenantId === world.tenantId &&
      hold.state === "active" &&
      Date.parse(hold.effectiveAt) <= Date.parse(inboxV2ScenarioNow) &&
      hold.scope.kind === "exact" &&
      hold.scope.targets.some((target) =>
        sameEntity(target, deletionRootResource)
      )
    );
  });
  return hasExactActiveHold ? "active" : "clear";
}

function deletionGuardFrom(
  authorization: InboxV2AuthorizationPlanInput
): DeletionGuard {
  const guard = authorization.requirements.find(
    (requirement) =>
      requirement.guard.profileId ===
      "core:rbac.guard.privacy_deletion_plan_revisions"
  )?.guard;
  if (guard?.profileId !== "core:rbac.guard.privacy_deletion_plan_revisions") {
    throw new Error("Missing deletion authorization guard.");
  }
  return guard;
}

function decisionStep(
  action: string,
  authorization: InboxV2AuthorizationPlanInput
): InboxV2ScenarioStep {
  return step(action, authorization, ({ requireRecord }) => {
    const current = requireRecord(privacyStateEntity());
    const resultingRevision = (BigInt(current.revision) + 1n).toString();
    const value: InboxV2ScenarioState = {
      ...(current.value as InboxV2ScenarioState),
      action,
      status: "allowed",
      revision: resultingRevision
    };
    return {
      kind: "commit",
      changes: [
        {
          entity: privacyStateEntity(),
          expectedRevision: current.revision,
          resultingRevision,
          schemaId: inboxV2ScenarioContractIds.scenarioState,
          schema: inboxV2ScenarioStateSchema,
          value,
          audience: "policy_filtered"
        }
      ]
    };
  });
}

function deniedStep(
  action: string,
  authorization: InboxV2AuthorizationPlanInput
): InboxV2ScenarioStep {
  return step(action, authorization, () => ({
    kind: "reject",
    errorCode: "authorization.unexpectedly_allowed"
  }));
}

function step(
  id: string,
  authorization: InboxV2AuthorizationPlanInput,
  transition: InboxV2ScenarioStep["transition"]
): InboxV2ScenarioStep {
  const token = id.replaceAll(/[^A-Za-z0-9]/gu, "-");
  return {
    id,
    commandId: `scenario-command:privacy-${token}`,
    requestId: `scenario-request:privacy-${token}`,
    clientMutationId: `scenario-mutation:privacy-${token}`,
    requestHash: `sha256:${"b".repeat(64)}`,
    committedAt: inboxV2ScenarioLater,
    authorization,
    transition
  };
}

function addIndependentEmployeeGrant(
  authorization: InboxV2AuthorizationPlanInput,
  input: {
    id: string;
    employeeId: typeof approverId;
    permissionId: InboxV2PermissionId;
  }
): InboxV2AuthorizationPlanInput {
  const template = authorization.grants.find(isEmployeePolicyGrant);
  if (template === undefined) {
    throw new Error("Scenario authorization requires a direct-grant template.");
  }
  const grant = {
    ...template,
    id: input.id,
    principal: { kind: "employee" as const, employeeId: input.employeeId },
    permissionId: input.permissionId,
    source: {
      kind: "direct_grant" as const,
      origin: "inbox_v2_native" as const,
      directGrantId: `direct-${input.id}`,
      bindingResource: entity(
        "core:direct-grant",
        `direct_grant:direct-${input.id}`
      ),
      bindingRevision: template.source.bindingRevision
    }
  } satisfies InboxV2PolicyGrant;
  return { ...authorization, grants: [...authorization.grants, grant] };
}

function withOnlyPermissionGrant(
  authorization: InboxV2AuthorizationPlanInput,
  permissionId: InboxV2PermissionId
): InboxV2AuthorizationPlanInput {
  const template = authorization.grants.find(
    (grant): grant is EmployeePolicyGrant =>
      isEmployeePolicyGrant(grant) && grant.principal.employeeId === actorId
  );
  if (template === undefined) {
    throw new Error("Scenario authorization requires an actor grant.");
  }
  const grant = {
    ...template,
    id: "wrong-policy-view-grant",
    permissionId,
    source: {
      kind: "direct_grant" as const,
      origin: "inbox_v2_native" as const,
      directGrantId: "direct-wrong-policy-view-grant",
      bindingResource: entity(
        "core:direct-grant",
        "direct_grant:direct-wrong-policy-view-grant"
      ),
      bindingRevision: template.source.bindingRevision
    }
  } satisfies InboxV2PolicyGrant;
  return { ...authorization, grants: [grant] };
}

function isEmployeePolicyGrant(
  grant: InboxV2PolicyGrant
): grant is EmployeePolicyGrant {
  return grant.principal.kind === "employee";
}

function privacyState(world: ReturnType<typeof privacyWorld>) {
  const record = getInboxV2ScenarioRecord(world, privacyStateEntity());
  if (record === null) throw new Error("Missing privacy scenario state.");
  return inboxV2ScenarioStateSchema.parse(record.value);
}

function privacyStateEntity() {
  return entity(
    "module:hulee-testing:scenario-state",
    "scenario_state:privacy"
  );
}

function employeeResource(employeeId: string) {
  return entity("core:employee", employeeId);
}

function entity(entityTypeId: string, entityId: string) {
  return inboxV2ScenarioEntity(tenantId, entityTypeId, entityId);
}

function sameEntity(left: InboxV2EntityKey, right: InboxV2EntityKey) {
  return (
    left.tenantId === right.tenantId &&
    left.entityTypeId === right.entityTypeId &&
    left.entityId === right.entityId
  );
}

function keyed(resources: readonly InboxV2EntityKey[]) {
  return resources.map((resource) => ({
    resource,
    expected: "1",
    actual: "1"
  }));
}

function decisionDetails(
  result: ReturnType<typeof executeInboxV2ScenarioStep>
) {
  return result.outcome === "rejected"
    ? JSON.stringify(result.authorization)
    : result.outcome;
}
