import {
  inboxV2AuthorizationDependencyVectorSchema,
  inboxV2AuthorizationEpochSchema,
  inboxV2AuthorizationEpochSnapshotSchema,
  inboxV2ConversationIdSchema,
  inboxV2EmployeeIdSchema,
  inboxV2EmployeeReferenceSchema,
  inboxV2EntityKeySchema,
  inboxV2EntityRevisionSchema,
  inboxV2TenantIdSchema,
  type InboxV2AuthorizationDependencyVector,
  type InboxV2EntityKey
} from "@hulee/contracts";
import { describe, expect, it } from "vitest";

import {
  deriveInboxV2Capabilities,
  evaluateInboxV2AuthorizationPlan,
  type InboxV2AuthorizationPlanInput,
  type InboxV2AuthorizationRequirement,
  type InboxV2PermissionId,
  type InboxV2PermissionScope,
  type InboxV2PolicyGrant,
  type InboxV2PolicyGuardEvidence
} from "./index";

const NOW = "2026-07-12T10:00:00.000Z";
const OVERDUE = "2026-07-12T09:30:00.000Z";
const GRANT_END = "2026-07-12T10:30:00.000Z";
const SESSION_END = "2026-07-12T11:00:00.000Z";
const DIGEST = `sha256:${"e".repeat(64)}`;

const tenantId = inboxV2TenantIdSchema.parse("tenant:hold-export");
const otherTenantId = inboxV2TenantIdSchema.parse("tenant:hold-export-other");
const employeeId = inboxV2EmployeeIdSchema.parse("employee:hold-export-actor");
const approverEmployeeId = inboxV2EmployeeIdSchema.parse(
  "employee:hold-export-approver"
);
const issuerEmployeeId = inboxV2EmployeeIdSchema.parse(
  "employee:hold-export-issuer"
);
const employee = inboxV2EmployeeReferenceSchema.parse({
  tenantId,
  kind: "employee",
  id: employeeId
});
const revision = inboxV2EntityRevisionSchema.parse("1");
const epoch = inboxV2AuthorizationEpochSchema.parse(
  "authorization:hold-export"
);
const conversationId = inboxV2ConversationIdSchema.parse(
  "conversation:hold-export"
);

const approverEmployeeResource = resource(
  "core:employee",
  String(approverEmployeeId)
);
const conversationResource = resource(
  "core:conversation",
  String(conversationId)
);
const topologyResource = resource(
  "core:conversation-topology",
  "conversation_topology:hold-export"
);
const reportResource = resource(
  "core:report-query",
  "report_query:tenant-export-pii"
);

type HoldPermissionId =
  | "core:privacy.hold.view"
  | "core:privacy.hold.issue"
  | "core:privacy.hold.release";

type HoldFixture = ReturnType<typeof makeHoldFixture>;
type ExportFixture = ReturnType<typeof makeExportFixture>;

describe("Inbox V2 privacy hold authorization hardening", () => {
  it("keeps an overdue hold visible but blocks issue and release mutation", () => {
    const view = makeHoldFixture("view", OVERDUE);
    const viewDecision = evaluate(view);
    expect(viewDecision).toMatchObject({ outcome: "allowed" });

    for (const phase of ["issue", "release"] as const) {
      const mutation = makeHoldFixture(phase, OVERDUE);
      expect(evaluate(mutation)).toMatchObject({
        outcome: "denied",
        publicErrorCode: "privacy.scope_ambiguous"
      });
    }
  });

  it("binds the exact hold manifest, roots, approval, directory and grant", () => {
    const fixture = makeHoldFixture("issue", GRANT_END);
    expect(evaluate(fixture).outcome).toBe("allowed");
    const approval = fixture.guard.approvalEvidence!;

    const replacementManifest = resource(
      "core:privacy-hold-scope-manifest",
      "privacy_hold_scope_manifest:replacement"
    );
    const replacementRoot = resource(
      "core:storage-root",
      "storage_root:replacement"
    );
    const replacementApproval = resource(
      "core:privacy-hold-approval",
      "privacy_hold_approval:replacement"
    );
    const foreignRoot = resource(
      "core:storage-root",
      "storage_root:foreign",
      otherTenantId
    );
    const foreignIssuer = resource(
      "core:privacy-hold-issuer-binding",
      "privacy_hold_issuer_binding:foreign",
      otherTenantId
    );
    const foreignApproval = resource(
      "core:privacy-hold-approval",
      "privacy_hold_approval:foreign",
      otherTenantId
    );

    const deniedGuards: InboxV2PolicyGuardEvidence[] = [
      { ...fixture.guard, manifestResource: replacementManifest },
      {
        ...fixture.guard,
        rootResources: [replacementRoot],
        manifestRootResources: [replacementRoot]
      },
      {
        ...fixture.guard,
        manifestRevisionChecks: fixture.guard.manifestRevisionChecks.map(
          (check, index) => (index === 0 ? { ...check, actual: "2" } : check)
        )
      },
      {
        ...fixture.guard,
        rootResources: [foreignRoot],
        manifestRootResources: [foreignRoot],
        manifestRevisionChecks: keyed([
          fixture.guard.manifestResource,
          fixture.guard.targetResource,
          foreignRoot
        ])
      },
      {
        ...fixture.guard,
        approvalEvidence: { ...approval, resource: replacementApproval }
      },
      {
        ...fixture.guard,
        approvalEvidence: {
          ...approval,
          approverLifecycle: "draining"
        }
      },
      {
        ...fixture.guard,
        expectedManifestRevision: "2",
        currentManifestRevision: "2",
        manifestRevisionChecks: fixture.guard.manifestRevisionChecks.map(
          (check) => ({ ...check, expected: "2", actual: "2" })
        )
      },
      {
        ...fixture.guard,
        issuerEvidence: {
          ...fixture.guard.issuerEvidence!,
          resource: foreignIssuer,
          revisionChecks: fixture.guard.issuerEvidence!.revisionChecks.map(
            (check, index) =>
              index === 0 ? { ...check, resource: foreignIssuer } : check
          )
        }
      },
      {
        ...fixture.guard,
        approvalEvidence: {
          ...approval,
          resource: foreignApproval,
          revisionChecks: approval.revisionChecks.map((check, index) =>
            index === 0 ? { ...check, resource: foreignApproval } : check
          )
        }
      },
      {
        ...fixture.guard,
        approvalEvidence: {
          ...approval,
          manifestRootResources: [replacementRoot]
        }
      }
    ];
    for (const guard of deniedGuards) {
      expect(evaluate(fixture, guard).outcome).toBe("denied");
    }

    expect(evaluate(fixture, fixture.guard, [])).toMatchObject({
      outcome: "denied"
    });

    const wrongScopeGrants = fixture.grants.map((grant) =>
      grant.id === approval.approverGrantId
        ? {
            ...grant,
            scope: {
              type: "conversation" as const,
              tenantId,
              id: conversationId
            }
          }
        : grant
    );
    expect(
      evaluate(
        fixture,
        fixture.guard,
        fixture.supportingRequirements,
        wrongScopeGrants
      ).outcome
    ).toBe("denied");

    const release = makeHoldFixture("release", GRANT_END);
    expect(evaluate(release).outcome).toBe("allowed");
    expect(
      evaluate(release, {
        ...release.guard,
        // The scalar remains distinct from the releaser but no longer matches
        // the immutable hold-to-issuer binding.
        issuerEmployeeId: approverEmployeeId
      }).outcome
    ).toBe("denied");
  });

  it("does not turn hold authority into content authority", () => {
    const fixture = makeHoldFixture("view", OVERDUE);
    const holdDecision = evaluate(fixture);
    expect(holdDecision.outcome).toBe("allowed");
    if (holdDecision.outcome === "allowed") {
      expect(deriveInboxV2Capabilities(holdDecision)).toEqual([
        expect.objectContaining({ permissionId: "core:privacy.hold.view" })
      ]);
    }

    const contentRead = conversationReadRequirement("hold-content-read");
    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [fixture.primary, ...fixture.supportingRequirements, contentRead],
          fixture.grants
        )
      ).outcome
    ).toBe("denied");
  });
});

describe("Inbox V2 tenant export authorization hardening", () => {
  it("allows a current non-PII export with exact approval authority", () => {
    expect(evaluateExport(makeExportFixture()).outcome).toBe("allowed");
  });

  it("rejects substitutions, stale evidence, cross-tenant roots and late authorization", () => {
    const fixture = makeExportFixture();
    const replacementManifest = resource(
      "core:privacy-tenant-export-manifest",
      "privacy_tenant_export_manifest:replacement"
    );
    const replacementRoot = resource(
      "core:storage-root",
      "storage_root:export-replacement"
    );
    const replacementApproval = resource(
      "core:privacy-tenant-export-approval",
      "privacy_tenant_export_approval:replacement"
    );
    const foreignRoot = resource(
      "core:storage-root",
      "storage_root:export-foreign",
      otherTenantId
    );
    const foreignApproval = resource(
      "core:privacy-tenant-export-approval",
      "privacy_tenant_export_approval:foreign",
      otherTenantId
    );
    const deniedGuards: InboxV2PolicyGuardEvidence[] = [
      { ...fixture.guard, manifestResource: replacementManifest },
      {
        ...fixture.guard,
        rootResources: [replacementRoot],
        manifestRootResources: [replacementRoot]
      },
      {
        ...fixture.guard,
        manifestRevisionChecks: fixture.guard.manifestRevisionChecks.map(
          (check, index) => (index === 0 ? { ...check, actual: "2" } : check)
        )
      },
      {
        ...fixture.guard,
        rootResources: [foreignRoot],
        manifestRootResources: [foreignRoot],
        manifestRevisionChecks: keyed([
          fixture.guard.manifestResource,
          fixture.guard.targetResource,
          fixture.guard.graphResource,
          foreignRoot
        ])
      },
      { ...fixture.guard, approvalResource: replacementApproval },
      {
        ...fixture.guard,
        approvalRevisionChecks: fixture.guard.approvalRevisionChecks.map(
          (check, index) => (index === 0 ? { ...check, actual: "2" } : check)
        )
      },
      {
        ...fixture.guard,
        authorizationAppliedBeforePaginationAndMaterialization: false
      },
      {
        ...fixture.guard,
        secretsIncluded: true as unknown as false
      },
      {
        ...fixture.guard,
        manifestRevisionChecks: fixture.guard.manifestRevisionChecks.map(
          (check) => ({ ...check, expected: "2", actual: "2" })
        ),
        requesterRevisionChecks: fixture.guard.requesterRevisionChecks.map(
          (check) => ({ ...check, expected: "2", actual: "2" })
        )
      },
      {
        ...fixture.guard,
        approvalResource: foreignApproval,
        approvalRevisionChecks: fixture.guard.approvalRevisionChecks.map(
          (check, index) =>
            index === 0 ? { ...check, resource: foreignApproval } : check
        )
      },
      {
        ...fixture.guard,
        approvalRequesterEmployeeResource: approverEmployeeResource
      },
      {
        ...fixture.guard,
        approvalGraphResource: replacementRoot
      },
      {
        ...fixture.guard,
        approvalGraphHighWater: "9"
      },
      {
        ...fixture.guard,
        approvalRootResources: [replacementRoot]
      }
    ];
    for (const guard of deniedGuards) {
      expect(evaluateExport(fixture, guard).outcome).toBe("denied");
    }
  });

  it("requires an active exact-tenant approver grant and directory requirement", () => {
    const fixture = makeExportFixture();
    expect(evaluateExport(fixture, fixture.guard, []).outcome).toBe("denied");

    const wrongScopeGrants = fixture.grants.map((grant) =>
      grant.id === fixture.guard.approverGrantId
        ? {
            ...grant,
            scope: {
              type: "conversation" as const,
              tenantId,
              id: conversationId
            }
          }
        : grant
    );
    expect(
      evaluateExport(
        fixture,
        fixture.guard,
        fixture.supportingRequirements,
        wrongScopeGrants
      ).outcome
    ).toBe("denied");

    const revokedGrants = fixture.grants.map((grant) =>
      grant.id === fixture.guard.approverGrantId
        ? { ...grant, revokedAt: NOW }
        : grant
    );
    expect(
      evaluateExport(
        fixture,
        fixture.guard,
        fixture.supportingRequirements,
        revokedGrants
      ).outcome
    ).toBe("denied");
  });

  it("requires the explicit reports.pii.export companion for PII", () => {
    const fixture = makeExportFixture();
    const piiGuard = {
      ...fixture.guard,
      piiIncluded: true,
      piiAuthorityResource: reportResource,
      piiRequirementId: "tenant-export-pii",
      approvalPiiAuthorityResource: reportResource,
      manifestRevisionChecks: keyed([
        fixture.guard.manifestResource,
        fixture.guard.targetResource,
        fixture.guard.requesterRelationResource,
        fixture.guard.requesterEmployeeResource,
        fixture.guard.graphResource,
        ...fixture.guard.rootResources,
        reportResource
      ]),
      approvalRevisionChecks: keyed([
        fixture.guard.approvalResource,
        fixture.guard.targetResource,
        fixture.guard.manifestResource,
        fixture.guard.requesterRelationResource,
        fixture.guard.requesterEmployeeResource,
        fixture.guard.graphResource,
        fixture.guard.approvalApproverEmployeeResource,
        ...fixture.guard.rootResources,
        reportResource
      ])
    } satisfies InboxV2PolicyGuardEvidence;

    expect(evaluateExport(fixture, piiGuard).outcome).toBe("denied");

    const report = makePiiExportAuthority();
    expect(
      evaluateExport(
        fixture,
        piiGuard,
        [...fixture.supportingRequirements, ...report.requirements],
        [...fixture.grants, ...report.grants]
      ).outcome
    ).toBe("allowed");
  });
});

function makeHoldFixture(
  phase: "view" | "issue" | "release",
  nextReviewAt: string
) {
  const permissionId: HoldPermissionId =
    phase === "view"
      ? "core:privacy.hold.view"
      : phase === "issue"
        ? "core:privacy.hold.issue"
        : "core:privacy.hold.release";
  const holdResource = resource("core:privacy-hold", `privacy_hold:${phase}`);
  const manifestResource = resource(
    "core:privacy-hold-scope-manifest",
    `privacy_hold_scope_manifest:${phase}`
  );
  const rootResource = resource(
    "core:storage-root",
    `storage_root:hold-${phase}`
  );
  const approvalResource = resource(
    "core:privacy-hold-approval",
    `privacy_hold_approval:${phase}`
  );
  const holdIssuerEmployeeId =
    phase === "view" ? null : phase === "issue" ? employeeId : issuerEmployeeId;
  const holdIssuerEmployeeResource =
    holdIssuerEmployeeId === null
      ? null
      : resource("core:employee", String(holdIssuerEmployeeId));
  const issuerBindingResource = resource(
    "core:privacy-hold-issuer-binding",
    `privacy_hold_issuer_binding:${phase}`
  );
  const directoryRequirementId = `hold-approver-directory-${phase}`;
  const approverGrantId = `hold-approver-grant-${phase}`;
  const approvalEvidence =
    phase === "view"
      ? null
      : {
          resource: approvalResource,
          holdResource,
          manifestResource,
          manifestRootResources: [rootResource],
          approverEmployeeResource,
          approverEmployeeId,
          approverLifecycle: "active" as const,
          approverDirectoryRequirementId: directoryRequirementId,
          approverGrantId,
          state: "approved" as const,
          revisionChecks: keyed([
            approvalResource,
            holdResource,
            manifestResource,
            approverEmployeeResource,
            rootResource
          ]),
          notAfter: GRANT_END
        };
  const issuerEvidence =
    holdIssuerEmployeeId === null || holdIssuerEmployeeResource === null
      ? null
      : {
          resource: issuerBindingResource,
          holdResource,
          manifestResource,
          manifestRootResources: [rootResource],
          issuerEmployeeResource: holdIssuerEmployeeResource,
          issuerEmployeeId: holdIssuerEmployeeId,
          revisionChecks: keyed([
            issuerBindingResource,
            holdResource,
            manifestResource,
            holdIssuerEmployeeResource,
            rootResource
          ])
        };
  const guard = {
    profileId: "core:rbac.guard.privacy_hold_manifest_revision" as const,
    targetResource: holdResource,
    holdId: phase,
    manifestAuthenticity: "authentic" as const,
    manifestResource,
    manifestHoldResource: holdResource,
    rootResources: [rootResource],
    manifestRootResources: [rootResource],
    manifestRevisionChecks: keyed([
      manifestResource,
      holdResource,
      rootResource
    ]),
    expectedManifestRevision: "1",
    currentManifestRevision: "1",
    lastReviewedAt: "2026-07-12T09:00:00.000Z",
    nextReviewAt,
    phase,
    actingEmployeeId: employeeId,
    reason: phase === "view" ? "" : `approved ${phase}`,
    reviewerEmployeeId: phase === "view" ? null : approverEmployeeId,
    issuerEmployeeId: holdIssuerEmployeeId,
    releaserEmployeeId: phase === "release" ? employeeId : null,
    issuerEvidence,
    approvalEvidence,
    contentAuthorityRequested: false as const
  } satisfies InboxV2PolicyGuardEvidence;
  const primary = requirement(
    `hold-primary-${phase}`,
    permissionId,
    holdResource,
    guard
  );
  const supportingRequirements =
    approvalEvidence === null
      ? []
      : [
          requirement(
            directoryRequirementId,
            "core:employee.directory.view",
            approverEmployeeResource,
            canonicalGuard(),
            "secondary_hidden"
          )
        ];
  const grants: InboxV2PolicyGrant[] = [
    grant(`hold-actor-grant-${phase}`, permissionId, employeeId),
    ...(approvalEvidence === null
      ? []
      : [
          grant(approverGrantId, permissionId, approverEmployeeId),
          grant(
            `hold-directory-grant-${phase}`,
            "core:employee.directory.view",
            employeeId
          )
        ])
  ];
  return { guard, primary, supportingRequirements, grants };
}

function makeExportFixture() {
  const exportResource = resource(
    "core:privacy-export-job",
    "privacy_export_job:tenant-export"
  );
  const manifestResource = resource(
    "core:privacy-tenant-export-manifest",
    "privacy_tenant_export_manifest:tenant-export"
  );
  const graphResource = resource(
    "core:tenant-resource-graph",
    "tenant_resource_graph:tenant-export"
  );
  const rootResource = resource(
    "core:storage-root",
    "storage_root:tenant-export"
  );
  const approvalResource = resource(
    "core:privacy-tenant-export-approval",
    "privacy_tenant_export_approval:tenant-export"
  );
  const requesterEmployeeResource = resource(
    "core:employee",
    String(employeeId)
  );
  const requesterRelationResource = resource(
    "core:privacy-tenant-export-requester",
    "privacy_tenant_export_requester:tenant-export"
  );
  const approverDirectoryRequirementId = "tenant-export-approver-directory";
  const approverGrantId = "tenant-export-approver-grant";
  const guard = {
    profileId: "core:rbac.guard.privacy_tenant_export_high_water" as const,
    targetResource: exportResource,
    exportId: "tenant-export",
    manifestResource,
    manifestExportResource: exportResource,
    manifestRequesterEmployeeResource: requesterEmployeeResource,
    manifestRequesterRelationResource: requesterRelationResource,
    graphResource,
    manifestGraphResource: graphResource,
    rootResources: [rootResource],
    manifestRootResources: [rootResource],
    manifestRevisionChecks: keyed([
      manifestResource,
      exportResource,
      requesterRelationResource,
      requesterEmployeeResource,
      graphResource,
      rootResource
    ]),
    expectedGraphHighWater: "10",
    currentGraphHighWater: "10",
    actingEmployeeId: employeeId,
    requesterEmployeeId: employeeId,
    requesterEmployeeResource,
    requesterRelationResource,
    requesterRelationExportResource: exportResource,
    requesterRelationEmployeeResource: requesterEmployeeResource,
    requesterRevisionChecks: keyed([
      requesterRelationResource,
      exportResource,
      requesterEmployeeResource
    ]),
    approverEmployeeId,
    approvalResource,
    approvalExportResource: exportResource,
    approvalManifestResource: manifestResource,
    approvalRequesterEmployeeResource: requesterEmployeeResource,
    approvalRequesterRelationResource: requesterRelationResource,
    approvalGraphResource: graphResource,
    approvalGraphHighWater: "10",
    approvalRootResources: [rootResource],
    approvalPiiAuthorityResource: null,
    approvalApproverEmployeeResource: approverEmployeeResource,
    approverLifecycle: "active" as const,
    approverDirectoryRequirementId,
    approverGrantId,
    approvalState: "approved" as const,
    approvalRevisionChecks: keyed([
      approvalResource,
      exportResource,
      manifestResource,
      requesterRelationResource,
      requesterEmployeeResource,
      graphResource,
      approverEmployeeResource,
      rootResource
    ]),
    approvalNotAfter: GRANT_END,
    authorizationAppliedBeforePaginationAndMaterialization: true,
    secretsIncluded: false as const,
    piiIncluded: false,
    piiAuthorityResource: null,
    piiRequirementId: null
  } satisfies InboxV2PolicyGuardEvidence;
  const primary = requirement(
    "tenant-export-primary",
    "core:privacy.tenant_export",
    exportResource,
    guard
  );
  const supportingRequirements = [
    requirement(
      approverDirectoryRequirementId,
      "core:employee.directory.view",
      approverEmployeeResource,
      canonicalGuard(),
      "secondary_hidden"
    )
  ];
  const grants = [
    grant(
      "tenant-export-actor-grant",
      "core:privacy.tenant_export",
      employeeId
    ),
    grant(approverGrantId, "core:privacy.tenant_export", approverEmployeeId),
    grant(
      "tenant-export-directory-grant",
      "core:employee.directory.view",
      employeeId
    )
  ];
  return { guard, primary, supportingRequirements, grants };
}

function makePiiExportAuthority() {
  const row = conversationReadRequirement("tenant-export-row");
  const view = requirement(
    "tenant-export-report-view",
    "core:reports.view",
    reportResource,
    {
      ...canonicalGuard(),
      action: {
        kind: "report_aggregate",
        targetResource: reportResource,
        privacy: safeReportPrivacy()
      }
    }
  );
  const drilldown = reportConjunction(
    "tenant-export-report-drilldown",
    "core:reports.drilldown",
    "drilldown",
    [view.id],
    row
  );
  const reportExport = requirement(
    "tenant-export-report-export",
    "core:reports.export",
    reportResource,
    {
      ...canonicalGuard(),
      action: {
        kind: "report_export",
        targetResource: reportResource,
        privacy: safeReportPrivacy(),
        reportsViewRequirementId: view.id
      }
    }
  );
  const piiView = reportConjunction(
    "tenant-export-report-pii-view",
    "core:reports.pii.view",
    "pii",
    [view.id, drilldown.id],
    row
  );
  const piiExport = reportConjunction(
    "tenant-export-pii",
    "core:reports.pii.export",
    "pii_export",
    [view.id, reportExport.id, drilldown.id, piiView.id],
    row
  );
  const requirements = [
    piiExport,
    piiView,
    reportExport,
    drilldown,
    view,
    row
  ].map((reportRequirement) => ({
    ...reportRequirement,
    visibility: "secondary_hidden" as const
  }));
  const grants = requirements.map((reportRequirement, index) =>
    grant(
      `tenant-export-report-grant-${index}`,
      reportRequirement.permissionId as InboxV2PermissionId,
      employeeId
    )
  );
  return { requirements, grants };
}

function reportConjunction(
  id: string,
  permissionId:
    | "core:reports.drilldown"
    | "core:reports.pii.view"
    | "core:reports.pii.export",
  accessLevel: "drilldown" | "pii" | "pii_export",
  layerRequirementIds: readonly string[],
  row: InboxV2AuthorizationRequirement
) {
  return requirement(id, permissionId, reportResource, {
    profileId: "core:rbac.guard.report_resource_conjunction",
    targetResource: reportResource,
    accessLevel,
    layerRequirementIds,
    underlyingRequirementIds: [row.id],
    underlyingResources: [row.resource],
    manifestResource: resource(
      "core:authorization-manifest",
      `authorization_manifest:${id}`
    ),
    manifestTargetResource: reportResource,
    manifestRevisionChecks: [{ kind: "manifest", expected: "1", actual: "1" }],
    scopeAppliedBeforeCountAndPagination: true,
    privateInternalIncluded: false,
    privateInternalRequirementIds: []
  });
}

function safeReportPrivacy() {
  return {
    requestedDimensionIds: ["core:queue"],
    allowedDimensionIds: ["core:queue"],
    minimumCellSize: 5,
    primarySuppressionApplied: true,
    complementarySuppressionApplied: true,
    differencingBudgetRemaining: 1,
    privateInternalIncluded: false,
    stablePersonIdentifiersIncluded: false
  };
}

function conversationReadRequirement(id: string) {
  return requirement(id, "core:conversation.read", conversationResource, {
    profileId: "core:rbac.guard.canonical_resource",
    resourceState: "active",
    contentBoundary: "external",
    routeInputFields: [],
    companionRequirementIds: [],
    action: {
      kind: "conversation_content_read",
      targetResource: conversationResource,
      conversationKind: "external_work",
      contentBoundary: "external",
      topologyResource,
      topologyConversationResource: conversationResource,
      topologyConversationKind: "external_work",
      topologyRevisionChecks: [{ kind: "state", expected: "1", actual: "1" }]
    }
  });
}

function canonicalGuard(): Extract<
  InboxV2PolicyGuardEvidence,
  { profileId: "core:rbac.guard.canonical_resource" }
> {
  return {
    profileId: "core:rbac.guard.canonical_resource",
    resourceState: "active",
    contentBoundary: "none",
    routeInputFields: [],
    companionRequirementIds: [],
    action: { kind: "canonical" }
  };
}

function evaluate(
  fixture: HoldFixture,
  guard: InboxV2PolicyGuardEvidence = fixture.guard,
  supportingRequirements = fixture.supportingRequirements,
  grants = fixture.grants
) {
  return evaluateInboxV2AuthorizationPlan(
    makeInput(
      [{ ...fixture.primary, guard }, ...supportingRequirements],
      grants
    )
  );
}

function evaluateExport(
  fixture: ExportFixture,
  guard: InboxV2PolicyGuardEvidence = fixture.guard,
  supportingRequirements = fixture.supportingRequirements,
  grants = fixture.grants
) {
  return evaluateInboxV2AuthorizationPlan(
    makeInput(
      [{ ...fixture.primary, guard }, ...supportingRequirements],
      grants
    )
  );
}

function keyed(resources: readonly InboxV2EntityKey[]) {
  return resources.map((revisionResource) => ({
    resource: revisionResource,
    expected: "1",
    actual: "1"
  }));
}

function requirement(
  id: string,
  permissionId: InboxV2PermissionId,
  requirementResource: InboxV2EntityKey,
  guard: InboxV2PolicyGuardEvidence,
  visibility: "primary" | "secondary_hidden" = "primary"
): InboxV2AuthorizationRequirement {
  return {
    id,
    permissionId,
    resource: requirementResource,
    resourceAccessRevision: "5",
    expectedResourceAccessRevision: "5",
    scopeFacts: [],
    revisionChecks: [],
    guard,
    visibility,
    authorizationSubject: { kind: "actor" }
  };
}

function grant(
  id: string,
  permissionId: InboxV2PermissionId,
  principalEmployeeId: typeof employeeId | typeof approverEmployeeId,
  scope: InboxV2PermissionScope = { type: "tenant", tenantId }
): InboxV2PolicyGrant {
  return {
    id,
    tenantId,
    principal: { kind: "employee", employeeId: principalEmployeeId },
    permissionId,
    catalogSchemaId: "core:inbox-v2.permission-scope-catalog",
    catalogVersion: "v1",
    scope,
    source: {
      kind: "direct_grant",
      origin: "inbox_v2_native",
      directGrantId: `direct-${id}`,
      bindingResource: resource(
        "core:direct-grant",
        `direct_grant:direct-${id}`
      ),
      bindingRevision: revision
    },
    revision,
    validFrom: null,
    validUntil: GRANT_END,
    revokedAt: null
  };
}

function makeInput(
  requirements: readonly InboxV2AuthorizationRequirement[],
  grants: readonly InboxV2PolicyGrant[]
): InboxV2AuthorizationPlanInput {
  const dependencies = makeDependencies(requirements);
  const authorization = inboxV2AuthorizationEpochSnapshotSchema.parse({
    tenantId,
    employee,
    value: epoch,
    dependencies,
    evaluatedAt: NOW,
    notAfter: SESSION_END,
    nextAuthorizationBoundary: SESSION_END
  });
  return {
    tenantId,
    evaluatedAt: NOW,
    principal: {
      kind: "employee",
      employee,
      lifecycle: "active",
      session: { state: "active", authorization, notAfter: SESSION_END }
    },
    currentAuthorization: {
      tenantId,
      principal: { kind: "employee", employeeId },
      authorizationEpoch: epoch,
      dependencies
    },
    grants,
    requirements
  };
}

function makeDependencies(
  requirements: readonly InboxV2AuthorizationRequirement[]
): InboxV2AuthorizationDependencyVector {
  const resources = new Map<string, InboxV2EntityKey>();
  for (const current of requirements) {
    resources.set(
      `${current.resource.tenantId}\u0000${current.resource.entityTypeId}\u0000${current.resource.entityId}`,
      current.resource
    );
  }
  return inboxV2AuthorizationDependencyVectorSchema.parse({
    tenantRbacRevision: "1",
    employeeAccessRevision: "2",
    employeeInboxRelationRevision: "3",
    sharedAccessRevision: "4",
    resourceDependencies: [...resources.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, dependencyResource]) => ({
        resource: dependencyResource,
        accessRevision: "5"
      })),
    temporalBoundaryDigest: DIGEST
  });
}

function resource(
  entityTypeId: string,
  entityId: string,
  resourceTenantId = tenantId
): InboxV2EntityKey {
  return inboxV2EntityKeySchema.parse({
    tenantId: resourceTenantId,
    entityTypeId,
    entityId
  });
}
