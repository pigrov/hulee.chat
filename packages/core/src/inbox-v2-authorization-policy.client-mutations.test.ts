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
  inboxV2OrgUnitIdSchema,
  inboxV2TeamIdSchema,
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
import {
  activeConversationLinkPathEvidence,
  exactClientBindingPathEvidence
} from "./inbox-v2-authorization-policy.client-path.test-support";

const NOW = "2026-07-12T10:00:00.000Z";
const GRANT_END = "2026-07-12T10:30:00.000Z";
const SESSION_END = "2026-07-12T11:00:00.000Z";
const LATER = "2026-07-12T12:00:00.000Z";
const DIGEST = `sha256:${"c".repeat(64)}`;

const tenantId = inboxV2TenantIdSchema.parse("tenant:client-mutations");
const employeeId = inboxV2EmployeeIdSchema.parse(
  "employee:client-mutation-actor"
);
const employee = inboxV2EmployeeReferenceSchema.parse({
  tenantId,
  kind: "employee",
  id: employeeId
});
const epoch = inboxV2AuthorizationEpochSchema.parse(
  "authorization:client-mutations-epoch"
);
const revision = inboxV2EntityRevisionSchema.parse("1");
const clientId = inboxV2ClientIdSchema.parse("client:client-a");
const secondClientId = inboxV2ClientIdSchema.parse("client:client-b");
const conversationId = inboxV2ConversationIdSchema.parse(
  "conversation:client-links"
);
const orgUnitId = inboxV2OrgUnitIdSchema.parse("org_unit:old-target");
const teamId = inboxV2TeamIdSchema.parse("team:new-target");

const clientResource = resource("core:client", String(clientId));
const tenantResource = resource("core:tenant", String(tenantId));
const secondClientResource = resource("core:client", String(secondClientId));
const conversationResource = resource(
  "core:conversation",
  String(conversationId)
);
const orgUnitResource = resource("core:org-unit", String(orgUnitId));
const teamResource = resource("core:team", String(teamId));
const bindingSetResource = resource(
  "core:client-access-binding-set",
  "client_access_binding_set:client-a"
);
const manifestResource = resource(
  "core:authorization-manifest",
  "authorization_manifest:client-links"
);
const auditEventResource = resource(
  "core:audit-event",
  "audit_event:client-mutations"
);

type ClientGuardEvidence = Extract<
  InboxV2PolicyGuardEvidence,
  { profileId: "core:rbac.guard.client_context" }
>;
type ClientMutationEvidence = NonNullable<ClientGuardEvidence["mutation"]>;
type PipelineMutation = Extract<
  ClientMutationEvidence,
  { kind: "pipeline_transition" }
>;
type FieldMutation = Extract<ClientMutationEvidence, { kind: "field_edit" }>;
type AccessBindingMutation = Extract<
  ClientMutationEvidence,
  { kind: "access_binding_change" }
>;
type ConversationLinksMutation = Extract<
  ClientMutationEvidence,
  { kind: "conversation_client_links_change" }
>;

describe("Inbox V2 typed Client mutation authorization", () => {
  it("allows a policy-bound pipeline transition with exact stages and audit", () => {
    const primary = clientRequirement(
      "pipeline",
      "core:client.pipeline.transition",
      clientResource,
      clientId,
      pipelineMutation()
    );

    const decision = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [primary],
        [
          makeGrant("core:client.pipeline.transition", {
            type: "tenant",
            tenantId
          })
        ]
      )
    );
    expect(decision, JSON.stringify(decision)).toMatchObject({
      outcome: "allowed"
    });
  });

  it("denies pipeline stage/policy substitution and stale Client revision", () => {
    const mutation = pipelineMutation();
    const substituted = clientRequirement(
      "pipeline-substituted",
      "core:client.pipeline.transition",
      clientResource,
      clientId,
      {
        ...mutation,
        policyNewStageResource: resource(
          "core:client-pipeline-stage",
          "client_pipeline_stage:substituted"
        )
      }
    );
    const stale = clientRequirement(
      "pipeline-stale",
      "core:client.pipeline.transition",
      clientResource,
      clientId,
      { ...mutation, currentClientRevision: "2" }
    );
    const grant = makeGrant("core:client.pipeline.transition", {
      type: "tenant",
      tenantId
    });

    expect(
      evaluateInboxV2AuthorizationPlan(makeInput([substituted], [grant]))
        .outcome
    ).toBe("denied");
    expect(
      evaluateInboxV2AuthorizationPlan(makeInput([stale], [grant]))
    ).toMatchObject({
      outcome: "denied",
      publicErrorCode: "revision.conflict"
    });
  });

  it("allows a validated typed field edit only with exact Client view", () => {
    const clientRead = clientRequirement(
      "field-client-read",
      "core:client.view",
      clientResource,
      clientId,
      undefined,
      "secondary_hidden"
    );
    const primary = clientRequirement(
      "field-edit",
      "core:client.fields.edit",
      clientResource,
      clientId,
      fieldMutation(),
      "primary",
      [clientRead.id]
    );

    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [primary, clientRead],
          [
            makeGrant("core:client.fields.edit", {
              type: "tenant",
              tenantId
            }),
            makeGrant(
              "core:client.view",
              { type: "tenant", tenantId },
              "field-client-read"
            )
          ]
        )
      ).outcome
    ).toBe("allowed");
  });

  it("denies field-definition substitution, invalid value proof and stale value revision", () => {
    const base = fieldMutation();
    const mutations: readonly FieldMutation[] = [
      {
        ...base,
        fieldValueDefinitionResource: resource(
          "core:client-field-definition",
          "client_field_definition:other"
        )
      },
      { ...base, submittedValueType: "number" },
      { ...base, currentFieldValueRevision: "3" }
    ];

    for (const [index, mutation] of mutations.entries()) {
      const readId = `field-read-${index}`;
      const read = clientRequirement(
        readId,
        "core:client.view",
        clientResource,
        clientId,
        undefined,
        "secondary_hidden"
      );
      const primary = clientRequirement(
        `field-denied-${index}`,
        "core:client.fields.edit",
        clientResource,
        clientId,
        mutation,
        "primary",
        [readId]
      );
      const decision = evaluateInboxV2AuthorizationPlan(
        makeInput(
          [primary, read],
          [
            makeGrant("core:client.fields.edit", {
              type: "tenant",
              tenantId
            }),
            makeGrant("core:client.view", { type: "tenant", tenantId }, readId)
          ]
        )
      );
      expect(
        decision,
        `case ${index}: ${JSON.stringify(decision)}`
      ).toMatchObject({ outcome: "denied" });
    }
  });

  it("allows access-binding replace only with exact old and new target authority", () => {
    const mutation = accessBindingMutation();
    const oldAuthority = accessBindingAuthorityRequirement(
      "access-old",
      "old",
      orgUnitResource,
      orgUnitFact()
    );
    const newAuthority = accessBindingAuthorityRequirement(
      "access-new",
      "new",
      teamResource,
      teamFact()
    );
    const primary = clientRequirement(
      "access-change",
      "core:client.access_binding.manage",
      clientResource,
      clientId,
      mutation
    );

    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [primary, oldAuthority, newAuthority],
          [
            makeGrant("core:client.access_binding.manage", {
              type: "tenant",
              tenantId
            }),
            makeGrant(
              "core:client.access_binding.manage",
              { type: "org_unit", tenantId, id: orgUnitId, mode: "exact" },
              "access-old"
            ),
            makeGrant(
              "core:client.access_binding.manage",
              { type: "team", tenantId, id: teamId },
              "access-new"
            )
          ]
        )
      ).outcome
    ).toBe("allowed");
  });

  it("denies access-binding target substitution, reused authority and stale relation", () => {
    const base = accessBindingMutation();
    const oldAuthority = accessBindingAuthorityRequirement(
      "access-old",
      "old",
      orgUnitResource,
      orgUnitFact()
    );
    const substitutedNew = accessBindingAuthorityRequirement(
      "access-new",
      "new",
      orgUnitResource,
      orgUnitFact()
    );
    const staleNew = accessBindingAuthorityRequirement(
      "access-new",
      "new",
      teamResource,
      teamFact(),
      [{ kind: "relation", expected: "1", actual: "2" }]
    );
    const primary = clientRequirement(
      "access-change",
      "core:client.access_binding.manage",
      clientResource,
      clientId,
      base
    );
    const reused = clientRequirement(
      "access-reused",
      "core:client.access_binding.manage",
      clientResource,
      clientId,
      {
        ...base,
        targetAuthorities: [
          base.targetAuthorities[0]!,
          {
            ...base.targetAuthorities[1]!,
            requirementId: base.targetAuthorities[0]!.requirementId
          }
        ]
      }
    );
    const grants = [
      makeGrant("core:client.access_binding.manage", {
        type: "tenant",
        tenantId
      }),
      makeGrant(
        "core:client.access_binding.manage",
        { type: "org_unit", tenantId, id: orgUnitId, mode: "exact" },
        "access-old"
      ),
      makeGrant(
        "core:client.access_binding.manage",
        { type: "team", tenantId, id: teamId },
        "access-new"
      )
    ];

    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput([primary, oldAuthority, substitutedNew], grants)
      ).outcome
    ).toBe("denied");
    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput([reused, oldAuthority], grants)
      ).outcome
    ).toBe("denied");
    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput([primary, oldAuthority, staleNew], grants)
      ).outcome
    ).toBe("denied");
  });

  it("allows one exact client.link.manage companion for every manifest target", () => {
    const { primary, clientAuthorities, conversationRead } = linkPlan();
    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [primary, conversationRead, ...clientAuthorities],
          linkGrants()
        )
      ).outcome
    ).toBe("allowed");
  });

  it("denies partial link manifests and one companion reused for multiple Clients", () => {
    const { primary, clientAuthorities, conversationRead } = linkPlan();
    const primaryGuard = primary.guard as ClientGuardEvidence;
    const mutation = primaryGuard.mutation as ConversationLinksMutation;
    const partial = {
      ...primary,
      guard: {
        ...primaryGuard,
        mutation: {
          ...mutation,
          targets: [mutation.targets[0]!]
        }
      }
    } satisfies InboxV2AuthorizationRequirement;
    const reused = {
      ...primary,
      guard: {
        ...primaryGuard,
        linkedClientRequirementIds: ["link-client-a"],
        mutation: {
          ...mutation,
          targets: [
            mutation.targets[0]!,
            {
              ...mutation.targets[1]!,
              clientRequirementId: "link-client-a"
            }
          ]
        }
      }
    } satisfies InboxV2AuthorizationRequirement;

    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [partial, conversationRead, ...clientAuthorities],
          linkGrants()
        )
      ).outcome
    ).toBe("denied");
    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [reused, conversationRead, clientAuthorities[0]!],
          linkGrants()
        )
      ).outcome
    ).toBe("denied");
  });

  it("denies Client/link substitution and stale link relation evidence", () => {
    const { primary, clientAuthorities, conversationRead } = linkPlan();
    const secondGuard = clientAuthorities[1]!.guard as ClientGuardEvidence;
    const substituted = {
      ...clientAuthorities[1]!,
      guard: {
        ...secondGuard,
        mutation: {
          ...(secondGuard.mutation as Extract<
            ClientMutationEvidence,
            { kind: "client_link_target_authority" }
          >),
          relationClientResource: clientResource
        }
      }
    } satisfies InboxV2AuthorizationRequirement;
    const stale = {
      ...clientAuthorities[1]!,
      guard: {
        ...secondGuard,
        mutation: {
          ...(secondGuard.mutation as Extract<
            ClientMutationEvidence,
            { kind: "client_link_target_authority" }
          >),
          relationRevisionChecks: [
            { kind: "relation", expected: "1", actual: "2" }
          ]
        }
      }
    } satisfies InboxV2AuthorizationRequirement;

    for (const secondAuthority of [substituted, stale]) {
      expect(
        evaluateInboxV2AuthorizationPlan(
          makeInput(
            [primary, conversationRead, clientAuthorities[0]!, secondAuthority],
            linkGrants()
          )
        ).outcome
      ).toBe("denied");
    }
  });
});

function pipelineMutation(): PipelineMutation {
  const oldStageResource = resource(
    "core:client-pipeline-stage",
    "client_pipeline_stage:new"
  );
  const newStageResource = resource(
    "core:client-pipeline-stage",
    "client_pipeline_stage:qualified"
  );
  return {
    kind: "pipeline_transition",
    clientResource,
    oldStageResource,
    newStageResource,
    transitionPolicyResource: resource(
      "core:client-pipeline-transition-policy",
      "client_pipeline_transition_policy:new-qualified"
    ),
    policyClientResource: clientResource,
    policyOldStageResource: oldStageResource,
    policyNewStageResource: newStageResource,
    policyState: "active",
    policyRevisionChecks: [{ kind: "policy", expected: "4", actual: "4" }],
    expectedClientRevision: "7",
    currentClientRevision: "7",
    reason: "qualify after verified contact",
    auditEventResource,
    auditClientResource: clientResource,
    auditOldStageResource: oldStageResource,
    auditNewStageResource: newStageResource
  };
}

function fieldMutation(): FieldMutation {
  const fieldDefinitionResource = resource(
    "core:client-field-definition",
    "client_field_definition:budget"
  );
  const fieldValueResource = resource(
    "core:client-field-value",
    "client_field_value:client-a-budget"
  );
  return {
    kind: "field_edit",
    clientResource,
    fieldDefinitionResource,
    fieldValueResource,
    fieldValueClientResource: clientResource,
    fieldValueDefinitionResource: fieldDefinitionResource,
    definitionState: "active",
    definitionValueType: "string",
    submittedValueType: "string",
    valueValidationState: "validated",
    requestedValueDigest: DIGEST,
    validatedValueDigest: DIGEST,
    definitionRevisionChecks: [{ kind: "entity", expected: "3", actual: "3" }],
    expectedFieldValueRevision: "2",
    currentFieldValueRevision: "2",
    expectedClientRevision: "7",
    currentClientRevision: "7",
    reason: "update a schema-validated field",
    auditEventResource,
    auditClientResource: clientResource,
    auditFieldDefinitionResource: fieldDefinitionResource,
    auditFieldValueResource: fieldValueResource
  };
}

function accessBindingMutation(): AccessBindingMutation {
  const oldBindingResource = resource(
    "core:client-access-binding",
    "client_access_binding:old"
  );
  const newBindingResource = resource(
    "core:client-access-binding",
    "client_access_binding:new"
  );
  return {
    kind: "access_binding_change",
    operation: "replace",
    clientResource,
    bindingSetResource,
    bindingSetClientResource: clientResource,
    oldBindingResource,
    oldBindingClientResource: clientResource,
    oldBindingTargetResource: orgUnitResource,
    newBindingResource,
    newBindingClientResource: clientResource,
    newBindingTargetResource: teamResource,
    targetAuthorities: [
      {
        side: "old",
        targetResource: orgUnitResource,
        requirementId: "access-old"
      },
      {
        side: "new",
        targetResource: teamResource,
        requirementId: "access-new"
      }
    ],
    expectedBindingSetRevision: "5",
    currentBindingSetRevision: "5",
    oldRelationRevisionChecks: [
      { kind: "relation", expected: "2", actual: "2" }
    ],
    newRelationRevisionChecks: [
      { kind: "relation", expected: "0", actual: "0" }
    ],
    reason: "move Client access to the servicing Team",
    auditEventResource,
    auditClientResource: clientResource,
    auditOldTargetResource: orgUnitResource,
    auditNewTargetResource: teamResource
  };
}

function accessBindingAuthorityRequirement(
  id: string,
  side: "old" | "new",
  targetResource: InboxV2EntityKey,
  scopeFact: InboxV2CanonicalScopeFact,
  relationRevisionChecks?: readonly Readonly<{
    kind: "relation";
    expected: string;
    actual: string;
  }>[]
): InboxV2AuthorizationRequirement {
  const currentRelationRevisionChecks =
    relationRevisionChecks ??
    (side === "old"
      ? [{ kind: "relation" as const, expected: "2", actual: "2" }]
      : [{ kind: "relation" as const, expected: "0", actual: "0" }]);
  return clientRequirement(
    id,
    "core:client.access_binding.manage",
    clientResource,
    clientId,
    {
      kind: "access_binding_target_authority",
      clientResource,
      bindingSetResource,
      side,
      targetResource,
      relationClientResource: clientResource,
      relationTargetResource: targetResource,
      relationRevisionChecks: currentRelationRevisionChecks
    },
    "secondary_hidden",
    [],
    [scopeFact]
  );
}

function linkPlan(): Readonly<{
  primary: InboxV2AuthorizationRequirement;
  conversationRead: InboxV2AuthorizationRequirement;
  clientAuthorities: readonly InboxV2AuthorizationRequirement[];
}> {
  const first = linkTarget(
    "link-client-a",
    clientId,
    clientResource,
    "conversation_client_link:a"
  );
  const second = linkTarget(
    "link-client-b",
    secondClientId,
    secondClientResource,
    "conversation_client_link:b"
  );
  const targets = [first.target, second.target];
  const mutation: ConversationLinksMutation = {
    kind: "conversation_client_links_change",
    operation: "add",
    conversationResource,
    manifestResource,
    manifestConversationResource: conversationResource,
    requestedTargetCount: 2,
    manifestTargetCount: 2,
    requestedTargetSetDigest: DIGEST,
    manifestTargetSetDigest: DIGEST,
    manifestRevisionChecks: [{ kind: "manifest", expected: "3", actual: "3" }],
    targets,
    reason: "link all verified Clients atomically",
    auditEventResource,
    auditConversationResource: conversationResource,
    auditManifestResource: manifestResource
  };
  const conversationRead = conversationReadRequirement();
  const primary = conversationClientRequirement(mutation, conversationRead.id);
  const authorities = [
    linkAuthorityRequirement(first, clientId),
    linkAuthorityRequirement(second, secondClientId)
  ];
  return { primary, conversationRead, clientAuthorities: authorities };
}

function linkTarget(
  clientRequirementId: string,
  _clientId: typeof clientId | typeof secondClientId,
  targetClientResource: InboxV2EntityKey,
  linkId: string
) {
  const linkResource = resource("core:conversation-client-link", linkId);
  return {
    target: {
      clientResource: targetClientResource,
      linkResource,
      relationConversationResource: conversationResource,
      relationClientResource: targetClientResource,
      expectedLinkRevision: "0",
      currentLinkRevision: "0",
      relationRevisionChecks: [
        { kind: "relation" as const, expected: "0", actual: "0" }
      ],
      clientRequirementId
    },
    clientRequirementId,
    clientResource: targetClientResource,
    linkResource
  } as const;
}

function linkAuthorityRequirement(
  descriptor: ReturnType<typeof linkTarget>,
  targetClientId: typeof clientId | typeof secondClientId
): InboxV2AuthorizationRequirement {
  return clientRequirement(
    descriptor.clientRequirementId,
    "core:client.link.manage",
    descriptor.clientResource,
    targetClientId,
    {
      kind: "client_link_target_authority",
      operation: "add",
      clientResource: descriptor.clientResource,
      conversationResource,
      linkResource: descriptor.linkResource,
      relationConversationResource: conversationResource,
      relationClientResource: descriptor.clientResource,
      expectedLinkRevision: "0",
      currentLinkRevision: "0",
      relationRevisionChecks: [
        { kind: "relation", expected: "0", actual: "0" }
      ],
      manifestResource,
      manifestConversationResource: conversationResource,
      manifestTargetCount: 2,
      manifestTargetSetDigest: DIGEST,
      manifestRevisionChecks: [
        { kind: "manifest", expected: "3", actual: "3" }
      ],
      reason: "link all verified Clients atomically",
      auditEventResource,
      auditConversationResource: conversationResource,
      auditClientResource: descriptor.clientResource,
      auditLinkResource: descriptor.linkResource
    },
    "secondary_hidden",
    [],
    [clientFact(targetClientId, descriptor.clientResource)]
  );
}

function conversationClientRequirement(
  mutation: ConversationLinksMutation,
  conversationReadRequirementId: string
): InboxV2AuthorizationRequirement {
  return makeRequirement({
    id: "conversation-links",
    permissionId: "core:conversation.clients.manage",
    resource: conversationResource,
    guard: {
      profileId: "core:rbac.guard.client_context",
      target: { kind: "conversation", conversationId },
      accessPath: "active_conversation_link",
      pathEvidence: activeConversationLinkPathEvidence({
        targetResource: conversationResource,
        clientResource: mutation.targets[0]!.clientResource,
        conversationResource,
        suffix: "client-links-primary"
      }),
      contextualRequirementIds: [conversationReadRequirementId],
      linkedClientRequirementIds: mutation.targets.map(
        ({ clientRequirementId }) => clientRequirementId
      ),
      mutation
    }
  });
}

function conversationReadRequirement(): InboxV2AuthorizationRequirement {
  return makeRequirement({
    id: "conversation-read",
    permissionId: "core:conversation.read",
    resource: conversationResource,
    guard: {
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
        topologyResource: resource(
          "core:conversation-topology",
          "conversation_topology:client-links"
        ),
        topologyConversationResource: conversationResource,
        topologyConversationKind: "external_work",
        topologyRevisionChecks: [{ kind: "state", expected: "1", actual: "1" }]
      }
    },
    visibility: "secondary_hidden"
  });
}

function linkGrants(): readonly InboxV2PolicyGrant[] {
  return [
    makeGrant("core:conversation.clients.manage", {
      type: "tenant",
      tenantId
    }),
    makeGrant(
      "core:conversation.read",
      { type: "tenant", tenantId },
      "conversation-read"
    ),
    makeGrant(
      "core:client.link.manage",
      { type: "client", tenantId, id: clientId },
      "link-client-a"
    ),
    makeGrant(
      "core:client.link.manage",
      { type: "client", tenantId, id: secondClientId },
      "link-client-b"
    )
  ];
}

function clientRequirement(
  id: string,
  permissionId: InboxV2PermissionId,
  targetResource: InboxV2EntityKey,
  targetClientId: typeof clientId | typeof secondClientId,
  mutation?: ClientMutationEvidence,
  visibility: "primary" | "secondary_hidden" = "primary",
  contextualRequirementIds: readonly string[] = [],
  scopeFacts: readonly InboxV2CanonicalScopeFact[] = []
): InboxV2AuthorizationRequirement {
  return makeRequirement({
    id,
    permissionId,
    resource: targetResource,
    scopeFacts,
    guard: {
      profileId: "core:rbac.guard.client_context",
      target: { kind: "client", clientId: targetClientId },
      accessPath: "exact_client_binding",
      pathEvidence: exactClientBindingPathEvidence({
        targetResource,
        clientResource: targetResource,
        authorityResource: scopeFacts[0]?.scopeTarget ?? tenantResource,
        suffix: id
      }),
      contextualRequirementIds,
      linkedClientRequirementIds: [],
      ...(mutation === undefined ? {} : { mutation })
    },
    visibility
  });
}

function makeRequirement(
  overrides: Partial<InboxV2AuthorizationRequirement>
): InboxV2AuthorizationRequirement {
  const defaultGuard: ClientGuardEvidence = {
    profileId: "core:rbac.guard.client_context",
    target: { kind: "client", clientId },
    accessPath: "exact_client_binding",
    pathEvidence: exactClientBindingPathEvidence({
      targetResource: clientResource,
      clientResource,
      authorityResource: tenantResource,
      suffix: "default"
    }),
    contextualRequirementIds: [],
    linkedClientRequirementIds: []
  };
  return Object.freeze({
    id: "primary",
    permissionId: "core:client.view",
    resource: clientResource,
    resourceAccessRevision: "5",
    expectedResourceAccessRevision: "5",
    scopeFacts: Object.freeze([]),
    revisionChecks: Object.freeze([]),
    guard: defaultGuard,
    visibility: "primary",
    authorizationSubject: Object.freeze({ kind: "actor" as const }),
    ...overrides
  });
}

function makeGrant(
  permissionId: InboxV2PermissionId,
  scope: InboxV2PermissionScope,
  id = `grant-${permissionId}`
): Extract<InboxV2PolicyGrant, { principal: { kind: "employee" } }> {
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
    validUntil: GRANT_END,
    revokedAt: null
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

function makeDependencies(
  requirements: readonly InboxV2AuthorizationRequirement[]
): InboxV2AuthorizationDependencyVector {
  const resources = new Map<string, InboxV2EntityKey>();
  for (const requirement of requirements) {
    resources.set(
      `${requirement.resource.entityTypeId}\u0000${requirement.resource.entityId}`,
      requirement.resource
    );
  }
  return inboxV2AuthorizationDependencyVectorSchema.parse({
    tenantRbacRevision: "1",
    employeeAccessRevision: "2",
    employeeInboxRelationRevision: "3",
    sharedAccessRevision: "4",
    resourceDependencies: [...resources.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([, resource]) => ({
        resource,
        accessRevision: "5"
      })),
    temporalBoundaryDigest: DIGEST
  });
}

function clientFact(
  targetClientId: typeof clientId | typeof secondClientId,
  targetResource: InboxV2EntityKey
): InboxV2CanonicalScopeFact {
  return {
    kind: "client",
    ...scopePath(targetResource, targetResource),
    clientId: targetClientId,
    validUntil: LATER
  };
}

function orgUnitFact(): InboxV2CanonicalScopeFact {
  return {
    kind: "org_unit",
    ...scopePath(clientResource, orgUnitResource),
    orgUnitId,
    ancestorOrgUnitIds: [],
    closureRevision: revision,
    currentClosureRevision: revision,
    validUntil: LATER
  };
}

function teamFact(): InboxV2CanonicalScopeFact {
  return {
    kind: "team",
    ...scopePath(clientResource, teamResource),
    teamId,
    validUntil: LATER
  };
}

function scopePath(resource: InboxV2EntityKey, scopeTarget: InboxV2EntityKey) {
  return {
    resource,
    scopeTarget,
    pathRevisionChecks: [
      { kind: "relation" as const, expected: "1", actual: "1" },
      { kind: "state" as const, expected: "1", actual: "1" }
    ],
    authorityProvenance: {
      kind: "hulee_canonical_repository" as const,
      factId: `fact:${resource.entityTypeId}:${resource.entityId}`,
      loaderDecisionId: "client-mutation-loader",
      projectionRevision: revision,
      observedAt: NOW
    }
  };
}

function resource(entityTypeId: string, entityId: string): InboxV2EntityKey {
  return inboxV2EntityKeySchema.parse({ tenantId, entityTypeId, entityId });
}
