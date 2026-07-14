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

const NOW = "2026-07-12T10:00:00.000Z";
const GRANT_END = "2026-07-12T10:30:00.000Z";
const SESSION_END = "2026-07-12T11:00:00.000Z";
const DIGEST = `sha256:${"a".repeat(64)}`;

const tenantId = inboxV2TenantIdSchema.parse("tenant:privileged-hardening");
const actorEmployeeId = inboxV2EmployeeIdSchema.parse("employee:actor");
const targetEmployeeId = inboxV2EmployeeIdSchema.parse("employee:target");
const successorEmployeeId = inboxV2EmployeeIdSchema.parse("employee:successor");
const actor = inboxV2EmployeeReferenceSchema.parse({
  tenantId,
  kind: "employee",
  id: actorEmployeeId
});
const epoch = inboxV2AuthorizationEpochSchema.parse(
  "authorization:privileged-hardening"
);
const revision = inboxV2EntityRevisionSchema.parse("1");
const conversationId = inboxV2ConversationIdSchema.parse(
  "conversation:privileged-hardening"
);

const tenantResource = resource("core:tenant", String(tenantId));
const actorEmployeeResource = resource(
  "core:employee",
  String(actorEmployeeId)
);
const targetEmployeeResource = resource(
  "core:employee",
  String(targetEmployeeId)
);
const successorEmployeeResource = resource(
  "core:employee",
  String(successorEmployeeId)
);
const conversationResource = resource(
  "core:conversation",
  String(conversationId)
);

const canonicalGuard = Object.freeze({
  profileId: "core:rbac.guard.canonical_resource" as const,
  resourceState: "active" as const,
  contentBoundary: "none" as const,
  routeInputFields: Object.freeze([]),
  companionRequirementIds: Object.freeze([]),
  action: Object.freeze({ kind: "canonical" as const })
});

describe("Inbox V2 privileged mutation hardening", () => {
  it("binds admin CAS and audit evidence to the exact mutation target", () => {
    const eventResource = resource("core:audit-event", "audit:tenant-settings");
    const primary = makeRequirement({
      id: "tenant-settings",
      permissionId: "core:tenant.manage",
      resource: tenantResource,
      guard: {
        ...canonicalGuard,
        action: {
          kind: "tenant_settings_change",
          targetResource: tenantResource,
          targetRevisionChecks: keyedRevisionChecks([tenantResource]),
          reason: "rotate a tenant-owned setting",
          audit: privilegedAudit(
            "tenant_settings_change",
            tenantResource,
            eventResource
          )
        }
      }
    });
    const input = makeInput(
      [primary],
      [
        makeGrant(
          "core:tenant.manage",
          { type: "tenant", tenantId },
          "tenant-settings"
        )
      ]
    );

    expectAllowed(evaluateInboxV2AuthorizationPlan(input));

    const action = canonicalAction(primary, "tenant_settings_change");
    const substitutedTarget = resource("core:tenant", "tenant:substituted");
    for (const candidate of [
      {
        ...action,
        targetRevisionChecks: keyedRevisionChecks([substitutedTarget])
      },
      {
        ...action,
        audit: {
          ...action.audit,
          bindingTargetResource: substitutedTarget
        }
      },
      {
        ...action,
        audit: {
          ...action.audit,
          revisionChecks: action.audit.revisionChecks.map((check, index) =>
            index === 0 ? { ...check, actual: "2" } : check
          )
        }
      }
    ]) {
      expect(
        decideCanonicalMutation(input, primary.id, candidate).outcome
      ).toBe("denied");
    }
  });

  it("finalizes Employee deactivation only from exact zero-set and handler manifests", () => {
    const action = employeeDeactivationAction();
    const primary = makeRequirement({
      id: "employee-deactivate",
      permissionId: "core:employee.deactivate",
      resource: targetEmployeeResource,
      guard: { ...canonicalGuard, action }
    });
    const input = makeInput(
      [primary],
      [
        makeGrant(
          "core:employee.deactivate",
          { type: "tenant", tenantId },
          "employee-deactivate"
        )
      ]
    );
    expectAllowed(evaluateInboxV2AuthorizationPlan(input));

    const workflow = action.deactivationWorkflow!;
    const substitutedSet = resource(
      "core:employee-active-relation-set-manifest",
      "active-relation-set:substituted"
    );
    const reducedHandlerResources =
      workflow.handlerSet.requiredHandlerResources.slice(0, 1);
    for (const candidate of [
      {
        ...action,
        deactivationWorkflow: {
          ...workflow,
          relationSets: workflow.relationSets.map((set, index) =>
            index === 0 ? { ...set, activeCount: 1 } : set
          )
        }
      },
      {
        ...action,
        deactivationWorkflow: {
          ...workflow,
          handlerSet: {
            ...workflow.handlerSet,
            completedHandlerResources:
              workflow.handlerSet.completedHandlerResources.slice(1)
          }
        }
      },
      {
        ...action,
        deactivationWorkflow: {
          ...workflow,
          handlerSet: {
            ...workflow.handlerSet,
            registryManifest: {
              ...workflow.handlerSet.registryManifest,
              registeredMandatoryHandlerResources: reducedHandlerResources,
              revisionChecks: keyedRevisionChecks([
                workflow.handlerSet.registryManifest.resource,
                tenantResource,
                ...reducedHandlerResources
              ])
            },
            requiredHandlerResources: reducedHandlerResources,
            completedHandlerResources: reducedHandlerResources,
            revisionChecks: keyedRevisionChecks([
              workflow.handlerSet.resource,
              workflow.resource,
              targetEmployeeResource,
              workflow.handlerSet.registrySelection.resource,
              workflow.handlerSet.registryManifest.resource,
              ...reducedHandlerResources
            ])
          }
        }
      },
      {
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
              targetEmployeeResource,
              workflow.handlerSet.registryManifest.resource,
              workflow.handlerSet.requiredHandlerResources[0]!
            ])
          }
        }
      },
      {
        ...action,
        deactivationWorkflow: {
          ...workflow,
          handlerSet: {
            ...workflow.handlerSet,
            registryManifest: {
              ...workflow.handlerSet.registryManifest,
              resource: resource(
                "core:employee-deactivation-handler-registry-manifest",
                "employee_deactivation_handler_registry:v2"
              )
            }
          }
        }
      },
      {
        ...action,
        deactivationWorkflow: {
          ...workflow,
          handlerSet: {
            ...workflow.handlerSet,
            registryManifest: {
              ...workflow.handlerSet.registryManifest,
              revisionChecks:
                workflow.handlerSet.registryManifest.revisionChecks.map(
                  (check, index) =>
                    index ===
                    workflow.handlerSet.registryManifest.revisionChecks.length -
                      1
                      ? { ...check, expected: "2", actual: "2" }
                      : check
                )
            }
          }
        }
      },
      {
        ...action,
        deactivationWorkflow: {
          ...workflow,
          handlerSet: {
            ...workflow.handlerSet,
            registryManifest: {
              ...workflow.handlerSet.registryManifest,
              revisionChecks:
                workflow.handlerSet.registryManifest.revisionChecks.map(
                  (check, index) =>
                    index === 0 ? { ...check, actual: "2" } : check
                )
            }
          }
        }
      },
      {
        ...action,
        deactivationWorkflow: {
          ...workflow,
          relationSets: workflow.relationSets.map((set, index) =>
            index === 0
              ? {
                  ...set,
                  resource: substitutedSet,
                  revisionChecks: keyedRevisionChecks([
                    substitutedSet,
                    workflow.zeroRelationsProofResource,
                    targetEmployeeResource
                  ])
                }
              : set
          )
        }
      },
      {
        ...action,
        deactivationWorkflow: {
          ...workflow,
          relationSets: workflow.relationSets.map((set, index) =>
            index === 0 ? { ...set, currentHighWater: "2" } : set
          )
        }
      }
    ]) {
      expect(
        decideCanonicalMutation(input, primary.id, candidate).outcome
      ).toBe("denied");
    }
  });

  it("rejects a coordinated attacker-prefixed deactivation registry shrink", () => {
    const action = employeeDeactivationAction();
    const primary = makeRequirement({
      id: "employee-deactivate-coordinated-shrink",
      permissionId: "core:employee.deactivate",
      resource: targetEmployeeResource,
      guard: { ...canonicalGuard, action }
    });
    const input = makeInput(
      [primary],
      [
        makeGrant(
          "core:employee.deactivate",
          { type: "tenant", tenantId },
          "employee-deactivate-coordinated-shrink"
        )
      ]
    );
    const workflow = action.deactivationWorkflow!;
    const reducedHandlerResources =
      workflow.handlerSet.requiredHandlerResources.slice(0, 1);
    const attackerRegistryVersion = "employee_deactivation_handler_registry:v2";
    const attackerRegistryResource = resource(
      "core:employee-deactivation-handler-registry-manifest",
      attackerRegistryVersion
    );
    const attackerRegistrySelectionResource = resource(
      "core:employee-deactivation-handler-registry-selection",
      `attacker:${String(tenantId)}`
    );
    const attackerRegistryDigest = `sha256:${"e".repeat(64)}`;
    const coordinatedShrink = {
      ...action,
      deactivationWorkflow: {
        ...workflow,
        handlerSet: {
          ...workflow.handlerSet,
          registrySelection: {
            ...workflow.handlerSet.registrySelection,
            resource: attackerRegistrySelectionResource,
            selectedRegistryResource: attackerRegistryResource,
            selectedVersion: attackerRegistryVersion,
            selectedDigest: attackerRegistryDigest,
            mandatoryHandlerResources: reducedHandlerResources,
            revisionChecks: keyedRevisionChecks([
              attackerRegistrySelectionResource,
              tenantResource,
              attackerRegistryResource,
              ...reducedHandlerResources
            ])
          },
          registryManifest: {
            ...workflow.handlerSet.registryManifest,
            resource: attackerRegistryResource,
            version: attackerRegistryVersion,
            digest: attackerRegistryDigest,
            registeredMandatoryHandlerResources: reducedHandlerResources,
            revisionChecks: keyedRevisionChecks([
              attackerRegistryResource,
              tenantResource,
              ...reducedHandlerResources
            ])
          },
          requiredHandlerResources: reducedHandlerResources,
          completedHandlerResources: reducedHandlerResources,
          revisionChecks: keyedRevisionChecks([
            workflow.handlerSet.resource,
            workflow.resource,
            targetEmployeeResource,
            attackerRegistrySelectionResource,
            attackerRegistryResource,
            ...reducedHandlerResources
          ])
        },
        revisionChecks: keyedRevisionChecks([
          workflow.zeroRelationsProofResource,
          workflow.resource,
          targetEmployeeResource,
          workflow.handlerSet.resource,
          attackerRegistrySelectionResource,
          attackerRegistryResource,
          ...workflow.relationSets.map(({ resource }) => resource)
        ])
      }
    };

    expect(
      decideCanonicalMutation(input, primary.id, coordinatedShrink).outcome,
      "an attacker-prefixed Tenant selector must not authorize a coordinated mandatory-handler registry shrink"
    ).toBe("denied");
  });

  it("binds delegation effect and revisions to the exact direct grant", () => {
    const directGrantResource = resource("core:direct-grant", "grant:exact");
    const effectResource = resource("core:delegation-effect", "effect:exact");
    const subjectDirectory = canonicalRequirement(
      "subject-directory",
      "core:employee.directory.view",
      targetEmployeeResource
    );
    const delegatedRead = externalConversationReadRequirement("delegated-read");
    const action = {
      kind: "delegation_change" as const,
      targetResource: directGrantResource,
      operation: "direct_grant" as const,
      actorEmployeeId,
      subjectEmployeeId: targetEmployeeId,
      subjectEmployeeResource: targetEmployeeResource,
      subjectDirectoryRequirementId: subjectDirectory.id,
      delegatedAuthorities: [
        {
          requirementId: delegatedRead.id,
          permissionId: "core:conversation.read" as const,
          requestedScope: { type: "tenant" as const, tenantId }
        }
      ],
      bindingScope: { type: "tenant" as const, tenantId },
      bindingScopeResource: tenantResource,
      bindingRelationResource: effectResource,
      relationBindingResource: directGrantResource,
      relationSubjectEmployeeResource: targetEmployeeResource,
      relationScopeResource: tenantResource,
      bindingRevisionChecks: keyedRevisionChecks([
        directGrantResource,
        effectResource,
        targetEmployeeResource,
        tenantResource
      ]),
      reason: "delegate exact bounded conversation read",
      validUntil: GRANT_END,
      audit: privilegedAudit(
        "direct_grant",
        directGrantResource,
        resource("core:audit-event", "audit:direct-grant")
      ),
      roleDefinition: null
    };
    const primary = makeRequirement({
      id: "direct-grant",
      permissionId: "core:direct_grants.manage",
      resource: directGrantResource,
      guard: { ...canonicalGuard, action }
    });
    const input = makeInput(
      [primary, subjectDirectory, delegatedRead],
      [
        makeGrant(
          "core:direct_grants.manage",
          { type: "tenant", tenantId },
          "direct-grant"
        ),
        makeGrant(
          "core:employee.directory.view",
          { type: "tenant", tenantId },
          "subject-directory"
        ),
        makeGrant(
          "core:conversation.read",
          { type: "tenant", tenantId },
          "delegated-read"
        )
      ]
    );
    expectAllowed(evaluateInboxV2AuthorizationPlan(input));

    const substitutedGrant = resource("core:direct-grant", "grant:substituted");
    for (const candidate of [
      { ...action, relationBindingResource: substitutedGrant },
      {
        ...action,
        bindingRevisionChecks: keyedRevisionChecks([
          substitutedGrant,
          effectResource,
          targetEmployeeResource,
          tenantResource
        ])
      }
    ]) {
      expect(
        decideCanonicalMutation(input, primary.id, candidate).outcome
      ).toBe("denied");
    }
  });

  it("requires a typed exact audit binding for break-glass read", () => {
    const eventResource = resource("core:audit-event", "audit:break-glass");
    const guard: Extract<
      InboxV2PolicyGuardEvidence,
      { profileId: "core:rbac.guard.internal_break_glass_read" }
    > = {
      profileId: "core:rbac.guard.internal_break_glass_read",
      conversationId,
      exactGrantConversationId: conversationId,
      grantKind: "direct_grant",
      reason: "bounded incident investigation",
      auditEventId: String(eventResource.entityId),
      audit: privilegedAudit(
        "internal_break_glass_read",
        conversationResource,
        eventResource
      ),
      accessMode: "read_only",
      validUntil: GRANT_END
    };
    const primary = makeRequirement({
      id: "break-glass",
      permissionId: "core:conversation.internal.break_glass_read",
      resource: conversationResource,
      scopeFacts: [
        {
          kind: "conversation",
          ...scopePath(conversationResource, conversationResource),
          conversationId,
          validUntil: GRANT_END
        }
      ],
      guard
    });
    const input = makeInput(
      [primary],
      [
        makeGrant(
          "core:conversation.internal.break_glass_read",
          { type: "conversation", tenantId, id: conversationId },
          "break-glass"
        )
      ]
    );
    expectAllowed(evaluateInboxV2AuthorizationPlan(input));

    for (const candidate of [
      { ...guard, auditEventId: "" },
      {
        ...guard,
        audit: {
          ...guard.audit,
          bindingTargetResource: resource(
            "core:conversation",
            "conversation:substituted"
          )
        }
      },
      {
        ...guard,
        audit: {
          ...guard.audit,
          revisionChecks: guard.audit.revisionChecks.map((check, index) =>
            index === 0 ? { ...check, actual: "2" } : check
          )
        }
      }
    ]) {
      expect(decideGuard(input, primary.id, candidate).outcome).toBe("denied");
    }
  });

  it("removes the last owner only with an exact atomic successor and owner set", () => {
    const targetMembershipResource = resource(
      "core:internal-membership",
      "membership:departing-owner"
    );
    const successorMembershipResource = resource(
      "core:internal-membership",
      "membership:successor"
    );
    const topologyResource = resource(
      "core:internal-conversation-topology",
      "topology:internal"
    );
    const ownerSetResource = resource(
      "core:internal-owner-set-manifest",
      "owner-set:transition"
    );
    const targetDirectory = canonicalRequirement(
      "target-directory",
      "core:employee.directory.view",
      targetEmployeeResource
    );
    const successorRead = independentSuccessorReadRequirement("successor-read");
    const action = {
      operation: "remove" as const,
      targetEmployeeId,
      targetEmployeeResource,
      targetDirectoryRequirementId: targetDirectory.id,
      targetLifecycle: "active" as const,
      oldRole: "owner" as const,
      newRole: null,
      membershipRelationResource: targetMembershipResource,
      relationConversationResource: conversationResource,
      relationEmployeeResource: targetEmployeeResource,
      topologyResource,
      topologyConversationResource: conversationResource,
      successorOwnerRequirementId: successorRead.id,
      successorOwner: {
        employeeId: successorEmployeeId,
        employeeResource: successorEmployeeResource,
        membershipRelationResource: successorMembershipResource,
        relationConversationResource: conversationResource,
        relationEmployeeResource: successorEmployeeResource,
        lifecycle: "active" as const,
        currentRole: "member" as const,
        newRole: "owner" as const
      },
      ownerSet: {
        resource: ownerSetResource,
        conversationResource,
        beforeOwnerMembershipResources: [targetMembershipResource],
        afterOwnerMembershipResources: [successorMembershipResource]
      },
      mutationRevisionChecks: keyedRevisionChecks([
        conversationResource,
        targetMembershipResource,
        targetEmployeeResource,
        topologyResource,
        ownerSetResource,
        successorMembershipResource,
        successorEmployeeResource
      ]),
      reason: "replace the only owner atomically",
      audit: privilegedAudit(
        "internal_membership_remove",
        targetMembershipResource,
        resource("core:audit-event", "audit:last-owner")
      )
    };
    const primary = makeRequirement({
      id: "last-owner",
      permissionId: "core:conversation.internal.members.manage",
      resource: conversationResource,
      scopeFacts: [internalParticipantFact(actorEmployeeId, "owner")],
      guard: {
        profileId: "core:rbac.guard.internal_membership",
        conversationId,
        employeeId: actorEmployeeId,
        membershipState: "active",
        membershipOrigin: "hulee_internal_command",
        membershipRole: "owner",
        contentBoundary: "internal",
        validUntil: GRANT_END,
        membershipChange: action
      }
    });
    const input = makeInput(
      [primary, targetDirectory, successorRead],
      [
        makeGrant(
          "core:conversation.internal.members.manage",
          { type: "internal_participant", tenantId },
          "last-owner"
        ),
        makeGrant(
          "core:employee.directory.view",
          { type: "tenant", tenantId },
          "target-directory"
        ),
        makeGrant(
          "core:conversation.internal.read",
          { type: "internal_participant", tenantId },
          "successor-read",
          successorEmployeeId
        )
      ]
    );
    expectAllowed(evaluateInboxV2AuthorizationPlan(input));

    for (const candidate of [
      {
        ...action,
        successorOwnerRequirementId: null,
        successorOwner: null
      },
      {
        ...action,
        ownerSet: {
          ...action.ownerSet,
          afterOwnerMembershipResources: [
            resource("core:internal-membership", "membership:substituted")
          ]
        }
      },
      {
        ...action,
        mutationRevisionChecks: action.mutationRevisionChecks.map(
          (check, index) => (index === 0 ? { ...check, actual: "2" } : check)
        )
      }
    ]) {
      expect(
        decideInternalMembership(input, primary.id, candidate).outcome
      ).toBe("denied");
    }
  });
});

function employeeDeactivationAction() {
  const workflowResource = resource(
    "core:employee-deactivation-workflow",
    "deactivation-workflow:target"
  );
  const fenceResource = resource(
    "core:employee-active-relation-fence",
    "deactivation-fence:target"
  );
  const handlerSetResource = resource(
    "core:employee-deactivation-handler-set-manifest",
    "handler-set:target"
  );
  const handlerRegistryVersion = "employee_deactivation_handler_registry:v1";
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
      resource("core:employee-deactivation-handler-checkpoint", `handler:${id}`)
  );
  const setResources = ["work", "client-owner", "internal-owner"].map((id) =>
    resource("core:employee-active-relation-set-manifest", `set:${id}`)
  );
  const relationSets = (
    ["primary_work", "client_owner", "internal_owner"] as const
  ).map((kind, index) => ({
    kind,
    resource: setResources[index]!,
    fenceResource,
    employeeResource: targetEmployeeResource,
    activeCount: 0,
    expectedHighWater: "1",
    currentHighWater: "1",
    revisionChecks: keyedRevisionChecks([
      setResources[index]!,
      fenceResource,
      targetEmployeeResource
    ])
  }));
  return {
    kind: "employee_record_change" as const,
    operation: "deactivate" as const,
    targetResource: targetEmployeeResource,
    targetEmployeeResource,
    lifecycleBefore: "draining" as const,
    lifecycleAfter: "inactive" as const,
    targetRevisionChecks: keyedRevisionChecks([targetEmployeeResource]),
    reason: "finish a fenced deactivation",
    audit: privilegedAudit(
      "employee_deactivate",
      targetEmployeeResource,
      resource("core:audit-event", "audit:employee-deactivate")
    ),
    deactivationWorkflow: {
      resource: workflowResource,
      employeeResource: targetEmployeeResource,
      phase: "finalize_inactive" as const,
      handlerSet: {
        resource: handlerSetResource,
        workflowResource,
        employeeResource: targetEmployeeResource,
        registrySelection: {
          resource: handlerRegistrySelectionResource,
          tenantResource,
          selectedRegistryResource: handlerRegistryResource,
          selectedVersion: handlerRegistryVersion,
          selectedDigest: handlerRegistryDigest,
          state: "active" as const,
          mandatoryHandlerResources: handlerResources,
          revisionChecks: keyedRevisionChecks([
            handlerRegistrySelectionResource,
            tenantResource,
            handlerRegistryResource,
            ...handlerResources
          ])
        },
        registryManifest: {
          resource: handlerRegistryResource,
          tenantResource,
          version: handlerRegistryVersion,
          digest: handlerRegistryDigest,
          registeredMandatoryHandlerResources: handlerResources,
          revisionChecks: keyedRevisionChecks([
            handlerRegistryResource,
            tenantResource,
            ...handlerResources
          ])
        },
        requiredHandlerResources: handlerResources,
        completedHandlerResources: handlerResources,
        revisionChecks: keyedRevisionChecks([
          handlerSetResource,
          workflowResource,
          targetEmployeeResource,
          handlerRegistrySelectionResource,
          handlerRegistryResource,
          ...handlerResources
        ])
      },
      zeroRelationsProofResource: fenceResource,
      proofWorkflowResource: workflowResource,
      proofEmployeeResource: targetEmployeeResource,
      relationSets,
      revisionChecks: keyedRevisionChecks([
        fenceResource,
        workflowResource,
        targetEmployeeResource,
        handlerSetResource,
        handlerRegistrySelectionResource,
        handlerRegistryResource,
        ...setResources
      ])
    }
  } as const;
}

function privilegedAudit(
  action:
    | "tenant_settings_change"
    | "employee_deactivate"
    | "direct_grant"
    | "internal_break_glass_read"
    | "internal_membership_remove",
  targetResource: InboxV2EntityKey,
  eventResource: InboxV2EntityKey
) {
  const bindingResource = resource(
    "core:audit-event-binding",
    `audit-binding:${String(eventResource.entityId)}`
  );
  return {
    eventResource,
    bindingResource,
    bindingEventResource: eventResource,
    bindingTargetResource: targetResource,
    bindingActorEmployeeResource: actorEmployeeResource,
    action,
    revisionChecks: keyedRevisionChecks([
      eventResource,
      bindingResource,
      targetResource,
      actorEmployeeResource
    ])
  } as const;
}

function resource(entityTypeId: string, entityId: string): InboxV2EntityKey {
  return inboxV2EntityKeySchema.parse({ tenantId, entityTypeId, entityId });
}

function keyedRevisionChecks(resources: readonly InboxV2EntityKey[]) {
  const unique = new Map<string, InboxV2EntityKey>();
  for (const candidate of resources) {
    unique.set(
      `${candidate.tenantId}\u0000${candidate.entityTypeId}\u0000${candidate.entityId}`,
      candidate
    );
  }
  return [...unique.values()].map((candidate) => ({
    resource: candidate,
    expected: "1",
    actual: "1"
  }));
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
      loaderDecisionId: "privileged-hardening-loader",
      projectionRevision: revision,
      observedAt: NOW
    }
  };
}

function internalParticipantFact(
  employeeId: InboxV2EmployeeId,
  role: "owner" | "admin" | "member" | "observer"
): InboxV2CanonicalScopeFact {
  return {
    kind: "internal_participant",
    ...scopePath(conversationResource, conversationResource),
    employeeId,
    conversationId,
    origin: "hulee_internal_command",
    state: "active",
    role,
    membershipRevision: revision,
    currentMembershipRevision: revision,
    validUntil: GRANT_END
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

function canonicalRequirement(
  id: string,
  permissionId: InboxV2PermissionId,
  targetResource: InboxV2EntityKey
) {
  return makeRequirement({
    id,
    permissionId,
    resource: targetResource,
    guard: canonicalGuard,
    visibility: "secondary_hidden"
  });
}

function externalConversationReadRequirement(id: string) {
  const topologyResource = resource(
    "core:conversation-topology",
    "topology:external"
  );
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
        topologyResource,
        topologyConversationResource: conversationResource,
        topologyConversationKind: "external_work",
        topologyRevisionChecks: [{ kind: "state", expected: "1", actual: "1" }]
      }
    },
    visibility: "secondary_hidden"
  });
}

function independentSuccessorReadRequirement(id: string) {
  const base = makeRequirement({
    id,
    permissionId: "core:conversation.internal.read",
    resource: conversationResource,
    scopeFacts: [internalParticipantFact(successorEmployeeId, "member")],
    guard: {
      profileId: "core:rbac.guard.internal_membership",
      conversationId,
      employeeId: successorEmployeeId,
      membershipState: "active",
      membershipOrigin: "hulee_internal_command",
      membershipRole: "member",
      contentBoundary: "internal",
      validUntil: GRANT_END
    },
    visibility: "secondary_hidden"
  });
  const successor = inboxV2EmployeeReferenceSchema.parse({
    tenantId,
    kind: "employee",
    id: successorEmployeeId
  });
  const dependencies = makeDependencies([base]);
  const authorization = inboxV2AuthorizationEpochSnapshotSchema.parse({
    tenantId,
    employee: successor,
    value: epoch,
    dependencies,
    evaluatedAt: NOW,
    notAfter: SESSION_END,
    nextAuthorizationBoundary: SESSION_END
  });
  return Object.freeze({
    ...base,
    authorizationSubject: {
      kind: "independent_employee" as const,
      employee: successor,
      lifecycle: "active" as const,
      authorization,
      currentAuthorization: {
        tenantId,
        principal: {
          kind: "employee" as const,
          employeeId: successorEmployeeId
        },
        authorizationEpoch: epoch,
        dependencies
      },
      notAfter: SESSION_END
    }
  });
}

type EmployeeGrant = Extract<
  InboxV2PolicyGrant,
  { principal: { kind: "employee" } }
>;

function makeGrant(
  permissionId: InboxV2PermissionId,
  scope: InboxV2PermissionScope,
  id: string,
  principalEmployeeId: InboxV2EmployeeId = actorEmployeeId
): EmployeeGrant {
  return Object.freeze({
    id,
    tenantId,
    principal: { kind: "employee" as const, employeeId: principalEmployeeId },
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
    resourceDependencies: [...unique.entries()]
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
    employee: actor,
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
      employee: actor,
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
        employeeId: actorEmployeeId
      }),
      authorizationEpoch: epoch,
      dependencies
    }),
    grants: Object.freeze([...grants]),
    requirements: Object.freeze([...requirements])
  });
}

function canonicalAction<
  Kind extends Extract<
    InboxV2PolicyGuardEvidence,
    { profileId: "core:rbac.guard.canonical_resource" }
  >["action"]["kind"]
>(requirement: InboxV2AuthorizationRequirement, kind: Kind) {
  if (
    requirement.guard.profileId !== "core:rbac.guard.canonical_resource" ||
    requirement.guard.action.kind !== kind
  ) {
    throw new Error(`expected canonical action ${kind}`);
  }
  return requirement.guard.action as Extract<
    typeof requirement.guard.action,
    { kind: Kind }
  >;
}

function decideCanonicalMutation(
  input: InboxV2AuthorizationPlanInput,
  requirementId: string,
  action: Extract<
    InboxV2PolicyGuardEvidence,
    { profileId: "core:rbac.guard.canonical_resource" }
  >["action"]
) {
  return evaluateInboxV2AuthorizationPlan({
    ...input,
    requirements: input.requirements.map((requirement) =>
      requirement.id === requirementId &&
      requirement.guard.profileId === "core:rbac.guard.canonical_resource"
        ? {
            ...requirement,
            guard: { ...requirement.guard, action }
          }
        : requirement
    )
  });
}

function decideGuard(
  input: InboxV2AuthorizationPlanInput,
  requirementId: string,
  guard: InboxV2PolicyGuardEvidence
) {
  return evaluateInboxV2AuthorizationPlan({
    ...input,
    requirements: input.requirements.map((requirement) =>
      requirement.id === requirementId ? { ...requirement, guard } : requirement
    )
  });
}

function decideInternalMembership(
  input: InboxV2AuthorizationPlanInput,
  requirementId: string,
  membershipChange: NonNullable<
    Extract<
      InboxV2PolicyGuardEvidence,
      { profileId: "core:rbac.guard.internal_membership" }
    >["membershipChange"]
  >
) {
  return evaluateInboxV2AuthorizationPlan({
    ...input,
    requirements: input.requirements.map((requirement) =>
      requirement.id === requirementId &&
      requirement.guard.profileId === "core:rbac.guard.internal_membership"
        ? {
            ...requirement,
            guard: { ...requirement.guard, membershipChange }
          }
        : requirement
    )
  });
}

function expectAllowed(
  decision: ReturnType<typeof evaluateInboxV2AuthorizationPlan>
): void {
  if (decision.outcome === "denied") {
    throw new Error(JSON.stringify(decision));
  }
  expect(decision.outcome).toBe("allowed");
}
