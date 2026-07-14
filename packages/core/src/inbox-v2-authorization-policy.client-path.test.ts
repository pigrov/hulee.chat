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
  inboxV2TenantIdSchema,
  inboxV2WorkItemIdSchema,
  inboxV2WorkQueueIdSchema,
  type InboxV2AuthorizationDependencyVector,
  type InboxV2EntityKey
} from "@hulee/contracts";
import { describe, expect, it } from "vitest";

import {
  activeConversationLinkPathEvidence,
  clientOwnerPathEvidence,
  currentResponsiblePathEvidence,
  currentWorkItemQueuePathEvidence,
  exactClientBindingPathEvidence
} from "./inbox-v2-authorization-policy.client-path.test-support";
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

const NOW = "2026-07-13T08:00:00.000Z";
const AUTHORITY_END = "2026-07-13T08:30:00.000Z";
const SESSION_END = "2026-07-13T09:00:00.000Z";
const LATER = "2026-07-13T10:00:00.000Z";
const DIGEST = `sha256:${"7".repeat(64)}`;

const tenantId = inboxV2TenantIdSchema.parse("tenant:client-path");
const employeeId = inboxV2EmployeeIdSchema.parse("employee:client-path");
const employee = inboxV2EmployeeReferenceSchema.parse({
  tenantId,
  kind: "employee",
  id: employeeId
});
const epoch = inboxV2AuthorizationEpochSchema.parse(
  "authorization:client-path"
);
const revision = inboxV2EntityRevisionSchema.parse("1");
const clientId = inboxV2ClientIdSchema.parse("client:client-path");
const otherClientId = inboxV2ClientIdSchema.parse(
  "client:client-path-unrelated"
);
const conversationId = inboxV2ConversationIdSchema.parse(
  "conversation:client-path"
);
const otherConversationId = inboxV2ConversationIdSchema.parse(
  "conversation:client-path-unrelated"
);
const workItemId = inboxV2WorkItemIdSchema.parse("work_item:client-path");
const queueId = inboxV2WorkQueueIdSchema.parse("work_queue:client-path");

const tenantResource = resource("core:tenant", String(tenantId));
const clientResource = resource("core:client", String(clientId));
const otherClientResource = resource("core:client", String(otherClientId));
const conversationResource = resource(
  "core:conversation",
  String(conversationId)
);
const otherConversationResource = resource(
  "core:conversation",
  String(otherConversationId)
);
const workItemResource = resource("core:work-item", String(workItemId));
const queueResource = resource("core:work-queue", String(queueId));
const employeeResource = resource("core:employee", String(employeeId));

type ClientGuard = Extract<
  InboxV2PolicyGuardEvidence,
  { profileId: "core:rbac.guard.client_context" }
>;
type PathKind = ClientGuard["accessPath"];

describe("Inbox V2 exact Client contextual paths", () => {
  it.each([
    "exact_client_binding",
    "active_conversation_link",
    "current_work_item_queue",
    "current_responsible",
    "client_owner"
  ] as const)("allows the exact current %s path", (kind) => {
    const scenario = clientPathScenario(kind);
    const decision = evaluateInboxV2AuthorizationPlan(scenario);
    expect(decision, JSON.stringify(decision)).toMatchObject({
      outcome: "allowed"
    });
  });

  it("allows an exact Client scope only for that same Client", () => {
    const scenario = exactClientScopedScenario(clientResource, clientId);
    expect(evaluateInboxV2AuthorizationPlan(scenario).outcome).toBe("allowed");
  });

  it("rejects a Client A binding that tries to reuse exact Client B authority", () => {
    const scenario = exactClientScopedScenario(
      otherClientResource,
      otherClientId
    );
    expect(evaluateInboxV2AuthorizationPlan(scenario).outcome).toBe("denied");
  });

  it("rejects a readable but unrelated contextual Conversation", () => {
    const scenario = clientPathScenario("active_conversation_link");
    const requirements = scenario.requirements.map((requirement) =>
      requirement.id === "conversation-read"
        ? conversationReadRequirement(
            "conversation-read",
            otherConversationResource,
            otherConversationId
          )
        : requirement
    );
    expect(
      evaluateInboxV2AuthorizationPlan(makeInput(requirements, scenario.grants))
        .outcome
    ).toBe("denied");
  });

  it("rejects a missing/substituted WorkItem-to-Conversation hop", () => {
    const scenario = clientPathScenario("current_work_item_queue");
    const denied = mutateClientGuard(
      scenario,
      "current_work_item_queue",
      (guard) => ({
        ...guard,
        pathEvidence: {
          ...guard.pathEvidence,
          relationConversationResource: otherConversationResource
        }
      })
    );
    expect(evaluateInboxV2AuthorizationPlan(denied).outcome).toBe("denied");
  });

  it("rejects a stale keyed path CAS", () => {
    const scenario = clientPathScenario("current_responsible");
    const denied = mutateClientGuard(
      scenario,
      "current_responsible",
      (guard) => ({
        ...guard,
        pathEvidence: {
          ...guard.pathEvidence,
          pathRevisionChecks: guard.pathEvidence.pathRevisionChecks.map(
            (check, index) => (index === 0 ? { ...check, actual: "2" } : check)
          )
        }
      })
    );
    expect(evaluateInboxV2AuthorizationPlan(denied).outcome).toBe("denied");
  });

  it("rejects individually current manifest/path snapshots that disagree", () => {
    const scenario = clientPathScenario("client_owner");
    const denied = mutateClientGuard(scenario, "client_owner", (guard) => ({
      ...guard,
      pathEvidence: {
        ...guard.pathEvidence,
        pathRevisionChecks: guard.pathEvidence.pathRevisionChecks.map(
          (check) => ({ ...check, expected: "2", actual: "2" })
        )
      }
    }));
    expect(evaluateInboxV2AuthorizationPlan(denied).outcome).toBe("denied");
  });
});

function clientPathScenario(kind: PathKind): InboxV2AuthorizationPlanInput {
  const conversationRead = conversationReadRequirement(
    "conversation-read",
    conversationResource,
    conversationId
  );
  const workRead = workReadRequirement();
  const contextualRequirementIds =
    kind === "active_conversation_link"
      ? [conversationRead.id]
      : kind === "current_work_item_queue" || kind === "current_responsible"
        ? [conversationRead.id, workRead.id]
        : [];
  const guard = clientGuard(kind, contextualRequirementIds);
  const primary = requirement({
    id: "client-read",
    permissionId: "core:client.view",
    resource: clientResource,
    scopeFacts: clientScopeFacts(kind),
    guard
  });
  const companions =
    kind === "active_conversation_link"
      ? [conversationRead]
      : kind === "current_work_item_queue" || kind === "current_responsible"
        ? [conversationRead, workRead]
        : [];
  const primaryScope: InboxV2PermissionScope =
    kind === "current_work_item_queue"
      ? { type: "queue", tenantId, id: queueId }
      : kind === "current_responsible"
        ? { type: "responsible", tenantId }
        : kind === "client_owner"
          ? { type: "client_owner", tenantId }
          : { type: "tenant", tenantId };
  return makeInput(
    [primary, ...companions],
    [
      grant("core:client.view", primaryScope, "client-read"),
      ...(companions.some(({ id }) => id === conversationRead.id)
        ? [
            grant(
              "core:conversation.read",
              { type: "tenant", tenantId },
              conversationRead.id
            )
          ]
        : []),
      ...(companions.some(({ id }) => id === workRead.id)
        ? [grant("core:work.read", { type: "tenant", tenantId }, workRead.id)]
        : [])
    ]
  );
}

function exactClientScopedScenario(
  authorityResource: InboxV2EntityKey,
  authorityClientId: typeof clientId | typeof otherClientId
): InboxV2AuthorizationPlanInput {
  const primary = requirement({
    id: "client-read",
    permissionId: "core:client.view",
    resource: clientResource,
    scopeFacts: [
      {
        kind: "client",
        ...scopePath(clientResource, authorityResource),
        clientId: authorityClientId,
        validUntil: LATER
      }
    ],
    guard: {
      profileId: "core:rbac.guard.client_context",
      target: { kind: "client", clientId },
      accessPath: "exact_client_binding",
      pathEvidence: exactClientBindingPathEvidence({
        targetResource: clientResource,
        clientResource,
        authorityResource,
        suffix: `exact-client-scope:${String(authorityClientId)}`
      }),
      contextualRequirementIds: [],
      linkedClientRequirementIds: []
    }
  });
  return makeInput(
    [primary],
    [
      grant(
        "core:client.view",
        { type: "client", tenantId, id: authorityClientId },
        "client-read"
      )
    ]
  );
}

function clientGuard(
  kind: PathKind,
  contextualRequirementIds: readonly string[]
): ClientGuard {
  const common = {
    profileId: "core:rbac.guard.client_context" as const,
    target: { kind: "client" as const, clientId },
    contextualRequirementIds,
    linkedClientRequirementIds: []
  };
  switch (kind) {
    case "exact_client_binding":
      return {
        ...common,
        accessPath: kind,
        pathEvidence: exactClientBindingPathEvidence({
          targetResource: clientResource,
          clientResource,
          authorityResource: tenantResource,
          suffix: kind
        })
      };
    case "active_conversation_link":
      return {
        ...common,
        accessPath: kind,
        pathEvidence: activeConversationLinkPathEvidence({
          targetResource: clientResource,
          clientResource,
          conversationResource,
          suffix: kind
        })
      };
    case "current_work_item_queue":
      return {
        ...common,
        accessPath: kind,
        pathEvidence: currentWorkItemQueuePathEvidence({
          targetResource: clientResource,
          clientResource,
          conversationResource,
          workItemResource,
          queueResource,
          suffix: kind
        })
      };
    case "current_responsible":
      return {
        ...common,
        accessPath: kind,
        pathEvidence: currentResponsiblePathEvidence({
          targetResource: clientResource,
          clientResource,
          conversationResource,
          workItemResource,
          responsibleEmployeeResource: employeeResource,
          suffix: kind
        })
      };
    case "client_owner":
      return {
        ...common,
        accessPath: kind,
        pathEvidence: clientOwnerPathEvidence({
          targetResource: clientResource,
          clientResource,
          ownerEmployeeResource: employeeResource,
          suffix: kind
        })
      };
  }
}

function clientScopeFacts(
  kind: PathKind
): readonly InboxV2CanonicalScopeFact[] {
  if (kind === "current_work_item_queue") {
    return [
      {
        kind: "queue",
        ...scopePath(clientResource, queueResource),
        queueId,
        validUntil: LATER
      }
    ];
  }
  if (kind === "current_responsible") {
    return [
      {
        kind: "responsible",
        ...scopePath(clientResource, workItemResource),
        employeeId,
        workItemId,
        state: "active",
        assignmentRevision: revision,
        currentAssignmentRevision: revision,
        validUntil: LATER
      }
    ];
  }
  if (kind === "client_owner") {
    return [
      {
        kind: "client_owner",
        ...scopePath(clientResource, clientResource),
        employeeId,
        clientId,
        state: "active",
        ownershipRevision: revision,
        currentOwnershipRevision: revision,
        validUntil: LATER
      }
    ];
  }
  return [];
}

function conversationReadRequirement(
  id: string,
  targetResource: InboxV2EntityKey,
  targetConversationId: typeof conversationId
): InboxV2AuthorizationRequirement {
  return requirement({
    id,
    permissionId: "core:conversation.read",
    resource: targetResource,
    guard: {
      profileId: "core:rbac.guard.canonical_resource",
      resourceState: "active",
      contentBoundary: "external",
      routeInputFields: [],
      companionRequirementIds: [],
      action: {
        kind: "conversation_content_read",
        targetResource,
        conversationKind: "external_work",
        contentBoundary: "external",
        topologyResource: resource(
          "core:conversation-topology",
          `conversation_topology:${String(targetConversationId)}`
        ),
        topologyConversationResource: targetResource,
        topologyConversationKind: "external_work",
        topologyRevisionChecks: [{ kind: "state", expected: "1", actual: "1" }]
      }
    },
    visibility: "secondary_hidden"
  });
}

function workReadRequirement(): InboxV2AuthorizationRequirement {
  return requirement({
    id: "work-read",
    permissionId: "core:work.read",
    resource: workItemResource,
    guard: {
      profileId: "core:rbac.guard.work_item_state",
      authorizationMode: "operation",
      workItemId,
      operation: "read",
      workState: "active",
      actorRelation: "none",
      assignmentState: "assigned",
      expectedStateRevision: "1",
      currentStateRevision: "1",
      destinationRequirementIds: [],
      destinationResources: [],
      authorityTargetResource: null,
      authorityState: null,
      eligibleEmployeeId: null,
      authorityRevisionChecks: [],
      overrideReason: null,
      overrideRequirementId: null
    },
    visibility: "secondary_hidden"
  });
}

function mutateClientGuard<K extends PathKind>(
  input: InboxV2AuthorizationPlanInput,
  accessPath: K,
  mutate: (
    guard: Extract<ClientGuard, { accessPath: K }>
  ) => Extract<ClientGuard, { accessPath: K }>
): InboxV2AuthorizationPlanInput {
  return makeInput(
    input.requirements.map((candidate) =>
      candidate.id === "client-read" &&
      candidate.guard.profileId === "core:rbac.guard.client_context" &&
      candidate.guard.accessPath === accessPath
        ? {
            ...candidate,
            guard: mutate(
              candidate.guard as Extract<ClientGuard, { accessPath: K }>
            )
          }
        : candidate
    ),
    input.grants
  );
}

function requirement(
  input: Readonly<{
    id: string;
    permissionId: InboxV2PermissionId;
    resource: InboxV2EntityKey;
    guard: InboxV2PolicyGuardEvidence;
    scopeFacts?: readonly InboxV2CanonicalScopeFact[];
    visibility?: "primary" | "secondary_hidden";
  }>
): InboxV2AuthorizationRequirement {
  return {
    ...input,
    resourceAccessRevision: "5",
    expectedResourceAccessRevision: "5",
    scopeFacts: input.scopeFacts ?? [],
    revisionChecks: [],
    visibility: input.visibility ?? "primary",
    authorizationSubject: { kind: "actor" }
  };
}

function grant(
  permissionId: InboxV2PermissionId,
  scope: InboxV2PermissionScope,
  id: string
): InboxV2PolicyGrant {
  return {
    id: `grant-${id}`,
    tenantId,
    principal: { kind: "employee", employeeId },
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
    validUntil: AUTHORITY_END,
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
  for (const { resource } of requirements) {
    resources.set(
      `${resource.entityTypeId}\u0000${resource.entityId}`,
      resource
    );
  }
  return inboxV2AuthorizationDependencyVectorSchema.parse({
    tenantRbacRevision: "1",
    employeeAccessRevision: "2",
    employeeInboxRelationRevision: "3",
    sharedAccessRevision: "4",
    resourceDependencies: [...resources.values()].map((dependencyResource) => ({
      resource: dependencyResource,
      accessRevision: "5"
    })),
    temporalBoundaryDigest: DIGEST
  });
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
      loaderDecisionId: "client-path-test-loader",
      projectionRevision: revision,
      observedAt: NOW
    }
  };
}

function resource(entityTypeId: string, entityId: string): InboxV2EntityKey {
  return inboxV2EntityKeySchema.parse({ tenantId, entityTypeId, entityId });
}
