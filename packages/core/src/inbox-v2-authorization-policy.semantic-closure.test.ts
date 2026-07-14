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
  inboxV2TeamIdSchema,
  inboxV2TenantIdSchema,
  inboxV2TrustedServiceIdSchema,
  inboxV2WorkItemIdSchema,
  inboxV2WorkQueueIdSchema,
  type InboxV2AuthorizationDependencyVector,
  type InboxV2EmployeeId,
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
const GRANT_END = "2026-07-12T10:30:00.000Z";
const SESSION_END = "2026-07-12T11:00:00.000Z";
const LATER = "2026-07-12T12:00:00.000Z";
const DIGEST = `sha256:${"c".repeat(64)}`;

const tenantId = inboxV2TenantIdSchema.parse("tenant:semantic-closure");
const employeeId = inboxV2EmployeeIdSchema.parse("employee:closure-actor");
const otherEmployeeId = inboxV2EmployeeIdSchema.parse(
  "employee:closure-successor"
);
const thirdEmployeeId = inboxV2EmployeeIdSchema.parse(
  "employee:closure-approver"
);
const employee = inboxV2EmployeeReferenceSchema.parse({
  tenantId,
  kind: "employee",
  id: employeeId
});
const epoch = inboxV2AuthorizationEpochSchema.parse(
  "authorization:semantic-closure"
);
const revision = inboxV2EntityRevisionSchema.parse("1");
const conversationId = inboxV2ConversationIdSchema.parse(
  "conversation:semantic-closure"
);
const clientId = inboxV2ClientIdSchema.parse("client:closure-old");
const sourceAccountId = inboxV2SourceAccountIdSchema.parse(
  "source_account:semantic-closure"
);
const workItemId = inboxV2WorkItemIdSchema.parse("work_item:semantic-closure");
const queueId = inboxV2WorkQueueIdSchema.parse("work_queue:semantic-closure");
const clientAccessTeamId = inboxV2TeamIdSchema.parse(
  "team:client-access-semantic-closure"
);
const trustedServiceId = inboxV2TrustedServiceIdSchema.parse(
  "core:identity-semantic-resolver"
);

const tenantResource = resource("core:tenant", String(tenantId));
const conversationResource = resource(
  "core:conversation",
  String(conversationId)
);
const clientResource = resource("core:client", String(clientId));
const clientContactResource = resource(
  "core:client-contact",
  "client_contact:closure-old"
);
const secondClientContactResource = resource(
  "core:client-contact",
  "client_contact:closure-new"
);
const otherEmployeeResource = resource(
  "core:employee",
  String(otherEmployeeId)
);
const sourceAccountResource = resource(
  "core:source-account",
  String(sourceAccountId)
);
const sourceIdentityResource = resource(
  "core:source-external-identity",
  "source_external_identity:semantic-closure"
);
const aliasSourceIdentityResource = resource(
  "core:source-external-identity",
  "source_external_identity:semantic-closure-alias"
);
const workItemResource = resource("core:work-item", String(workItemId));
const queueResource = resource("core:work-queue", String(queueId));
const reportResource = resource(
  "core:report-query",
  "report_query:semantic-closure"
);
const clientAccessTeamResource = resource(
  "core:team",
  String(clientAccessTeamId)
);

const canonicalGuard = Object.freeze({
  profileId: "core:rbac.guard.canonical_resource",
  resourceState: "active",
  contentBoundary: "none",
  routeInputFields: Object.freeze([]),
  companionRequirementIds: Object.freeze([]),
  action: Object.freeze({ kind: "canonical" as const })
} satisfies InboxV2PolicyGuardEvidence);

/**
 * Literal fence for the exact gaps found by the catalog-vs-evaluated-scenario
 * audit. Adding a scenario without deliberately updating this list cannot make
 * the closure meta-test pass by accident.
 */
const SEMANTIC_GAP_PERMISSION_IDS = Object.freeze([
  "core:tenant.manage",
  "core:employee.invite",
  "core:employee.profile.manage",
  "core:employee.deactivate",
  "core:roles.define",
  "core:direct_grants.manage",
  "core:org_unit.manage",
  "core:team.manage",
  "core:conversation.internal.owner_recover",
  "core:conversation.access_binding.apply_policy",
  "core:message.staff_note.read",
  "core:message.delete_own",
  "core:source_account.view",
  "core:source_account.diagnostics.view",
  "core:call.transcript.view",
  "core:client.edit",
  "core:client.pipeline.transition",
  "core:client.fields.view_sensitive",
  "core:client.fields.edit",
  "core:client.owner.assign",
  "core:client.access_binding.manage",
  "core:identity.client_contact_claim.manage",
  "core:identity.source_identity.use",
  "core:identity.evidence.view",
  "core:identity.auto_resolve",
  "core:identity.claim.revoke",
  "core:identity.merge",
  "core:identity.observation.review",
  "core:reports.workforce_dimension.view",
  "core:audit.view",
  "core:privacy.request.view",
  "core:privacy.request.execute",
  "core:privacy.hold.view",
  "core:privacy.hold.issue",
  "core:audit.privacy.view",
  "core:audit.privacy.export"
] as const satisfies readonly InboxV2PermissionId[]);

const ADDITIONAL_SEMANTIC_CLOSURE_PERMISSION_IDS = Object.freeze([
  "core:identity.employee_claim.manage",
  "core:work.transfer",
  "core:work.release_self",
  "core:work.release_other"
] as const satisfies readonly InboxV2PermissionId[]);

const SEMANTIC_CLOSURE_PERMISSION_IDS = Object.freeze([
  ...SEMANTIC_GAP_PERMISSION_IDS,
  ...ADDITIONAL_SEMANTIC_CLOSURE_PERMISSION_IDS
] as const satisfies readonly InboxV2PermissionId[]);

type SemanticScenario = Readonly<{
  permissionId: InboxV2PermissionId;
  input: InboxV2AuthorizationPlanInput;
}>;

type EmployeeGrant = Extract<
  InboxV2PolicyGrant,
  { principal: { kind: "employee" } }
>;

function resource(entityTypeId: string, entityId: string): InboxV2EntityKey {
  return inboxV2EntityKeySchema.parse({ tenantId, entityTypeId, entityId });
}

function keyedRevisionChecks(
  resources: readonly InboxV2EntityKey[]
): readonly Readonly<{
  resource: InboxV2EntityKey;
  expected: string;
  actual: string;
}>[] {
  const uniqueResources = new Map<string, InboxV2EntityKey>();
  for (const revisionResource of resources) {
    uniqueResources.set(
      `${revisionResource.tenantId}\u0000${revisionResource.entityTypeId}\u0000${revisionResource.entityId}`,
      revisionResource
    );
  }
  return [...uniqueResources.values()].map((revisionResource) => ({
    resource: revisionResource,
    expected: "1",
    actual: "1"
  }));
}

function privilegedAudit(
  action:
    | "tenant_settings_change"
    | "employee_invite"
    | "employee_profile_update"
    | "employee_deactivate"
    | "role_definition_change"
    | "organization_graph_change"
    | "direct_grant"
    | "internal_owner_recovery",
  targetResource: InboxV2EntityKey,
  eventResource: InboxV2EntityKey
) {
  const actorResource = resource("core:employee", String(employeeId));
  const bindingResource = resource(
    "core:audit-event-binding",
    `audit_event_binding:${String(eventResource.entityId)}`
  );
  return {
    eventResource,
    bindingResource,
    bindingEventResource: eventResource,
    bindingTargetResource: targetResource,
    bindingActorEmployeeResource: actorResource,
    action,
    revisionChecks: keyedRevisionChecks([
      eventResource,
      bindingResource,
      targetResource,
      actorResource
    ])
  } as const;
}

function employeeDeactivationResources(targetResource: InboxV2EntityKey) {
  const workflowResource = resource(
    "core:employee-deactivation-workflow",
    "employee_deactivation_workflow:semantic"
  );
  const fenceResource = resource(
    "core:employee-active-relation-fence",
    "employee_active_relation_fence:semantic"
  );
  const handlerSetResource = resource(
    "core:employee-deactivation-handler-set-manifest",
    "employee_deactivation_handler_set:semantic"
  );
  const handlerRegistryVersion =
    "employee_deactivation_handler_registry:semantic-v1";
  const handlerRegistryResource = resource(
    "core:employee-deactivation-handler-registry-manifest",
    handlerRegistryVersion
  );
  const handlerRegistrySelectionResource = resource(
    "core:employee-deactivation-handler-registry-selection",
    `employee_deactivation_handler_registry_selection:${String(tenantId)}`
  );
  const handlerRegistryDigest = `sha256:${"d".repeat(64)}`;
  const handlerResources = ["work", "client-owner", "internal-owner"].map(
    (id) =>
      resource(
        "core:employee-deactivation-handler-checkpoint",
        `employee_deactivation_handler:${id}`
      )
  );
  const relationSetResources = [
    "primary-work",
    "client-owner",
    "internal-owner"
  ].map((id) =>
    resource(
      "core:employee-active-relation-set-manifest",
      `employee_active_relation_set:${id}`
    )
  );
  return {
    targetResource,
    workflowResource,
    fenceResource,
    handlerSetResource,
    handlerRegistryVersion,
    handlerRegistryResource,
    handlerRegistrySelectionResource,
    handlerRegistryDigest,
    handlerResources,
    relationSetResources
  } as const;
}

function employeeDeactivationHandlerSet(targetResource: InboxV2EntityKey) {
  const resources = employeeDeactivationResources(targetResource);
  return {
    resource: resources.handlerSetResource,
    workflowResource: resources.workflowResource,
    employeeResource: targetResource,
    registrySelection: {
      resource: resources.handlerRegistrySelectionResource,
      tenantResource,
      selectedRegistryResource: resources.handlerRegistryResource,
      selectedVersion: resources.handlerRegistryVersion,
      selectedDigest: resources.handlerRegistryDigest,
      state: "active" as const,
      mandatoryHandlerResources: resources.handlerResources,
      revisionChecks: keyedRevisionChecks([
        resources.handlerRegistrySelectionResource,
        tenantResource,
        resources.handlerRegistryResource,
        ...resources.handlerResources
      ])
    },
    registryManifest: {
      resource: resources.handlerRegistryResource,
      tenantResource,
      version: resources.handlerRegistryVersion,
      digest: resources.handlerRegistryDigest,
      registeredMandatoryHandlerResources: resources.handlerResources,
      revisionChecks: keyedRevisionChecks([
        resources.handlerRegistryResource,
        tenantResource,
        ...resources.handlerResources
      ])
    },
    requiredHandlerResources: resources.handlerResources,
    completedHandlerResources: resources.handlerResources,
    revisionChecks: keyedRevisionChecks([
      resources.handlerSetResource,
      resources.workflowResource,
      targetResource,
      resources.handlerRegistrySelectionResource,
      resources.handlerRegistryResource,
      ...resources.handlerResources
    ])
  } as const;
}

function employeeDeactivationRelationSets(targetResource: InboxV2EntityKey) {
  const resources = employeeDeactivationResources(targetResource);
  return (["primary_work", "client_owner", "internal_owner"] as const).map(
    (kind, index) => ({
      kind,
      resource: resources.relationSetResources[index]!,
      fenceResource: resources.fenceResource,
      employeeResource: targetResource,
      activeCount: 0,
      expectedHighWater: "1",
      currentHighWater: "1",
      revisionChecks: keyedRevisionChecks([
        resources.relationSetResources[index]!,
        resources.fenceResource,
        targetResource
      ])
    })
  );
}

function employeeDeactivationWorkflowRevisions(
  targetResource: InboxV2EntityKey
) {
  const resources = employeeDeactivationResources(targetResource);
  return keyedRevisionChecks([
    resources.fenceResource,
    resources.workflowResource,
    targetResource,
    resources.handlerSetResource,
    resources.handlerRegistrySelectionResource,
    resources.handlerRegistryResource,
    ...resources.relationSetResources
  ]);
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
      loaderDecisionId: "semantic-closure-loader",
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
  id: string,
  principalEmployeeId: InboxV2EmployeeId = employeeId
): EmployeeGrant {
  return Object.freeze({
    id,
    tenantId,
    principal: {
      kind: "employee" as const,
      employeeId: principalEmployeeId
    },
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

function makeDependencies(
  requirements: readonly InboxV2AuthorizationRequirement[]
): InboxV2AuthorizationDependencyVector {
  const uniqueResources = new Map<string, InboxV2EntityKey>();
  for (const requirement of requirements) {
    uniqueResources.set(
      `${requirement.resource.entityTypeId}\u0000${requirement.resource.entityId}`,
      requirement.resource
    );
  }
  return inboxV2AuthorizationDependencyVectorSchema.parse({
    tenantRbacRevision: "1",
    employeeAccessRevision: "2",
    employeeInboxRelationRevision: "3",
    sharedAccessRevision: "4",
    resourceDependencies: [...uniqueResources.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, dependencyResource]) => ({
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
      principal: Object.freeze({
        kind: "employee" as const,
        employeeId
      }),
      authorizationEpoch: epoch,
      dependencies
    }),
    grants: Object.freeze([...grants]),
    requirements: Object.freeze([...requirements])
  });
}

function makeTrustedServiceInput(
  requirements: readonly InboxV2AuthorizationRequirement[],
  permissionId: InboxV2PermissionId
): InboxV2AuthorizationPlanInput {
  const dependencies = makeDependencies(requirements);
  const grant: InboxV2PolicyGrant = Object.freeze({
    id: "identity-auto-service-grant",
    tenantId,
    principal: { kind: "trusted_service" as const, trustedServiceId },
    permissionId,
    catalogSchemaId: "core:inbox-v2.permission-scope-catalog",
    catalogVersion: "v1",
    scope: { type: "tenant" as const, tenantId },
    source: {
      kind: "service_registration" as const,
      origin: "inbox_v2_native" as const,
      serviceRegistrationId: "identity-semantic-resolver",
      bindingResource: resource(
        "core:service-registration",
        "service_registration:identity-semantic-resolver"
      ),
      bindingRevision: revision
    },
    revision,
    validFrom: null,
    validUntil: GRANT_END,
    revokedAt: null
  });
  return Object.freeze({
    tenantId,
    evaluatedAt: NOW,
    principal: Object.freeze({
      kind: "trusted_service" as const,
      tenantId,
      trustedServiceId,
      registrationState: "active" as const,
      authorizationEpoch: epoch,
      dependencies,
      allowedPermissionIds: Object.freeze([permissionId]),
      notAfter: SESSION_END
    }),
    currentAuthorization: Object.freeze({
      tenantId,
      principal: Object.freeze({
        kind: "trusted_service" as const,
        trustedServiceId
      }),
      authorizationEpoch: epoch,
      dependencies
    }),
    grants: Object.freeze([grant]),
    requirements: Object.freeze([...requirements])
  });
}

function canonicalRequirement(
  id: string,
  permissionId: InboxV2PermissionId,
  targetResource: InboxV2EntityKey,
  visibility: "primary" | "secondary_hidden" = "primary"
): InboxV2AuthorizationRequirement {
  return makeRequirement({
    id,
    permissionId,
    resource: targetResource,
    guard: canonicalGuard,
    visibility
  });
}

function conversationReadRequirement(
  id: string,
  visibility: "primary" | "secondary_hidden" = "secondary_hidden"
): InboxV2AuthorizationRequirement {
  return makeRequirement({
    id,
    permissionId: "core:conversation.read",
    resource: conversationResource,
    guard: {
      ...canonicalGuard,
      contentBoundary: "external",
      action: {
        kind: "conversation_content_read",
        targetResource: conversationResource,
        conversationKind: "external_work",
        contentBoundary: "external",
        topologyResource: resource(
          "core:conversation-topology",
          `conversation_topology:${String(conversationId)}`
        ),
        topologyConversationResource: conversationResource,
        topologyConversationKind: "external_work",
        topologyRevisionChecks: [{ kind: "state", expected: "1", actual: "1" }]
      }
    },
    visibility
  });
}

function clientViewRequirement(
  id: string,
  targetClientId: typeof clientId,
  targetResource: InboxV2EntityKey,
  visibility: "primary" | "secondary_hidden" = "secondary_hidden"
): InboxV2AuthorizationRequirement {
  return makeRequirement({
    id,
    permissionId: "core:client.view",
    resource: targetResource,
    guard: {
      profileId: "core:rbac.guard.client_context",
      target: { kind: "client", clientId: targetClientId },
      accessPath: "exact_client_binding",
      pathEvidence: exactClientBindingPathEvidence({
        targetResource,
        clientResource: targetResource,
        authorityResource: tenantResource,
        suffix: id
      }),
      contextualRequirementIds: [],
      linkedClientRequirementIds: []
    },
    visibility
  });
}

function clientContactsViewRequirement(
  id: string,
  targetClientId: typeof clientId,
  targetResource: InboxV2EntityKey
): InboxV2AuthorizationRequirement {
  return makeRequirement({
    id,
    permissionId: "core:client.contacts.view",
    resource: targetResource,
    guard: {
      profileId: "core:rbac.guard.client_context",
      target: { kind: "client", clientId: targetClientId },
      accessPath: "exact_client_binding",
      pathEvidence: exactClientBindingPathEvidence({
        targetResource,
        clientResource: targetResource,
        authorityResource: tenantResource,
        suffix: id
      }),
      contextualRequirementIds: [],
      linkedClientRequirementIds: []
    },
    visibility: "secondary_hidden"
  });
}

function bareScenario(
  permissionId: InboxV2PermissionId,
  targetResource: InboxV2EntityKey
): SemanticScenario {
  const auditEventResource = resource(
    "core:audit-event",
    `audit_event:semantic:${permissionId}`
  );
  const guard: InboxV2PolicyGuardEvidence =
    permissionId === "core:tenant.manage"
      ? {
          ...canonicalGuard,
          action: {
            kind: "tenant_settings_change",
            targetResource,
            targetRevisionChecks: keyedRevisionChecks([targetResource]),
            reason: "update verified tenant settings",
            audit: privilegedAudit(
              "tenant_settings_change",
              targetResource,
              auditEventResource
            )
          }
        }
      : permissionId === "core:employee.invite"
        ? {
            ...canonicalGuard,
            action: {
              kind: "employee_record_change",
              operation: "invite",
              targetResource,
              targetEmployeeResource: null,
              lifecycleBefore: null,
              lifecycleAfter: "pending",
              targetRevisionChecks: keyedRevisionChecks([targetResource]),
              reason: "invite a verified employee",
              audit: privilegedAudit(
                "employee_invite",
                targetResource,
                auditEventResource
              ),
              deactivationWorkflow: null
            }
          }
        : permissionId === "core:employee.profile.manage"
          ? {
              ...canonicalGuard,
              action: {
                kind: "employee_record_change",
                operation: "profile_update",
                targetResource,
                targetEmployeeResource: targetResource,
                lifecycleBefore: "active",
                lifecycleAfter: "active",
                targetRevisionChecks: keyedRevisionChecks([targetResource]),
                reason: "update a verified employee profile",
                audit: privilegedAudit(
                  "employee_profile_update",
                  targetResource,
                  auditEventResource
                ),
                deactivationWorkflow: null
              }
            }
          : permissionId === "core:employee.deactivate"
            ? {
                ...canonicalGuard,
                action: {
                  kind: "employee_record_change",
                  operation: "deactivate",
                  targetResource,
                  targetEmployeeResource: targetResource,
                  lifecycleBefore: "draining",
                  lifecycleAfter: "inactive",
                  targetRevisionChecks: keyedRevisionChecks([targetResource]),
                  reason: "deactivate a verified employee",
                  audit: privilegedAudit(
                    "employee_deactivate",
                    targetResource,
                    auditEventResource
                  ),
                  deactivationWorkflow: {
                    resource: resource(
                      "core:employee-deactivation-workflow",
                      "employee_deactivation_workflow:semantic"
                    ),
                    employeeResource: targetResource,
                    phase: "finalize_inactive",
                    handlerSet: employeeDeactivationHandlerSet(targetResource),
                    zeroRelationsProofResource: resource(
                      "core:employee-active-relation-fence",
                      "employee_active_relation_fence:semantic"
                    ),
                    proofWorkflowResource: resource(
                      "core:employee-deactivation-workflow",
                      "employee_deactivation_workflow:semantic"
                    ),
                    proofEmployeeResource: targetResource,
                    relationSets:
                      employeeDeactivationRelationSets(targetResource),
                    revisionChecks:
                      employeeDeactivationWorkflowRevisions(targetResource)
                  }
                }
              }
            : permissionId === "core:roles.define"
              ? {
                  ...canonicalGuard,
                  action: {
                    kind: "role_definition_change",
                    targetResource,
                    permissionSetIds: ["core:conversation.read"],
                    targetRevisionChecks: keyedRevisionChecks([targetResource]),
                    reason: "update a versioned role definition",
                    audit: privilegedAudit(
                      "role_definition_change",
                      targetResource,
                      auditEventResource
                    )
                  }
                }
              : permissionId === "core:org_unit.manage"
                ? {
                    ...canonicalGuard,
                    action: {
                      kind: "organization_graph_change",
                      resourceKind: "org_unit",
                      targetResource,
                      graphResource: resource(
                        "core:organization-graph",
                        "organization_graph:semantic-closure"
                      ),
                      graphTargetResource: targetResource,
                      parentResource: null,
                      graphParentResource: null,
                      graphRevisionChecks: keyedRevisionChecks([
                        targetResource,
                        resource(
                          "core:organization-graph",
                          "organization_graph:semantic-closure"
                        )
                      ]),
                      createsCycle: false,
                      reason: "update an acyclic organization graph",
                      audit: privilegedAudit(
                        "organization_graph_change",
                        targetResource,
                        auditEventResource
                      )
                    }
                  }
                : permissionId === "core:team.manage"
                  ? {
                      ...canonicalGuard,
                      action: {
                        kind: "organization_graph_change",
                        resourceKind: "team",
                        targetResource,
                        graphResource: resource(
                          "core:organization-graph",
                          "organization_graph:semantic-closure"
                        ),
                        graphTargetResource: targetResource,
                        parentResource: null,
                        graphParentResource: null,
                        graphRevisionChecks: keyedRevisionChecks([
                          targetResource,
                          resource(
                            "core:organization-graph",
                            "organization_graph:semantic-closure"
                          )
                        ]),
                        createsCycle: false,
                        reason: "update an acyclic team graph",
                        audit: privilegedAudit(
                          "organization_graph_change",
                          targetResource,
                          auditEventResource
                        )
                      }
                    }
                  : canonicalGuard;
  const requirement = makeRequirement({
    id: `semantic-${permissionId}`,
    permissionId,
    resource: targetResource,
    guard
  });
  return Object.freeze({
    permissionId,
    input: makeInput(
      [requirement],
      [
        makeGrant(
          permissionId,
          { type: "tenant", tenantId },
          `grant-${permissionId}`
        )
      ]
    )
  });
}

function directGrantScenario(): SemanticScenario {
  const subjectDirectory = canonicalRequirement(
    "direct-grant-subject-directory",
    "core:employee.directory.view",
    otherEmployeeResource,
    "secondary_hidden"
  );
  const delegatedRead = conversationReadRequirement(
    "direct-grant-delegated-read"
  );
  const directGrantResource = resource(
    "core:direct-grant",
    "direct_grant:semantic-closure"
  );
  const primary = makeRequirement({
    id: "direct-grant-primary",
    permissionId: "core:direct_grants.manage",
    resource: directGrantResource,
    guard: {
      ...canonicalGuard,
      action: {
        kind: "delegation_change",
        targetResource: directGrantResource,
        operation: "direct_grant",
        actorEmployeeId: employeeId,
        subjectEmployeeId: otherEmployeeId,
        subjectEmployeeResource: otherEmployeeResource,
        subjectDirectoryRequirementId: subjectDirectory.id,
        delegatedAuthorities: [
          {
            requirementId: delegatedRead.id,
            permissionId: "core:conversation.read",
            requestedScope: { type: "tenant", tenantId }
          }
        ],
        bindingScope: { type: "tenant", tenantId },
        bindingScopeResource: resource("core:tenant", String(tenantId)),
        bindingRelationResource: resource(
          "core:delegation-effect",
          "delegation_effect:semantic-closure"
        ),
        relationBindingResource: directGrantResource,
        relationSubjectEmployeeResource: otherEmployeeResource,
        relationScopeResource: resource("core:tenant", String(tenantId)),
        bindingRevisionChecks: keyedRevisionChecks([
          directGrantResource,
          resource(
            "core:delegation-effect",
            "delegation_effect:semantic-closure"
          ),
          otherEmployeeResource,
          resource("core:tenant", String(tenantId))
        ]),
        reason: "delegate a bounded external-read duty",
        validUntil: GRANT_END,
        audit: privilegedAudit(
          "direct_grant",
          directGrantResource,
          resource("core:audit-event", "audit_event:direct-grant")
        ),
        roleDefinition: null
      }
    }
  });
  return {
    permissionId: "core:direct_grants.manage",
    input: makeInput(
      [primary, subjectDirectory, delegatedRead],
      [
        makeGrant(
          "core:direct_grants.manage",
          { type: "tenant", tenantId },
          "direct-grant-primary"
        ),
        makeGrant(
          "core:employee.directory.view",
          { type: "tenant", tenantId },
          "direct-grant-directory"
        ),
        makeGrant(
          "core:conversation.read",
          { type: "tenant", tenantId },
          "direct-grant-delegated-read"
        )
      ]
    )
  };
}

function accessPolicyScenario(): SemanticScenario {
  const bindingResource = resource(
    "core:conversation-access-binding",
    "conversation_access_binding:semantic-closure"
  );
  const primary = makeRequirement({
    id: "access-policy-primary",
    permissionId: "core:conversation.access_binding.apply_policy",
    resource: conversationResource,
    guard: {
      ...canonicalGuard,
      action: {
        kind: "conversation_access_change",
        targetResource: conversationResource,
        operation: "apply_policy",
        bindingResource,
        bindingConversationResource: conversationResource,
        bindingRevisionChecks: keyedRevisionChecks([
          bindingResource,
          conversationResource
        ]),
        oldTargetResource: tenantResource,
        oldTargetScope: { type: "tenant", tenantId },
        newTargetResource: tenantResource,
        newTargetScope: { type: "tenant", tenantId },
        targetRevisionChecks: keyedRevisionChecks([
          bindingResource,
          conversationResource,
          tenantResource
        ]),
        reason: "apply the reviewed routing policy",
        policyResource: resource(
          "core:routing-policy",
          "routing_policy:semantic-closure"
        ),
        policyRevisionChecks: [{ kind: "policy", expected: "1", actual: "1" }]
      }
    }
  });
  return {
    permissionId: "core:conversation.access_binding.apply_policy",
    input: makeTrustedServiceInput(
      [primary],
      "core:conversation.access_binding.apply_policy"
    )
  };
}

function asIndependentEmployeeRequirement(
  requirement: InboxV2AuthorizationRequirement,
  subjectEmployeeId: InboxV2EmployeeId
): InboxV2AuthorizationRequirement {
  const subject = inboxV2EmployeeReferenceSchema.parse({
    tenantId,
    kind: "employee",
    id: subjectEmployeeId
  });
  const dependencies = makeDependencies([requirement]);
  const currentAuthorization = {
    tenantId,
    principal: { kind: "employee" as const, employeeId: subjectEmployeeId },
    authorizationEpoch: epoch,
    dependencies
  };
  const authorization = inboxV2AuthorizationEpochSnapshotSchema.parse({
    tenantId,
    employee: subject,
    value: epoch,
    dependencies,
    evaluatedAt: NOW,
    notAfter: SESSION_END,
    nextAuthorizationBoundary: SESSION_END
  });
  return Object.freeze({
    ...requirement,
    authorizationSubject: {
      kind: "independent_employee" as const,
      employee: subject,
      lifecycle: "active" as const,
      authorization,
      currentAuthorization,
      notAfter: SESSION_END
    }
  });
}

function ownerRecoveryScenario(): SemanticScenario {
  const successorMembershipBase = makeRequirement({
    id: "owner-recovery-successor-membership",
    permissionId: "core:conversation.internal.read",
    resource: conversationResource,
    scopeFacts: [
      {
        kind: "internal_participant",
        ...scopePath(conversationResource, conversationResource),
        employeeId: otherEmployeeId,
        conversationId,
        origin: "hulee_internal_command",
        state: "active",
        role: "member",
        membershipRevision: revision,
        currentMembershipRevision: revision,
        validUntil: LATER
      }
    ],
    guard: {
      profileId: "core:rbac.guard.internal_membership",
      conversationId,
      employeeId: otherEmployeeId,
      membershipState: "active",
      membershipOrigin: "hulee_internal_command",
      membershipRole: "member",
      contentBoundary: "internal",
      validUntil: GRANT_END
    },
    visibility: "secondary_hidden"
  });
  const successorMembership = asIndependentEmployeeRequirement(
    successorMembershipBase,
    otherEmployeeId
  );
  const approverDirectory = canonicalRequirement(
    "owner-recovery-approver-directory",
    "core:employee.directory.view",
    resource("core:employee", String(thirdEmployeeId)),
    "secondary_hidden"
  );
  const primary = makeRequirement({
    id: "owner-recovery-primary",
    permissionId: "core:conversation.internal.owner_recover",
    resource: conversationResource,
    scopeFacts: [
      {
        kind: "conversation",
        ...scopePath(conversationResource, conversationResource),
        conversationId,
        validUntil: LATER
      }
    ],
    guard: {
      ...canonicalGuard,
      action: {
        kind: "internal_owner_recovery",
        targetResource: conversationResource,
        conversationId,
        recoveryState: "owner_recovery",
        actorEmployeeId: employeeId,
        successorEmployeeId: otherEmployeeId,
        approverEmployeeId: thirdEmployeeId,
        approverEmployeeResource: resource(
          "core:employee",
          String(thirdEmployeeId)
        ),
        approverDirectoryRequirementId: approverDirectory.id,
        approverGrantId: "owner-recovery-approver",
        successorMembershipRequirementId: successorMembership.id,
        approvalResource: resource(
          "core:owner-recovery-approval",
          "owner_recovery_approval:semantic-closure"
        ),
        approvalConversationResource: conversationResource,
        approvalApproverEmployeeResource: resource(
          "core:employee",
          String(thirdEmployeeId)
        ),
        approvalSuccessorEmployeeResource: otherEmployeeResource,
        approvalState: "approved",
        approvalRevisionChecks: keyedRevisionChecks([
          resource(
            "core:owner-recovery-approval",
            "owner_recovery_approval:semantic-closure"
          ),
          conversationResource,
          resource("core:employee", String(thirdEmployeeId)),
          otherEmployeeResource
        ]),
        approvalNotAfter: GRANT_END,
        successorMembership: {
          employeeId: otherEmployeeId,
          employeeResource: otherEmployeeResource,
          membershipRelationResource: resource(
            "core:internal-membership",
            "internal_membership:owner-recovery-successor"
          ),
          relationConversationResource: conversationResource,
          relationEmployeeResource: otherEmployeeResource,
          lifecycle: "active",
          currentRole: "member",
          newRole: "owner"
        },
        ownerSet: {
          resource: resource(
            "core:internal-owner-set-manifest",
            "internal_owner_set:owner-recovery"
          ),
          conversationResource,
          beforeOwnerMembershipResources: [],
          afterOwnerMembershipResources: [
            resource(
              "core:internal-membership",
              "internal_membership:owner-recovery-successor"
            )
          ]
        },
        mutationRevisionChecks: keyedRevisionChecks([
          conversationResource,
          resource(
            "core:internal-owner-set-manifest",
            "internal_owner_set:owner-recovery"
          ),
          otherEmployeeResource,
          resource(
            "core:internal-membership",
            "internal_membership:owner-recovery-successor"
          )
        ]),
        reason: "restore an owner after verified account loss",
        audit: privilegedAudit(
          "internal_owner_recovery",
          conversationResource,
          resource(
            "core:audit-event",
            "audit_event:owner-recovery-semantic-closure"
          )
        )
      }
    }
  });
  return {
    permissionId: "core:conversation.internal.owner_recover",
    input: makeInput(
      [primary, successorMembership, approverDirectory],
      [
        makeGrant(
          "core:conversation.internal.owner_recover",
          { type: "conversation", tenantId, id: conversationId },
          "owner-recovery-primary"
        ),
        makeGrant(
          "core:conversation.internal.read",
          { type: "internal_participant", tenantId },
          "owner-recovery-successor",
          otherEmployeeId
        ),
        makeGrant(
          "core:employee.directory.view",
          { type: "tenant", tenantId },
          "owner-recovery-approver-directory"
        ),
        makeGrant(
          "core:conversation.internal.owner_recover",
          { type: "conversation", tenantId, id: conversationId },
          "owner-recovery-approver",
          thirdEmployeeId
        )
      ]
    )
  };
}

function staffNoteReadScenario(): SemanticScenario {
  const baseRead = conversationReadRequirement("staff-note-base-read");
  const primary = makeRequirement({
    id: "staff-note-read-primary",
    permissionId: "core:message.staff_note.read",
    resource: conversationResource,
    guard: {
      ...canonicalGuard,
      contentBoundary: "staff_only",
      companionRequirementIds: [baseRead.id]
    }
  });
  return {
    permissionId: "core:message.staff_note.read",
    input: makeInput(
      [primary, baseRead],
      [
        makeGrant(
          "core:message.staff_note.read",
          { type: "tenant", tenantId },
          "staff-note-read-primary"
        ),
        makeGrant(
          "core:conversation.read",
          { type: "tenant", tenantId },
          "staff-note-base-read"
        )
      ]
    )
  };
}

function deleteOwnScenario(): SemanticScenario {
  const timelineItemResource = resource(
    "core:timeline-item",
    "timeline_item:delete-own-semantic-closure"
  );
  const contentRead = makeRequirement({
    id: "delete-own-content-read",
    permissionId: "core:conversation.internal.read",
    resource: conversationResource,
    scopeFacts: [
      {
        kind: "internal_participant",
        ...scopePath(conversationResource, conversationResource),
        employeeId,
        conversationId,
        origin: "hulee_internal_command",
        state: "active",
        role: "member",
        membershipRevision: revision,
        currentMembershipRevision: revision,
        validUntil: LATER
      }
    ],
    guard: {
      profileId: "core:rbac.guard.internal_membership",
      conversationId,
      employeeId,
      membershipState: "active",
      membershipOrigin: "hulee_internal_command",
      membershipRole: "member",
      contentBoundary: "internal",
      validUntil: GRANT_END
    },
    visibility: "secondary_hidden"
  });
  const primary = makeRequirement({
    id: "delete-own-primary",
    permissionId: "core:message.delete_own",
    resource: timelineItemResource,
    scopeFacts: [
      {
        kind: "conversation",
        ...scopePath(timelineItemResource, conversationResource),
        conversationId,
        validUntil: LATER
      }
    ],
    guard: {
      ...canonicalGuard,
      action: {
        kind: "message_author_action",
        operation: "delete",
        targetResource: timelineItemResource,
        actorEmployeeId: employeeId,
        authorEmployeeId: employeeId,
        contentBoundary: "internal",
        targetRevisionChecks: [{ kind: "entity", expected: "1", actual: "1" }],
        authorshipResource: resource(
          "core:message-authorship",
          "message_authorship:delete-own-semantic-closure"
        ),
        authorshipTimelineItemResource: timelineItemResource,
        authorshipEmployeeResource: resource(
          "core:employee",
          String(employeeId)
        ),
        authorshipRevisionChecks: [
          { kind: "relation", expected: "1", actual: "1" }
        ],
        contentTopologyResource: resource(
          "core:timeline-content-topology",
          "timeline_content_topology:delete-own-semantic-closure"
        ),
        topologyTimelineItemResource: timelineItemResource,
        topologyConversationResource: conversationResource,
        topologyBoundary: "internal",
        topologyRevisionChecks: [{ kind: "state", expected: "1", actual: "1" }],
        contentReadRequirementIds: [contentRead.id],
        deletionMode: "local_tombstone",
        holdProof: {
          resource: resource(
            "core:content-hold-index",
            "content_hold_index:delete-own-semantic-closure"
          ),
          targetResource: timelineItemResource,
          state: "none",
          revisionChecks: [{ kind: "state", expected: "1", actual: "1" }]
        },
        originalRouteRequirementId: null,
        originalSourceAccountId: null,
        originalSourceAccountResource: null,
        originalBindingResource: null,
        originalBindingSourceAccountResource: null,
        externalReferenceResource: null,
        externalReferenceBindingResource: null,
        externalReferenceTargetResource: null,
        routeRevisionChecks: [],
        capabilityId: null,
        capabilityManifestResource: null,
        capabilityManifestSourceAccountResource: null,
        capabilityRevisionChecks: [],
        capabilityState: "not_applicable",
        capabilityNotAfter: null
      }
    }
  });
  return {
    permissionId: "core:message.delete_own",
    input: makeInput(
      [primary, contentRead],
      [
        makeGrant(
          "core:message.delete_own",
          { type: "conversation", tenantId, id: conversationId },
          "delete-own-primary"
        ),
        makeGrant(
          "core:conversation.internal.read",
          { type: "internal_participant", tenantId },
          "delete-own-content-read"
        )
      ]
    )
  };
}

function callTranscriptScenario(): SemanticScenario {
  const callResource = resource("core:call", "call:semantic-closure");
  const baseRead = clientViewRequirement(
    "call-transcript-client-read",
    clientId,
    clientResource
  );
  const primary = makeRequirement({
    id: "call-transcript-primary",
    permissionId: "core:call.transcript.view",
    resource: callResource,
    guard: {
      ...canonicalGuard,
      action: {
        kind: "sensitive_content",
        targetResource: callResource,
        baseReadResource: clientResource,
        baseReadRelationTargetResource: callResource,
        baseReadRelationResource: clientResource,
        baseReadRelationRevisionChecks: [
          { kind: "relation", expected: "1", actual: "1" }
        ],
        baseReadRequirementId: baseRead.id,
        purpose: "resolve the customer support request",
        policyEvidence: {
          kind: "call_transcript",
          contentResource: callResource,
          availability: "available",
          retentionNotAfter: GRANT_END,
          consentState: "allowed",
          processingState: "allowed",
          policyResource: resource(
            "core:call-data-access-policy",
            "call_data_access_policy:transcript-semantic"
          ),
          policyTargetResource: callResource,
          approvedPurposeIds: ["resolve the customer support request"],
          revisionChecks: [{ kind: "policy", expected: "1", actual: "1" }]
        }
      }
    }
  });
  return {
    permissionId: "core:call.transcript.view",
    input: makeInput(
      [primary, baseRead],
      [
        makeGrant(
          "core:call.transcript.view",
          { type: "tenant", tenantId },
          "call-transcript-primary"
        ),
        makeGrant(
          "core:client.view",
          { type: "tenant", tenantId },
          "call-transcript-client-read"
        )
      ]
    )
  };
}

const CLIENT_SEMANTIC_PERMISSION_IDS = Object.freeze([
  "core:client.edit",
  "core:client.pipeline.transition",
  "core:client.fields.view_sensitive",
  "core:client.fields.edit",
  "core:client.owner.assign",
  "core:client.access_binding.manage"
] as const satisfies readonly InboxV2PermissionId[]);

type ClientGuardEvidence = Extract<
  InboxV2PolicyGuardEvidence,
  { profileId: "core:rbac.guard.client_context" }
>;
type ClientMutationEvidence = NonNullable<ClientGuardEvidence["mutation"]>;

function closeClientAccessPath(
  guard: ClientGuardEvidence
): ClientGuardEvidence {
  switch (guard.accessPath) {
    case "exact_client_binding":
      return {
        ...guard,
        pathEvidence: { ...guard.pathEvidence, state: "closed" }
      };
    case "active_conversation_link":
      return {
        ...guard,
        pathEvidence: { ...guard.pathEvidence, state: "closed" }
      };
    case "current_work_item_queue":
      return {
        ...guard,
        pathEvidence: { ...guard.pathEvidence, state: "closed" }
      };
    case "current_responsible":
      return {
        ...guard,
        pathEvidence: { ...guard.pathEvidence, state: "closed" }
      };
    case "client_owner":
      return {
        ...guard,
        pathEvidence: { ...guard.pathEvidence, state: "closed" }
      };
  }
}

function clientMutationForScenario(
  permissionId: (typeof CLIENT_SEMANTIC_PERMISSION_IDS)[number]
): ClientMutationEvidence | undefined {
  const auditEventResource = resource(
    "core:audit-event",
    `audit_event:client-mutation:${permissionId}`
  );
  if (permissionId === "core:client.pipeline.transition") {
    const oldStageResource = resource(
      "core:client-pipeline-stage",
      "client_pipeline_stage:semantic-new"
    );
    const newStageResource = resource(
      "core:client-pipeline-stage",
      "client_pipeline_stage:semantic-qualified"
    );
    return {
      kind: "pipeline_transition",
      clientResource,
      oldStageResource,
      newStageResource,
      transitionPolicyResource: resource(
        "core:client-pipeline-transition-policy",
        "client_pipeline_transition_policy:semantic"
      ),
      policyClientResource: clientResource,
      policyOldStageResource: oldStageResource,
      policyNewStageResource: newStageResource,
      policyState: "active",
      policyRevisionChecks: [{ kind: "policy", expected: "1", actual: "1" }],
      expectedClientRevision: "1",
      currentClientRevision: "1",
      reason: "semantic pipeline transition",
      auditEventResource,
      auditClientResource: clientResource,
      auditOldStageResource: oldStageResource,
      auditNewStageResource: newStageResource
    };
  }
  if (permissionId === "core:client.fields.edit") {
    const fieldDefinitionResource = resource(
      "core:client-field-definition",
      "client_field_definition:semantic"
    );
    const fieldValueResource = resource(
      "core:client-field-value",
      "client_field_value:semantic"
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
      definitionRevisionChecks: [
        { kind: "entity", expected: "1", actual: "1" }
      ],
      expectedFieldValueRevision: "1",
      currentFieldValueRevision: "1",
      expectedClientRevision: "1",
      currentClientRevision: "1",
      reason: "semantic typed field edit",
      auditEventResource,
      auditClientResource: clientResource,
      auditFieldDefinitionResource: fieldDefinitionResource,
      auditFieldValueResource: fieldValueResource
    };
  }
  if (permissionId === "core:client.access_binding.manage") {
    return {
      kind: "access_binding_change",
      operation: "add",
      clientResource,
      bindingSetResource: resource(
        "core:client-access-binding-set",
        "client_access_binding_set:semantic"
      ),
      bindingSetClientResource: clientResource,
      oldBindingResource: null,
      oldBindingClientResource: null,
      oldBindingTargetResource: null,
      newBindingResource: resource(
        "core:client-access-binding",
        "client_access_binding:semantic"
      ),
      newBindingClientResource: clientResource,
      newBindingTargetResource: clientAccessTeamResource,
      targetAuthorities: [
        {
          side: "new",
          targetResource: clientAccessTeamResource,
          requirementId: "client-access-target-authority"
        }
      ],
      expectedBindingSetRevision: "1",
      currentBindingSetRevision: "1",
      oldRelationRevisionChecks: [],
      newRelationRevisionChecks: [
        { kind: "relation", expected: "1", actual: "1" }
      ],
      reason: "semantic structural access binding",
      auditEventResource,
      auditClientResource: clientResource,
      auditOldTargetResource: null,
      auditNewTargetResource: clientAccessTeamResource
    };
  }
  return undefined;
}

function clientScenario(
  permissionId: (typeof CLIENT_SEMANTIC_PERMISSION_IDS)[number]
): SemanticScenario {
  const sensitive =
    permissionId === "core:client.fields.view_sensitive" ||
    permissionId === "core:client.fields.edit";
  const baseRead = clientViewRequirement(
    `client-base-read-${permissionId}`,
    clientId,
    clientResource
  );
  const ownerDirectoryRequirementId = "client-owner-target-directory";
  const ownerDirectory =
    permissionId === "core:client.owner.assign"
      ? employeeDirectoryRequirement(
          ownerDirectoryRequirementId,
          otherEmployeeResource
        )
      : null;
  const mutation = clientMutationForScenario(permissionId);
  const accessTargetAuthority =
    mutation?.kind === "access_binding_change"
      ? makeRequirement({
          id: "client-access-target-authority",
          permissionId: "core:client.access_binding.manage",
          resource: clientResource,
          scopeFacts: [
            {
              kind: "team",
              ...scopePath(clientResource, clientAccessTeamResource),
              teamId: clientAccessTeamId,
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
              authorityResource: clientAccessTeamResource,
              suffix: "semantic-access-target"
            }),
            contextualRequirementIds: [],
            linkedClientRequirementIds: [],
            mutation: {
              kind: "access_binding_target_authority",
              clientResource,
              bindingSetResource: mutation.bindingSetResource,
              side: "new",
              targetResource: clientAccessTeamResource,
              relationClientResource: clientResource,
              relationTargetResource: clientAccessTeamResource,
              relationRevisionChecks: [
                { kind: "relation", expected: "1", actual: "1" }
              ]
            }
          },
          visibility: "secondary_hidden"
        })
      : null;
  const primary = makeRequirement({
    id: `client-primary-${permissionId}`,
    permissionId,
    resource: clientResource,
    guard: {
      profileId: "core:rbac.guard.client_context",
      target: { kind: "client", clientId },
      accessPath: "exact_client_binding",
      pathEvidence: exactClientBindingPathEvidence({
        targetResource: clientResource,
        clientResource,
        authorityResource: tenantResource,
        suffix: `semantic-${permissionId}`
      }),
      contextualRequirementIds: sensitive ? [baseRead.id] : [],
      linkedClientRequirementIds: [],
      ...(mutation === undefined ? {} : { mutation }),
      ...(permissionId === "core:client.owner.assign"
        ? {
            clientOwnerAssignment: {
              clientResource,
              targetEmployeeResource: otherEmployeeResource,
              targetEmployeeId: otherEmployeeId,
              targetDirectoryRequirementId: ownerDirectoryRequirementId,
              targetLifecycle: "active" as const,
              eligibilityState: "eligible" as const,
              eligibilityResource: resource(
                "core:client-owner-eligibility",
                "client_owner_eligibility:semantic-closure"
              ),
              eligibilityClientResource: clientResource,
              eligibilityEmployeeResource: otherEmployeeResource,
              eligibilityRevisionChecks: keyedRevisionChecks([
                resource(
                  "core:client-owner-eligibility",
                  "client_owner_eligibility:semantic-closure"
                ),
                clientResource,
                otherEmployeeResource
              ]),
              lifecycleRevisionChecks: keyedRevisionChecks([
                otherEmployeeResource
              ]),
              ownershipRelationResource: resource(
                "core:client-owner-relation",
                "client_owner_relation:semantic-closure"
              ),
              ownershipRelationClientResource: clientResource,
              ownershipRelationEmployeeResource: otherEmployeeResource,
              ownershipRevisionChecks: [
                {
                  resource: resource(
                    "core:client-owner-relation",
                    "client_owner_relation:semantic-closure"
                  ),
                  expected: "1",
                  actual: "1"
                },
                { resource: clientResource, expected: "1", actual: "1" },
                {
                  resource: otherEmployeeResource,
                  expected: "1",
                  actual: "1"
                }
              ],
              expectedOwnershipRevision: "1",
              currentOwnershipRevision: "1",
              reason: "assign verified client owner",
              auditEventResource: resource(
                "core:audit-event",
                "audit_event:client-owner-assignment"
              )
            }
          }
        : {})
    }
  });
  return {
    permissionId,
    input: makeInput(
      [
        primary,
        ...(sensitive ? [baseRead] : []),
        ...(ownerDirectory === null ? [] : [ownerDirectory]),
        ...(accessTargetAuthority === null ? [] : [accessTargetAuthority])
      ],
      [
        makeGrant(
          permissionId,
          { type: "tenant", tenantId },
          `client-primary-${permissionId}`
        ),
        ...(sensitive
          ? [
              makeGrant(
                "core:client.view",
                { type: "tenant", tenantId },
                `client-base-read-${permissionId}`
              )
            ]
          : []),
        ...(ownerDirectory === null
          ? []
          : [
              makeGrant(
                "core:employee.directory.view",
                { type: "tenant", tenantId },
                "client-owner-target-directory"
              )
            ]),
        ...(accessTargetAuthority === null
          ? []
          : [
              makeGrant(
                "core:client.access_binding.manage",
                { type: "team", tenantId, id: clientAccessTeamId },
                "client-access-target-authority"
              )
            ])
      ]
    )
  };
}

type EmployeeIdentityPermissionId =
  | "core:identity.employee_claim.manage"
  | "core:identity.client_contact_claim.manage"
  | "core:identity.source_identity.use"
  | "core:identity.evidence.view"
  | "core:identity.claim.revoke"
  | "core:identity.merge"
  | "core:identity.observation.review";

type CompoundIdentityPermissionId = Exclude<
  EmployeeIdentityPermissionId,
  "core:identity.source_identity.use" | "core:identity.evidence.view"
>;

function identityLeafScenario(
  permissionId:
    | "core:identity.source_identity.use"
    | "core:identity.evidence.view"
): SemanticScenario {
  const operationKind =
    permissionId === "core:identity.source_identity.use"
      ? "source_identity_use"
      : "evidence_view";
  const primary = makeRequirement({
    id: `identity-primary-${permissionId}`,
    permissionId,
    resource: sourceIdentityResource,
    guard: {
      profileId: "core:rbac.guard.identity_evidence",
      targetResource: sourceIdentityResource,
      evidenceState: "verified",
      operation: {
        kind: operationKind,
        actorEmployeeId: employeeId,
        evidenceResource: sourceIdentityResource,
        revisionChecks: [{ kind: "relation", expected: "1", actual: "1" }]
      }
    }
  });
  return {
    permissionId,
    input: makeInput(
      [primary],
      [
        makeGrant(
          permissionId,
          { type: "tenant", tenantId },
          `identity-primary-${permissionId}`
        )
      ]
    )
  };
}

function employeeDirectoryRequirement(
  id: string,
  targetResource: InboxV2EntityKey
): InboxV2AuthorizationRequirement {
  return canonicalRequirement(
    id,
    "core:employee.directory.view",
    targetResource,
    "secondary_hidden"
  );
}

function compoundIdentityScenario(
  permissionId: CompoundIdentityPermissionId
): SemanticScenario {
  const sourceUse = (
    id: string,
    sourceResource: InboxV2EntityKey
  ): InboxV2AuthorizationRequirement =>
    makeRequirement({
      id,
      permissionId: "core:identity.source_identity.use",
      resource: sourceResource,
      guard: {
        profileId: "core:rbac.guard.identity_evidence",
        targetResource: sourceResource,
        evidenceState: "verified",
        operation: {
          kind: "source_identity_use",
          actorEmployeeId: employeeId,
          evidenceResource: sourceResource,
          revisionChecks: [{ kind: "relation", expected: "1", actual: "1" }]
        }
      },
      visibility: "secondary_hidden"
    });
  const sourceIdentity = sourceUse(
    `identity-source-${permissionId}`,
    sourceIdentityResource
  );
  const identityMutationResource = resource(
    "core:identity-mutation",
    `identity_mutation:${permissionId}`
  );
  const primaryGrant = makeGrant(
    permissionId,
    { type: "tenant", tenantId },
    `identity-primary-${permissionId}`
  );
  const sourceGrant = makeGrant(
    "core:identity.source_identity.use",
    { type: "tenant", tenantId },
    `identity-source-${permissionId}`
  );
  const entityRevisionChecks = [
    { kind: "entity" as const, expected: "1", actual: "1" }
  ];
  const relationRevisionChecks = [
    { kind: "relation" as const, expected: "1", actual: "1" }
  ];
  const policyRevisionChecks = [
    { kind: "policy" as const, expected: "1", actual: "1" }
  ];
  const stateRevisionChecks = [
    { kind: "state" as const, expected: "1", actual: "1" }
  ];

  if (
    permissionId === "core:identity.employee_claim.manage" ||
    permissionId === "core:identity.client_contact_claim.manage"
  ) {
    const employeeClaim =
      permissionId === "core:identity.employee_claim.manage";
    const newTargetResource = employeeClaim
      ? otherEmployeeResource
      : secondClientContactResource;
    const evidenceResource = resource(
      "core:identity-evidence",
      `identity_evidence:${permissionId}`
    );
    const claimPolicyResource = resource(
      "core:identity-claim-policy",
      `identity_claim_policy:${permissionId}`
    );
    const operation = employeeClaim
      ? {
          kind: "employee_claim_manage" as const,
          actorEmployeeId: employeeId,
          sourceIdentityResource,
          sourceIdentityRequirementId: sourceIdentity.id,
          sourceIdentityRevisionChecks: entityRevisionChecks,
          reasonCodeId: "core:verified-manual-claim",
          auditEventResource: resource(
            "core:audit-event",
            `audit_event:${permissionId}`
          ),
          auditActorEmployeeId: employeeId,
          auditSourceIdentityResource: sourceIdentityResource,
          auditTargetResource: newTargetResource,
          auditRevisionChecks: entityRevisionChecks,
          oldTargetResource: null,
          oldTargetRequirementId: null,
          newTargetResource,
          newTargetEmployeeId: otherEmployeeId,
          newTargetLifecycle: "active" as const,
          claimPolicyResource,
          claimPolicyState: "approved_active" as const,
          claimPolicyVersion: "1",
          evidencePolicyResource: claimPolicyResource,
          evidencePolicyVersion: "1",
          evidenceResource,
          evidenceSourceIdentityResource: sourceIdentityResource,
          evidenceTargetResource: newTargetResource,
          sensitiveEvidenceIncluded: false,
          evidenceViewRequirementId: null,
          claimPolicyRevisionChecks: policyRevisionChecks,
          evidenceRevisionChecks: entityRevisionChecks,
          targetRevisionChecks: entityRevisionChecks,
          claimHeadResource: resource(
            "core:source-identity-claim-head",
            `source_identity_claim_head:${permissionId}`
          ),
          claimHeadSourceIdentityResource: sourceIdentityResource,
          currentClaimTargetResource: null,
          expectedClaimVersion: null,
          currentClaimVersion: null,
          claimRevisionChecks: relationRevisionChecks
        }
      : {
          kind: "client_contact_claim_manage" as const,
          actorEmployeeId: employeeId,
          sourceIdentityResource,
          sourceIdentityRequirementId: sourceIdentity.id,
          sourceIdentityRevisionChecks: entityRevisionChecks,
          reasonCodeId: "core:verified-manual-claim",
          auditEventResource: resource(
            "core:audit-event",
            `audit_event:${permissionId}`
          ),
          auditActorEmployeeId: employeeId,
          auditSourceIdentityResource: sourceIdentityResource,
          auditTargetResource: newTargetResource,
          auditRevisionChecks: entityRevisionChecks,
          oldTargetResource: null,
          oldTargetRequirementId: null,
          newTargetResource,
          claimPolicyResource,
          claimPolicyState: "approved_active" as const,
          claimPolicyVersion: "1",
          evidencePolicyResource: claimPolicyResource,
          evidencePolicyVersion: "1",
          evidenceResource,
          evidenceSourceIdentityResource: sourceIdentityResource,
          evidenceTargetResource: newTargetResource,
          sensitiveEvidenceIncluded: false,
          evidenceViewRequirementId: null,
          claimPolicyRevisionChecks: policyRevisionChecks,
          evidenceRevisionChecks: entityRevisionChecks,
          targetRevisionChecks: entityRevisionChecks,
          claimHeadResource: resource(
            "core:source-identity-claim-head",
            `source_identity_claim_head:${permissionId}`
          ),
          claimHeadSourceIdentityResource: sourceIdentityResource,
          currentClaimTargetResource: null,
          expectedClaimVersion: null,
          currentClaimVersion: null,
          claimRevisionChecks: relationRevisionChecks
        };
    const primary = makeRequirement({
      id: `identity-primary-${permissionId}`,
      permissionId,
      resource: newTargetResource,
      guard: {
        profileId: "core:rbac.guard.identity_evidence",
        targetResource: newTargetResource,
        evidenceState: "verified",
        operation
      }
    });
    return {
      permissionId,
      input: makeInput([primary, sourceIdentity], [primaryGrant, sourceGrant])
    };
  }

  if (permissionId === "core:identity.claim.revoke") {
    const primary = makeRequirement({
      id: `identity-primary-${permissionId}`,
      permissionId,
      resource: clientContactResource,
      guard: {
        profileId: "core:rbac.guard.identity_evidence",
        targetResource: clientContactResource,
        evidenceState: "verified",
        operation: {
          kind: "claim_revoke",
          actorEmployeeId: employeeId,
          sourceIdentityResource,
          sourceIdentityRequirementId: sourceIdentity.id,
          sourceIdentityRevisionChecks: entityRevisionChecks,
          reasonCodeId: "core:verified-manual-revoke",
          auditEventResource: resource(
            "core:audit-event",
            "audit_event:identity-revoke"
          ),
          auditActorEmployeeId: employeeId,
          auditSourceIdentityResource: sourceIdentityResource,
          auditTargetResource: clientContactResource,
          auditRevisionChecks: entityRevisionChecks,
          activeClaimResource: resource(
            "core:source-identity-claim",
            "source_identity_claim:semantic-closure"
          ),
          claimSourceIdentityResource: sourceIdentityResource,
          existingTargetResource: clientContactResource,
          claimTargetResource: clientContactResource,
          activeClaimRevisionChecks: relationRevisionChecks,
          targetRevisionChecks: entityRevisionChecks
        }
      }
    });
    return {
      permissionId,
      input: makeInput([primary, sourceIdentity], [primaryGrant, sourceGrant])
    };
  }

  if (permissionId === "core:identity.merge") {
    const aliasIdentity = sourceUse(
      `identity-alias-${permissionId}`,
      aliasSourceIdentityResource
    );
    const primary = makeRequirement({
      id: `identity-primary-${permissionId}`,
      permissionId,
      resource: identityMutationResource,
      guard: {
        profileId: "core:rbac.guard.identity_evidence",
        targetResource: identityMutationResource,
        evidenceState: "verified",
        operation: {
          kind: "merge",
          actorEmployeeId: employeeId,
          mutationResource: identityMutationResource,
          mutationBindingResource: resource(
            "core:identity-mutation-binding",
            "identity_mutation_binding:semantic-closure"
          ),
          bindingMutationResource: identityMutationResource,
          bindingCanonicalIdentityResource: sourceIdentityResource,
          bindingAliasIdentityResource: aliasSourceIdentityResource,
          mutationRevisionChecks: [
            {
              resource: resource(
                "core:identity-mutation-binding",
                "identity_mutation_binding:semantic-closure"
              ),
              expected: "1",
              actual: "1"
            },
            { resource: identityMutationResource, expected: "1", actual: "1" },
            { resource: sourceIdentityResource, expected: "1", actual: "1" },
            {
              resource: aliasSourceIdentityResource,
              expected: "1",
              actual: "1"
            }
          ],
          canonicalIdentityResource: sourceIdentityResource,
          canonicalIdentityRequirementId: sourceIdentity.id,
          aliasIdentityResource: aliasSourceIdentityResource,
          aliasIdentityRequirementId: aliasIdentity.id,
          canonicalRealmId: "core:provider-realm-v1",
          aliasRealmId: "core:provider-realm-v1",
          canonicalRealmVersion: "1",
          aliasRealmVersion: "1",
          canonicalizationVersion: "1",
          aliasCanonicalizationVersion: "1",
          canonicalScope: {
            kind: "source_account",
            ownerResource: sourceAccountResource
          },
          aliasScope: {
            kind: "source_account",
            ownerResource: sourceAccountResource
          },
          canonicalRealmScopeBinding: {
            resource: resource(
              "core:identity-realm-scope-binding",
              "identity_realm_scope_binding:merge-canonical"
            ),
            identityResource: sourceIdentityResource,
            realmResource: resource(
              "core:identity-realm",
              "core:provider-realm-v1"
            ),
            scopeResource: sourceAccountResource,
            bindingIdentityResource: sourceIdentityResource,
            bindingRealmResource: resource(
              "core:identity-realm",
              "core:provider-realm-v1"
            ),
            bindingScopeResource: sourceAccountResource,
            realmId: "core:provider-realm-v1",
            realmVersion: "1",
            scopeKind: "source_account",
            revisionChecks: [
              {
                resource: resource(
                  "core:identity-realm-scope-binding",
                  "identity_realm_scope_binding:merge-canonical"
                ),
                expected: "1",
                actual: "1"
              },
              { resource: sourceIdentityResource, expected: "1", actual: "1" },
              {
                resource: resource(
                  "core:identity-realm",
                  "core:provider-realm-v1"
                ),
                expected: "1",
                actual: "1"
              },
              { resource: sourceAccountResource, expected: "1", actual: "1" }
            ]
          },
          aliasRealmScopeBinding: {
            resource: resource(
              "core:identity-realm-scope-binding",
              "identity_realm_scope_binding:merge-alias"
            ),
            identityResource: aliasSourceIdentityResource,
            realmResource: resource(
              "core:identity-realm",
              "core:provider-realm-v1"
            ),
            scopeResource: sourceAccountResource,
            bindingIdentityResource: aliasSourceIdentityResource,
            bindingRealmResource: resource(
              "core:identity-realm",
              "core:provider-realm-v1"
            ),
            bindingScopeResource: sourceAccountResource,
            realmId: "core:provider-realm-v1",
            realmVersion: "1",
            scopeKind: "source_account",
            revisionChecks: [
              {
                resource: resource(
                  "core:identity-realm-scope-binding",
                  "identity_realm_scope_binding:merge-alias"
                ),
                expected: "1",
                actual: "1"
              },
              {
                resource: aliasSourceIdentityResource,
                expected: "1",
                actual: "1"
              },
              {
                resource: resource(
                  "core:identity-realm",
                  "core:provider-realm-v1"
                ),
                expected: "1",
                actual: "1"
              },
              { resource: sourceAccountResource, expected: "1", actual: "1" }
            ]
          },
          canonicalResolution: { state: "unresolved" },
          aliasResolution: { state: "unresolved" },
          conflictState: "reviewed_clear",
          conflictReviewResource: resource(
            "core:identity-conflict-review",
            "identity_conflict_review:semantic-closure"
          ),
          reviewedCanonicalIdentityResource: sourceIdentityResource,
          reviewedAliasIdentityResource: aliasSourceIdentityResource,
          mergeDirection: "alias_into_canonical",
          createsAcyclicAlias: true,
          canonicalIdentityRevisionChecks: entityRevisionChecks,
          aliasIdentityRevisionChecks: entityRevisionChecks,
          conflictReviewRevisionChecks: stateRevisionChecks,
          canonicalClaimHeadResource: resource(
            "core:source-identity-claim-head",
            "source_identity_claim_head:merge-canonical"
          ),
          canonicalClaimHeadIdentityResource: sourceIdentityResource,
          canonicalClaimHeadTargetResource: null,
          canonicalClaimTargetAuthority: null,
          canonicalClaimHeadRevisionChecks: relationRevisionChecks,
          aliasClaimHeadResource: resource(
            "core:source-identity-claim-head",
            "source_identity_claim_head:merge-alias"
          ),
          aliasClaimHeadIdentityResource: aliasSourceIdentityResource,
          aliasClaimHeadTargetResource: null,
          aliasClaimTargetAuthority: null,
          aliasClaimHeadRevisionChecks: relationRevisionChecks,
          aliasGraphResource: resource(
            "core:source-identity-alias-graph",
            "source_identity_alias_graph:semantic-closure"
          ),
          aliasGraphCanonicalIdentityResource: sourceIdentityResource,
          aliasGraphAliasIdentityResource: aliasSourceIdentityResource,
          expectedAliasGraphRevision: "1",
          currentAliasGraphRevision: "1",
          reasonCodeId: "core:verified-compatible-identity-merge",
          auditEventResource: resource(
            "core:audit-event",
            "audit_event:identity-merge"
          ),
          auditActorEmployeeId: employeeId,
          auditCanonicalIdentityResource: sourceIdentityResource,
          auditAliasIdentityResource: aliasSourceIdentityResource,
          auditRevisionChecks: entityRevisionChecks,
          resourceRevisionChecks: [
            {
              resource: resource(
                "core:identity-conflict-review",
                "identity_conflict_review:semantic-closure"
              ),
              expected: "1",
              actual: "1"
            },
            {
              resource: resource(
                "core:source-identity-claim-head",
                "source_identity_claim_head:merge-canonical"
              ),
              expected: "1",
              actual: "1"
            },
            {
              resource: resource(
                "core:source-identity-claim-head",
                "source_identity_claim_head:merge-alias"
              ),
              expected: "1",
              actual: "1"
            },
            {
              resource: resource(
                "core:source-identity-alias-graph",
                "source_identity_alias_graph:semantic-closure"
              ),
              expected: "1",
              actual: "1"
            },
            {
              resource: resource(
                "core:audit-event",
                "audit_event:identity-merge"
              ),
              expected: "1",
              actual: "1"
            }
          ]
        }
      }
    });
    return {
      permissionId,
      input: makeInput(
        [primary, sourceIdentity, aliasIdentity],
        [primaryGrant, sourceGrant]
      )
    };
  }

  const annotationResource = resource(
    "core:identity-review-annotation",
    "identity_review_annotation:semantic-closure"
  );
  const primary = makeRequirement({
    id: `identity-primary-${permissionId}`,
    permissionId,
    resource: annotationResource,
    guard: {
      profileId: "core:rbac.guard.identity_evidence",
      targetResource: annotationResource,
      evidenceState: "verified",
      operation: {
        kind: "observation_review",
        actorEmployeeId: employeeId,
        sourceIdentityResource,
        sourceIdentityRequirementId: sourceIdentity.id,
        sourceIdentityRevisionChecks: entityRevisionChecks,
        reasonCodeId: "core:reviewed-observation",
        auditEventResource: resource(
          "core:audit-event",
          "audit_event:identity-observation-review"
        ),
        auditActorEmployeeId: employeeId,
        auditSourceIdentityResource: sourceIdentityResource,
        auditTargetResource: annotationResource,
        auditRevisionChecks: entityRevisionChecks,
        observationResource: resource(
          "core:source-identity-observation",
          "source_identity_observation:semantic-closure"
        ),
        reviewedObservationResource: resource(
          "core:source-identity-observation",
          "source_identity_observation:semantic-closure"
        ),
        annotationResource,
        annotationOperation: "append_annotation",
        observationSourceIdentityResource: sourceIdentityResource,
        writeSet: ["review_annotation"],
        observationRevisionChecks: entityRevisionChecks,
        annotationRevisionChecks: entityRevisionChecks
      }
    }
  });
  return {
    permissionId,
    input: makeInput([primary, sourceIdentity], [primaryGrant, sourceGrant])
  };
}

function identityAutoResolveScenario(): SemanticScenario {
  const resolutionResource = resource(
    "core:identity-resolution",
    "identity_resolution:semantic-closure"
  );
  const primary = makeRequirement({
    id: "identity-primary-core:identity.auto_resolve",
    permissionId: "core:identity.auto_resolve",
    resource: resolutionResource,
    guard: {
      profileId: "core:rbac.guard.identity_evidence",
      targetResource: resolutionResource,
      evidenceState: "verified",
      operation: {
        kind: "auto_resolve",
        trustedServiceId,
        manualActorEmployeeId: null,
        resolutionDecisionResource: resolutionResource,
        resolutionRelationResource: resource(
          "core:identity-resolution-binding",
          "identity_resolution_binding:semantic-closure"
        ),
        decisionSourceIdentityResource: sourceIdentityResource,
        decisionClaimTargetResource: secondClientContactResource,
        decisionPolicyResource: resource(
          "core:identity-claim-policy",
          "identity_claim_policy:auto-resolve"
        ),
        resolutionResourceRevisionChecks: [
          { resource: resolutionResource, expected: "1", actual: "1" },
          {
            resource: resource(
              "core:identity-resolution-binding",
              "identity_resolution_binding:semantic-closure"
            ),
            expected: "1",
            actual: "1"
          },
          { resource: sourceIdentityResource, expected: "1", actual: "1" },
          {
            resource: secondClientContactResource,
            expected: "1",
            actual: "1"
          },
          {
            resource: resource(
              "core:identity-claim-policy",
              "identity_claim_policy:auto-resolve"
            ),
            expected: "1",
            actual: "1"
          },
          {
            resource: resource(
              "core:identity-evidence",
              "identity_evidence:semantic-closure"
            ),
            expected: "1",
            actual: "1"
          },
          {
            resource: resource(
              "core:source-identity-claim-head",
              "source_identity_claim_head:auto-resolve"
            ),
            expected: "1",
            actual: "1"
          },
          {
            resource: resource("core:audit-event", "audit_event:auto-resolve"),
            expected: "1",
            actual: "1"
          }
        ],
        sourceIdentityResource,
        evidenceResource: resource(
          "core:identity-evidence",
          "identity_evidence:semantic-closure"
        ),
        claimTargetResource: secondClientContactResource,
        evidenceSourceIdentityResource: sourceIdentityResource,
        evidenceClaimTargetResource: secondClientContactResource,
        evidenceKind: "verified_scope_correct",
        policyResource: resource(
          "core:identity-claim-policy",
          "identity_claim_policy:auto-resolve"
        ),
        policyState: "approved_active",
        policyId: "core:verified-source-identity-policy",
        policyVersion: "1",
        evidencePolicyId: "core:verified-source-identity-policy",
        evidencePolicyVersion: "1",
        policyRuleManifest: {
          resource: resource(
            "core:identity-auto-resolution-policy-rule-manifest",
            "identity_auto_resolution_policy_rule_manifest:semantic-closure"
          ),
          policyResource: resource(
            "core:identity-claim-policy",
            "identity_claim_policy:auto-resolve"
          ),
          sourceIdentityResource,
          evidenceResource: resource(
            "core:identity-evidence",
            "identity_evidence:semantic-closure"
          ),
          claimTargetResource: secondClientContactResource,
          ruleId: "core:verified-scope-correct-auto-resolution",
          ruleVersion: "1",
          evidenceRuleId: "core:verified-scope-correct-auto-resolution",
          evidenceRuleVersion: "1",
          state: "approved_active",
          revisionChecks: [
            {
              resource: resource(
                "core:identity-auto-resolution-policy-rule-manifest",
                "identity_auto_resolution_policy_rule_manifest:semantic-closure"
              ),
              expected: "1",
              actual: "1"
            },
            {
              resource: resource(
                "core:identity-claim-policy",
                "identity_claim_policy:auto-resolve"
              ),
              expected: "1",
              actual: "1"
            },
            { resource: sourceIdentityResource, expected: "1", actual: "1" },
            {
              resource: resource(
                "core:identity-evidence",
                "identity_evidence:semantic-closure"
              ),
              expected: "1",
              actual: "1"
            },
            {
              resource: secondClientContactResource,
              expected: "1",
              actual: "1"
            }
          ],
          notAfter: GRANT_END
        },
        policyAllowedTargetKind: "client_contact",
        targetKind: "client_contact",
        targetEmployeeId: null,
        targetEmployeeLifecycle: null,
        sourceIdentityResolution: { state: "unresolved" },
        claimHeadResource: resource(
          "core:source-identity-claim-head",
          "source_identity_claim_head:auto-resolve"
        ),
        claimHeadSourceIdentityResource: sourceIdentityResource,
        currentClaimTargetResource: null,
        expectedClaimVersion: null,
        currentClaimVersion: null,
        auditEventResource: resource(
          "core:audit-event",
          "audit_event:auto-resolve"
        ),
        auditSourceIdentityResource: sourceIdentityResource,
        auditClaimTargetResource: secondClientContactResource,
        auditTrustedServiceId: trustedServiceId,
        reasonCodeId: "core:verified-auto-resolution",
        resolutionRevisionChecks: [
          { kind: "entity", expected: "1", actual: "1" }
        ],
        sourceIdentityRevisionChecks: [
          { kind: "entity", expected: "1", actual: "1" }
        ],
        evidenceRevisionChecks: [
          { kind: "entity", expected: "1", actual: "1" }
        ],
        targetRevisionChecks: [{ kind: "entity", expected: "1", actual: "1" }],
        policyRevisionChecks: [{ kind: "policy", expected: "1", actual: "1" }],
        claimRevisionChecks: [{ kind: "relation", expected: "1", actual: "1" }],
        auditRevisionChecks: [{ kind: "entity", expected: "1", actual: "1" }]
      }
    }
  });
  return {
    permissionId: "core:identity.auto_resolve",
    input: makeTrustedServiceInput([primary], "core:identity.auto_resolve")
  };
}

function identityScenario(
  permissionId: EmployeeIdentityPermissionId | "core:identity.auto_resolve"
): SemanticScenario {
  if (permissionId === "core:identity.auto_resolve") {
    return identityAutoResolveScenario();
  }
  if (
    permissionId === "core:identity.source_identity.use" ||
    permissionId === "core:identity.evidence.view"
  ) {
    return identityLeafScenario(permissionId);
  }
  return compoundIdentityScenario(permissionId);
}

type IdentityGuard = Extract<
  InboxV2PolicyGuardEvidence,
  { profileId: "core:rbac.guard.identity_evidence" }
>;

function replacePrimaryIdentityOperation(
  scenario: SemanticScenario,
  transform: (
    operation: IdentityGuard["operation"]
  ) => IdentityGuard["operation"]
): InboxV2AuthorizationPlanInput {
  return {
    ...scenario.input,
    requirements: scenario.input.requirements.map((requirement) => {
      if (
        requirement.permissionId !== scenario.permissionId ||
        requirement.guard.profileId !== "core:rbac.guard.identity_evidence"
      ) {
        return requirement;
      }
      return {
        ...requirement,
        guard: {
          ...requirement.guard,
          operation: transform(requirement.guard.operation)
        }
      };
    })
  };
}

function retargetPrimaryIdentityOperation(
  scenario: SemanticScenario,
  targetResource: InboxV2EntityKey,
  transform: (
    operation: IdentityGuard["operation"]
  ) => IdentityGuard["operation"]
): InboxV2AuthorizationPlanInput {
  return {
    ...scenario.input,
    requirements: scenario.input.requirements.map((requirement) => {
      if (
        requirement.permissionId !== scenario.permissionId ||
        requirement.guard.profileId !== "core:rbac.guard.identity_evidence"
      ) {
        return requirement;
      }
      return {
        ...requirement,
        resource: targetResource,
        guard: {
          ...requirement.guard,
          targetResource,
          operation: transform(requirement.guard.operation)
        }
      };
    })
  };
}

function claimedIdentityMergeScenario(
  targetKind: "employee" | "client_contact"
) {
  const base = identityScenario("core:identity.merge");
  const targetResource =
    targetKind === "employee" ? otherEmployeeResource : clientContactResource;
  const authorityResource =
    targetKind === "employee" ? targetResource : clientResource;
  const targetRequirementId = `identity-merge-${targetKind}-target`;
  const targetRequirement =
    targetKind === "employee"
      ? employeeDirectoryRequirement(targetRequirementId, targetResource)
      : clientContactsViewRequirement(
          targetRequirementId,
          clientId,
          authorityResource
        );
  const requirements = base.input.requirements.map((requirement) => {
    if (
      requirement.permissionId !== "core:identity.merge" ||
      requirement.guard.profileId !== "core:rbac.guard.identity_evidence" ||
      requirement.guard.operation.kind !== "merge"
    ) {
      return requirement;
    }
    const operation = requirement.guard.operation;
    const claimTargetAuthority = (
      side: "canonical" | "alias",
      claimHeadResource: InboxV2EntityKey
    ) => {
      const bindingResource = resource(
        "core:identity-merge-claim-target-binding",
        `identity_merge_claim_target_binding:${targetKind}-${side}`
      );
      return {
        kind: targetKind,
        targetResource,
        targetRequirementId,
        authorityResource,
        bindingResource,
        bindingMutationResource: operation.mutationResource,
        bindingClaimHeadResource: claimHeadResource,
        bindingTargetResource: targetResource,
        bindingAuthorityResource: authorityResource,
        revisionChecks: keyedRevisionChecks([
          bindingResource,
          operation.mutationResource,
          claimHeadResource,
          targetResource,
          authorityResource
        ])
      } as const;
    };
    return {
      ...requirement,
      guard: {
        ...requirement.guard,
        operation: {
          ...operation,
          canonicalResolution: { state: "claimed" as const, targetResource },
          aliasResolution: { state: "claimed" as const, targetResource },
          canonicalClaimHeadTargetResource: targetResource,
          aliasClaimHeadTargetResource: targetResource,
          canonicalClaimTargetAuthority: claimTargetAuthority(
            "canonical",
            operation.canonicalClaimHeadResource
          ),
          aliasClaimTargetAuthority: claimTargetAuthority(
            "alias",
            operation.aliasClaimHeadResource
          )
        }
      }
    };
  });
  const targetPermission =
    targetKind === "employee"
      ? "core:employee.directory.view"
      : "core:client.contacts.view";
  const input = makeInput(
    [...requirements, targetRequirement],
    [
      ...base.input.grants,
      makeGrant(
        targetPermission,
        { type: "tenant", tenantId },
        `identity-merge-${targetKind}-target`
      )
    ]
  );
  return {
    scenario: {
      permissionId: "core:identity.merge" as const,
      input
    } satisfies SemanticScenario,
    targetKind,
    targetResource,
    authorityResource,
    targetRequirementId
  };
}

function safeReportPrivacyEvidence() {
  return Object.freeze({
    requestedDimensionIds: Object.freeze(["core:queue"]),
    allowedDimensionIds: Object.freeze(["core:queue", "core:day"]),
    minimumCellSize: 5,
    primarySuppressionApplied: true,
    complementarySuppressionApplied: true,
    differencingBudgetRemaining: 1,
    privateInternalIncluded: false,
    stablePersonIdentifiersIncluded: false
  });
}

function workforceReportScenario(): SemanticScenario {
  const directory = employeeDirectoryRequirement(
    "workforce-report-directory",
    otherEmployeeResource
  );
  const primary = makeRequirement({
    id: "workforce-report-primary",
    permissionId: "core:reports.workforce_dimension.view",
    resource: reportResource,
    guard: {
      ...canonicalGuard,
      action: {
        kind: "report_workforce",
        targetResource: reportResource,
        privacy: safeReportPrivacyEvidence(),
        employeeDirectoryRequirementId: directory.id,
        employeeDirectoryResource: otherEmployeeResource
      }
    }
  });
  return {
    permissionId: "core:reports.workforce_dimension.view",
    input: makeInput(
      [primary, directory],
      [
        makeGrant(
          "core:reports.workforce_dimension.view",
          { type: "tenant", tenantId },
          "workforce-report-primary"
        ),
        makeGrant(
          "core:employee.directory.view",
          { type: "tenant", tenantId },
          "workforce-report-directory"
        )
      ]
    )
  };
}

function auditScenario(permissionId: "core:audit.view"): SemanticScenario {
  const facet = conversationReadRequirement("audit-conversation-facet");
  const auditResource = resource(
    "core:audit-query",
    "audit_query:semantic-closure"
  );
  const primary = makeRequirement({
    id: "audit-primary",
    permissionId,
    resource: auditResource,
    guard: {
      profileId: "core:rbac.guard.audit_facets",
      targetResource: auditResource,
      facetRequirementIds: [facet.id],
      facetResources: [conversationResource],
      manifestResource: resource(
        "core:authorization-manifest",
        "authorization_manifest:audit"
      ),
      manifestTargetResource: auditResource,
      manifestRevisionChecks: [
        { kind: "manifest", expected: "1", actual: "1" }
      ],
      scopeAppliedBeforeCountAndPagination: true,
      piiRequested: false,
      piiRequirementId: null
    }
  });
  return {
    permissionId,
    input: makeInput(
      [primary, facet],
      [
        makeGrant(permissionId, { type: "tenant", tenantId }, "audit-primary"),
        makeGrant(
          "core:conversation.read",
          { type: "tenant", tenantId },
          "audit-conversation-facet"
        )
      ]
    )
  };
}

function privacyRequestScenario(
  permissionId: "core:privacy.request.view" | "core:privacy.request.execute"
): SemanticScenario {
  const execute = permissionId === "core:privacy.request.execute";
  const caseId = execute ? "closure-execute" : "closure-view";
  const caseResource = resource(
    "core:privacy-request",
    `privacy_request_case:${caseId}`
  );
  const discoveryManifestResource = resource(
    "core:privacy-discovery-manifest",
    `privacy_discovery_manifest:${caseId}`
  );
  const proofResource = resource(
    "core:privacy-discovery-proof",
    `privacy_discovery_proof:${caseId}`
  );
  const policyRuleResource = resource(
    "core:data-lifecycle-policy-rule",
    "data_lifecycle_policy_rule:semantic-closure-rule"
  );
  const requesterId = execute ? otherEmployeeId : employeeId;
  const requesterEmployeeResource = resource(
    "core:employee",
    String(requesterId)
  );
  const deciderEmployeeResource = resource(
    "core:employee",
    String(thirdEmployeeId)
  );
  const executorEmployeeResource = resource(
    "core:employee",
    String(employeeId)
  );
  const partyBindingResource = resource(
    "core:privacy-request-party-binding",
    `privacy_request_party_binding:${caseId}`
  );
  const decisionLedgerResource = resource(
    "core:privacy-request-decision-ledger",
    `privacy_request_decision_ledger:${caseId}`
  );
  const rootDecisionManifestResource = resource(
    "core:privacy-request-root-decision-manifest",
    `privacy_request_root_decision_manifest:${caseId}`
  );
  const executorRelationResource = resource(
    "core:privacy-request-executor-relation",
    `privacy_request_executor_relation:${caseId}`
  );
  const primary = makeRequirement({
    id: `privacy-request-primary-${caseId}`,
    permissionId,
    resource: caseResource,
    guard: {
      profileId: "core:rbac.guard.privacy_request_roots_revision",
      targetResource: caseResource,
      caseId,
      casePartyEvidence: {
        bindingResource: partyBindingResource,
        bindingCaseResource: caseResource,
        requesterEmployeeResource,
        bindingRequesterEmployeeResource: requesterEmployeeResource,
        state: "immutable",
        revisionChecks: [
          { resource: partyBindingResource, expected: "1", actual: "1" },
          { resource: caseResource, expected: "1", actual: "1" },
          {
            resource: requesterEmployeeResource,
            expected: "1",
            actual: "1"
          }
        ]
      },
      verificationState: "verified",
      expectedRootsRevision: "1",
      currentRootsRevision: "1",
      governanceContextResource: resource(
        "core:governance-context",
        `governance_context:${caseId}`
      ),
      expectedGovernanceRevision: "1",
      currentGovernanceRevision: "1",
      discoveryManifestResource,
      discoveryManifestTargetResource: caseResource,
      discoveryManifestRevisionChecks: [
        { resource: discoveryManifestResource, expected: "1", actual: "1" },
        { resource: caseResource, expected: "1", actual: "1" }
      ],
      discoveryManifestRootResources: execute ? [conversationResource] : [],
      discoveryManifestMembershipRevisionChecks: keyedRevisionChecks([
        discoveryManifestResource,
        caseResource,
        ...(execute ? [conversationResource] : [])
      ]),
      rootDecisions: execute
        ? [
            {
              rootResource: conversationResource,
              discoveryProofResource: proofResource,
              proofRequestResource: caseResource,
              proofRootResource: conversationResource,
              proofRevisionChecks: [
                { resource: proofResource, expected: "1", actual: "1" },
                { resource: caseResource, expected: "1", actual: "1" },
                {
                  resource: conversationResource,
                  expected: "1",
                  actual: "1"
                }
              ],
              policyRuleId: "semantic-closure-rule",
              policyRuleResource,
              policyRuleRequestResource: caseResource,
              policyRuleRootResource: conversationResource,
              policyRuleState: "active",
              policyRuleRevisionChecks: [
                {
                  resource: policyRuleResource,
                  expected: "1",
                  actual: "1"
                },
                { resource: caseResource, expected: "1", actual: "1" },
                {
                  resource: conversationResource,
                  expected: "1",
                  actual: "1"
                }
              ],
              expectedDecisionRevision: "1",
              currentDecisionRevision: "1",
              decisionState: "approved" as const
            }
          ]
        : [],
      phase: execute ? "execute" : "view",
      actingEmployeeId: employeeId,
      requesterEmployeeId: requesterId,
      deciderEmployeeId: execute ? thirdEmployeeId : null,
      executorEmployeeId: execute ? employeeId : null,
      decisionLedger: execute
        ? {
            resource: decisionLedgerResource,
            caseResource,
            requesterEmployeeResource,
            deciderEmployeeResource,
            rootManifestResource: rootDecisionManifestResource,
            rootManifestDecisionResource: decisionLedgerResource,
            rootManifestCaseResource: caseResource,
            rootManifestRootResources: [conversationResource],
            rootManifestEntries: [
              {
                rootResource: conversationResource,
                discoveryProofResource: proofResource,
                policyRuleId: "semantic-closure-rule",
                policyRuleResource,
                decisionState: "approved" as const,
                expectedDecisionRevision: "1",
                currentDecisionRevision: "1"
              }
            ],
            rootManifestDecisionSetDigest: `decision-set:${caseId}:v1`,
            ledgerDecisionSetDigest: `decision-set:${caseId}:v1`,
            state: "approved" as const,
            revisionChecks: [
              {
                resource: decisionLedgerResource,
                expected: "1",
                actual: "1"
              },
              { resource: caseResource, expected: "1", actual: "1" },
              {
                resource: requesterEmployeeResource,
                expected: "1",
                actual: "1"
              },
              {
                resource: deciderEmployeeResource,
                expected: "1",
                actual: "1"
              },
              {
                resource: discoveryManifestResource,
                expected: "1",
                actual: "1"
              },
              {
                resource: rootDecisionManifestResource,
                expected: "1",
                actual: "1"
              },
              {
                resource: conversationResource,
                expected: "1",
                actual: "1"
              },
              {
                resource: proofResource,
                expected: "1",
                actual: "1"
              },
              {
                resource: policyRuleResource,
                expected: "1",
                actual: "1"
              }
            ]
          }
        : null,
      executorRelation: execute
        ? {
            resource: executorRelationResource,
            decisionResource: decisionLedgerResource,
            caseResource,
            executorEmployeeResource,
            relationExecutorEmployeeResource: executorEmployeeResource,
            state: "active" as const,
            revisionChecks: [
              {
                resource: executorRelationResource,
                expected: "1",
                actual: "1"
              },
              {
                resource: decisionLedgerResource,
                expected: "1",
                actual: "1"
              },
              { resource: caseResource, expected: "1", actual: "1" },
              {
                resource: requesterEmployeeResource,
                expected: "1",
                actual: "1"
              },
              {
                resource: deciderEmployeeResource,
                expected: "1",
                actual: "1"
              },
              {
                resource: rootDecisionManifestResource,
                expected: "1",
                actual: "1"
              },
              {
                resource: discoveryManifestResource,
                expected: "1",
                actual: "1"
              },
              {
                resource: conversationResource,
                expected: "1",
                actual: "1"
              },
              {
                resource: executorEmployeeResource,
                expected: "1",
                actual: "1"
              }
            ]
          }
        : null,
      contentAuthorityDerivedFromRequester: false
    }
  });
  return {
    permissionId,
    input: makeInput(
      [primary],
      [
        makeGrant(
          permissionId,
          { type: "tenant", tenantId },
          `privacy-request-${caseId}`
        )
      ]
    )
  };
}

function privacyHoldScenario(
  permissionId: "core:privacy.hold.view" | "core:privacy.hold.issue"
): SemanticScenario {
  const issue = permissionId === "core:privacy.hold.issue";
  const holdId = issue ? "closure-issue" : "closure-view";
  const holdResource = resource("core:privacy-hold", `privacy_hold:${holdId}`);
  const manifestResource = resource(
    "core:privacy-hold-scope-manifest",
    `privacy_hold_scope_manifest:${holdId}`
  );
  const rootResource = resource("core:storage-root", `storage_root:${holdId}`);
  const approvalResource = resource(
    "core:privacy-hold-approval",
    `privacy_hold_approval:${holdId}`
  );
  const issuerBindingResource = resource(
    "core:privacy-hold-issuer-binding",
    `privacy_hold_issuer_binding:${holdId}`
  );
  const issuerEmployeeResource = resource("core:employee", String(employeeId));
  const directoryRequirementId = `privacy-hold-directory-${holdId}`;
  const approverGrantId = `privacy-hold-approver-${holdId}`;
  const approvalEvidence = issue
    ? {
        resource: approvalResource,
        holdResource,
        manifestResource,
        manifestRootResources: [rootResource],
        approverEmployeeResource: otherEmployeeResource,
        approverEmployeeId: otherEmployeeId,
        approverLifecycle: "active" as const,
        approverDirectoryRequirementId: directoryRequirementId,
        approverGrantId,
        state: "approved" as const,
        revisionChecks: [
          approvalResource,
          holdResource,
          manifestResource,
          otherEmployeeResource,
          rootResource
        ].map((revisionResource) => ({
          resource: revisionResource,
          expected: "1",
          actual: "1"
        })),
        notAfter: GRANT_END
      }
    : null;
  const issuerEvidence = issue
    ? {
        resource: issuerBindingResource,
        holdResource,
        manifestResource,
        manifestRootResources: [rootResource],
        issuerEmployeeResource,
        issuerEmployeeId: employeeId,
        revisionChecks: [
          issuerBindingResource,
          holdResource,
          manifestResource,
          issuerEmployeeResource,
          rootResource
        ].map((revisionResource) => ({
          resource: revisionResource,
          expected: "1",
          actual: "1"
        }))
      }
    : null;
  const primary = makeRequirement({
    id: `privacy-hold-primary-${holdId}`,
    permissionId,
    resource: holdResource,
    guard: {
      profileId: "core:rbac.guard.privacy_hold_manifest_revision",
      targetResource: holdResource,
      holdId,
      manifestAuthenticity: "authentic",
      manifestResource,
      manifestHoldResource: holdResource,
      rootResources: [rootResource],
      manifestRootResources: [rootResource],
      manifestRevisionChecks: [
        manifestResource,
        holdResource,
        rootResource
      ].map((revisionResource) => ({
        resource: revisionResource,
        expected: "1",
        actual: "1"
      })),
      expectedManifestRevision: "1",
      currentManifestRevision: "1",
      lastReviewedAt: "2026-07-12T09:00:00.000Z",
      nextReviewAt: GRANT_END,
      phase: issue ? "issue" : "view",
      actingEmployeeId: employeeId,
      reason: issue ? "preserve records for the verified legal case" : "",
      reviewerEmployeeId: issue ? otherEmployeeId : null,
      issuerEmployeeId: issue ? employeeId : null,
      releaserEmployeeId: null,
      issuerEvidence,
      approvalEvidence,
      contentAuthorityRequested: false
    }
  });
  const directoryRequirement = issue
    ? makeRequirement({
        id: directoryRequirementId,
        permissionId: "core:employee.directory.view",
        resource: otherEmployeeResource,
        guard: canonicalGuard,
        visibility: "secondary_hidden"
      })
    : null;
  return {
    permissionId,
    input: makeInput(
      [
        primary,
        ...(directoryRequirement === null ? [] : [directoryRequirement])
      ],
      [
        makeGrant(
          permissionId,
          { type: "tenant", tenantId },
          `privacy-hold-${holdId}`
        ),
        ...(issue
          ? [
              makeGrant(
                permissionId,
                { type: "tenant", tenantId },
                approverGrantId,
                otherEmployeeId
              ),
              makeGrant(
                "core:employee.directory.view",
                { type: "tenant", tenantId },
                `${directoryRequirementId}-grant`
              )
            ]
          : [])
      ]
    )
  };
}

function privacyAuditScenario(
  permissionId: "core:audit.privacy.view" | "core:audit.privacy.export"
): SemanticScenario {
  const suffix = permissionId.endsWith("export") ? "export" : "view";
  const facet = conversationReadRequirement(
    `privacy-audit-conversation-${suffix}`
  );
  const auditResource = resource(
    "core:privacy-audit-query",
    `privacy_audit_query:${suffix}`
  );
  const primary = makeRequirement({
    id: `privacy-audit-primary-${suffix}`,
    permissionId,
    resource: auditResource,
    guard: {
      profileId: "core:rbac.guard.privacy_audit_facets",
      targetResource: auditResource,
      accessLevel: suffix,
      actorFacet: "actor",
      targetFacet: "target",
      scopeFacet: "scope",
      facetRequirementIds: [facet.id],
      facetResources: [conversationResource],
      manifestResource: resource(
        "core:authorization-manifest",
        `authorization_manifest:privacy-audit-${suffix}`
      ),
      manifestTargetResource: auditResource,
      manifestRevisionChecks: [
        { kind: "manifest", expected: "1", actual: "1" }
      ],
      piiRequested: false,
      piiRequirementId: null,
      piiAuthorityEvidence: null,
      actingEmployeeId: employeeId,
      auditAccessEventId: `audit:privacy-${suffix}-semantic-closure`,
      auditAccessEventResource: resource(
        "core:audit-event",
        `audit:privacy-${suffix}-semantic-closure`
      ),
      auditEventActorEmployeeResource: resource(
        "core:employee",
        String(employeeId)
      ),
      auditEventAction:
        suffix === "export" ? "privacy_audit_export" : "privacy_audit_view",
      auditEventTargetResource: auditResource,
      auditEventRevisionChecks: [
        {
          resource: resource(
            "core:audit-event",
            `audit:privacy-${suffix}-semantic-closure`
          ),
          expected: "1",
          actual: "1"
        },
        { resource: auditResource, expected: "1", actual: "1" },
        {
          resource: resource("core:employee", String(employeeId)),
          expected: "1",
          actual: "1"
        }
      ],
      scopeAppliedBeforeCountAndPagination: true
    }
  });
  return {
    permissionId,
    input: makeInput(
      [primary, facet],
      [
        makeGrant(
          permissionId,
          { type: "tenant", tenantId },
          `privacy-audit-primary-${suffix}`
        ),
        makeGrant(
          "core:conversation.read",
          { type: "tenant", tenantId },
          `privacy-audit-conversation-${suffix}`
        )
      ]
    )
  };
}

function privacyAuditPiiScenario(
  substituteTeamB: boolean
): InboxV2AuthorizationPlanInput {
  const auditFacet = conversationReadRequirement("privacy-audit-pii-facet");
  const teamBConversation = resource(
    "core:conversation",
    "conversation:privacy-audit-team-b"
  );
  const reportUnderlying = substituteTeamB
    ? makeRequirement({
        id: "privacy-audit-pii-team-b-underlying",
        permissionId: "core:conversation.read",
        resource: teamBConversation,
        guard: {
          ...canonicalGuard,
          contentBoundary: "external",
          action: {
            kind: "conversation_content_read",
            targetResource: teamBConversation,
            conversationKind: "external_work",
            contentBoundary: "external",
            topologyResource: resource(
              "core:conversation-topology",
              "conversation_topology:privacy-audit-team-b"
            ),
            topologyConversationResource: teamBConversation,
            topologyConversationKind: "external_work",
            topologyRevisionChecks: [
              { kind: "state", expected: "1", actual: "1" }
            ]
          }
        },
        visibility: "secondary_hidden"
      })
    : auditFacet;
  const auditResource = resource(
    "core:privacy-audit-query",
    "privacy_audit_query:pii"
  );
  const auditManifestResource = resource(
    "core:authorization-manifest",
    "authorization_manifest:privacy-audit-pii"
  );
  const reportQueryResource = resource(
    "core:report-query",
    "report_query:privacy-audit-pii"
  );
  const reportDrillManifestResource = resource(
    "core:authorization-manifest",
    "authorization_manifest:privacy-audit-pii-drill"
  );
  const reportPiiManifestResource = resource(
    "core:authorization-manifest",
    "authorization_manifest:privacy-audit-pii-authority"
  );
  const reportScopeFacts: readonly InboxV2CanonicalScopeFact[] = substituteTeamB
    ? [
        {
          kind: "team",
          ...scopePath(reportQueryResource, clientAccessTeamResource),
          teamId: clientAccessTeamId,
          validUntil: LATER
        }
      ]
    : [];
  const reportView = makeRequirement({
    id: "privacy-audit-pii-report-view",
    permissionId: "core:reports.view",
    resource: reportQueryResource,
    scopeFacts: reportScopeFacts,
    guard: {
      ...canonicalGuard,
      action: {
        kind: "report_aggregate",
        targetResource: reportQueryResource,
        privacy: safeReportPrivacyEvidence()
      }
    },
    visibility: "secondary_hidden"
  });
  const reportDrill = makeRequirement({
    id: "privacy-audit-pii-report-drilldown",
    permissionId: "core:reports.drilldown",
    resource: reportQueryResource,
    scopeFacts: reportScopeFacts,
    guard: {
      profileId: "core:rbac.guard.report_resource_conjunction",
      targetResource: reportQueryResource,
      accessLevel: "drilldown",
      layerRequirementIds: [reportView.id],
      underlyingRequirementIds: [reportUnderlying.id],
      underlyingResources: [reportUnderlying.resource],
      manifestResource: reportDrillManifestResource,
      manifestTargetResource: reportQueryResource,
      manifestRevisionChecks: [
        { kind: "manifest", expected: "1", actual: "1" }
      ],
      scopeAppliedBeforeCountAndPagination: true,
      privateInternalIncluded: false,
      privateInternalRequirementIds: []
    },
    visibility: "secondary_hidden"
  });
  const reportPii = makeRequirement({
    id: "privacy-audit-pii-report-authority",
    permissionId: "core:reports.pii.view",
    resource: reportQueryResource,
    scopeFacts: reportScopeFacts,
    guard: {
      profileId: "core:rbac.guard.report_resource_conjunction",
      targetResource: reportQueryResource,
      accessLevel: "pii",
      layerRequirementIds: [reportView.id, reportDrill.id],
      underlyingRequirementIds: [reportUnderlying.id],
      underlyingResources: [reportUnderlying.resource],
      manifestResource: reportPiiManifestResource,
      manifestTargetResource: reportQueryResource,
      manifestRevisionChecks: [
        { kind: "manifest", expected: "1", actual: "1" }
      ],
      scopeAppliedBeforeCountAndPagination: true,
      privateInternalIncluded: false,
      privateInternalRequirementIds: []
    },
    visibility: "secondary_hidden"
  });
  const auditEventResource = resource(
    "core:audit-event",
    "audit:privacy-pii-semantic-closure"
  );
  const actorResource = resource("core:employee", String(employeeId));
  const piiBindingResource = resource(
    "core:privacy-audit-pii-authority-binding",
    "privacy_audit_pii_authority_binding:semantic-closure"
  );
  const primary = makeRequirement({
    id: "privacy-audit-pii-primary",
    permissionId: "core:audit.privacy.view",
    resource: auditResource,
    guard: {
      profileId: "core:rbac.guard.privacy_audit_facets",
      targetResource: auditResource,
      accessLevel: "view",
      actorFacet: "actor",
      targetFacet: "target",
      scopeFacet: "scope",
      facetRequirementIds: [auditFacet.id],
      facetResources: [conversationResource],
      manifestResource: auditManifestResource,
      manifestTargetResource: auditResource,
      manifestRevisionChecks: [
        { kind: "manifest", expected: "1", actual: "1" }
      ],
      piiRequested: true,
      piiRequirementId: reportPii.id,
      piiAuthorityEvidence: {
        bindingResource: piiBindingResource,
        auditQueryResource: auditResource,
        auditManifestResource,
        reportQueryResource,
        reportManifestResource: reportPiiManifestResource,
        facetResources: [conversationResource],
        revisionChecks: [
          { resource: piiBindingResource, expected: "1", actual: "1" },
          { resource: auditResource, expected: "5", actual: "5" },
          { resource: auditManifestResource, expected: "1", actual: "1" },
          { resource: reportQueryResource, expected: "5", actual: "5" },
          {
            resource: reportPiiManifestResource,
            expected: "1",
            actual: "1"
          },
          { resource: conversationResource, expected: "5", actual: "5" }
        ]
      },
      actingEmployeeId: employeeId,
      auditAccessEventId: "audit:privacy-pii-semantic-closure",
      auditAccessEventResource: auditEventResource,
      auditEventActorEmployeeResource: actorResource,
      auditEventAction: "privacy_audit_view",
      auditEventTargetResource: auditResource,
      auditEventRevisionChecks: [
        { resource: auditEventResource, expected: "1", actual: "1" },
        { resource: auditResource, expected: "5", actual: "5" },
        { resource: actorResource, expected: "1", actual: "1" }
      ],
      scopeAppliedBeforeCountAndPagination: true
    }
  });
  const reportScope: InboxV2PermissionScope = substituteTeamB
    ? { type: "team", tenantId, id: clientAccessTeamId }
    : { type: "tenant", tenantId };
  return makeInput(
    [
      primary,
      auditFacet,
      reportPii,
      reportDrill,
      reportView,
      ...(substituteTeamB ? [reportUnderlying] : [])
    ],
    [
      makeGrant(
        "core:audit.privacy.view",
        { type: "tenant", tenantId },
        "privacy-audit-pii-primary"
      ),
      makeGrant(
        "core:conversation.read",
        { type: "tenant", tenantId },
        auditFacet.id
      ),
      makeGrant("core:reports.pii.view", reportScope, reportPii.id),
      makeGrant("core:reports.drilldown", reportScope, reportDrill.id),
      makeGrant("core:reports.view", reportScope, reportView.id),
      ...(substituteTeamB
        ? [
            makeGrant(
              "core:conversation.read",
              { type: "tenant", tenantId },
              reportUnderlying.id
            )
          ]
        : [])
    ]
  );
}

type WorkClosurePermissionId =
  | "core:work.transfer"
  | "core:work.release_self"
  | "core:work.release_other";

type WorkClosureOperation = "transfer" | "release_self" | "release_other";

function responsibleFact(): InboxV2CanonicalScopeFact {
  return {
    kind: "responsible",
    ...scopePath(workItemResource, workItemResource),
    employeeId,
    workItemId,
    state: "active",
    assignmentRevision: revision,
    currentAssignmentRevision: revision,
    validUntil: LATER
  };
}

function queueAuthorityFacts(
  includeResponsible: boolean
): readonly InboxV2CanonicalScopeFact[] {
  return [
    {
      kind: "queue",
      ...scopePath(workItemResource, queueResource),
      queueId,
      validUntil: LATER
    },
    ...(includeResponsible ? [responsibleFact()] : [])
  ];
}

function workGuard(
  input: Readonly<{
    authorizationMode: "operation" | "destination_authority";
    operation: WorkClosureOperation | "override";
    actorRelation:
      | "primary_responsible"
      | "scoped_supervisor_override"
      | "none";
    destinationRequirementIds?: readonly string[];
    destinationResources?: readonly InboxV2EntityKey[];
    authorityTargetResource?: InboxV2EntityKey | null;
    authorityState?: "eligible" | null;
    overrideReason?: string | null;
    overrideRequirementId?: string | null;
  }>
): Extract<
  InboxV2PolicyGuardEvidence,
  { profileId: "core:rbac.guard.work_item_state" }
> {
  return {
    profileId: "core:rbac.guard.work_item_state",
    authorizationMode: input.authorizationMode,
    workItemId,
    operation: input.operation,
    workState: "active",
    actorRelation: input.actorRelation,
    assignmentState: "assigned",
    expectedStateRevision: "1",
    currentStateRevision: "1",
    destinationRequirementIds: input.destinationRequirementIds ?? [],
    destinationResources: input.destinationResources ?? [],
    authorityTargetResource: input.authorityTargetResource ?? null,
    authorityState: input.authorityState ?? null,
    eligibleEmployeeId: null,
    authorityRevisionChecks:
      input.authorizationMode === "destination_authority"
        ? [{ kind: "relation", expected: "1", actual: "1" }]
        : [],
    overrideReason: input.overrideReason ?? null,
    overrideRequirementId: input.overrideRequirementId ?? null
  };
}

function workClosureScenario(
  permissionId: WorkClosurePermissionId
): SemanticScenario {
  const operation: WorkClosureOperation =
    permissionId === "core:work.transfer"
      ? "transfer"
      : permissionId === "core:work.release_self"
        ? "release_self"
        : "release_other";
  const releaseSelf = operation === "release_self";
  const releaseOther = operation === "release_other";
  const destinationId = `work-destination-${operation}`;
  const overrideId = "work-release-other-override";
  const primary = makeRequirement({
    id: `work-primary-${operation}`,
    permissionId,
    resource: workItemResource,
    scopeFacts: releaseOther ? [] : [responsibleFact()],
    guard: workGuard({
      authorizationMode: "operation",
      operation,
      actorRelation: releaseOther
        ? "scoped_supervisor_override"
        : "primary_responsible",
      destinationRequirementIds: [destinationId],
      destinationResources: [queueResource],
      overrideReason: releaseOther ? "release abandoned assignment" : null,
      overrideRequirementId: releaseOther ? overrideId : null
    })
  });
  const destination = makeRequirement({
    id: destinationId,
    permissionId,
    resource: workItemResource,
    scopeFacts: queueAuthorityFacts(releaseSelf),
    guard: workGuard({
      authorizationMode: "destination_authority",
      operation,
      actorRelation: "none",
      authorityTargetResource: queueResource,
      authorityState: "eligible"
    }),
    visibility: "secondary_hidden"
  });
  const override = makeRequirement({
    id: overrideId,
    permissionId: "core:work.override",
    resource: workItemResource,
    guard: workGuard({
      authorizationMode: "operation",
      operation: "override",
      actorRelation: "scoped_supervisor_override",
      overrideReason: "approve release of another employee assignment"
    }),
    visibility: "secondary_hidden"
  });
  const primaryScope: InboxV2PermissionScope = releaseSelf
    ? { type: "responsible", tenantId }
    : { type: "tenant", tenantId };
  return {
    permissionId,
    input: makeInput(
      releaseOther ? [primary, destination, override] : [primary, destination],
      [
        makeGrant(permissionId, primaryScope, `work-primary-${operation}`),
        ...(releaseOther
          ? [
              makeGrant(
                "core:work.override",
                { type: "tenant", tenantId },
                "work-release-other-override"
              )
            ]
          : [])
      ]
    )
  };
}

function semanticGapScenarios(): readonly SemanticScenario[] {
  return Object.freeze([
    bareScenario("core:tenant.manage", tenantResource),
    bareScenario(
      "core:employee.invite",
      resource(
        "core:employee-invitation",
        "employee_invitation:semantic-closure"
      )
    ),
    bareScenario("core:employee.profile.manage", otherEmployeeResource),
    bareScenario("core:employee.deactivate", otherEmployeeResource),
    bareScenario(
      "core:roles.define",
      resource("core:role", "role:semantic-closure")
    ),
    directGrantScenario(),
    bareScenario(
      "core:org_unit.manage",
      resource("core:org-unit", "org_unit:semantic-closure")
    ),
    bareScenario(
      "core:team.manage",
      resource("core:team", "team:semantic-closure")
    ),
    ownerRecoveryScenario(),
    accessPolicyScenario(),
    staffNoteReadScenario(),
    deleteOwnScenario(),
    bareScenario("core:source_account.view", sourceAccountResource),
    bareScenario("core:source_account.diagnostics.view", sourceAccountResource),
    callTranscriptScenario(),
    ...CLIENT_SEMANTIC_PERMISSION_IDS.map(clientScenario),
    identityScenario("core:identity.client_contact_claim.manage"),
    identityScenario("core:identity.source_identity.use"),
    identityScenario("core:identity.evidence.view"),
    identityScenario("core:identity.auto_resolve"),
    identityScenario("core:identity.claim.revoke"),
    identityScenario("core:identity.merge"),
    identityScenario("core:identity.observation.review"),
    workforceReportScenario(),
    auditScenario("core:audit.view"),
    privacyRequestScenario("core:privacy.request.view"),
    privacyRequestScenario("core:privacy.request.execute"),
    privacyHoldScenario("core:privacy.hold.view"),
    privacyHoldScenario("core:privacy.hold.issue"),
    privacyAuditScenario("core:audit.privacy.view"),
    privacyAuditScenario("core:audit.privacy.export")
  ]);
}

function additionalSemanticClosureScenarios(): readonly SemanticScenario[] {
  return Object.freeze([
    identityScenario("core:identity.employee_claim.manage"),
    workClosureScenario("core:work.transfer"),
    workClosureScenario("core:work.release_self"),
    workClosureScenario("core:work.release_other")
  ]);
}

function semanticClosureScenarios(): readonly SemanticScenario[] {
  return Object.freeze([
    ...semanticGapScenarios(),
    ...additionalSemanticClosureScenarios()
  ]);
}

const EMPLOYEE_IDENTITY_PERMISSION_IDS = Object.freeze([
  "core:identity.employee_claim.manage",
  "core:identity.client_contact_claim.manage",
  "core:identity.source_identity.use",
  "core:identity.evidence.view",
  "core:identity.claim.revoke",
  "core:identity.merge",
  "core:identity.observation.review"
] as const satisfies readonly EmployeeIdentityPermissionId[]);

function relabelIdentityPermission(
  scenario: SemanticScenario,
  replacementPermissionId: EmployeeIdentityPermissionId
): InboxV2AuthorizationPlanInput {
  return Object.freeze({
    ...scenario.input,
    requirements: Object.freeze(
      scenario.input.requirements.map((requirement) =>
        requirement.permissionId === scenario.permissionId
          ? Object.freeze({
              ...requirement,
              permissionId: replacementPermissionId
            })
          : requirement
      )
    ),
    grants: Object.freeze(
      scenario.input.grants.map((grant) =>
        grant.permissionId === scenario.permissionId &&
        grant.principal.kind === "employee"
          ? Object.freeze({
              ...grant,
              permissionId: replacementPermissionId
            })
          : grant
      )
    )
  });
}

describe("Inbox V2 authorization semantic closure", () => {
  const gapScenarios = semanticGapScenarios();
  const closureScenarios = semanticClosureScenarios();

  it("pins the exact 36 audited gaps and all 40 direct closure IDs", () => {
    expect(new Set(SEMANTIC_GAP_PERMISSION_IDS).size).toBe(36);
    expect(gapScenarios.map(({ permissionId }) => permissionId)).toEqual(
      SEMANTIC_GAP_PERMISSION_IDS
    );
    expect(new Set(SEMANTIC_CLOSURE_PERMISSION_IDS).size).toBe(40);
    expect(closureScenarios.map(({ permissionId }) => permissionId)).toEqual(
      SEMANTIC_CLOSURE_PERMISSION_IDS
    );
  });

  it.each(closureScenarios)(
    "evaluates a permission-specific allowed path for $permissionId",
    ({ permissionId, input }) => {
      const decision = evaluateInboxV2AuthorizationPlan(input);
      expect(
        decision,
        `${permissionId}: ${JSON.stringify(decision)}`
      ).toMatchObject({
        outcome: "allowed"
      });
    }
  );

  it("binds internal owner recovery to the exact approval, approver grant and successor", () => {
    type CanonicalGuard = Extract<
      InboxV2PolicyGuardEvidence,
      { profileId: "core:rbac.guard.canonical_resource" }
    >;
    type RecoveryAction = Extract<
      CanonicalGuard["action"],
      { kind: "internal_owner_recovery" }
    >;
    const scenario = ownerRecoveryScenario();
    const primary = scenario.input.requirements.find(
      ({ permissionId }) =>
        permissionId === "core:conversation.internal.owner_recover"
    );
    if (
      primary?.guard.profileId !== "core:rbac.guard.canonical_resource" ||
      primary.guard.action.kind !== "internal_owner_recovery"
    ) {
      throw new Error("owner recovery scenario is not canonical");
    }
    const baseAction = primary.guard.action;
    const transforms: readonly ((action: RecoveryAction) => RecoveryAction)[] =
      [
        (action) => ({
          ...action,
          approvalConversationResource: resource(
            "core:conversation",
            "conversation:substituted"
          )
        }),
        (action) => ({
          ...action,
          approvalApproverEmployeeResource: otherEmployeeResource
        }),
        (action) => ({ ...action, approvalState: "pending" }),
        (action) => ({ ...action, approverGrantId: "missing-approver-grant" }),
        (action) => ({ ...action, approvalNotAfter: LATER }),
        (action) => ({ ...action, successorEmployeeId: employeeId })
      ];

    for (const transform of transforms) {
      const input: InboxV2AuthorizationPlanInput = {
        ...scenario.input,
        requirements: scenario.input.requirements.map((requirement) =>
          requirement.id !== primary.id
            ? requirement
            : {
                ...requirement,
                guard: { ...primary.guard, action: transform(baseAction) }
              }
        )
      };
      expect(evaluateInboxV2AuthorizationPlan(input).outcome).toBe("denied");
    }
  });

  it("binds privacy-audit export to its exact audit event and pre-pagination scope", () => {
    type PrivacyAuditGuard = Extract<
      InboxV2PolicyGuardEvidence,
      { profileId: "core:rbac.guard.privacy_audit_facets" }
    >;
    const scenario = privacyAuditScenario("core:audit.privacy.export");
    const primary = scenario.input.requirements.find(
      ({ permissionId }) => permissionId === "core:audit.privacy.export"
    );
    if (primary?.guard.profileId !== "core:rbac.guard.privacy_audit_facets") {
      throw new Error("privacy audit scenario is not typed");
    }
    const guard = primary.guard;
    const transforms: readonly ((
      guard: PrivacyAuditGuard
    ) => PrivacyAuditGuard)[] = [
      (candidate) => ({ ...candidate, accessLevel: "view" }),
      (candidate) => ({
        ...candidate,
        auditEventAction: "privacy_audit_view"
      }),
      (candidate) => ({ ...candidate, actingEmployeeId: otherEmployeeId }),
      (candidate) => ({
        ...candidate,
        auditEventActorEmployeeResource: otherEmployeeResource
      }),
      (candidate) => ({
        ...candidate,
        auditEventTargetResource: reportResource
      }),
      (candidate) => ({
        ...candidate,
        auditAccessEventResource: resource(
          "core:audit-event",
          "audit:privacy-substituted"
        )
      }),
      (candidate) => ({
        ...candidate,
        auditEventRevisionChecks: candidate.auditEventRevisionChecks.map(
          (check, index) => (index === 0 ? { ...check, actual: "2" } : check)
        )
      }),
      (candidate) => ({
        ...candidate,
        scopeAppliedBeforeCountAndPagination: false
      })
    ];

    for (const transform of transforms) {
      const input: InboxV2AuthorizationPlanInput = {
        ...scenario.input,
        requirements: scenario.input.requirements.map((requirement) =>
          requirement.id === primary.id
            ? { ...requirement, guard: transform(guard) }
            : requirement
        )
      };
      expect(evaluateInboxV2AuthorizationPlan(input).outcome).toBe("denied");
    }
  });

  it("allows privacy-audit PII only through an exact same-facet report authority", () => {
    expect(
      evaluateInboxV2AuthorizationPlan(privacyAuditPiiScenario(false)).outcome
    ).toBe("allowed");
  });

  it("denies substituting a team-B report PII authority for privacy-audit facet A", () => {
    expect(
      evaluateInboxV2AuthorizationPlan(privacyAuditPiiScenario(true)).outcome
    ).toBe("denied");
  });

  it("finalizes employee deactivation only after every Inbox responsibility is drained", () => {
    type CanonicalGuard = Extract<
      InboxV2PolicyGuardEvidence,
      { profileId: "core:rbac.guard.canonical_resource" }
    >;
    type EmployeeAction = Extract<
      CanonicalGuard["action"],
      { kind: "employee_record_change" }
    >;
    const scenario = bareScenario(
      "core:employee.deactivate",
      otherEmployeeResource
    );
    const primary = scenario.input.requirements[0];
    if (
      primary?.guard.profileId !== "core:rbac.guard.canonical_resource" ||
      primary.guard.action.kind !== "employee_record_change" ||
      primary.guard.action.deactivationWorkflow === null
    ) {
      throw new Error("employee deactivation scenario is not typed");
    }
    const baseAction = primary.guard.action;
    const workflow: NonNullable<EmployeeAction["deactivationWorkflow"]> =
      baseAction.deactivationWorkflow!;
    const transforms: readonly ((action: EmployeeAction) => EmployeeAction)[] =
      [
        (action) => ({
          ...action,
          deactivationWorkflow: {
            ...workflow,
            handlerSet: {
              ...workflow.handlerSet,
              completedHandlerResources: []
            }
          }
        }),
        (action) => ({
          ...action,
          deactivationWorkflow: {
            ...workflow,
            handlerSet: {
              ...workflow.handlerSet,
              requiredHandlerResources:
                workflow.handlerSet.requiredHandlerResources.slice(0, 1),
              completedHandlerResources:
                workflow.handlerSet.completedHandlerResources.slice(0, 1),
              revisionChecks: keyedRevisionChecks([
                workflow.handlerSet.resource,
                workflow.resource,
                otherEmployeeResource,
                workflow.handlerSet.registryManifest.resource,
                workflow.handlerSet.requiredHandlerResources[0]!
              ])
            }
          }
        }),
        (action) => ({
          ...action,
          deactivationWorkflow: {
            ...workflow,
            relationSets: workflow.relationSets.map((set, index) =>
              index === 0 ? { ...set, activeCount: 1 } : set
            )
          }
        }),
        (action) => ({
          ...action,
          deactivationWorkflow: {
            ...workflow,
            proofEmployeeResource: resource(
              "core:employee",
              String(thirdEmployeeId)
            )
          }
        }),
        (action) => ({
          ...action,
          deactivationWorkflow: {
            ...workflow,
            revisionChecks: workflow.revisionChecks.map((check, index) =>
              index === 0 ? { ...check, actual: "2" } : check
            )
          }
        }),
        (action) => ({ ...action, lifecycleBefore: "active" })
      ];

    for (const transform of transforms) {
      const input: InboxV2AuthorizationPlanInput = {
        ...scenario.input,
        requirements: scenario.input.requirements.map((requirement) =>
          requirement.id === primary.id
            ? {
                ...requirement,
                guard: { ...primary.guard, action: transform(baseAction) }
              }
            : requirement
        )
      };
      expect(evaluateInboxV2AuthorizationPlan(input).outcome).toBe("denied");
    }
  });

  it.each(
    EMPLOYEE_IDENTITY_PERMISSION_IDS.map((permissionId, index, ids) => ({
      permissionId,
      replacementPermissionId: ids[(index + 1) % ids.length]!
    }))
  )(
    "denies identity operation relabel $permissionId -> $replacementPermissionId",
    ({ permissionId, replacementPermissionId }) => {
      const scenario = identityScenario(permissionId);
      const decision = evaluateInboxV2AuthorizationPlan(
        relabelIdentityPermission(scenario, replacementPermissionId)
      );
      const publicErrorCode =
        permissionId === "core:identity.source_identity.use" &&
        replacementPermissionId === "core:identity.evidence.view"
          ? "identity.evidence_required"
          : "permission.denied";
      expect(decision).toMatchObject({
        outcome: "denied",
        publicErrorCode,
        diagnostics: { reason: "hard_boundary_denied" }
      });
    }
  );

  it("requires exact source_identity.use authority for every manual identity mutation", () => {
    const scenario = identityScenario("core:identity.employee_claim.manage");
    const sourceRequirementId =
      "identity-source-core:identity.employee_claim.manage";
    const input: InboxV2AuthorizationPlanInput = {
      ...scenario.input,
      requirements: scenario.input.requirements.map((requirement) =>
        requirement.id !== sourceRequirementId
          ? requirement
          : {
              ...requirement,
              permissionId: "core:identity.evidence.view",
              guard: {
                profileId: "core:rbac.guard.identity_evidence",
                targetResource: sourceIdentityResource,
                evidenceState: "verified",
                operation: {
                  kind: "evidence_view",
                  actorEmployeeId: employeeId,
                  evidenceResource: sourceIdentityResource,
                  revisionChecks: [
                    { kind: "relation", expected: "1", actual: "1" }
                  ]
                }
              }
            }
      ),
      grants: scenario.input.grants.map((grant) =>
        grant.permissionId !== "core:identity.source_identity.use"
          ? grant
          : { ...grant, permissionId: "core:identity.evidence.view" }
      )
    };

    expect(evaluateInboxV2AuthorizationPlan(input).outcome).toBe("denied");
  });

  it.each([
    { targetKind: "employee" as const },
    { targetKind: "client_contact" as const }
  ])(
    "allows identity merge with one deduplicated hidden current $targetKind authority",
    ({ targetKind }) => {
      const { scenario, targetRequirementId } =
        claimedIdentityMergeScenario(targetKind);
      const decision = evaluateInboxV2AuthorizationPlan(scenario.input);
      expect(
        decision.outcome,
        `${targetKind}: ${JSON.stringify(decision)}`
      ).toBe("allowed");
      expect(
        scenario.input.requirements.filter(
          ({ id }) => id === targetRequirementId
        )
      ).toEqual([
        expect.objectContaining({
          visibility: "secondary_hidden",
          permissionId:
            targetKind === "employee"
              ? "core:employee.directory.view"
              : "core:client.contacts.view"
        })
      ]);
    }
  );

  it("denies missing, wrong, stale, cross-tenant and non-deduplicated merge target authority", () => {
    const fixture = claimedIdentityMergeScenario("employee");
    const mutateMerge = (
      input: InboxV2AuthorizationPlanInput,
      transform: (
        operation: Extract<IdentityGuard["operation"], { kind: "merge" }>
      ) => Extract<IdentityGuard["operation"], { kind: "merge" }>
    ): InboxV2AuthorizationPlanInput =>
      makeInput(
        input.requirements.map((requirement) => {
          if (
            requirement.permissionId !== "core:identity.merge" ||
            requirement.guard.profileId !==
              "core:rbac.guard.identity_evidence" ||
            requirement.guard.operation.kind !== "merge"
          ) {
            return requirement;
          }
          return {
            ...requirement,
            guard: {
              ...requirement.guard,
              operation: transform(requirement.guard.operation)
            }
          };
        }),
        input.grants
      );
    const missing = makeInput(
      fixture.scenario.input.requirements.filter(
        ({ id }) => id !== fixture.targetRequirementId
      ),
      fixture.scenario.input.grants
    );
    const wrongTarget = resource(
      "core:employee",
      "employee:identity-merge-wrong-target"
    );
    const wrong = makeInput(
      fixture.scenario.input.requirements.map((requirement) =>
        requirement.id === fixture.targetRequirementId
          ? { ...requirement, resource: wrongTarget }
          : requirement
      ),
      fixture.scenario.input.grants
    );
    const stale = mutateMerge(fixture.scenario.input, (operation) => ({
      ...operation,
      canonicalClaimTargetAuthority:
        operation.canonicalClaimTargetAuthority === null
          ? null
          : {
              ...operation.canonicalClaimTargetAuthority,
              revisionChecks:
                operation.canonicalClaimTargetAuthority.revisionChecks.map(
                  (check, index) =>
                    index === 0 ? { ...check, actual: "2" } : check
                )
            }
    }));
    const foreignTenantId = inboxV2TenantIdSchema.parse(
      "tenant:identity-merge-foreign"
    );
    const foreignTarget = inboxV2EntityKeySchema.parse({
      tenantId: foreignTenantId,
      entityTypeId: "core:employee",
      entityId: "employee:identity-merge-foreign"
    });
    const crossTenantRequirements = fixture.scenario.input.requirements.map(
      (requirement) => {
        if (
          requirement.permissionId !== "core:identity.merge" ||
          requirement.guard.profileId !== "core:rbac.guard.identity_evidence" ||
          requirement.guard.operation.kind !== "merge"
        ) {
          return requirement;
        }
        const operation = requirement.guard.operation;
        const foreignAuthority = (
          authority: NonNullable<typeof operation.canonicalClaimTargetAuthority>
        ) => ({
          ...authority,
          targetResource: foreignTarget,
          authorityResource: foreignTarget,
          bindingTargetResource: foreignTarget,
          bindingAuthorityResource: foreignTarget,
          revisionChecks: keyedRevisionChecks([
            authority.bindingResource,
            operation.mutationResource,
            authority.bindingClaimHeadResource,
            foreignTarget
          ])
        });
        return {
          ...requirement,
          guard: {
            ...requirement.guard,
            operation: {
              ...operation,
              canonicalResolution: {
                state: "claimed" as const,
                targetResource: foreignTarget
              },
              aliasResolution: {
                state: "claimed" as const,
                targetResource: foreignTarget
              },
              canonicalClaimHeadTargetResource: foreignTarget,
              aliasClaimHeadTargetResource: foreignTarget,
              canonicalClaimTargetAuthority:
                operation.canonicalClaimTargetAuthority === null
                  ? null
                  : foreignAuthority(operation.canonicalClaimTargetAuthority),
              aliasClaimTargetAuthority:
                operation.aliasClaimTargetAuthority === null
                  ? null
                  : foreignAuthority(operation.aliasClaimTargetAuthority)
            }
          }
        };
      }
    );
    const crossTenant = makeInput(
      crossTenantRequirements,
      fixture.scenario.input.grants
    );
    const duplicateRequirementId = `${fixture.targetRequirementId}-alias`;
    const duplicateRequirement = employeeDirectoryRequirement(
      duplicateRequirementId,
      fixture.targetResource
    );
    const nonDeduplicatedBase = mutateMerge(
      fixture.scenario.input,
      (operation) => ({
        ...operation,
        aliasClaimTargetAuthority:
          operation.aliasClaimTargetAuthority === null
            ? null
            : {
                ...operation.aliasClaimTargetAuthority,
                targetRequirementId: duplicateRequirementId
              }
      })
    );
    const nonDeduplicated = makeInput(
      [...nonDeduplicatedBase.requirements, duplicateRequirement],
      nonDeduplicatedBase.grants
    );

    for (const denied of [
      missing,
      wrong,
      stale,
      crossTenant,
      nonDeduplicated
    ]) {
      expect(evaluateInboxV2AuthorizationPlan(denied).outcome).toBe("denied");
    }
  });

  it("requires the current Client access path for a claimed ClientContact merge target", () => {
    const fixture = claimedIdentityMergeScenario("client_contact");
    const closedPath = makeInput(
      fixture.scenario.input.requirements.map((requirement) =>
        requirement.id !== fixture.targetRequirementId ||
        requirement.guard.profileId !== "core:rbac.guard.client_context"
          ? requirement
          : {
              ...requirement,
              guard: closeClientAccessPath(requirement.guard)
            }
      ),
      fixture.scenario.input.grants
    );
    expect(evaluateInboxV2AuthorizationPlan(closedPath).outcome).toBe("denied");
  });

  it("binds claim permission, target kind and every versioned claim resource", () => {
    const employeeClaim = identityScenario(
      "core:identity.employee_claim.manage"
    );
    const clientContactClaim = identityScenario(
      "core:identity.client_contact_claim.manage"
    );
    const actorEmployeeResource = resource("core:employee", String(employeeId));
    const stale = (kind: "entity" | "policy" | "relation") => [
      { kind, expected: "1", actual: "2" }
    ];
    const deniedInputs: readonly InboxV2AuthorizationPlanInput[] = [
      retargetPrimaryIdentityOperation(
        employeeClaim,
        actorEmployeeResource,
        (operation) => operation
      ),
      retargetPrimaryIdentityOperation(
        employeeClaim,
        secondClientContactResource,
        (operation) =>
          operation.kind !== "employee_claim_manage"
            ? operation
            : {
                ...operation,
                newTargetResource: secondClientContactResource,
                evidenceTargetResource: secondClientContactResource,
                auditTargetResource: secondClientContactResource
              }
      ),
      retargetPrimaryIdentityOperation(
        clientContactClaim,
        otherEmployeeResource,
        (operation) =>
          operation.kind !== "client_contact_claim_manage"
            ? operation
            : {
                ...operation,
                newTargetResource: otherEmployeeResource,
                evidenceTargetResource: otherEmployeeResource,
                auditTargetResource: otherEmployeeResource
              }
      ),
      ...(
        [
          (operation: IdentityGuard["operation"]) =>
            operation.kind !== "employee_claim_manage"
              ? operation
              : {
                  ...operation,
                  sourceIdentityRevisionChecks: stale("entity")
                },
          (operation: IdentityGuard["operation"]) =>
            operation.kind !== "employee_claim_manage"
              ? operation
              : {
                  ...operation,
                  claimHeadSourceIdentityResource: aliasSourceIdentityResource
                },
          (operation: IdentityGuard["operation"]) =>
            operation.kind !== "employee_claim_manage"
              ? operation
              : {
                  ...operation,
                  claimPolicyRevisionChecks: stale("policy")
                },
          (operation: IdentityGuard["operation"]) =>
            operation.kind !== "employee_claim_manage"
              ? operation
              : { ...operation, evidenceRevisionChecks: stale("entity") },
          (operation: IdentityGuard["operation"]) =>
            operation.kind !== "employee_claim_manage"
              ? operation
              : { ...operation, targetRevisionChecks: stale("entity") },
          (operation: IdentityGuard["operation"]) =>
            operation.kind !== "employee_claim_manage"
              ? operation
              : { ...operation, claimRevisionChecks: stale("relation") },
          (operation: IdentityGuard["operation"]) =>
            operation.kind !== "employee_claim_manage"
              ? operation
              : { ...operation, auditRevisionChecks: stale("entity") }
        ] as const
      ).map((transform) =>
        replacePrimaryIdentityOperation(employeeClaim, transform)
      )
    ];

    for (const input of deniedInputs) {
      expect(evaluateInboxV2AuthorizationPlan(input).outcome).toBe("denied");
    }
  });

  it("enforces revoke, versioned merge compatibility and annotation-only observation review", () => {
    const revoke = identityScenario("core:identity.claim.revoke");
    const merge = identityScenario("core:identity.merge");
    const observation = identityScenario("core:identity.observation.review");
    const deniedInputs: readonly InboxV2AuthorizationPlanInput[] = [
      retargetPrimaryIdentityOperation(
        revoke,
        secondClientContactResource,
        (operation) => operation
      ),
      replacePrimaryIdentityOperation(merge, (operation) =>
        operation.kind !== "merge"
          ? operation
          : { ...operation, aliasRealmVersion: "2" }
      ),
      replacePrimaryIdentityOperation(merge, (operation) =>
        operation.kind !== "merge"
          ? operation
          : {
              ...operation,
              aliasScope: {
                kind: "source_account",
                ownerResource: resource(
                  "core:source-account",
                  "source_account:other"
                )
              }
            }
      ),
      replacePrimaryIdentityOperation(merge, (operation) =>
        operation.kind !== "merge"
          ? operation
          : { ...operation, conflictState: "active_claim_conflict" }
      ),
      replacePrimaryIdentityOperation(merge, (operation) =>
        operation.kind !== "merge"
          ? operation
          : { ...operation, createsAcyclicAlias: false }
      ),
      replacePrimaryIdentityOperation(merge, (operation) =>
        operation.kind !== "merge"
          ? operation
          : {
              ...operation,
              mutationResource: resource(
                "core:identity-mutation",
                "identity_mutation:substituted"
              )
            }
      ),
      replacePrimaryIdentityOperation(merge, (operation) =>
        operation.kind !== "merge"
          ? operation
          : {
              ...operation,
              bindingCanonicalIdentityResource: aliasSourceIdentityResource
            }
      ),
      replacePrimaryIdentityOperation(merge, (operation) =>
        operation.kind !== "merge"
          ? operation
          : {
              ...operation,
              mutationRevisionChecks: operation.mutationRevisionChecks.map(
                (check, index) =>
                  index === 0 ? { ...check, actual: "2" } : check
              )
            }
      ),
      replacePrimaryIdentityOperation(merge, (operation) =>
        operation.kind !== "merge"
          ? operation
          : {
              ...operation,
              resourceRevisionChecks: operation.resourceRevisionChecks.map(
                (check, index) =>
                  index === 0 ? { ...check, actual: "2" } : check
              )
            }
      ),
      replacePrimaryIdentityOperation(merge, (operation) =>
        operation.kind !== "merge"
          ? operation
          : {
              ...operation,
              aliasRealmScopeBinding: {
                ...operation.aliasRealmScopeBinding,
                bindingIdentityResource: sourceIdentityResource
              }
            }
      ),
      replacePrimaryIdentityOperation(merge, (operation) =>
        operation.kind !== "merge"
          ? operation
          : {
              ...operation,
              canonicalRealmScopeBinding: {
                ...operation.canonicalRealmScopeBinding,
                revisionChecks:
                  operation.canonicalRealmScopeBinding.revisionChecks.map(
                    (check, index) =>
                      index === 0 ? { ...check, actual: "2" } : check
                  )
              }
            }
      ),
      replacePrimaryIdentityOperation(merge, (operation) =>
        operation.kind !== "merge"
          ? operation
          : {
              ...operation,
              aliasRealmScopeBinding: {
                ...operation.aliasRealmScopeBinding,
                scopeResource: resource(
                  "core:source-account",
                  "source_account:substituted-scope"
                )
              }
            }
      ),
      replacePrimaryIdentityOperation(merge, (operation) => {
        if (operation.kind !== "merge") return operation;
        const substitutedRealmResource = resource(
          "core:identity-realm",
          "core:substituted-provider-realm-v1"
        );
        return {
          ...operation,
          canonicalRealmScopeBinding: {
            ...operation.canonicalRealmScopeBinding,
            realmResource: substitutedRealmResource,
            bindingRealmResource: substitutedRealmResource,
            revisionChecks: keyedRevisionChecks([
              operation.canonicalRealmScopeBinding.resource,
              operation.canonicalIdentityResource,
              substitutedRealmResource,
              operation.canonicalRealmScopeBinding.scopeResource
            ])
          },
          aliasRealmScopeBinding: {
            ...operation.aliasRealmScopeBinding,
            realmResource: substitutedRealmResource,
            bindingRealmResource: substitutedRealmResource,
            revisionChecks: keyedRevisionChecks([
              operation.aliasRealmScopeBinding.resource,
              operation.aliasIdentityResource,
              substitutedRealmResource,
              operation.aliasRealmScopeBinding.scopeResource
            ])
          }
        };
      }),
      replacePrimaryIdentityOperation(observation, (operation) =>
        operation.kind !== "observation_review"
          ? operation
          : {
              ...operation,
              observationSourceIdentityResource: aliasSourceIdentityResource
            }
      ),
      replacePrimaryIdentityOperation(observation, (operation) =>
        operation.kind !== "observation_review"
          ? operation
          : { ...operation, writeSet: ["adapter_evidence"] }
      ),
      replacePrimaryIdentityOperation(observation, (operation) =>
        operation.kind !== "observation_review"
          ? operation
          : {
              ...operation,
              annotationRevisionChecks: [
                { kind: "entity", expected: "1", actual: "2" }
              ]
            }
      )
    ];

    for (const input of deniedInputs) {
      expect(evaluateInboxV2AuthorizationPlan(input).outcome).toBe("denied");
    }
  });

  it("binds auto-resolve to exact approved policy, evidence, CAS, audit and keyed revisions", () => {
    const scenario = identityAutoResolveScenario();
    const stale = (kind: "entity" | "policy" | "relation") => [
      { kind, expected: "1", actual: "2" }
    ];
    const transforms: readonly ((
      operation: IdentityGuard["operation"]
    ) => IdentityGuard["operation"])[] = [
      (operation) =>
        operation.kind !== "auto_resolve"
          ? operation
          : { ...operation, policyState: "draft" },
      (operation) =>
        operation.kind !== "auto_resolve"
          ? operation
          : { ...operation, evidencePolicyVersion: "2" },
      (operation) =>
        operation.kind !== "auto_resolve"
          ? operation
          : {
              ...operation,
              sourceIdentityResolution: { state: "conflicting" }
            },
      (operation) =>
        operation.kind !== "auto_resolve"
          ? operation
          : {
              ...operation,
              sourceIdentityResolution: {
                state: "claimed",
                activeClaimTargetResource: clientContactResource
              },
              currentClaimTargetResource: clientContactResource,
              expectedClaimVersion: "1",
              currentClaimVersion: "1"
            },
      (operation) =>
        operation.kind !== "auto_resolve"
          ? operation
          : { ...operation, currentClaimVersion: "2" },
      (operation) =>
        operation.kind !== "auto_resolve"
          ? operation
          : {
              ...operation,
              auditClaimTargetResource: clientContactResource
            },
      (operation) =>
        operation.kind !== "auto_resolve"
          ? operation
          : { ...operation, reasonCodeId: "" },
      (operation) =>
        operation.kind !== "auto_resolve"
          ? operation
          : {
              ...operation,
              claimHeadSourceIdentityResource: aliasSourceIdentityResource
            },
      (operation) =>
        operation.kind !== "auto_resolve"
          ? operation
          : {
              ...operation,
              decisionSourceIdentityResource: aliasSourceIdentityResource
            },
      (operation) =>
        operation.kind !== "auto_resolve"
          ? operation
          : {
              ...operation,
              resolutionRelationResource: resource(
                "core:identity-resolution-binding",
                "identity_resolution_binding:substituted"
              )
            },
      (operation) =>
        operation.kind !== "auto_resolve"
          ? operation
          : {
              ...operation,
              resolutionResourceRevisionChecks:
                operation.resolutionResourceRevisionChecks.map(
                  (check, index) =>
                    index === 0 ? { ...check, actual: "2" } : check
                )
            },
      (operation) =>
        operation.kind !== "auto_resolve"
          ? operation
          : {
              ...operation,
              policyRuleManifest: {
                ...operation.policyRuleManifest,
                policyResource: resource(
                  "core:identity-claim-policy",
                  "identity_claim_policy:substituted-rule-policy"
                )
              }
            },
      (operation) =>
        operation.kind !== "auto_resolve"
          ? operation
          : {
              ...operation,
              policyRuleManifest: {
                ...operation.policyRuleManifest,
                revisionChecks: operation.policyRuleManifest.revisionChecks.map(
                  (check, index) =>
                    index === 0
                      ? check
                      : { ...check, expected: "2", actual: "2" }
                )
              }
            },
      (operation) =>
        operation.kind !== "auto_resolve"
          ? operation
          : {
              ...operation,
              policyRuleManifest: {
                ...operation.policyRuleManifest,
                evidenceRuleVersion: "2"
              }
            },
      (operation) =>
        operation.kind !== "auto_resolve"
          ? operation
          : {
              ...operation,
              policyRuleManifest: {
                ...operation.policyRuleManifest,
                revisionChecks: operation.policyRuleManifest.revisionChecks.map(
                  (check, index) =>
                    index === 0 ? { ...check, actual: "2" } : check
                )
              }
            },
      (operation) =>
        operation.kind !== "auto_resolve"
          ? operation
          : {
              ...operation,
              policyRuleManifest: {
                ...operation.policyRuleManifest,
                notAfter: NOW
              }
            },
      ...(
        [
          "resolutionRevisionChecks",
          "sourceIdentityRevisionChecks",
          "evidenceRevisionChecks",
          "targetRevisionChecks",
          "auditRevisionChecks"
        ] as const
      ).map(
        (field) =>
          (operation: IdentityGuard["operation"]): IdentityGuard["operation"] =>
            operation.kind !== "auto_resolve"
              ? operation
              : { ...operation, [field]: stale("entity") }
      ),
      (operation) =>
        operation.kind !== "auto_resolve"
          ? operation
          : { ...operation, policyRevisionChecks: stale("policy") },
      (operation) =>
        operation.kind !== "auto_resolve"
          ? operation
          : { ...operation, claimRevisionChecks: stale("relation") }
    ];

    for (const transform of transforms) {
      expect(
        evaluateInboxV2AuthorizationPlan(
          replacePrimaryIdentityOperation(scenario, transform)
        ).outcome
      ).toBe("denied");
    }
  });

  it("denies an employee identity operation relabeled as trusted-service auto-resolve evidence", () => {
    const scenario = identityAutoResolveScenario();
    const requirements = scenario.input.requirements.map((requirement) => {
      if (
        requirement.permissionId !== "core:identity.auto_resolve" ||
        requirement.guard.profileId !== "core:rbac.guard.identity_evidence"
      ) {
        return requirement;
      }
      return Object.freeze({
        ...requirement,
        guard: Object.freeze({
          ...requirement.guard,
          operation: Object.freeze({
            kind: "evidence_view" as const,
            actorEmployeeId: employeeId,
            evidenceResource: requirement.resource,
            revisionChecks: Object.freeze([
              { kind: "relation" as const, expected: "1", actual: "1" }
            ])
          })
        })
      });
    });
    const decision = evaluateInboxV2AuthorizationPlan({
      ...scenario.input,
      requirements
    });

    expect(decision).toMatchObject({
      outcome: "denied",
      publicErrorCode: "identity.evidence_required",
      diagnostics: { reason: "hard_boundary_denied" }
    });
  });

  it("allows trusted-service identity.auto_resolve with an exact registered operation", () => {
    const scenario = identityAutoResolveScenario();
    const decision = evaluateInboxV2AuthorizationPlan(scenario.input);

    expect(decision).toMatchObject({ outcome: "allowed" });
  });

  it("allows only idempotent auto-resolve of an existing claim to the exact same target", () => {
    const scenario = identityAutoResolveScenario();
    const decision = evaluateInboxV2AuthorizationPlan(
      replacePrimaryIdentityOperation(scenario, (operation) =>
        operation.kind !== "auto_resolve"
          ? operation
          : {
              ...operation,
              sourceIdentityResolution: {
                state: "claimed",
                activeClaimTargetResource: secondClientContactResource
              },
              currentClaimTargetResource: secondClientContactResource,
              expectedClaimVersion: "1",
              currentClaimVersion: "1"
            }
      )
    );

    expect(decision).toMatchObject({ outcome: "allowed" });
  });
});
