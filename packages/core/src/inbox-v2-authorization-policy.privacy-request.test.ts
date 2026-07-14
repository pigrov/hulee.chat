import {
  inboxV2AuthorizationDependencyVectorSchema,
  inboxV2AuthorizationEpochSchema,
  inboxV2AuthorizationEpochSnapshotSchema,
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
  evaluateInboxV2AuthorizationPlan,
  type InboxV2AuthorizationPlanInput,
  type InboxV2AuthorizationRequirement,
  type InboxV2PermissionScope,
  type InboxV2PolicyGrant,
  type InboxV2PolicyGuardEvidence
} from "./index";

const NOW = "2026-07-12T10:00:00.000Z";
const GRANT_END = "2026-07-12T10:30:00.000Z";
const SESSION_END = "2026-07-12T11:00:00.000Z";
const DIGEST = `sha256:${"a".repeat(64)}`;

const tenantId = inboxV2TenantIdSchema.parse("tenant:privacy-request-tenant");
const otherTenantId = inboxV2TenantIdSchema.parse(
  "tenant:privacy-request-other"
);
const employeeId = inboxV2EmployeeIdSchema.parse(
  "employee:privacy-request-decider"
);
const requesterEmployeeId = inboxV2EmployeeIdSchema.parse(
  "employee:privacy-request-subject"
);
const priorDeciderEmployeeId = inboxV2EmployeeIdSchema.parse(
  "employee:privacy-request-prior-decider"
);
const inventedEmployeeId = inboxV2EmployeeIdSchema.parse(
  "employee:privacy-request-invented"
);
const employee = inboxV2EmployeeReferenceSchema.parse({
  tenantId,
  kind: "employee",
  id: employeeId
});
const revision = inboxV2EntityRevisionSchema.parse("1");
const epoch = inboxV2AuthorizationEpochSchema.parse(
  "authorization:privacy-request-epoch"
);

const caseResource = resource(
  "core:privacy-request",
  "privacy_request_case:case-a"
);
const otherCaseResource = resource(
  "core:privacy-request",
  "privacy_request_case:case-b"
);
const rootResource = resource("core:conversation", "conversation:root-a");
const otherRootResource = resource("core:conversation", "conversation:root-b");
const governanceResource = resource(
  "core:governance-context",
  "governance_context:privacy-request"
);
const manifestResource = resource(
  "core:privacy-discovery-manifest",
  "privacy_discovery_manifest:case-a"
);
const proofResource = resource(
  "core:privacy-discovery-proof",
  "privacy_discovery_proof:case-a-root-a"
);
const policyRuleResource = resource(
  "core:data-lifecycle-policy-rule",
  "data_lifecycle_policy_rule:retention-access"
);
const requesterEmployeeResource = resource(
  "core:employee",
  String(requesterEmployeeId)
);
const actingEmployeeResource = resource("core:employee", String(employeeId));
const priorDeciderEmployeeResource = resource(
  "core:employee",
  String(priorDeciderEmployeeId)
);
const partyBindingResource = resource(
  "core:privacy-request-party-binding",
  "privacy_request_party_binding:case-a-requester"
);
const decisionLedgerResource = resource(
  "core:privacy-request-decision-ledger",
  "privacy_request_decision_ledger:case-a"
);
const rootDecisionManifestResource = resource(
  "core:privacy-request-root-decision-manifest",
  "privacy_request_root_decision_manifest:case-a"
);
const executorRelationResource = resource(
  "core:privacy-request-executor-relation",
  "privacy_request_executor_relation:case-a"
);

type PrivacyRequestGuard = Extract<
  InboxV2PolicyGuardEvidence,
  { profileId: "core:rbac.guard.privacy_request_roots_revision" }
>;
type PrivacyRootDecision = PrivacyRequestGuard["rootDecisions"][number];
type PrivacyDecisionLedger = NonNullable<PrivacyRequestGuard["decisionLedger"]>;

describe("Inbox V2 privacy request exact-scope authorization", () => {
  it("allows an authorized reviewer to inspect an unverified request without decision authority", () => {
    const guard: PrivacyRequestGuard = {
      ...makeGuard(),
      verificationState: "unverified",
      rootDecisions: [],
      discoveryManifestRootResources: [],
      discoveryManifestMembershipRevisionChecks: currentChecks([
        manifestResource,
        caseResource
      ]),
      phase: "view",
      deciderEmployeeId: null,
      decisionLedger: null,
      executorRelation: null
    };
    const decision = evaluateInboxV2AuthorizationPlan(
      makeInput(guard, "core:privacy.request.view")
    );

    expect(decision.outcome).toBe("allowed");
    if (decision.outcome !== "allowed") return;
    expect(decision.requirements).toHaveLength(1);
    expect(decision.requirements[0]?.permissionId).toBe(
      "core:privacy.request.view"
    );
  });

  it("allows a current exact case/root proof and policy-rule chain without deriving content authority", () => {
    const decision = evaluateInboxV2AuthorizationPlan(makeInput(makeGuard()));

    expect(decision.outcome).toBe("allowed");
    if (decision.outcome !== "allowed") return;
    expect(decision.requirements).toHaveLength(1);
    expect(decision.requirements[0]).toMatchObject({
      permissionId: "core:privacy.request.decide",
      resource: caseResource,
      authorizationSubjectKind: "actor"
    });
    expect(
      decision.requirements.some(({ resource }) =>
        sameResource(resource, rootResource)
      )
    ).toBe(false);
  });

  it("denies a self-consistent decision subset replay when the discovery manifest has another root", () => {
    const guard = makeGuard();
    const decision = evaluateInboxV2AuthorizationPlan(
      makeInput({
        ...guard,
        discoveryManifestRootResources: [rootResource, otherRootResource],
        discoveryManifestMembershipRevisionChecks: currentChecks([
          manifestResource,
          caseResource,
          rootResource,
          otherRootResource
        ])
      })
    );

    expect(decision).toMatchObject({
      outcome: "denied",
      publicErrorCode: "privacy.revision_changed"
    });
  });

  it("allows execution only through an approved exact decision ledger and executor relation", () => {
    const decision = evaluateInboxV2AuthorizationPlan(
      makeInput(makeExecuteGuard(), "core:privacy.request.execute")
    );

    expect(decision).toMatchObject({ outcome: "allowed" });
  });

  it("denies execute when an approved root decision is substituted with excluded", () => {
    const guard = makeExecuteGuard();
    expectDenied(
      {
        ...guard,
        rootDecisions: guard.rootDecisions.map((decision) => ({
          ...decision,
          decisionState: "excluded" as const
        }))
      },
      "core:privacy.request.execute"
    );
  });

  it("denies execute when another current policy rule replaces the approved decision basis", () => {
    const guard = makeExecuteGuard();
    const replacementRule = resource(
      "core:data-lifecycle-policy-rule",
      "data_lifecycle_policy_rule:replacement-current-rule"
    );
    expectDenied(
      {
        ...guard,
        rootDecisions: guard.rootDecisions.map((decision) => ({
          ...decision,
          policyRuleId: "replacement-current-rule",
          policyRuleResource: replacementRule,
          policyRuleRevisionChecks: [
            { resource: replacementRule, expected: "1", actual: "1" },
            { resource: caseResource, expected: "1", actual: "1" },
            { resource: rootResource, expected: "1", actual: "1" }
          ]
        }))
      },
      "core:privacy.request.execute"
    );
  });

  it("denies replay of an executor relation from a different approved decision snapshot", () => {
    const guard = makeExecuteGuard();
    if (guard.executorRelation === null) {
      throw new Error("expected executor relation");
    }
    expectDenied(
      {
        ...guard,
        executorRelation: {
          ...guard.executorRelation,
          revisionChecks: guard.executorRelation.revisionChecks.map((check) =>
            sameResource(check.resource, decisionLedgerResource)
              ? { ...check, expected: "2", actual: "2" }
              : check
          )
        }
      },
      "core:privacy.request.execute"
    );
  });

  it("denies self-decision when a spoofed requester scalar hides the exact requester resource", () => {
    const guard = makeGuard();
    const selfParty = {
      ...guard.casePartyEvidence,
      requesterEmployeeResource: actingEmployeeResource,
      bindingRequesterEmployeeResource: actingEmployeeResource,
      revisionChecks: currentChecks([
        partyBindingResource,
        caseResource,
        actingEmployeeResource
      ])
    };
    const selfLedger = makeDecisionLedger(
      actingEmployeeResource,
      "pending",
      actingEmployeeResource
    );
    expectDenied({
      ...guard,
      requesterEmployeeId,
      casePartyEvidence: selfParty,
      decisionLedger: selfLedger
    });
  });

  it.each([
    {
      name: "invented requester scalar",
      mutate: (guard: PrivacyRequestGuard): PrivacyRequestGuard => ({
        ...guard,
        requesterEmployeeId: inventedEmployeeId
      })
    },
    {
      name: "invented decider scalar",
      mutate: (guard: PrivacyRequestGuard): PrivacyRequestGuard => ({
        ...guard,
        deciderEmployeeId: inventedEmployeeId
      })
    },
    {
      name: "decision from another case",
      mutate: (guard: PrivacyRequestGuard): PrivacyRequestGuard => ({
        ...guard,
        decisionLedger:
          guard.decisionLedger === null
            ? null
            : { ...guard.decisionLedger, caseResource: otherCaseResource }
      })
    },
    {
      name: "decision manifest from another root",
      mutate: (guard: PrivacyRequestGuard): PrivacyRequestGuard => ({
        ...guard,
        decisionLedger:
          guard.decisionLedger === null
            ? null
            : {
                ...guard.decisionLedger,
                rootManifestRootResources: [otherRootResource]
              }
      })
    },
    {
      name: "stale decision ledger",
      mutate: (guard: PrivacyRequestGuard): PrivacyRequestGuard => ({
        ...guard,
        decisionLedger:
          guard.decisionLedger === null
            ? null
            : {
                ...guard.decisionLedger,
                revisionChecks: guard.decisionLedger.revisionChecks.map(
                  (check) =>
                    sameResource(check.resource, decisionLedgerResource)
                      ? { ...check, actual: "2" }
                      : check
                )
              }
      })
    },
    {
      name: "cross-tenant decision ledger",
      mutate: (guard: PrivacyRequestGuard): PrivacyRequestGuard => ({
        ...guard,
        decisionLedger:
          guard.decisionLedger === null
            ? null
            : {
                ...guard.decisionLedger,
                resource: resource(
                  "core:privacy-request-decision-ledger",
                  "privacy_request_decision_ledger:case-a",
                  otherTenantId
                )
              }
      })
    }
  ])("denies execute with $name evidence", ({ mutate }) => {
    expectDenied(mutate(makeExecuteGuard()), "core:privacy.request.execute");
  });

  it.each([
    {
      name: "manifest type relabel",
      mutate: (guard: PrivacyRequestGuard): PrivacyRequestGuard => ({
        ...guard,
        discoveryManifestResource: resource(
          "core:authorization-manifest",
          String(guard.discoveryManifestResource.entityId)
        )
      })
    },
    {
      name: "manifest from another request",
      mutate: (guard: PrivacyRequestGuard): PrivacyRequestGuard => ({
        ...guard,
        discoveryManifestTargetResource: otherCaseResource
      })
    },
    {
      name: "stale discovery manifest",
      mutate: (guard: PrivacyRequestGuard): PrivacyRequestGuard => ({
        ...guard,
        discoveryManifestRevisionChecks: [
          { resource: manifestResource, expected: "1", actual: "2" },
          { resource: caseResource, expected: "1", actual: "1" }
        ]
      })
    },
    {
      name: "manifest revision set omits the exact request",
      mutate: (guard: PrivacyRequestGuard): PrivacyRequestGuard => ({
        ...guard,
        discoveryManifestRevisionChecks: [
          { resource: manifestResource, expected: "1", actual: "1" },
          { resource: otherCaseResource, expected: "1", actual: "1" }
        ]
      })
    },
    {
      name: "proof linked to another request",
      mutate: withRootDecision((decision) => ({
        ...decision,
        proofRequestResource: otherCaseResource
      }))
    },
    {
      name: "proof linked to another root",
      mutate: withRootDecision((decision) => ({
        ...decision,
        proofRootResource: otherRootResource
      }))
    },
    {
      name: "proof revision set omits the exact request",
      mutate: withRootDecision((decision) => ({
        ...decision,
        proofRevisionChecks: [
          { resource: proofResource, expected: "1", actual: "1" },
          { resource: otherCaseResource, expected: "1", actual: "1" },
          { resource: rootResource, expected: "1", actual: "1" }
        ]
      }))
    },
    {
      name: "stale exact-root proof revision",
      mutate: withRootDecision((decision) => ({
        ...decision,
        proofRevisionChecks: decision.proofRevisionChecks.map((check) =>
          sameResource(check.resource, rootResource)
            ? { ...check, actual: "2" }
            : check
        )
      }))
    },
    {
      name: "inactive policy rule",
      mutate: withRootDecision((decision) => ({
        ...decision,
        policyRuleState: "inactive"
      }))
    },
    {
      name: "policy rule linked to another request",
      mutate: withRootDecision((decision) => ({
        ...decision,
        policyRuleRequestResource: otherCaseResource
      }))
    },
    {
      name: "policy rule linked to another root",
      mutate: withRootDecision((decision) => ({
        ...decision,
        policyRuleRootResource: otherRootResource
      }))
    },
    {
      name: "policy rule resource does not match its rule id",
      mutate: withRootDecision((decision) => ({
        ...decision,
        policyRuleResource: resource(
          "core:data-lifecycle-policy-rule",
          "data_lifecycle_policy_rule:another-rule"
        )
      }))
    },
    {
      name: "policy rule revision set omits the exact rule",
      mutate: withRootDecision((decision) => ({
        ...decision,
        policyRuleRevisionChecks: [
          {
            resource: resource(
              "core:data-lifecycle-policy-rule",
              "data_lifecycle_policy_rule:another-rule"
            ),
            expected: "1",
            actual: "1"
          },
          { resource: caseResource, expected: "1", actual: "1" },
          { resource: rootResource, expected: "1", actual: "1" }
        ]
      }))
    },
    {
      name: "cross-tenant proof",
      mutate: withRootDecision((decision) => ({
        ...decision,
        discoveryProofResource: resource(
          "core:privacy-discovery-proof",
          "privacy_discovery_proof:case-a-root-a",
          otherTenantId
        )
      }))
    }
  ])("denies $name substitution", ({ mutate }) => {
    const decision = evaluateInboxV2AuthorizationPlan(
      makeInput(mutate(makeGuard()))
    );

    expect(decision).toMatchObject({
      outcome: "denied",
      publicErrorCode: "privacy.revision_changed"
    });
  });
});

function makeGuard(): PrivacyRequestGuard {
  return {
    profileId: "core:rbac.guard.privacy_request_roots_revision",
    targetResource: caseResource,
    caseId: "case-a",
    casePartyEvidence: {
      bindingResource: partyBindingResource,
      bindingCaseResource: caseResource,
      requesterEmployeeResource,
      bindingRequesterEmployeeResource: requesterEmployeeResource,
      state: "immutable",
      revisionChecks: currentChecks([
        partyBindingResource,
        caseResource,
        requesterEmployeeResource
      ])
    },
    verificationState: "verified",
    expectedRootsRevision: "1",
    currentRootsRevision: "1",
    governanceContextResource: governanceResource,
    expectedGovernanceRevision: "1",
    currentGovernanceRevision: "1",
    discoveryManifestResource: manifestResource,
    discoveryManifestTargetResource: caseResource,
    discoveryManifestRevisionChecks: [
      { resource: manifestResource, expected: "1", actual: "1" },
      { resource: caseResource, expected: "1", actual: "1" }
    ],
    discoveryManifestRootResources: [rootResource],
    discoveryManifestMembershipRevisionChecks: currentChecks([
      manifestResource,
      caseResource,
      rootResource
    ]),
    rootDecisions: [makeRootDecision()],
    phase: "decide",
    actingEmployeeId: employeeId,
    requesterEmployeeId,
    deciderEmployeeId: employeeId,
    executorEmployeeId: null,
    decisionLedger: makeDecisionLedger(actingEmployeeResource, "pending"),
    executorRelation: null,
    contentAuthorityDerivedFromRequester: false
  };
}

function makeExecuteGuard(): PrivacyRequestGuard {
  const decisionLedger = makeDecisionLedger(
    priorDeciderEmployeeResource,
    "approved"
  );
  return {
    ...makeGuard(),
    rootDecisions: [{ ...makeRootDecision(), decisionState: "approved" }],
    phase: "execute",
    deciderEmployeeId: priorDeciderEmployeeId,
    executorEmployeeId: employeeId,
    decisionLedger,
    executorRelation: {
      resource: executorRelationResource,
      decisionResource: decisionLedgerResource,
      caseResource,
      executorEmployeeResource: actingEmployeeResource,
      relationExecutorEmployeeResource: actingEmployeeResource,
      state: "active",
      revisionChecks: currentChecks([
        executorRelationResource,
        decisionLedgerResource,
        caseResource,
        requesterEmployeeResource,
        priorDeciderEmployeeResource,
        rootDecisionManifestResource,
        manifestResource,
        rootResource,
        actingEmployeeResource
      ])
    }
  };
}

function makeDecisionLedger(
  deciderEmployeeResource: InboxV2EntityKey,
  state: PrivacyDecisionLedger["state"],
  ledgerRequesterEmployeeResource = requesterEmployeeResource
): PrivacyDecisionLedger {
  const decision = {
    ...makeRootDecision(),
    decisionState:
      state === "approved" ? ("approved" as const) : ("pending" as const)
  };
  return {
    resource: decisionLedgerResource,
    caseResource,
    requesterEmployeeResource: ledgerRequesterEmployeeResource,
    deciderEmployeeResource,
    rootManifestResource: rootDecisionManifestResource,
    rootManifestDecisionResource: decisionLedgerResource,
    rootManifestCaseResource: caseResource,
    rootManifestRootResources: [rootResource],
    rootManifestEntries: [
      {
        rootResource: decision.rootResource,
        discoveryProofResource: decision.discoveryProofResource,
        policyRuleId: decision.policyRuleId,
        policyRuleResource: decision.policyRuleResource,
        decisionState: decision.decisionState,
        expectedDecisionRevision: decision.expectedDecisionRevision,
        currentDecisionRevision: decision.currentDecisionRevision
      }
    ],
    rootManifestDecisionSetDigest: "decision-set:case-a:v1",
    ledgerDecisionSetDigest: "decision-set:case-a:v1",
    state,
    revisionChecks: currentChecks([
      decisionLedgerResource,
      caseResource,
      ledgerRequesterEmployeeResource,
      deciderEmployeeResource,
      manifestResource,
      rootDecisionManifestResource,
      rootResource,
      proofResource,
      policyRuleResource
    ])
  };
}

function makeRootDecision(): PrivacyRootDecision {
  return {
    rootResource,
    discoveryProofResource: proofResource,
    proofRequestResource: caseResource,
    proofRootResource: rootResource,
    proofRevisionChecks: [
      { resource: proofResource, expected: "1", actual: "1" },
      { resource: caseResource, expected: "1", actual: "1" },
      { resource: rootResource, expected: "1", actual: "1" }
    ],
    policyRuleId: "retention-access",
    policyRuleResource,
    policyRuleRequestResource: caseResource,
    policyRuleRootResource: rootResource,
    policyRuleState: "active",
    policyRuleRevisionChecks: [
      { resource: policyRuleResource, expected: "1", actual: "1" },
      { resource: caseResource, expected: "1", actual: "1" },
      { resource: rootResource, expected: "1", actual: "1" }
    ],
    expectedDecisionRevision: "1",
    currentDecisionRevision: "1",
    decisionState: "pending"
  };
}

function withRootDecision(
  mutate: (decision: PrivacyRootDecision) => PrivacyRootDecision
): (guard: PrivacyRequestGuard) => PrivacyRequestGuard {
  return (guard) => ({
    ...guard,
    rootDecisions: [mutate(guard.rootDecisions[0]!)]
  });
}

function currentChecks(resources: readonly InboxV2EntityKey[]) {
  return resources.map((resource) => ({
    resource,
    expected: "1",
    actual: "1"
  }));
}

function expectDenied(
  guard: PrivacyRequestGuard,
  permissionId:
    | "core:privacy.request.view"
    | "core:privacy.request.decide"
    | "core:privacy.request.execute" = "core:privacy.request.decide"
): void {
  expect(
    evaluateInboxV2AuthorizationPlan(makeInput(guard, permissionId))
  ).toMatchObject({
    outcome: "denied",
    publicErrorCode: "privacy.revision_changed"
  });
}

function makeInput(
  guard: PrivacyRequestGuard,
  permissionId:
    | "core:privacy.request.view"
    | "core:privacy.request.decide"
    | "core:privacy.request.execute" = "core:privacy.request.decide"
): InboxV2AuthorizationPlanInput {
  const requirement: InboxV2AuthorizationRequirement = {
    id: "privacy-request-primary",
    permissionId,
    resource: caseResource,
    resourceAccessRevision: "5",
    expectedResourceAccessRevision: "5",
    scopeFacts: [],
    revisionChecks: [],
    guard,
    visibility: "primary",
    authorizationSubject: { kind: "actor" }
  };
  const dependencies = makeDependencies([requirement]);
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
    grants: [makeGrant(permissionId, { type: "tenant", tenantId })],
    requirements: [requirement]
  };
}

function makeGrant(
  permissionId:
    | "core:privacy.request.view"
    | "core:privacy.request.decide"
    | "core:privacy.request.execute",
  scope: InboxV2PermissionScope
): InboxV2PolicyGrant {
  return {
    id: "privacy-request-grant",
    tenantId,
    principal: { kind: "employee", employeeId },
    permissionId,
    catalogSchemaId: "core:inbox-v2.permission-scope-catalog",
    catalogVersion: "v1",
    scope,
    source: {
      kind: "direct_grant",
      origin: "inbox_v2_native",
      directGrantId: "privacy-request",
      bindingResource: resource(
        "core:direct-grant",
        "direct_grant:privacy-request"
      ),
      bindingRevision: revision
    },
    revision,
    validFrom: null,
    validUntil: GRANT_END,
    revokedAt: null
  };
}

function makeDependencies(
  requirements: readonly InboxV2AuthorizationRequirement[]
): InboxV2AuthorizationDependencyVector {
  return inboxV2AuthorizationDependencyVectorSchema.parse({
    tenantRbacRevision: "1",
    employeeAccessRevision: "2",
    employeeInboxRelationRevision: "3",
    sharedAccessRevision: "4",
    resourceDependencies: requirements.map((requirement) => ({
      resource: requirement.resource,
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

function sameResource(
  left: InboxV2EntityKey,
  right: InboxV2EntityKey
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.entityTypeId === right.entityTypeId &&
    left.entityId === right.entityId
  );
}
