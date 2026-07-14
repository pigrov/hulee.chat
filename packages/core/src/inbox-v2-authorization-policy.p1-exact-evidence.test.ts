import {
  inboxV2AuthorizationDependencyVectorSchema,
  inboxV2AuthorizationEpochSchema,
  inboxV2AuthorizationEpochSnapshotSchema,
  inboxV2ClientIdSchema,
  inboxV2ConversationIdSchema,
  inboxV2EmployeeIdSchema,
  inboxV2EmployeeReferenceSchema,
  inboxV2EntityKeySchema,
  inboxV2EntityRevisionSchema,
  inboxV2SourceAccountIdSchema,
  inboxV2TenantIdSchema,
  type InboxV2AuthorizationDependencyVector,
  type InboxV2EntityKey
} from "@hulee/contracts";
import { describe, expect, it } from "vitest";

import {
  evaluateInboxV2AuthorizationPlan,
  type InboxV2AuthorizationPlanInput,
  type InboxV2AuthorizationRequirement,
  type InboxV2CanonicalScopeFact,
  type InboxV2PermissionId,
  type InboxV2PermissionScope,
  type InboxV2PolicyGrant,
  type InboxV2PolicyGuardEvidence
} from "./index";
import { exactClientBindingPathEvidence } from "./inbox-v2-authorization-policy.client-path.test-support";

const NOW = "2026-07-12T10:00:00.000Z";
const AUTHORITY_END = "2026-07-12T10:30:00.000Z";
const SESSION_END = "2026-07-12T11:00:00.000Z";
const LATER = "2026-07-12T12:00:00.000Z";
const DIGEST = `sha256:${"e".repeat(64)}`;

const tenantId = inboxV2TenantIdSchema.parse("tenant:p1-exact-evidence");
const employeeId = inboxV2EmployeeIdSchema.parse("employee:p1-actor");
const ownerId = inboxV2EmployeeIdSchema.parse("employee:p1-owner");
const employee = inboxV2EmployeeReferenceSchema.parse({
  tenantId,
  kind: "employee",
  id: employeeId
});
const revision = inboxV2EntityRevisionSchema.parse("1");
const epoch = inboxV2AuthorizationEpochSchema.parse(
  "authorization:p1-exact-evidence"
);
const sourceAccountId = inboxV2SourceAccountIdSchema.parse(
  "source_account:p1-source"
);
const clientId = inboxV2ClientIdSchema.parse("client:p1-client");
const conversationId = inboxV2ConversationIdSchema.parse(
  "conversation:p1-internal"
);

const sourceAccountResource = resource(
  "core:source-account",
  String(sourceAccountId)
);
const sourceBindingResource = resource(
  "core:source-thread-binding",
  "source_thread_binding:p1-source"
);
const capabilityManifestResource = resource(
  "core:provider-capability-manifest",
  "provider_capability_manifest:p1-source-use"
);
const clientResource = resource("core:client", String(clientId));
const tenantResource = resource("core:tenant", String(tenantId));
const ownerResource = resource("core:employee", String(ownerId));
const ownerRelationResource = resource(
  "core:client-owner-relation",
  "client_owner_relation:p1-client"
);
const ownerEligibilityResource = resource(
  "core:client-owner-eligibility",
  "client_owner_eligibility:p1-client"
);
const conversationResource = resource(
  "core:conversation",
  String(conversationId)
);

type SourceGuard = Extract<
  InboxV2PolicyGuardEvidence,
  { profileId: "core:rbac.guard.source_account_route" }
>;
type ClientGuard = Extract<
  InboxV2PolicyGuardEvidence,
  { profileId: "core:rbac.guard.client_context" }
>;

describe("Inbox V2 P1 exact relation and capability evidence", () => {
  it("allows source use only with an exact bounded source/binding manifest", () => {
    const decision = decideSourceUse(makeSourceUseGuard());
    expect(decision, JSON.stringify(decision)).toMatchObject({
      outcome: "allowed",
      notAfter: AUTHORITY_END
    });
  });

  it("rejects source use manifest binding substitution and stale keyed CAS", () => {
    const base = makeSourceUseGuard();
    if (base.operation.kind !== "use") throw new Error("expected use guard");
    const substitutedBinding = resource(
      "core:source-thread-binding",
      "source_thread_binding:p1-substituted"
    );
    const substituted: SourceGuard = {
      ...base,
      operation: {
        ...base.operation,
        capabilityManifest: {
          ...base.operation.capabilityManifest,
          manifestBindingResource: substitutedBinding
        }
      }
    };
    const stale: SourceGuard = {
      ...base,
      operation: {
        ...base.operation,
        capabilityManifest: {
          ...base.operation.capabilityManifest,
          revisionChecks: base.operation.capabilityManifest.revisionChecks.map(
            (check, index) => (index === 0 ? { ...check, actual: "2" } : check)
          )
        }
      }
    };

    expect(decideSourceUse(substituted)).toMatchObject({ outcome: "denied" });
    expect(decideSourceUse(stale)).toMatchObject({ outcome: "denied" });
  });

  it("allows client owner assignment with an exact ownership relation CAS", () => {
    const decision = decideClientOwner(makeClientOwnerGuard());
    expect(decision, JSON.stringify(decision)).toMatchObject({
      outcome: "allowed"
    });
  });

  it("rejects client owner endpoint substitution and stale ownership CAS", () => {
    const base = makeClientOwnerGuard();
    const assignment = base.clientOwnerAssignment;
    if (assignment === undefined) throw new Error("expected owner assignment");
    const substituted: ClientGuard = {
      ...base,
      clientOwnerAssignment: {
        ...assignment,
        ownershipRelationEmployeeResource: resource(
          "core:employee",
          "employee:p1-substituted-owner"
        )
      }
    };
    const stale: ClientGuard = {
      ...base,
      clientOwnerAssignment: {
        ...assignment,
        ownershipRevisionChecks: assignment.ownershipRevisionChecks.map(
          (check) =>
            sameResource(check.resource, ownerRelationResource)
              ? { ...check, actual: "2" }
              : check
        )
      }
    };
    const substitutedEligibility: ClientGuard = {
      ...base,
      clientOwnerAssignment: {
        ...assignment,
        eligibilityResource: resource(
          "core:client-owner-eligibility",
          "client_owner_eligibility:p1-substituted"
        )
      }
    };
    const staleEligibility: ClientGuard = {
      ...base,
      clientOwnerAssignment: {
        ...assignment,
        eligibilityRevisionChecks: assignment.eligibilityRevisionChecks.map(
          (check, index) => (index === 0 ? { ...check, actual: "2" } : check)
        )
      }
    };
    const staleLifecycle: ClientGuard = {
      ...base,
      clientOwnerAssignment: {
        ...assignment,
        lifecycleRevisionChecks: assignment.lifecycleRevisionChecks.map(
          (check) => ({ ...check, actual: "2" })
        )
      }
    };
    const incoherentEligibility: ClientGuard = {
      ...base,
      clientOwnerAssignment: {
        ...assignment,
        eligibilityRevisionChecks: assignment.eligibilityRevisionChecks.map(
          (check) =>
            sameResource(check.resource, ownerResource)
              ? { ...check, expected: "2", actual: "2" }
              : check
        )
      }
    };
    const incoherentLifecycle: ClientGuard = {
      ...base,
      clientOwnerAssignment: {
        ...assignment,
        lifecycleRevisionChecks: assignment.lifecycleRevisionChecks.map(
          (check) => ({ ...check, expected: "2", actual: "2" })
        )
      }
    };

    expect(decideClientOwner(substituted)).toMatchObject({
      outcome: "denied"
    });
    expect(decideClientOwner(stale)).toMatchObject({ outcome: "denied" });
    expect(decideClientOwner(substitutedEligibility)).toMatchObject({
      outcome: "denied"
    });
    expect(decideClientOwner(staleEligibility)).toMatchObject({
      outcome: "denied"
    });
    expect(decideClientOwner(staleLifecycle)).toMatchObject({
      outcome: "denied"
    });
    expect(decideClientOwner(incoherentEligibility)).toMatchObject({
      outcome: "denied"
    });
    expect(decideClientOwner(incoherentLifecycle)).toMatchObject({
      outcome: "denied"
    });
  });

  it("allows internal moderation for an exact active owner membership", () => {
    const scopeFact: InboxV2CanonicalScopeFact = {
      kind: "internal_participant",
      ...scopePath(conversationResource, conversationResource),
      employeeId,
      conversationId,
      origin: "hulee_internal_command",
      state: "active",
      role: "owner",
      membershipRevision: revision,
      currentMembershipRevision: revision,
      validUntil: LATER
    };
    const requirement = makeRequirement({
      id: "moderate-internal",
      permissionId: "core:message.moderate_internal",
      resource: conversationResource,
      scopeFacts: [scopeFact],
      guard: {
        profileId: "core:rbac.guard.internal_membership",
        conversationId,
        employeeId,
        membershipState: "active",
        membershipOrigin: "hulee_internal_command",
        membershipRole: "owner",
        contentBoundary: "internal",
        validUntil: AUTHORITY_END
      }
    });
    const decision = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [requirement],
        [
          makeGrant(
            "core:message.moderate_internal",
            { type: "internal_participant", tenantId },
            "moderate-internal"
          )
        ]
      )
    );

    expect(decision, JSON.stringify(decision)).toMatchObject({
      outcome: "allowed",
      notAfter: AUTHORITY_END
    });
  });
});

function makeSourceUseGuard(): SourceGuard {
  return {
    profileId: "core:rbac.guard.source_account_route",
    operation: {
      kind: "use",
      sourceAccountResource,
      bindingResource: sourceBindingResource,
      capabilityManifest: {
        resource: capabilityManifestResource,
        capabilityId: "core:capability.source_account.use",
        sourceAccountResource,
        bindingResource: sourceBindingResource,
        routeResource: null,
        manifestSourceAccountResource: sourceAccountResource,
        manifestBindingResource: sourceBindingResource,
        manifestRouteResource: null,
        state: "supported",
        revisionChecks: keyed([
          capabilityManifestResource,
          sourceAccountResource,
          sourceBindingResource
        ]),
        notAfter: AUTHORITY_END
      }
    },
    sourceAccountId,
    routeSourceAccountId: sourceAccountId,
    sourceState: "active",
    bindingState: "active",
    bindingGeneration: "1",
    expectedBindingGeneration: "1",
    capabilityState: "supported",
    capabilityNotAfter: AUTHORITY_END
  };
}

function decideSourceUse(guard: SourceGuard) {
  const requirement = makeRequirement({
    id: "source-use",
    permissionId: "core:source_account.use",
    resource: sourceAccountResource,
    scopeFacts: [
      {
        kind: "source_account",
        ...scopePath(sourceAccountResource, sourceAccountResource),
        sourceAccountId,
        validUntil: LATER
      }
    ],
    guard
  });
  return evaluateInboxV2AuthorizationPlan(
    makeInput(
      [requirement],
      [
        makeGrant(
          "core:source_account.use",
          { type: "source_account", tenantId, id: sourceAccountId },
          "source-use"
        )
      ]
    )
  );
}

function makeClientOwnerGuard(): ClientGuard {
  return {
    profileId: "core:rbac.guard.client_context",
    target: { kind: "client", clientId },
    accessPath: "exact_client_binding",
    pathEvidence: exactClientBindingPathEvidence({
      targetResource: clientResource,
      clientResource,
      authorityResource: tenantResource,
      suffix: "client-owner"
    }),
    contextualRequirementIds: [],
    linkedClientRequirementIds: [],
    clientOwnerAssignment: {
      clientResource,
      targetEmployeeResource: ownerResource,
      targetEmployeeId: ownerId,
      targetDirectoryRequirementId: "owner-directory",
      targetLifecycle: "active",
      eligibilityState: "eligible",
      eligibilityResource: ownerEligibilityResource,
      eligibilityClientResource: clientResource,
      eligibilityEmployeeResource: ownerResource,
      eligibilityRevisionChecks: keyed([
        ownerEligibilityResource,
        clientResource,
        ownerResource
      ]),
      lifecycleRevisionChecks: keyed([ownerResource]),
      ownershipRelationResource: ownerRelationResource,
      ownershipRelationClientResource: clientResource,
      ownershipRelationEmployeeResource: ownerResource,
      ownershipRevisionChecks: keyed([
        ownerRelationResource,
        clientResource,
        ownerResource
      ]),
      expectedOwnershipRevision: "1",
      currentOwnershipRevision: "1",
      reason: "assign exact active owner",
      auditEventResource: resource(
        "core:audit-event",
        "audit_event:p1-client-owner"
      )
    }
  };
}

function decideClientOwner(guard: ClientGuard) {
  const primary = makeRequirement({
    id: "client-owner",
    permissionId: "core:client.owner.assign",
    resource: clientResource,
    guard
  });
  const directory = makeRequirement({
    id: "owner-directory",
    permissionId: "core:employee.directory.view",
    resource: ownerResource,
    visibility: "secondary_hidden",
    guard: canonicalGuard()
  });
  return evaluateInboxV2AuthorizationPlan(
    makeInput(
      [primary, directory],
      [
        makeGrant(
          "core:client.owner.assign",
          { type: "tenant", tenantId },
          "client-owner"
        ),
        makeGrant(
          "core:employee.directory.view",
          { type: "tenant", tenantId },
          "owner-directory"
        )
      ]
    )
  );
}

function canonicalGuard(): InboxV2PolicyGuardEvidence {
  return {
    profileId: "core:rbac.guard.canonical_resource",
    resourceState: "active",
    contentBoundary: "none",
    routeInputFields: [],
    companionRequirementIds: [],
    action: { kind: "canonical" }
  };
}

function keyed(resources: readonly InboxV2EntityKey[]) {
  return resources.map((revisionResource) => ({
    resource: revisionResource,
    expected: "1",
    actual: "1"
  }));
}

function sameResource(left: InboxV2EntityKey, right: InboxV2EntityKey) {
  return (
    left.tenantId === right.tenantId &&
    left.entityTypeId === right.entityTypeId &&
    left.entityId === right.entityId
  );
}

function scopePath(
  targetResource: InboxV2EntityKey,
  scopeTarget: InboxV2EntityKey
) {
  return {
    resource: targetResource,
    scopeTarget,
    pathRevisionChecks: [
      { kind: "relation" as const, expected: "1", actual: "1" },
      { kind: "state" as const, expected: "1", actual: "1" }
    ],
    authorityProvenance: {
      kind: "hulee_canonical_repository" as const,
      factId: `fact:${targetResource.entityTypeId}:${targetResource.entityId}`,
      loaderDecisionId: "p1-exact-evidence-loader",
      projectionRevision: revision,
      observedAt: NOW
    }
  };
}

function makeRequirement(
  input: Readonly<{
    id: string;
    permissionId: InboxV2PermissionId;
    resource: InboxV2EntityKey;
    guard: InboxV2PolicyGuardEvidence;
    scopeFacts?: readonly InboxV2CanonicalScopeFact[];
    visibility?: "primary" | "secondary_hidden";
  }>
): InboxV2AuthorizationRequirement {
  return Object.freeze({
    ...input,
    resourceAccessRevision: "5",
    expectedResourceAccessRevision: "5",
    scopeFacts: Object.freeze([...(input.scopeFacts ?? [])]),
    revisionChecks: Object.freeze([]),
    visibility: input.visibility ?? "primary",
    authorizationSubject: Object.freeze({ kind: "actor" as const })
  });
}

function makeGrant(
  permissionId: InboxV2PermissionId,
  scope: InboxV2PermissionScope,
  id: string
): InboxV2PolicyGrant {
  return Object.freeze({
    id,
    tenantId,
    principal: { kind: "employee" as const, employeeId },
    permissionId,
    catalogSchemaId: "core:inbox-v2.permission-scope-catalog" as const,
    catalogVersion: "v1" as const,
    scope,
    source: {
      kind: "direct_grant" as const,
      origin: "inbox_v2_native" as const,
      directGrantId: `direct-${id}`,
      bindingResource: resource(
        "core:direct-grant",
        `direct_grant:direct-${id}`
      ),
      bindingRevision: revision
    },
    revision,
    validFrom: null,
    validUntil: AUTHORITY_END,
    revokedAt: null
  });
}

function makeDependencies(
  requirements: readonly InboxV2AuthorizationRequirement[]
): InboxV2AuthorizationDependencyVector {
  const unique = new Map<string, InboxV2EntityKey>();
  for (const requirement of requirements) {
    unique.set(
      `${requirement.resource.entityTypeId}\u0000${requirement.resource.entityId}`,
      requirement.resource
    );
  }
  return inboxV2AuthorizationDependencyVectorSchema.parse({
    tenantRbacRevision: "1",
    employeeAccessRevision: "2",
    employeeInboxRelationRevision: "3",
    sharedAccessRevision: "4",
    resourceDependencies: [...unique.values()].map((dependencyResource) => ({
      resource: dependencyResource,
      accessRevision: "5"
    })),
    temporalBoundaryDigest: DIGEST
  });
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
  return Object.freeze({
    tenantId,
    evaluatedAt: NOW,
    principal: Object.freeze({
      kind: "employee" as const,
      employee,
      lifecycle: "active" as const,
      session: Object.freeze({
        state: "active" as const,
        authorization,
        notAfter: SESSION_END
      })
    }),
    currentAuthorization: Object.freeze({
      tenantId,
      principal: Object.freeze({ kind: "employee" as const, employeeId }),
      authorizationEpoch: epoch,
      dependencies
    }),
    grants: Object.freeze([...grants]),
    requirements: Object.freeze([...requirements])
  });
}

function resource(entityTypeId: string, entityId: string): InboxV2EntityKey {
  return inboxV2EntityKeySchema.parse({ tenantId, entityTypeId, entityId });
}
