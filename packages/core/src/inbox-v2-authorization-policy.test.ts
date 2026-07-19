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
  inboxV2SourceAccountIdSchema,
  inboxV2TeamIdSchema,
  inboxV2TenantIdSchema,
  inboxV2TrustedServiceIdSchema,
  inboxV2WorkItemIdSchema,
  inboxV2WorkQueueIdSchema,
  type InboxV2AuthorizationDependencyVector,
  type InboxV2EntityKey
} from "@hulee/contracts";
import { describe, expect, it } from "vitest";

import {
  deriveInboxV2Capabilities,
  evaluateInboxV2AuthorizationPlan,
  inboxV2PermissionCatalog,
  toInboxV2PublicAuthorizationDecision,
  type InboxV2AuthorizationPlanInput,
  type InboxV2AuthorizationRequirement,
  type InboxV2CanonicalScopeFact,
  type InboxV2PermissionId,
  type InboxV2PermissionScope,
  type InboxV2PolicyGrant,
  type InboxV2PolicyGuardEvidence,
  type InboxV2PolicyPrincipal
} from "./index";
import {
  activeConversationLinkPathEvidence,
  clientOwnerPathEvidence,
  exactClientBindingPathEvidence
} from "./inbox-v2-authorization-policy.client-path.test-support";

const NOW = "2026-07-12T10:00:00.000Z";
const GRANT_END = "2026-07-12T10:30:00.000Z";
const SESSION_END = "2026-07-12T11:00:00.000Z";
const LATER = "2026-07-12T12:00:00.000Z";
const DIGEST = `sha256:${"a".repeat(64)}`;

const tenantId = inboxV2TenantIdSchema.parse("tenant:tenant-1");
const otherTenantId = inboxV2TenantIdSchema.parse("tenant:tenant-2");
const employeeId = inboxV2EmployeeIdSchema.parse("employee:employee-1");
const otherEmployeeId = inboxV2EmployeeIdSchema.parse("employee:employee-2");
const thirdEmployeeId = inboxV2EmployeeIdSchema.parse("employee:employee-3");
const employee = inboxV2EmployeeReferenceSchema.parse({
  tenantId,
  kind: "employee",
  id: employeeId
});
const conversationId = inboxV2ConversationIdSchema.parse(
  "conversation:conversation-1"
);
const hiddenConversationId = inboxV2ConversationIdSchema.parse(
  "conversation:conversation-hidden"
);
const clientId = inboxV2ClientIdSchema.parse("client:client-1");
const secondClientId = inboxV2ClientIdSchema.parse("client:client-2");
const workItemId = inboxV2WorkItemIdSchema.parse("work_item:work-1");
const sourceAccountId = inboxV2SourceAccountIdSchema.parse(
  "source_account:source-1"
);
const otherSourceAccountId = inboxV2SourceAccountIdSchema.parse(
  "source_account:source-2"
);
const orgUnitId = inboxV2OrgUnitIdSchema.parse("org_unit:org-1");
const parentOrgUnitId = inboxV2OrgUnitIdSchema.parse("org_unit:org-parent");
const teamId = inboxV2TeamIdSchema.parse("team:team-1");
const queueId = inboxV2WorkQueueIdSchema.parse("work_queue:queue-1");
const revision = inboxV2EntityRevisionSchema.parse("1");
const epoch = inboxV2AuthorizationEpochSchema.parse("authorization:epoch-0001");

const conversationResource = resource(
  "core:conversation",
  String(conversationId)
);
const hiddenConversationResource = resource(
  "core:conversation",
  String(hiddenConversationId)
);
const clientResource = resource("core:client", String(clientId));
const secondClientResource = resource("core:client", String(secondClientId));
const fileResource = resource("core:file", "file:file-1");
const workItemResource = resource("core:work-item", String(workItemId));
const employeeResource = resource("core:employee", String(employeeId));
const otherEmployeeResource = resource(
  "core:employee",
  String(otherEmployeeId)
);
const thirdEmployeeResource = resource(
  "core:employee",
  String(thirdEmployeeId)
);
const otherNotificationEndpointResource = resource(
  "core:notification-endpoint",
  "notification_endpoint:endpoint-2"
);
const sourceAccountResource = resource(
  "core:source-account",
  String(sourceAccountId)
);
const otherSourceAccountResource = resource(
  "core:source-account",
  String(otherSourceAccountId)
);
const sourceThreadBindingResource = resource(
  "core:source-thread-binding",
  "source_thread_binding:binding-1"
);
const secondSourceThreadBindingResource = resource(
  "core:source-thread-binding",
  "source_thread_binding:binding-2"
);
const externalThreadResource = resource(
  "core:external-thread",
  "external_thread:thread-1"
);
const secondExternalThreadResource = resource(
  "core:external-thread",
  "external_thread:thread-2"
);
const externalMessageReferenceResource = resource(
  "core:external-message-reference",
  "external_message_reference:reference-1"
);
const timelineItemResource = resource(
  "core:timeline-item",
  "timeline_item:message-1"
);
const conversationTopologyResource = resource(
  "core:conversation-topology",
  "conversation_topology:conversation-1"
);
const timelineItemTopologyResource = resource(
  "core:timeline-content-topology",
  "timeline_content_topology:message-1"
);
const timelineItemAuthorshipResource = resource(
  "core:message-authorship",
  "message_authorship:message-1"
);
const providerCapabilityManifestResource = resource(
  "core:provider-capability-manifest",
  "provider_capability_manifest:source-1"
);
const sourceOccurrenceResource = resource(
  "core:source-occurrence",
  "source_occurrence:occurrence-1"
);
const sourceExternalIdentityResource = resource(
  "core:source-external-identity",
  "source_external_identity:identity-1"
);
const identityClaimPolicyResource = resource(
  "core:identity-claim-policy",
  "identity_claim_policy:manual-1"
);
const identityEvidenceResource = resource(
  "core:identity-evidence",
  "identity_evidence:manual-1"
);
const sourceItemResource = resource("core:source-item", "source_item:item-1");
const sourceReplyDescriptorResource = resource(
  "core:source-reply-descriptor",
  "source_reply_descriptor:descriptor-1"
);
const sourceRoutePolicyResource = resource(
  "core:source-route-policy",
  "source_route_policy:policy-1"
);
const outboundDispatchResource = resource(
  "core:outbound-dispatch",
  "outbound_dispatch:dispatch-1"
);
const originalOutboundRouteResource = resource(
  "core:outbound-route",
  "outbound_route:route-1"
);
const newOutboundRouteResource = resource(
  "core:outbound-route",
  "outbound_route:route-2"
);
const callResource = resource("core:call", "call:call-1");
const orgUnitResource = resource("core:org-unit", String(orgUnitId));
const teamResource = resource("core:team", String(teamId));
const queueResource = resource("core:work-queue", String(queueId));
const privacyDeletionResource = resource(
  "core:privacy-deletion-plan",
  "privacy_deletion_plan:plan-1"
);
const privacyDeleteHandlerResource = resource(
  "core:privacy-delete-handler",
  "privacy_delete_handler:handler-1"
);
const privacyDeletionManifestResource = resource(
  "core:privacy-scope-manifest",
  "privacy_scope_manifest:plan-1"
);
const privacyDeletionRootRelationResource = resource(
  "core:privacy-deletion-plan-root",
  "privacy_deletion_plan_root:plan-1-conversation-1"
);
const privacyDeletionHandlerRelationResource = resource(
  "core:privacy-deletion-plan-handler",
  "privacy_deletion_plan_handler:plan-1-handler-1"
);
const privacyDeletionHoldIndexResource = resource(
  "core:privacy-deletion-hold-index",
  "privacy_deletion_hold_index:plan-1"
);
const privacyDeletionApprovalResource = resource(
  "core:privacy-deletion-approval",
  "privacy_deletion_approval:plan-1"
);
const privacyDeletionRequesterRelationResource = resource(
  "core:privacy-deletion-plan-requester",
  "privacy_deletion_plan_requester:plan-1"
);
const reportResource = resource("core:report-query", "report_query:report-1");
const roleBindingResource = resource(
  "core:role-binding",
  "role_binding:binding-1"
);

const canonicalGuard = Object.freeze({
  profileId: "core:rbac.guard.canonical_resource",
  resourceState: "active",
  contentBoundary: "external",
  routeInputFields: Object.freeze([]),
  companionRequirementIds: Object.freeze([]),
  action: Object.freeze({ kind: "canonical" as const })
} satisfies InboxV2PolicyGuardEvidence);

describe("Inbox V2 authorization policy", () => {
  it("allows a current employee grant and derives only bounded output capabilities", () => {
    const requirement = makeRequirement();
    const input = makeInput(
      [requirement],
      [makeGrant("core:inbox.read", { type: "tenant", tenantId })]
    );

    const decision = evaluateInboxV2AuthorizationPlan(input);

    expect(decision.outcome).toBe("allowed");
    if (decision.outcome !== "allowed") return;
    expect(decision.notAfter).toBe(GRANT_END);
    expect(decision.requirements[0]?.matchedGrantId).toBe("grant-1");
    expect(deriveInboxV2Capabilities(decision)).toEqual([
      expect.objectContaining({
        kind: "inbox_v2_derived_capability",
        permissionId: "core:inbox.read",
        scopeType: "tenant",
        notAfter: GRANT_END
      })
    ]);
  });

  it("returns an immutable authorization snapshot detached from mutable input evidence", () => {
    const mutableResource = { ...conversationResource } as InboxV2EntityKey;
    const mutableScope = {
      type: "tenant" as const,
      tenantId
    } as InboxV2PermissionScope;
    const decision = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [
          makeRequirement({
            permissionId: "core:conversation.read",
            resource: mutableResource
          })
        ],
        [makeGrant("core:conversation.read", mutableScope)]
      )
    );

    expect(decision.outcome).toBe("allowed");
    if (decision.outcome !== "allowed") return;
    const outputResource = decision.requirements[0]!.resource;
    const outputScope = decision.requirements[0]!.matchedScope;
    (mutableResource as unknown as { entityId: string }).entityId =
      "conversation:mutated-after-evaluation";
    (mutableScope as unknown as { type: string }).type = "team";

    expect(outputResource).toEqual(conversationResource);
    expect(outputScope).toEqual({ type: "tenant", tenantId });
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.requirements)).toBe(true);
    expect(Object.isFrozen(decision.requirements[0])).toBe(true);
    expect(Object.isFrozen(outputResource)).toBe(true);
    expect(Object.isFrozen(outputScope)).toBe(true);
  });

  it.each(["none", "staff_only"] as const)(
    "does not let conversation.read cross the %s content boundary",
    (contentBoundary) => {
      const decision = evaluateInboxV2AuthorizationPlan(
        makeInput(
          [
            makeRequirement({
              permissionId: "core:conversation.read",
              guard: { ...canonicalGuard, contentBoundary }
            })
          ],
          [
            makeGrant("core:conversation.read", {
              type: "tenant",
              tenantId
            })
          ]
        )
      );

      expect(decision).toMatchObject({
        outcome: "denied",
        diagnostics: { reason: "hard_boundary_denied" }
      });
    }
  );

  const scopeCases: readonly Readonly<{
    name: string;
    scope: InboxV2PermissionScope;
    fact: InboxV2CanonicalScopeFact;
  }>[] = [
    {
      name: "org exact",
      scope: { type: "org_unit", tenantId, id: orgUnitId, mode: "exact" },
      fact: {
        kind: "org_unit",
        ...scopePath(conversationResource, orgUnitResource),
        orgUnitId,
        ancestorOrgUnitIds: [parentOrgUnitId],
        closureRevision: revision,
        currentClosureRevision: revision,
        validUntil: LATER
      }
    },
    {
      name: "org subtree",
      scope: {
        type: "org_unit",
        tenantId,
        id: parentOrgUnitId,
        mode: "subtree"
      },
      fact: {
        kind: "org_unit",
        ...scopePath(conversationResource, orgUnitResource),
        orgUnitId,
        ancestorOrgUnitIds: [parentOrgUnitId],
        closureRevision: revision,
        currentClosureRevision: revision,
        validUntil: LATER
      }
    },
    {
      name: "team",
      scope: { type: "team", tenantId, id: teamId },
      fact: {
        kind: "team",
        ...scopePath(conversationResource, teamResource),
        teamId,
        validUntil: LATER
      }
    },
    {
      name: "queue",
      scope: { type: "queue", tenantId, id: queueId },
      fact: {
        kind: "queue",
        ...scopePath(conversationResource, queueResource),
        queueId,
        validUntil: LATER
      }
    },
    {
      name: "conversation",
      scope: { type: "conversation", tenantId, id: conversationId },
      fact: {
        kind: "conversation",
        ...scopePath(conversationResource, conversationResource),
        conversationId,
        validUntil: LATER
      }
    },
    {
      name: "responsible",
      scope: { type: "responsible", tenantId },
      fact: {
        kind: "responsible",
        ...scopePath(conversationResource, workItemResource),
        employeeId,
        workItemId,
        state: "active",
        assignmentRevision: revision,
        currentAssignmentRevision: revision,
        validUntil: LATER
      }
    },
    {
      name: "conversation collaborator",
      scope: { type: "collaborator", tenantId },
      fact: {
        kind: "collaborator",
        ...scopePath(conversationResource, conversationResource),
        employeeId,
        subject: { kind: "conversation", conversationId },
        state: "active",
        episodeRevision: revision,
        currentEpisodeRevision: revision,
        validUntil: LATER
      }
    },
    {
      name: "internal participant",
      scope: { type: "internal_participant", tenantId },
      fact: {
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
    }
  ];

  it.each(scopeCases)(
    "matches $name only through a current canonical fact",
    ({ scope, fact }) => {
      const allowed = evaluateInboxV2AuthorizationPlan(
        makeInput(
          [makeRequirement({ scopeFacts: [fact] })],
          [makeGrant("core:inbox.read", scope)]
        )
      );
      const denied = evaluateInboxV2AuthorizationPlan(
        makeInput(
          [makeRequirement({ scopeFacts: [] })],
          [makeGrant("core:inbox.read", scope)]
        )
      );

      expect(allowed.outcome).toBe("allowed");
      expect(denied).toMatchObject({
        outcome: "denied",
        publicErrorCode: "permission.denied"
      });
    }
  );

  it("rejects provider observations as internal Hulee authority", () => {
    const providerFact: InboxV2CanonicalScopeFact = {
      kind: "internal_participant",
      ...scopePath(conversationResource, conversationResource),
      employeeId,
      conversationId,
      origin: "provider_observation",
      state: "active",
      role: "member",
      membershipRevision: revision,
      currentMembershipRevision: revision,
      validUntil: LATER
    };
    const decision = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [makeRequirement({ scopeFacts: [providerFact] })],
        [
          makeGrant("core:inbox.read", {
            type: "internal_participant",
            tenantId
          })
        ]
      )
    );

    expect(decision).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "canonical_relation_not_matched" }
    });
  });

  it("does not propagate an exact Client grant into a Conversation", () => {
    const guard: InboxV2PolicyGuardEvidence = {
      profileId: "core:rbac.guard.client_context",
      target: { kind: "client", clientId },
      accessPath: "exact_client_binding",
      pathEvidence: exactClientBindingPathEvidence({
        targetResource: conversationResource,
        clientResource,
        authorityResource: clientResource,
        suffix: "non-propagating-client"
      }),
      contextualRequirementIds: [],
      linkedClientRequirementIds: []
    };
    const decision = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [
          makeRequirement({
            permissionId: "core:client.view",
            resource: conversationResource,
            scopeFacts: [
              {
                kind: "client",
                ...scopePath(conversationResource, clientResource),
                clientId,
                validUntil: LATER
              }
            ],
            guard
          })
        ],
        [
          makeGrant("core:client.view", {
            type: "client",
            tenantId,
            id: clientId
          })
        ]
      )
    );

    expect(decision).toMatchObject({
      outcome: "denied",
      publicErrorCode: "permission.denied",
      diagnostics: { reason: "hard_boundary_denied" }
    });
  });

  it("allows an exact Client owner path but never treats ownership as Conversation authority", () => {
    const guard: InboxV2PolicyGuardEvidence = {
      profileId: "core:rbac.guard.client_context",
      target: { kind: "client", clientId },
      accessPath: "client_owner",
      pathEvidence: clientOwnerPathEvidence({
        targetResource: clientResource,
        clientResource,
        ownerEmployeeResource: employeeResource,
        suffix: "owner-path"
      }),
      contextualRequirementIds: [],
      linkedClientRequirementIds: []
    };
    const ownerFact: InboxV2CanonicalScopeFact = {
      kind: "client_owner",
      ...scopePath(clientResource, clientResource),
      employeeId,
      clientId,
      state: "active",
      ownershipRevision: revision,
      currentOwnershipRevision: revision,
      validUntil: LATER
    };
    const decision = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [
          makeRequirement({
            permissionId: "core:client.view",
            resource: clientResource,
            scopeFacts: [ownerFact],
            guard
          })
        ],
        [
          makeGrant("core:client.view", {
            type: "client_owner",
            tenantId
          })
        ]
      )
    );

    expect(decision.outcome).toBe("allowed");
  });

  it("fails closed on stale epoch, resource access revision and temporal boundary", () => {
    const requirement = makeRequirement();
    const grants = [makeGrant("core:inbox.read", { type: "tenant", tenantId })];
    const staleEpochInput = makeInput([requirement], grants);
    const staleEpoch = evaluateInboxV2AuthorizationPlan({
      ...staleEpochInput,
      currentAuthorization: {
        ...staleEpochInput.currentAuthorization,
        authorizationEpoch: inboxV2AuthorizationEpochSchema.parse(
          "authorization:epoch-0002"
        )
      }
    });
    const staleResource = evaluateInboxV2AuthorizationPlan(
      makeInput([makeRequirement({ resourceAccessRevision: "99" })], grants)
    );
    const atBoundary = evaluateInboxV2AuthorizationPlan({
      ...makeInput([requirement], grants),
      evaluatedAt: GRANT_END
    });

    expect(staleEpoch).toMatchObject({
      outcome: "denied",
      publicErrorCode: "auth.access_revision_stale"
    });
    expect(staleResource).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "revision_guard_failed" }
    });
    expect(atBoundary).toMatchObject({
      outcome: "denied",
      publicErrorCode: "auth.access_revision_stale",
      diagnostics: { reason: "temporal_boundary_reached" }
    });
  });

  it("requires active principals and a closed trusted-service action allow-list", () => {
    const requirement = makeRequirement();
    const grant = makeGrant("core:inbox.read", {
      type: "tenant",
      tenantId
    });
    const base = makeInput([requirement], [grant]);
    const draining = evaluateInboxV2AuthorizationPlan({
      ...base,
      principal: {
        ...base.principal,
        kind: "employee",
        lifecycle: "draining"
      } as InboxV2PolicyPrincipal
    });

    const serviceId = inboxV2TrustedServiceIdSchema.parse(
      "core:inbox-projector"
    );
    const serviceGrant: InboxV2PolicyGrant = {
      ...grant,
      principal: { kind: "trusted_service", trustedServiceId: serviceId },
      source: {
        kind: "service_registration",
        origin: "inbox_v2_native",
        serviceRegistrationId: "service-registration-1",
        bindingResource: resource(
          "core:service-registration",
          "service_registration:service-registration-1"
        ),
        bindingRevision: revision
      }
    };
    const serviceWithoutAction = evaluateInboxV2AuthorizationPlan({
      ...base,
      currentAuthorization: {
        ...base.currentAuthorization,
        principal: { kind: "trusted_service", trustedServiceId: serviceId }
      },
      principal: {
        kind: "trusted_service",
        tenantId,
        trustedServiceId: serviceId,
        registrationState: "active",
        authorizationEpoch: epoch,
        dependencies: base.currentAuthorization.dependencies,
        allowedPermissionIds: [],
        notAfter: SESSION_END
      },
      grants: [serviceGrant]
    });
    const serviceAllowed = evaluateInboxV2AuthorizationPlan({
      ...base,
      currentAuthorization: {
        ...base.currentAuthorization,
        principal: { kind: "trusted_service", trustedServiceId: serviceId }
      },
      principal: {
        kind: "trusted_service",
        tenantId,
        trustedServiceId: serviceId,
        registrationState: "active",
        authorizationEpoch: epoch,
        dependencies: base.currentAuthorization.dependencies,
        allowedPermissionIds: ["core:inbox.read"],
        notAfter: SESSION_END
      },
      grants: [serviceGrant]
    });

    expect(draining).toMatchObject({
      outcome: "denied",
      publicErrorCode: "auth.employee_inactive"
    });
    expect(serviceWithoutAction).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "illegal_principal" }
    });
    expect(serviceAllowed.outcome).toBe("allowed");
  });

  it("collapses cross-tenant and hidden secondary failures without naming the target", () => {
    const primary = makeRequirement();
    const hidden = makeRequirement({
      id: "hidden-client",
      permissionId: "core:conversation.read",
      resource: hiddenConversationResource,
      visibility: "secondary_hidden"
    });
    const hiddenFailure = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [primary, hidden],
        [makeGrant("core:inbox.read", { type: "tenant", tenantId })]
      )
    );
    const crossTenant = evaluateInboxV2AuthorizationPlan(
      (() => {
        const sameTenantRequirement = makeRequirement();
        const base = makeInput(
          [sameTenantRequirement],
          [makeGrant("core:inbox.read", { type: "tenant", tenantId })]
        );
        return {
          ...base,
          requirements: [
            {
              ...sameTenantRequirement,
              resource: resource(
                "core:conversation",
                String(hiddenConversationId),
                otherTenantId
              )
            }
          ]
        };
      })()
    );

    expect(hiddenFailure).toEqual(
      expect.objectContaining({
        outcome: "denied",
        publicErrorCode: "resource.not_found",
        diagnostics: {
          reason: "secondary_resource_denied",
          failedRequirementId: null
        }
      })
    );
    expect(crossTenant).toMatchObject({
      outcome: "denied",
      publicErrorCode: "resource.not_found"
    });
  });

  it("requires Conversation authority, Work policy and exact SourceAccount authority for reply", () => {
    const requirements = externalReplyRequirements();
    const grants = [
      makeGrant("core:message.reply_external", {
        type: "tenant",
        tenantId
      }),
      makeGrant(
        "core:conversation.read",
        { type: "tenant", tenantId },
        "grant-2"
      ),
      makeGrant(
        "core:source_account.use",
        { type: "source_account", tenantId, id: sourceAccountId },
        "grant-3"
      ),
      makeGrant("core:work.read", { type: "tenant", tenantId }, "grant-4")
    ];

    const allowed = evaluateInboxV2AuthorizationPlan(
      makeInput(requirements, grants)
    );
    const missingSource = evaluateInboxV2AuthorizationPlan(
      makeInput(
        requirements,
        grants.filter(
          (grant) => grant.permissionId !== "core:source_account.use"
        )
      )
    );
    const activeWorkConversationCollaborator = evaluateInboxV2AuthorizationPlan(
      makeInput(
        requirements.map((requirement): InboxV2AuthorizationRequirement => {
          if (
            requirement.id !== "reply" ||
            requirement.guard.profileId !== "core:rbac.guard.external_route"
          ) {
            return requirement;
          }
          return {
            ...requirement,
            scopeFacts: [
              {
                kind: "collaborator",
                ...scopePath(conversationResource, conversationResource),
                employeeId,
                subject: { kind: "conversation", conversationId },
                state: "active",
                episodeRevision: revision,
                currentEpisodeRevision: revision,
                validUntil: LATER
              }
            ],
            guard: {
              ...requirement.guard,
              actorRelation: "conversation_collaborator"
            }
          };
        }),
        grants
      )
    );

    expect(allowed.outcome).toBe("allowed");
    expect(missingSource).toMatchObject({
      outcome: "denied",
      publicErrorCode: "resource.not_found",
      diagnostics: { reason: "secondary_resource_denied" }
    });
    expect(activeWorkConversationCollaborator).toMatchObject({
      outcome: "denied",
      publicErrorCode: "route.forbidden",
      diagnostics: { reason: "state_guard_failed" }
    });
  });

  it("binds reply routing to the exact Conversation, thread and account", () => {
    const requirements = externalReplyRequirements().map(
      (requirement): InboxV2AuthorizationRequirement =>
        requirement.id === "reply" &&
        requirement.guard.profileId === "core:rbac.guard.external_route"
          ? {
              ...requirement,
              guard: {
                ...requirement.guard,
                bindingConversationResource: hiddenConversationResource
              }
            }
          : requirement
    );
    const grants = [
      makeGrant("core:message.reply_external", { type: "tenant", tenantId }),
      makeGrant(
        "core:conversation.read",
        { type: "tenant", tenantId },
        "grant-route-conversation"
      ),
      makeGrant(
        "core:source_account.use",
        { type: "source_account", tenantId, id: sourceAccountId },
        "grant-route-source"
      ),
      makeGrant(
        "core:work.read",
        { type: "tenant", tenantId },
        "grant-route-work"
      )
    ];

    expect(
      evaluateInboxV2AuthorizationPlan(makeInput(requirements, grants))
    ).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "secondary_resource_denied" }
    });
  });

  it("separates no-work collaborator, exact and structural reply relations", () => {
    const noWorkRequirements = (
      actorRelation:
        | "conversation_collaborator"
        | "exact_conversation_scope"
        | "structural_access_binding",
      bindingState: "active" | "missing",
      exactConversationGrant: boolean
    ): readonly InboxV2AuthorizationRequirement[] =>
      externalReplyRequirements()
        .filter(({ id }) => id !== "work-read")
        .map((requirement): InboxV2AuthorizationRequirement => {
          if (
            requirement.id === "conversation-read" &&
            exactConversationGrant
          ) {
            return {
              ...requirement,
              scopeFacts: [
                {
                  kind: "conversation",
                  ...scopePath(conversationResource, conversationResource),
                  conversationId,
                  validUntil: LATER
                }
              ]
            };
          }
          if (
            requirement.id === "conversation-read" &&
            actorRelation === "structural_access_binding"
          ) {
            return {
              ...requirement,
              scopeFacts: [
                {
                  kind: "org_unit",
                  ...scopePath(conversationResource, orgUnitResource),
                  orgUnitId,
                  ancestorOrgUnitIds: [],
                  closureRevision: revision,
                  currentClosureRevision: revision,
                  validUntil: LATER
                }
              ]
            };
          }
          if (
            requirement.id !== "reply" ||
            requirement.guard.profileId !== "core:rbac.guard.external_route"
          ) {
            return requirement;
          }
          return {
            ...requirement,
            scopeFacts:
              actorRelation === "conversation_collaborator"
                ? [
                    {
                      kind: "collaborator",
                      ...scopePath(conversationResource, conversationResource),
                      employeeId,
                      subject: { kind: "conversation", conversationId },
                      state: "active",
                      episodeRevision: revision,
                      currentEpisodeRevision: revision,
                      validUntil: LATER
                    }
                  ]
                : requirement.scopeFacts,
            guard: {
              ...requirement.guard,
              workRequirementId: null,
              workItemId: null,
              workState: "no_work_non_actionable",
              actorRelation,
              replyPolicyEvidence: {
                ...requirement.guard.replyPolicyEvidence,
                workItemResource: null
              },
              workAbsenceProof: {
                resource: resource(
                  "core:conversation-work-head",
                  "conversation_work_head:conversation-1"
                ),
                conversationResource,
                workItemCount: 0,
                expectedHighWater: "7",
                currentHighWater: "7",
                revisionChecks: currentRevisionChecks("state")
              },
              conversationAccessBindingState: bindingState,
              structuralAccessBinding:
                actorRelation === "structural_access_binding"
                  ? {
                      resource: resource(
                        "core:conversation-access-binding",
                        "conversation_access_binding:conversation-1"
                      ),
                      conversationResource,
                      scopeTargetResource: orgUnitResource,
                      state: bindingState === "active" ? "active" : "inactive",
                      revisionChecks: currentRevisionChecks("relation"),
                      notAfter: GRANT_END
                    }
                  : null
            }
          };
        });
    const grants = (
      exactConversationGrant: boolean,
      actorRelation:
        | "conversation_collaborator"
        | "exact_conversation_scope"
        | "structural_access_binding"
    ) => [
      makeGrant("core:message.reply_external", { type: "tenant", tenantId }),
      makeGrant(
        "core:conversation.read",
        exactConversationGrant
          ? { type: "conversation", tenantId, id: conversationId }
          : actorRelation === "structural_access_binding"
            ? { type: "org_unit", tenantId, id: orgUnitId, mode: "exact" }
            : { type: "tenant", tenantId },
        "grant-no-work-conversation"
      ),
      makeGrant(
        "core:source_account.use",
        { type: "source_account", tenantId, id: sourceAccountId },
        "grant-no-work-source"
      )
    ];
    const cases = [
      {
        relation: "conversation_collaborator" as const,
        binding: "missing" as const,
        exact: false,
        expected: "allowed"
      },
      {
        relation: "exact_conversation_scope" as const,
        binding: "missing" as const,
        exact: true,
        expected: "allowed"
      },
      {
        relation: "structural_access_binding" as const,
        binding: "active" as const,
        exact: false,
        expected: "allowed"
      },
      {
        relation: "structural_access_binding" as const,
        binding: "missing" as const,
        exact: false,
        expected: "denied"
      }
    ];

    for (const item of cases) {
      const decision = evaluateInboxV2AuthorizationPlan(
        makeInput(
          noWorkRequirements(item.relation, item.binding, item.exact),
          grants(item.exact, item.relation)
        )
      );
      expect(decision.outcome, JSON.stringify({ item, decision })).toBe(
        item.expected
      );
    }
  });

  it("requires a current provider capability for external moderation", () => {
    const contentRead = makeRequirement({
      id: "moderation-read",
      permissionId: "core:conversation.read",
      visibility: "secondary_hidden"
    });
    const sourceUse = makeRequirement({
      id: "moderation-source",
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
      visibility: "secondary_hidden",
      guard: {
        profileId: "core:rbac.guard.source_account_route",
        operation: makeSourceAccountUseOperation(),
        sourceAccountId,
        routeSourceAccountId: sourceAccountId,
        sourceState: "active",
        bindingState: "active",
        bindingGeneration: "1",
        expectedBindingGeneration: "1",
        capabilityState: "supported",
        capabilityNotAfter: GRANT_END
      }
    });
    const action = {
      kind: "external_moderation" as const,
      operation: "delete" as const,
      targetResource: timelineItemResource,
      ...timelineTopologyEvidence("external"),
      contentReadResource: conversationResource,
      contentRelationTargetResource: timelineItemResource,
      contentRelationReadResource: conversationResource,
      contentRelationRevisionChecks: [
        { kind: "relation" as const, expected: "1", actual: "1" }
      ],
      reason: "verified abuse",
      auditEventId: "audit-moderation-1",
      contentReadRequirementId: "moderation-read",
      deletionMode: "provider_delete" as const,
      holdProof: {
        resource: resource(
          "core:content-hold-index",
          "content_hold_index:message-1"
        ),
        targetResource: timelineItemResource,
        state: "none" as const,
        revisionChecks: currentRevisionChecks("state")
      },
      originalRouteRequirementId: "moderation-source",
      originalSourceAccountId: sourceAccountId,
      originalSourceAccountResource: sourceAccountResource,
      originalBindingResource: sourceThreadBindingResource,
      originalBindingSourceAccountResource: sourceAccountResource,
      externalReferenceResource: externalMessageReferenceResource,
      externalReferenceBindingResource: sourceThreadBindingResource,
      externalReferenceTargetResource: timelineItemResource,
      routeRevisionChecks: currentRouteRevisionChecks(),
      capabilityId: "core:capability.message.delete" as const,
      capabilityManifestResource: providerCapabilityManifestResource,
      capabilityManifestSourceAccountResource: sourceAccountResource,
      capabilityRevisionChecks: [
        { kind: "manifest" as const, expected: "1", actual: "1" }
      ],
      capabilityState: "supported" as const,
      capabilityNotAfter: GRANT_END
    };
    const editAction = {
      ...action,
      operation: "edit" as const,
      capabilityId: "core:capability.message.edit" as const,
      deletionMode: null,
      holdProof: null,
      capabilityNotAfter: "2026-07-12T10:12:00.000Z"
    };
    const moderation = (
      actionEvidence: Extract<
        InboxV2PolicyGuardEvidence,
        { profileId: "core:rbac.guard.canonical_resource" }
      >["action"]
    ) =>
      makeRequirement({
        id: "moderation",
        permissionId: "core:message.moderate_external",
        resource: timelineItemResource,
        scopeFacts: [
          {
            kind: "conversation",
            ...scopePath(timelineItemResource, conversationResource),
            conversationId,
            validUntil: LATER
          }
        ],
        guard: { ...canonicalGuard, action: actionEvidence }
      });
    const grants = [
      makeGrant(
        "core:message.moderate_external",
        { type: "tenant", tenantId },
        "grant-moderation"
      ),
      makeGrant(
        "core:conversation.read",
        { type: "tenant", tenantId },
        "grant-moderation-read"
      ),
      makeGrant(
        "core:source_account.use",
        { type: "source_account", tenantId, id: sourceAccountId },
        "grant-moderation-source"
      )
    ];

    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput([moderation(action), contentRead, sourceUse], grants)
      ).outcome
    ).toBe("allowed");
    const editDecision = evaluateInboxV2AuthorizationPlan(
      makeInput([moderation(editAction), contentRead, sourceUse], grants)
    );
    expect(editDecision.outcome).toBe("allowed");
    if (editDecision.outcome === "allowed") {
      expect(editDecision.notAfter).toBe("2026-07-12T10:12:00.000Z");
    }
    for (const deniedAction of [
      { ...action, capabilityState: "unsupported" as const },
      { ...action, capabilityState: "expired" as const },
      { ...action, capabilityNotAfter: NOW },
      {
        ...action,
        capabilityId: "core:capability.message.edit" as const
      },
      {
        ...editAction,
        capabilityId: "core:capability.message.delete" as const
      },
      {
        ...action,
        capabilityRevisionChecks: [
          { kind: "manifest" as const, expected: "1", actual: "2" }
        ]
      },
      { ...action, capabilityRevisionChecks: [] },
      {
        ...action,
        capabilityRevisionChecks: [
          { kind: "state" as const, expected: "1", actual: "1" }
        ]
      },
      { ...action, auditEventId: "" }
    ]) {
      expect(
        evaluateInboxV2AuthorizationPlan(
          makeInput([moderation(deniedAction), contentRead, sourceUse], grants)
        )
      ).toMatchObject({
        outcome: "denied",
        publicErrorCode: "route.inactive"
      });
    }
  });

  it("forbids route-like fields on staff-only notes and requires Conversation read", () => {
    const note = makeRequirement({
      id: "note",
      permissionId: "core:message.staff_note.create",
      guard: {
        profileId: "core:rbac.guard.canonical_resource",
        resourceState: "active",
        contentBoundary: "staff_only",
        routeInputFields: ["sourceAccountId"],
        companionRequirementIds: ["conversation-read"],
        action: { kind: "canonical" }
      }
    });
    const read = makeRequirement({
      id: "conversation-read",
      permissionId: "core:conversation.read"
    });
    const decision = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [note, read],
        [
          makeGrant("core:message.staff_note.create", {
            type: "tenant",
            tenantId
          }),
          makeGrant(
            "core:conversation.read",
            { type: "tenant", tenantId },
            "grant-2"
          )
        ]
      )
    );

    expect(decision).toMatchObject({
      outcome: "denied",
      publicErrorCode: "message.staff_only_route_forbidden"
    });
  });

  it("enforces deletion phase separation, cooling, hold and preview-no-I/O boundaries", () => {
    const deletionGuard = makeDeletionGuard({
      phase: "approve",
      actingEmployeeId: employeeId,
      requesterEmployeeId: employeeId,
      approverEmployeeId: employeeId,
      executorEmployeeId: null
    });
    const requirement = makeRequirement({
      permissionId: "core:privacy.deletion.approve",
      resource: privacyDeletionResource,
      guard: deletionGuard
    });
    const grant = makeGrant("core:privacy.deletion.approve", {
      type: "tenant",
      tenantId
    });
    const samePerson = evaluateInboxV2AuthorizationPlan(
      makeInput([requirement], [grant])
    );
    const previewIo = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [
          makeRequirement({
            permissionId: "core:privacy.deletion.preview",
            resource: privacyDeletionResource,
            guard: makeDeletionGuard({
              phase: "preview",
              actingEmployeeId: employeeId,
              ioRequested: true
            })
          })
        ],
        [
          makeGrant("core:privacy.deletion.preview", {
            type: "tenant",
            tenantId
          })
        ]
      )
    );
    const executeOnHold = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [
          makeRequirement({
            permissionId: "core:privacy.deletion.execute",
            resource: privacyDeletionResource,
            guard: makeDeletionGuard({
              phase: "execute",
              actingEmployeeId: employeeId,
              requesterEmployeeId: otherEmployeeId,
              approverEmployeeId: thirdEmployeeId,
              executorEmployeeId: employeeId,
              coolingPeriodEndsAt: "2026-07-12T09:00:00.000Z",
              holdState: "active",
              ioRequested: true
            })
          }),
          makeRequirement({
            id: "deletion-approver-directory",
            permissionId: "core:employee.directory.view",
            resource: thirdEmployeeResource,
            visibility: "secondary_hidden"
          })
        ],
        [
          makeGrant("core:privacy.deletion.execute", {
            type: "tenant",
            tenantId
          }),
          makeGrant(
            "core:employee.directory.view",
            { type: "tenant", tenantId },
            "deletion-approver-directory-grant"
          ),
          {
            ...makeGrant(
              "core:privacy.deletion.approve",
              { type: "tenant", tenantId },
              "deletion-approver-grant"
            ),
            principal: {
              kind: "employee" as const,
              employeeId: thirdEmployeeId
            }
          }
        ]
      )
    );

    expect(samePerson).toMatchObject({
      outcome: "denied",
      publicErrorCode: "privacy.separation_of_duties"
    });
    expect(previewIo).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "hard_boundary_denied" }
    });
    expect(executeOnHold).toMatchObject({
      outcome: "denied",
      publicErrorCode: "privacy.hold_active"
    });
  });

  it("uses exact current WorkItem and SourceAccount targets", () => {
    const workGuard: InboxV2PolicyGuardEvidence = {
      profileId: "core:rbac.guard.work_item_state",
      authorizationMode: "operation",
      workItemId,
      operation: "close",
      workState: "active",
      actorRelation: "primary_responsible",
      assignmentState: "assigned",
      expectedStateRevision: "7",
      currentStateRevision: "7",
      destinationRequirementIds: [],
      destinationResources: [],
      authorityTargetResource: null,
      authorityState: null,
      eligibleEmployeeId: null,
      authorityRevisionChecks: [],
      overrideReason: null,
      overrideRequirementId: null
    };
    const sourceGuard: InboxV2PolicyGuardEvidence = {
      profileId: "core:rbac.guard.source_account_route",
      operation: makeSourceAccountUseOperation(),
      sourceAccountId,
      routeSourceAccountId: sourceAccountId,
      sourceState: "active",
      bindingState: "active",
      bindingGeneration: "3",
      expectedBindingGeneration: "3",
      capabilityState: "supported",
      capabilityNotAfter: GRANT_END
    };
    const requirements = [
      makeRequirement({
        id: "work",
        permissionId: "core:work.close",
        resource: workItemResource,
        scopeFacts: [
          {
            kind: "work_item",
            ...scopePath(workItemResource, workItemResource),
            workItemId,
            validUntil: LATER
          },
          {
            kind: "responsible",
            ...scopePath(workItemResource, workItemResource),
            employeeId,
            workItemId,
            state: "active",
            assignmentRevision: revision,
            currentAssignmentRevision: revision,
            validUntil: LATER
          }
        ],
        guard: workGuard
      }),
      makeRequirement({
        id: "source",
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
        guard: sourceGuard
      })
    ];
    const decision = evaluateInboxV2AuthorizationPlan(
      makeInput(requirements, [
        makeGrant(
          "core:work.close",
          { type: "work_item", tenantId, id: workItemId },
          "grant-work"
        ),
        makeGrant(
          "core:source_account.use",
          { type: "source_account", tenantId, id: sourceAccountId },
          "grant-source"
        )
      ])
    );

    expect(decision.outcome).toBe("allowed");
  });

  it("requires confirmed internal membership and forbids observer send authority", () => {
    const scopeFact: InboxV2CanonicalScopeFact = {
      kind: "internal_participant",
      ...scopePath(conversationResource, conversationResource),
      employeeId,
      conversationId,
      origin: "hulee_internal_command",
      state: "active",
      role: "member",
      membershipRevision: revision,
      currentMembershipRevision: revision,
      validUntil: GRANT_END
    };
    const memberGuard: InboxV2PolicyGuardEvidence = {
      profileId: "core:rbac.guard.internal_membership",
      conversationId,
      employeeId,
      membershipState: "active",
      membershipOrigin: "hulee_internal_command",
      membershipRole: "member",
      contentBoundary: "internal",
      validUntil: GRANT_END
    };
    const requirement = makeRequirement({
      permissionId: "core:message.send_internal",
      scopeFacts: [scopeFact],
      guard: memberGuard
    });
    const grant = makeGrant("core:message.send_internal", {
      type: "internal_participant",
      tenantId
    });

    expect(
      evaluateInboxV2AuthorizationPlan(makeInput([requirement], [grant]))
        .outcome
    ).toBe("allowed");
    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [
            {
              ...requirement,
              guard: { ...memberGuard, membershipRole: "observer" }
            }
          ],
          [grant]
        )
      )
    ).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "canonical_relation_not_matched" }
    });
  });

  it("keeps break-glass exact, direct, audited, read-only and time-bounded", () => {
    const guard: InboxV2PolicyGuardEvidence = {
      profileId: "core:rbac.guard.internal_break_glass_read",
      conversationId,
      exactGrantConversationId: conversationId,
      grantKind: "direct_grant",
      reason: "incident investigation",
      auditEventId: "audit-1",
      audit: privilegedAudit(
        "internal_break_glass_read",
        conversationResource,
        resource("core:audit-event", "audit-1")
      ),
      accessMode: "read_only",
      validUntil: GRANT_END
    };
    const requirement = makeRequirement({
      permissionId: "core:conversation.internal.break_glass_read",
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
    const grant = makeGrant("core:conversation.internal.break_glass_read", {
      type: "conversation",
      tenantId,
      id: conversationId
    });
    const allowed = evaluateInboxV2AuthorizationPlan(
      makeInput([requirement], [grant])
    );
    const writable = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [{ ...requirement, guard: { ...guard, accessMode: "read_write" } }],
        [grant]
      )
    );

    expect(allowed.outcome).toBe("allowed");
    expect(writable).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "hard_boundary_denied" }
    });
  });

  it("issues break-glass only for active exact target and authorized approver", () => {
    const alarmResource = resource("core:security-alarm-event", "alarm-1");
    const breakGlassPolicyResource = resource(
      "core:break-glass-policy",
      "break_glass_policy:conversation-1"
    );
    const breakGlassPolicyBindingResource = resource(
      "core:break-glass-policy-binding",
      "break_glass_policy_binding:conversation-1"
    );
    const breakGlassPolicySelectionResource = resource(
      "core:break-glass-policy-selection",
      `break_glass_policy_selection:${String(conversationId)}`
    );
    const breakGlassPolicyDigest = `sha256:${"b".repeat(64)}`;
    const attackerPolicyResource = resource(
      "core:break-glass-policy",
      "break_glass_policy:attacker"
    );
    const attackerPolicyBindingResource = resource(
      "core:break-glass-policy-binding",
      "break_glass_policy_binding:attacker"
    );
    const attackerPolicySelectionResource = resource(
      "core:break-glass-policy-selection",
      `attacker:${String(conversationId)}`
    );
    const attackerPolicyDigest = `sha256:${"c".repeat(64)}`;
    const guard: Extract<
      InboxV2PolicyGuardEvidence,
      { profileId: "core:rbac.guard.internal_break_glass_issue" }
    > = {
      profileId: "core:rbac.guard.internal_break_glass_issue",
      conversationId,
      requesterEmployeeId: employeeId,
      approverEmployeeId: thirdEmployeeId,
      targetEmployeeId: otherEmployeeId,
      approverEmployeeResource: thirdEmployeeResource,
      approverLifecycle: "active",
      approverDirectoryRequirementId: "approver-directory",
      approverGrantId: "approver-breakglass",
      targetEmployeeResource: otherEmployeeResource,
      targetLifecycle: "active",
      targetDirectoryRequirementId: "target-directory",
      reason: "verified support incident",
      alarmEventId: "alarm-1",
      alarmEvidence: {
        resource: alarmResource,
        conversationResource,
        actorEmployeeResource: employeeResource,
        action: "internal_break_glass_issue",
        revisionChecks: keyedRevisionChecks([
          alarmResource,
          conversationResource,
          employeeResource
        ])
      },
      validUntil: GRANT_END,
      approvalEvidence: {
        resource: resource(
          "core:break-glass-approval",
          "break_glass_approval:conversation-1"
        ),
        conversationResource,
        requesterEmployeeResource: employeeResource,
        approverEmployeeResource: thirdEmployeeResource,
        targetEmployeeResource: otherEmployeeResource,
        state: "approved",
        revisionChecks: [
          {
            resource: resource(
              "core:break-glass-approval",
              "break_glass_approval:conversation-1"
            ),
            expected: "1",
            actual: "1"
          },
          { resource: conversationResource, expected: "1", actual: "1" },
          { resource: employeeResource, expected: "1", actual: "1" },
          { resource: thirdEmployeeResource, expected: "1", actual: "1" },
          { resource: otherEmployeeResource, expected: "1", actual: "1" }
        ],
        notAfter: GRANT_END
      },
      policyResource: breakGlassPolicyResource,
      policyConversationResource: conversationResource,
      policyBindingResource: breakGlassPolicyBindingResource,
      policyBindingPolicyResource: breakGlassPolicyResource,
      policyBindingConversationResource: conversationResource,
      policyDigest: breakGlassPolicyDigest,
      maximumTtlSeconds: 1_800,
      policyMaximumTtlSeconds: 1_800,
      policyRevisionChecks: keyedRevisionChecks([
        breakGlassPolicyResource,
        breakGlassPolicyBindingResource,
        conversationResource
      ]),
      policySelection: {
        resource: breakGlassPolicySelectionResource,
        conversationResource,
        selectedPolicyResource: breakGlassPolicyResource,
        selectedBindingResource: breakGlassPolicyBindingResource,
        selectedPolicyDigest: breakGlassPolicyDigest,
        selectedMaximumTtlSeconds: 1_800,
        state: "active",
        revisionChecks: keyedRevisionChecks([
          breakGlassPolicySelectionResource,
          conversationResource,
          breakGlassPolicyResource,
          breakGlassPolicyBindingResource
        ])
      }
    };
    const issue = makeRequirement({
      id: "breakglass-issue",
      permissionId: "core:conversation.internal.break_glass.issue",
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
    const targetDirectory = makeRequirement({
      id: "target-directory",
      permissionId: "core:employee.directory.view",
      resource: otherEmployeeResource,
      visibility: "secondary_hidden"
    });
    const approverDirectory = makeRequirement({
      id: "approver-directory",
      permissionId: "core:employee.directory.view",
      resource: thirdEmployeeResource,
      visibility: "secondary_hidden"
    });
    const approverGrant: InboxV2PolicyGrant = {
      ...makeGrant(
        "core:conversation.internal.break_glass.issue",
        { type: "conversation", tenantId, id: conversationId },
        "approver-breakglass"
      ),
      principal: { kind: "employee", employeeId: thirdEmployeeId }
    };
    const grants = [
      makeGrant(
        "core:conversation.internal.break_glass.issue",
        { type: "conversation", tenantId, id: conversationId },
        "requester-breakglass"
      ),
      makeGrant(
        "core:employee.directory.view",
        { type: "tenant", tenantId },
        "directory"
      ),
      approverGrant
    ];

    const breakGlassIssueDecision = evaluateInboxV2AuthorizationPlan(
      makeInput([issue, targetDirectory, approverDirectory], grants)
    );
    expect(breakGlassIssueDecision.outcome).toBe("allowed");
    for (const invalidGuard of [
      { ...guard, targetLifecycle: "inactive" as const },
      {
        ...guard,
        targetEmployeeResource: resource(
          "core:employee",
          String(otherEmployeeId),
          otherTenantId
        )
      },
      { ...guard, validUntil: LATER },
      {
        ...guard,
        approvalEvidence: {
          ...guard.approvalEvidence,
          state: "pending" as const
        }
      },
      {
        ...guard,
        approvalEvidence: {
          ...guard.approvalEvidence,
          requesterEmployeeResource: otherEmployeeResource
        }
      },
      { ...guard, alarmEventId: "" },
      {
        ...guard,
        alarmEvidence: {
          ...guard.alarmEvidence!,
          actorEmployeeResource: otherEmployeeResource
        }
      },
      {
        ...guard,
        policyResource: resource(
          "core:break-glass-policy",
          "break_glass_policy:substituted"
        )
      },
      {
        ...guard,
        policyResource: resource(
          "core:break-glass-policy",
          "break_glass_policy:substituted"
        ),
        policyBindingResource: resource(
          "core:break-glass-policy-binding",
          "break_glass_policy_binding:substituted"
        ),
        policyBindingPolicyResource: resource(
          "core:break-glass-policy",
          "break_glass_policy:substituted"
        ),
        policyDigest: `sha256:${"c".repeat(64)}`,
        maximumTtlSeconds: 86_400,
        policyMaximumTtlSeconds: 86_400,
        policyRevisionChecks: keyedRevisionChecks([
          resource("core:break-glass-policy", "break_glass_policy:substituted"),
          resource(
            "core:break-glass-policy-binding",
            "break_glass_policy_binding:substituted"
          ),
          conversationResource
        ])
      },
      { ...guard, policyMaximumTtlSeconds: 86_400 },
      {
        ...guard,
        policyRevisionChecks: guard.policyRevisionChecks.map((check, index) =>
          index === 0 ? { ...check, actual: "2" } : check
        )
      },
      {
        ...guard,
        policyRevisionChecks: guard.policyRevisionChecks.map((check, index) =>
          index === guard.policyRevisionChecks.length - 1
            ? { ...check, expected: "2", actual: "2" }
            : check
        )
      }
    ]) {
      expect(
        evaluateInboxV2AuthorizationPlan(
          makeInput([{ ...issue, guard: invalidGuard }], grants)
        ).outcome
      ).toBe("denied");
    }

    const coordinatedSelectorSubstitution = {
      ...guard,
      policyResource: attackerPolicyResource,
      policyBindingResource: attackerPolicyBindingResource,
      policyBindingPolicyResource: attackerPolicyResource,
      policyBindingConversationResource: conversationResource,
      policyDigest: attackerPolicyDigest,
      maximumTtlSeconds: 86_400,
      policyMaximumTtlSeconds: 86_400,
      policyRevisionChecks: keyedRevisionChecks([
        attackerPolicyResource,
        attackerPolicyBindingResource,
        conversationResource
      ]),
      policySelection: {
        ...guard.policySelection,
        resource: attackerPolicySelectionResource,
        selectedPolicyResource: attackerPolicyResource,
        selectedBindingResource: attackerPolicyBindingResource,
        selectedPolicyDigest: attackerPolicyDigest,
        selectedMaximumTtlSeconds: 86_400,
        revisionChecks: keyedRevisionChecks([
          attackerPolicySelectionResource,
          conversationResource,
          attackerPolicyResource,
          attackerPolicyBindingResource
        ])
      }
    };
    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [{ ...issue, guard: coordinatedSelectorSubstitution }],
          grants
        )
      ).outcome,
      "an attacker-prefixed Conversation selector must not authorize a coordinated policy/TTL substitution"
    ).toBe("denied");
  });

  it("treats watcher state as eligibility and rechecks target read authority", () => {
    const watch = makeRequirement({
      id: "watch",
      permissionId: "core:notification.watch.self",
      guard: {
        profileId: "core:rbac.guard.notification_self",
        targetResource: conversationResource,
        targetEmployeeId: employeeId,
        targetReadRequirementId: "read"
      }
    });
    const read = makeRequirement({
      id: "read",
      permissionId: "core:conversation.read",
      visibility: "secondary_hidden"
    });
    const grants = [
      makeGrant(
        "core:notification.watch.self",
        { type: "tenant", tenantId },
        "grant-watch"
      ),
      makeGrant(
        "core:conversation.read",
        { type: "tenant", tenantId },
        "grant-read"
      )
    ];
    const allowed = evaluateInboxV2AuthorizationPlan(
      makeInput([watch, read], grants)
    );
    const revokedRead = evaluateInboxV2AuthorizationPlan(
      makeInput([watch, read], grants.slice(0, 1))
    );

    expect(allowed.outcome).toBe("allowed");
    expect(revokedRead).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "secondary_resource_denied" }
    });
  });

  it("authorizes files only together with their current parent content", () => {
    const parentRead = makeRequirement({
      id: "parent-read",
      permissionId: "core:conversation.read",
      visibility: "secondary_hidden"
    });
    const file = makeRequirement({
      id: "file",
      permissionId: "core:file.view",
      resource: fileResource,
      guard: {
        profileId: "core:rbac.guard.file_parent_content",
        targetResource: fileResource,
        parentResource: conversationResource,
        ...fileRelationEvidence(conversationResource),
        parentBoundary: "external",
        parentRequirementIds: ["parent-read"],
        retentionState: "available",
        holdState: "none",
        operation: "view",
        storagePolicyState: "allowed",
        actorEmployeeId: employeeId,
        uploaderEmployeeId: null,
        moderationRequirementId: null,
        expectedFileRevision: "1",
        currentFileRevision: "1"
      }
    });
    const grants = [
      makeGrant("core:file.view", { type: "tenant", tenantId }, "grant-file"),
      makeGrant(
        "core:conversation.read",
        { type: "tenant", tenantId },
        "grant-parent"
      )
    ];
    const allowed = evaluateInboxV2AuthorizationPlan(
      makeInput([file, parentRead], grants)
    );
    const missingParent = evaluateInboxV2AuthorizationPlan(
      makeInput([file, parentRead], grants.slice(0, 1))
    );
    const unrelatedParent = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [
          makeRequirement({
            id: "file",
            permissionId: "core:file.view",
            resource: fileResource,
            guard: {
              profileId: "core:rbac.guard.file_parent_content",
              targetResource: fileResource,
              parentResource: hiddenConversationResource,
              ...fileRelationEvidence(hiddenConversationResource),
              parentBoundary: "external",
              parentRequirementIds: ["parent-read"],
              retentionState: "available",
              holdState: "none",
              operation: "view",
              storagePolicyState: "allowed",
              actorEmployeeId: employeeId,
              uploaderEmployeeId: null,
              moderationRequirementId: null,
              expectedFileRevision: "1",
              currentFileRevision: "1"
            }
          }),
          parentRead
        ],
        grants
      )
    );

    expect(allowed.outcome).toBe("allowed");
    expect(missingParent).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "secondary_resource_denied" }
    });
    expect(unrelatedParent).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "secondary_resource_denied" }
    });
  });

  it("does not treat Inbox metadata as file or participant-PII content authority", () => {
    const inboxRead = makeRequirement({
      id: "metadata-only",
      permissionId: "core:inbox.read",
      visibility: "secondary_hidden"
    });
    const file = makeRequirement({
      id: "file-from-metadata",
      permissionId: "core:file.view",
      resource: fileResource,
      guard: {
        profileId: "core:rbac.guard.file_parent_content",
        targetResource: fileResource,
        parentResource: conversationResource,
        ...fileRelationEvidence(conversationResource),
        parentBoundary: "external",
        parentRequirementIds: ["metadata-only"],
        retentionState: "available",
        holdState: "none",
        operation: "view",
        storagePolicyState: "allowed",
        actorEmployeeId: employeeId,
        uploaderEmployeeId: null,
        moderationRequirementId: null,
        expectedFileRevision: "1",
        currentFileRevision: "1"
      }
    });
    const participantResource = resource(
      "core:conversation-participant",
      "conversation_participant:participant-1"
    );
    const pii = makeRequirement({
      id: "participant-pii",
      permissionId: "core:participant.pii.view",
      resource: participantResource,
      guard: {
        ...canonicalGuard,
        action: {
          kind: "sensitive_content",
          targetResource: participantResource,
          baseReadResource: conversationResource,
          baseReadRelationTargetResource: participantResource,
          baseReadRelationResource: conversationResource,
          baseReadRelationRevisionChecks: [
            { kind: "relation", expected: "1", actual: "1" }
          ],
          baseReadRequirementId: "metadata-only",
          purpose: "identity verification",
          policyEvidence: {
            kind: "participant_pii",
            policyResource: resource(
              "core:pii-access-policy",
              "pii_access_policy:participant-1"
            ),
            policyTargetResource: participantResource,
            approvedPurposeIds: ["identity verification"],
            revisionChecks: [{ kind: "policy", expected: "1", actual: "1" }],
            notAfter: GRANT_END
          }
        }
      }
    });
    const grants = [
      makeGrant("core:inbox.read", { type: "tenant", tenantId }, "metadata"),
      makeGrant("core:file.view", { type: "tenant", tenantId }, "file"),
      makeGrant(
        "core:participant.pii.view",
        { type: "tenant", tenantId },
        "participant-pii"
      )
    ];

    for (const requirement of [file, pii]) {
      expect(
        evaluateInboxV2AuthorizationPlan(
          makeInput([requirement, inboxRead], grants)
        )
      ).toMatchObject({
        outcome: "denied",
        diagnostics: { reason: "secondary_resource_denied" }
      });
    }
  });

  it("requires send/create authority for upload and uploader/moderator authority for delete", () => {
    const parentRead = makeRequirement({
      id: "file-parent-read",
      permissionId: "core:conversation.read",
      visibility: "secondary_hidden"
    });
    const baseGuard = {
      profileId: "core:rbac.guard.file_parent_content" as const,
      targetResource: fileResource,
      parentResource: conversationResource,
      ...fileRelationEvidence(conversationResource, otherEmployeeId),
      parentBoundary: "external" as const,
      parentRequirementIds: ["file-parent-read"],
      retentionState: "available" as const,
      holdState: "none" as const,
      storagePolicyState: "allowed" as const,
      actorEmployeeId: employeeId,
      uploaderEmployeeId: otherEmployeeId,
      moderationRequirementId: null,
      expectedFileRevision: "2",
      currentFileRevision: "2"
    };
    const upload = makeRequirement({
      id: "file-upload",
      permissionId: "core:file.upload",
      resource: fileResource,
      guard: { ...baseGuard, operation: "upload" }
    });
    const deleteFile = makeRequirement({
      id: "file-delete",
      permissionId: "core:file.delete",
      resource: fileResource,
      guard: { ...baseGuard, operation: "delete" }
    });
    const grants = [
      makeGrant(
        "core:conversation.read",
        { type: "tenant", tenantId },
        "file-parent-read"
      ),
      makeGrant("core:file.upload", { type: "tenant", tenantId }, "upload"),
      makeGrant("core:file.delete", { type: "tenant", tenantId }, "delete")
    ];

    expect(
      evaluateInboxV2AuthorizationPlan(makeInput([upload, parentRead], grants))
        .outcome
    ).toBe("denied");
    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput([deleteFile, parentRead], grants)
      ).outcome
    ).toBe("denied");
    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [
            {
              ...deleteFile,
              guard: {
                ...baseGuard,
                operation: "delete",
                uploaderEmployeeId: employeeId,
                currentFileRevision: "3"
              }
            },
            parentRead
          ],
          grants
        )
      ).outcome
    ).toBe("denied");
  });

  it("evaluates every Client in a group mutation and hides the failing Client", () => {
    const conversationRead = makeRequirement({
      id: "conversation-read",
      permissionId: "core:conversation.read",
      visibility: "secondary_hidden"
    });
    const clientA = makeClientLinkRequirement(
      "client-a",
      clientId,
      clientResource
    );
    const clientB = makeClientLinkRequirement(
      "client-b",
      secondClientId,
      secondClientResource
    );
    const primary = makeConversationClientLinksRequirement(
      "manage-links",
      [clientA, clientB],
      conversationRead.id
    );
    const decision = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [primary, conversationRead, clientA, clientB],
        [
          makeGrant(
            "core:conversation.clients.manage",
            { type: "tenant", tenantId },
            "grant-manage"
          ),
          makeGrant(
            "core:conversation.read",
            { type: "tenant", tenantId },
            "grant-read"
          ),
          makeGrant(
            "core:client.link.manage",
            { type: "client", tenantId, id: clientId },
            "grant-client-a"
          )
        ]
      )
    );

    expect(decision).toEqual(
      expect.objectContaining({
        outcome: "denied",
        publicErrorCode: "resource.not_found",
        diagnostics: {
          reason: "secondary_resource_denied",
          failedRequirementId: null
        }
      })
    );
  });

  it("rejects identity self-claim even with verified provider evidence", () => {
    const requirement = makeRequirement({
      permissionId: "core:identity.employee_claim.manage",
      resource: employeeResource,
      guard: {
        profileId: "core:rbac.guard.identity_evidence",
        targetResource: employeeResource,
        evidenceState: "verified",
        operation: {
          kind: "employee_claim_manage",
          oldTargetResource: null,
          newTargetResource: employeeResource,
          sourceIdentityResource: sourceExternalIdentityResource,
          oldTargetRequirementId: null,
          sourceIdentityRequirementId: "source-identity",
          sourceIdentityRevisionChecks: [
            { kind: "entity", expected: "1", actual: "1" }
          ],
          actorEmployeeId: employeeId,
          newTargetEmployeeId: employeeId,
          newTargetLifecycle: "active",
          claimPolicyResource: identityClaimPolicyResource,
          claimPolicyState: "approved_active",
          claimPolicyVersion: "1",
          evidencePolicyResource: identityClaimPolicyResource,
          evidencePolicyVersion: "1",
          evidenceResource: identityEvidenceResource,
          evidenceSourceIdentityResource: sourceExternalIdentityResource,
          evidenceTargetResource: employeeResource,
          sensitiveEvidenceIncluded: false,
          evidenceViewRequirementId: null,
          claimPolicyRevisionChecks: [
            { kind: "policy", expected: "1", actual: "1" }
          ],
          evidenceRevisionChecks: [
            { kind: "entity", expected: "1", actual: "1" }
          ],
          targetRevisionChecks: [
            { kind: "entity", expected: "1", actual: "1" }
          ],
          claimHeadResource: resource(
            "core:source-identity-claim-head",
            "source_identity_claim_head:self-claim"
          ),
          claimHeadSourceIdentityResource: sourceExternalIdentityResource,
          currentClaimTargetResource: null,
          expectedClaimVersion: null,
          currentClaimVersion: null,
          claimRevisionChecks: [
            { kind: "relation", expected: "1", actual: "1" }
          ],
          reasonCodeId: "core:verified-manual-claim",
          auditEventResource: resource(
            "core:audit-event",
            "audit_event:self-claim"
          ),
          auditActorEmployeeId: employeeId,
          auditSourceIdentityResource: sourceExternalIdentityResource,
          auditTargetResource: employeeResource,
          auditRevisionChecks: [{ kind: "entity", expected: "1", actual: "1" }]
        }
      }
    });
    const decision = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [requirement],
        [
          makeGrant("core:identity.employee_claim.manage", {
            type: "tenant",
            tenantId
          })
        ]
      )
    );

    expect(decision).toMatchObject({
      outcome: "denied",
      publicErrorCode: "identity.claim_self_forbidden",
      diagnostics: { reason: "separation_of_duties_denied" }
    });
  });

  it("rejects typed self claims and inactive Employee claim targets", () => {
    const baseGuard = {
      profileId: "core:rbac.guard.identity_evidence" as const,
      targetResource: employeeResource,
      evidenceState: "verified" as const,
      operation: {
        kind: "employee_claim_manage" as const,
        oldTargetResource: null,
        newTargetResource: employeeResource,
        sourceIdentityResource: sourceExternalIdentityResource,
        oldTargetRequirementId: null,
        sourceIdentityRequirementId: "source-identity",
        sourceIdentityRevisionChecks: [
          { kind: "entity" as const, expected: "1", actual: "1" }
        ],
        actorEmployeeId: employeeId,
        newTargetEmployeeId: employeeId,
        newTargetLifecycle: "active" as const,
        claimPolicyResource: identityClaimPolicyResource,
        claimPolicyState: "approved_active" as const,
        claimPolicyVersion: "1",
        evidencePolicyResource: identityClaimPolicyResource,
        evidencePolicyVersion: "1",
        evidenceResource: identityEvidenceResource,
        evidenceSourceIdentityResource: sourceExternalIdentityResource,
        evidenceTargetResource: employeeResource,
        sensitiveEvidenceIncluded: false,
        evidenceViewRequirementId: null,
        claimPolicyRevisionChecks: [
          { kind: "policy" as const, expected: "1", actual: "1" }
        ],
        evidenceRevisionChecks: [
          { kind: "entity" as const, expected: "1", actual: "1" }
        ],
        targetRevisionChecks: [
          { kind: "entity" as const, expected: "1", actual: "1" }
        ],
        claimHeadResource: resource(
          "core:source-identity-claim-head",
          "source_identity_claim_head:typed-self-claim"
        ),
        claimHeadSourceIdentityResource: sourceExternalIdentityResource,
        currentClaimTargetResource: null,
        expectedClaimVersion: null,
        currentClaimVersion: null,
        claimRevisionChecks: [
          { kind: "relation" as const, expected: "1", actual: "1" }
        ],
        reasonCodeId: "core:verified-manual-claim",
        auditEventResource: resource(
          "core:audit-event",
          "audit_event:typed-self-claim"
        ),
        auditActorEmployeeId: employeeId,
        auditSourceIdentityResource: sourceExternalIdentityResource,
        auditTargetResource: employeeResource,
        auditRevisionChecks: [
          { kind: "entity" as const, expected: "1", actual: "1" }
        ]
      }
    };
    const grant = makeGrant("core:identity.employee_claim.manage", {
      type: "tenant",
      tenantId
    });
    const nullSelf = makeRequirement({
      permissionId: "core:identity.employee_claim.manage",
      resource: employeeResource,
      guard: baseGuard
    });
    const inactiveOther = makeRequirement({
      permissionId: "core:identity.employee_claim.manage",
      resource: otherEmployeeResource,
      guard: {
        ...baseGuard,
        targetResource: otherEmployeeResource,
        operation: {
          ...baseGuard.operation,
          newTargetResource: otherEmployeeResource,
          newTargetEmployeeId: otherEmployeeId,
          newTargetLifecycle: "inactive",
          evidenceTargetResource: otherEmployeeResource,
          auditTargetResource: otherEmployeeResource
        }
      }
    });

    for (const requirement of [nullSelf, inactiveOther]) {
      expect(
        evaluateInboxV2AuthorizationPlan(makeInput([requirement], [grant]))
          .outcome
      ).toBe("denied");
    }
  });

  it.each([
    "employee_to_client_contact",
    "client_contact_to_employee"
  ] as const)(
    "allows $s cross-kind identity reassignment only with exact old-target revoke and new typed manage authority",
    (direction) => {
      const fixture = makeCrossKindIdentityClaimFixture(direction);

      expect(evaluateInboxV2AuthorizationPlan(fixture.input).outcome).toBe(
        "allowed"
      );

      const withoutOldTargetRevoke = makeInput(
        fixture.input.requirements.filter(
          ({ id }) => id !== fixture.oldTargetRequirementId
        ),
        fixture.input.grants
      );
      expect(
        evaluateInboxV2AuthorizationPlan(withoutOldTargetRevoke).outcome
      ).toBe("denied");

      const substitutedOldTarget = resource(
        String(fixture.oldTargetResource.entityTypeId),
        `substituted:${direction}`
      );
      const reboundOldTargetRevoke = makeInput(
        fixture.input.requirements.map((requirement) => {
          if (requirement.id !== fixture.oldTargetRequirementId) {
            return requirement;
          }
          if (
            requirement.guard.profileId !==
              "core:rbac.guard.identity_evidence" ||
            requirement.guard.operation.kind !== "claim_revoke"
          ) {
            throw new Error("Cross-kind fixture old-target guard is invalid.");
          }
          return {
            ...requirement,
            resource: substitutedOldTarget,
            guard: {
              ...requirement.guard,
              targetResource: substitutedOldTarget,
              operation: {
                ...requirement.guard.operation,
                existingTargetResource: substitutedOldTarget,
                claimTargetResource: substitutedOldTarget,
                auditTargetResource: substitutedOldTarget
              }
            }
          };
        }),
        fixture.input.grants
      );
      expect(
        evaluateInboxV2AuthorizationPlan(reboundOldTargetRevoke).outcome
      ).toBe("denied");

      const wrongManagePermission =
        fixture.newTargetPermissionId === "core:identity.employee_claim.manage"
          ? ("core:identity.client_contact_claim.manage" as const)
          : ("core:identity.employee_claim.manage" as const);
      const wrongNewTargetPermission = makeInput(
        fixture.input.requirements.map((requirement) =>
          requirement.id !== fixture.primaryRequirementId
            ? requirement
            : {
                ...requirement,
                permissionId: wrongManagePermission
              }
        ),
        fixture.input.grants.map((grant) =>
          grant.permissionId !== fixture.newTargetPermissionId
            ? grant
            : { ...grant, permissionId: wrongManagePermission }
        )
      );
      expect(
        evaluateInboxV2AuthorizationPlan(wrongNewTargetPermission).outcome
      ).toBe("denied");
    }
  );

  it("allows a claim at a nonzero head version when the active claim is exactly absent", () => {
    const fixture = makeCrossKindIdentityClaimFixture(
      "client_contact_to_employee"
    );
    const requirements = fixture.input.requirements
      .filter(({ id }) => id !== fixture.oldTargetRequirementId)
      .map((requirement) => {
        if (requirement.id !== fixture.primaryRequirementId) return requirement;
        if (
          requirement.guard.profileId !== "core:rbac.guard.identity_evidence" ||
          requirement.guard.operation.kind !== "employee_claim_manage"
        ) {
          throw new Error(
            "Identity re-claim fixture primary guard is invalid."
          );
        }
        return {
          ...requirement,
          guard: {
            ...requirement.guard,
            operation: {
              ...requirement.guard.operation,
              oldTargetResource: null,
              oldTargetRequirementId: null,
              currentClaimTargetResource: null,
              expectedClaimVersion: "1",
              currentClaimVersion: "1"
            }
          }
        };
      });

    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput(requirements, fixture.input.grants)
      ).outcome
    ).toBe("allowed");
  });

  it("requires real underlying read authority for report drilldown", () => {
    const drilldown = makeRequirement({
      id: "drilldown",
      permissionId: "core:reports.drilldown",
      resource: reportResource,
      guard: {
        profileId: "core:rbac.guard.report_resource_conjunction",
        targetResource: reportResource,
        accessLevel: "drilldown",
        layerRequirementIds: ["aggregate"],
        underlyingRequirementIds: ["row-read"],
        underlyingResources: [conversationResource],
        manifestResource: resource(
          "core:authorization-manifest",
          "authorization_manifest:drilldown"
        ),
        manifestTargetResource: reportResource,
        manifestRevisionChecks: [
          { kind: "manifest", expected: "1", actual: "1" }
        ],
        scopeAppliedBeforeCountAndPagination: true,
        privateInternalIncluded: false,
        privateInternalRequirementIds: []
      }
    });
    const fakeRead = makeRequirement({
      id: "row-read",
      permissionId: "core:queue.manage",
      visibility: "secondary_hidden"
    });
    const aggregate = makeRequirement({
      id: "aggregate",
      permissionId: "core:reports.view",
      resource: reportResource,
      guard: {
        ...canonicalGuard,
        action: {
          kind: "report_aggregate",
          targetResource: reportResource,
          privacy: safeReportPrivacyEvidence()
        }
      }
    });
    const decision = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [drilldown, fakeRead, aggregate],
        [
          makeGrant(
            "core:reports.drilldown",
            { type: "tenant", tenantId },
            "grant-report"
          ),
          makeGrant(
            "core:queue.manage",
            { type: "tenant", tenantId },
            "grant-fake-read"
          ),
          makeGrant(
            "core:reports.view",
            { type: "tenant", tenantId },
            "grant-aggregate"
          )
        ]
      )
    );

    expect(decision).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "secondary_resource_denied" }
    });
  });

  it("requires client.contacts.view for Client PII report rows", () => {
    const clientRead = (
      id: string,
      permissionId: "core:client.view" | "core:client.contacts.view"
    ) =>
      makeRequirement({
        id,
        permissionId,
        resource: clientResource,
        scopeFacts: [
          {
            kind: "client",
            ...scopePath(clientResource, clientResource),
            clientId,
            validUntil: LATER
          }
        ],
        visibility: "secondary_hidden",
        guard: {
          profileId: "core:rbac.guard.client_context",
          target: { kind: "client", clientId },
          accessPath: "exact_client_binding",
          pathEvidence: exactClientBindingPathEvidence({
            targetResource: clientResource,
            clientResource,
            authorityResource: clientResource,
            suffix: id
          }),
          contextualRequirementIds: [],
          linkedClientRequirementIds: []
        }
      });
    const reportView = {
      ...makeReportViewRequirement("pii-report-view"),
      visibility: "secondary_hidden" as const
    };
    const rowRead = clientRead("client-row-read", "core:client.view");
    const contactRead = clientRead(
      "client-contact-read",
      "core:client.contacts.view"
    );
    const drilldown = makeRequirement({
      id: "pii-report-drilldown",
      permissionId: "core:reports.drilldown",
      resource: reportResource,
      visibility: "secondary_hidden",
      guard: {
        profileId: "core:rbac.guard.report_resource_conjunction",
        targetResource: reportResource,
        accessLevel: "drilldown",
        layerRequirementIds: ["pii-report-view"],
        underlyingRequirementIds: ["client-row-read"],
        underlyingResources: [clientResource],
        manifestResource: resource(
          "core:authorization-manifest",
          "authorization_manifest:pii-drilldown"
        ),
        manifestTargetResource: reportResource,
        manifestRevisionChecks: [
          { kind: "manifest", expected: "1", actual: "1" }
        ],
        scopeAppliedBeforeCountAndPagination: true,
        privateInternalIncluded: false,
        privateInternalRequirementIds: []
      }
    });
    const pii = (underlyingRequirementId: string) =>
      makeRequirement({
        id: "pii-report-view-layer",
        permissionId: "core:reports.pii.view",
        resource: reportResource,
        guard: {
          profileId: "core:rbac.guard.report_resource_conjunction",
          targetResource: reportResource,
          accessLevel: "pii",
          layerRequirementIds: ["pii-report-view", "pii-report-drilldown"],
          underlyingRequirementIds: [underlyingRequirementId],
          underlyingResources: [clientResource],
          manifestResource: resource(
            "core:authorization-manifest",
            "authorization_manifest:pii-view"
          ),
          manifestTargetResource: reportResource,
          manifestRevisionChecks: [
            { kind: "manifest", expected: "1", actual: "1" }
          ],
          scopeAppliedBeforeCountAndPagination: true,
          privateInternalIncluded: false,
          privateInternalRequirementIds: []
        }
      });
    const grants = [
      makeGrant("core:reports.view", { type: "tenant", tenantId }, "report"),
      makeGrant(
        "core:reports.drilldown",
        { type: "tenant", tenantId },
        "drilldown"
      ),
      makeGrant("core:reports.pii.view", { type: "tenant", tenantId }, "pii"),
      makeGrant(
        "core:client.view",
        { type: "client", tenantId, id: clientId },
        "client-read"
      ),
      makeGrant(
        "core:client.contacts.view",
        { type: "client", tenantId, id: clientId },
        "contact-read"
      )
    ];

    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [pii("client-row-read"), drilldown, reportView, rowRead],
          grants
        )
      ).outcome
    ).toBe("denied");
    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [
            pii("client-contact-read"),
            drilldown,
            reportView,
            rowRead,
            contactRead
          ],
          grants
        )
      ).outcome
    ).toBe("allowed");
  });

  it("enforces privacy policy, hold and tenant-export separation/revisions", () => {
    const policy = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [
          makeRequirement({
            permissionId: "core:privacy.policy.manage",
            resource: resource(
              "core:data-lifecycle-policy",
              "privacy_policy:policy-1"
            ),
            guard: {
              profileId: "core:rbac.guard.privacy_policy_revision",
              targetResource: resource(
                "core:data-lifecycle-policy",
                "privacy_policy:policy-1"
              ),
              policyId: "policy-1",
              governanceContextId: "governance-1",
              governanceContextResource: resource(
                "core:governance-context",
                "governance_context:governance-1"
              ),
              governanceRelationResource: resource(
                "core:privacy-policy-governance-binding",
                "privacy_policy_governance_binding:policy-1"
              ),
              governancePolicyResource: resource(
                "core:data-lifecycle-policy",
                "privacy_policy:policy-1"
              ),
              governanceRelationContextResource: resource(
                "core:governance-context",
                "governance_context:governance-1"
              ),
              governanceRevisionChecks: [
                {
                  resource: resource(
                    "core:privacy-policy-governance-binding",
                    "privacy_policy_governance_binding:policy-1"
                  ),
                  expected: "1",
                  actual: "1"
                },
                {
                  resource: resource(
                    "core:data-lifecycle-policy",
                    "privacy_policy:policy-1"
                  ),
                  expected: "1",
                  actual: "1"
                },
                {
                  resource: resource(
                    "core:governance-context",
                    "governance_context:governance-1"
                  ),
                  expected: "1",
                  actual: "1"
                }
              ],
              expectedGovernanceRevision: "1",
              currentGovernanceRevision: "1",
              expectedPolicyRevision: "2",
              currentPolicyRevision: "2",
              phase: "activate",
              actingEmployeeId: employeeId,
              requesterEmployeeId: employeeId,
              approverEmployeeId: employeeId,
              activationEvidence: null,
              contentAuthorityRequested: false
            }
          })
        ],
        [
          makeGrant("core:privacy.policy.manage", {
            type: "tenant",
            tenantId
          })
        ]
      )
    );
    const holdResource = resource("core:privacy-hold", "privacy_hold:hold-1");
    const holdFixture = makePrivacyHoldFixture({
      permissionId: "core:privacy.hold.release",
      holdResource,
      holdId: "hold-1",
      phase: "release",
      reason: "legal dispute",
      reviewerEmployeeId: thirdEmployeeId,
      issuerEmployeeId: otherEmployeeId,
      releaserEmployeeId: employeeId
    });
    const hold = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [
          makeRequirement({
            permissionId: "core:privacy.hold.release",
            resource: holdResource,
            guard: {
              ...holdFixture.guard,
              manifestAuthenticity: "ambiguous"
            }
          }),
          ...holdFixture.requirements
        ],
        [
          makeGrant("core:privacy.hold.release", {
            type: "tenant",
            tenantId
          }),
          ...holdFixture.grants
        ]
      )
    );
    const exportResource = resource(
      "core:privacy-export-job",
      "privacy_tenant_export:export-1"
    );
    const exportFixture = makePrivacyTenantExportFixture({
      exportResource,
      exportId: "export-1"
    });
    const tenantExport = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [
          makeRequirement({
            permissionId: "core:privacy.tenant_export",
            resource: exportResource,
            guard: {
              ...exportFixture.guard,
              currentGraphHighWater: "9"
            }
          }),
          ...exportFixture.requirements
        ],
        [
          makeGrant("core:privacy.tenant_export", {
            type: "tenant",
            tenantId
          }),
          ...exportFixture.grants
        ]
      )
    );

    expect(policy).toMatchObject({
      outcome: "denied",
      publicErrorCode: "privacy.separation_of_duties"
    });
    expect(hold).toMatchObject({
      outcome: "denied",
      publicErrorCode: "privacy.scope_ambiguous"
    });
    expect(tenantExport).toMatchObject({
      outcome: "denied",
      publicErrorCode: "privacy.revision_changed"
    });
  });

  it("activates a privacy policy only through exact current approval evidence", () => {
    type PrivacyPolicyGuard = Extract<
      InboxV2PolicyGuardEvidence,
      { profileId: "core:rbac.guard.privacy_policy_revision" }
    >;
    const policyResource = resource(
      "core:data-lifecycle-policy",
      "data_lifecycle_policy:activation"
    );
    const governanceResource = resource(
      "core:governance-context",
      "governance_context:activation"
    );
    const governanceRelationResource = resource(
      "core:privacy-policy-governance-binding",
      "privacy_policy_governance_binding:activation"
    );
    const previewResource = resource(
      "core:privacy-policy-preview",
      "privacy_policy_preview:activation"
    );
    const impactResource = resource(
      "core:privacy-policy-impact-manifest",
      "privacy_policy_impact_manifest:activation"
    );
    const approvalResource = resource(
      "core:privacy-policy-approval",
      "privacy_policy_approval:activation"
    );
    const activationLedgerResource = resource(
      "core:privacy-policy-activation-ledger",
      "privacy_policy_activation_ledger:activation"
    );
    const guard: PrivacyPolicyGuard = {
      profileId: "core:rbac.guard.privacy_policy_revision",
      targetResource: policyResource,
      policyId: "activation",
      governanceContextId: "activation",
      governanceContextResource: governanceResource,
      governanceRelationResource,
      governancePolicyResource: policyResource,
      governanceRelationContextResource: governanceResource,
      governanceRevisionChecks: [
        { resource: governanceRelationResource, expected: "1", actual: "1" },
        { resource: policyResource, expected: "2", actual: "2" },
        { resource: governanceResource, expected: "1", actual: "1" }
      ],
      expectedGovernanceRevision: "1",
      currentGovernanceRevision: "1",
      expectedPolicyRevision: "2",
      currentPolicyRevision: "2",
      phase: "activate",
      actingEmployeeId: employeeId,
      requesterEmployeeId: otherEmployeeId,
      approverEmployeeId: employeeId,
      activationEvidence: {
        previewResource,
        previewPolicyResource: policyResource,
        previewRequesterEmployeeResource: otherEmployeeResource,
        previewGovernanceContextResource: governanceResource,
        impactManifestResource: impactResource,
        impactManifestPolicyResource: policyResource,
        impactManifestPreviewResource: previewResource,
        impactManifestGovernanceContextResource: governanceResource,
        approvalResource,
        approvalPolicyResource: policyResource,
        approvalPreviewResource: previewResource,
        approvalImpactManifestResource: impactResource,
        approvalGovernanceContextResource: governanceResource,
        approvalRequesterEmployeeResource: otherEmployeeResource,
        approvalApproverEmployeeResource: employeeResource,
        activationLedgerResource,
        activationLedgerPolicyResource: policyResource,
        activationLedgerGovernanceContextResource: governanceResource,
        activationLedgerGovernanceRelationResource: governanceRelationResource,
        activationLedgerPreviewResource: previewResource,
        activationLedgerImpactManifestResource: impactResource,
        activationLedgerApprovalResource: approvalResource,
        approverDirectoryRequirementId: "policy-activation-approver-directory",
        approverGrantId: "policy-activation-grant",
        approverLifecycle: "active",
        approvalState: "approved",
        revisionChecks: [
          { resource: previewResource, expected: "1", actual: "1" },
          { resource: impactResource, expected: "1", actual: "1" },
          { resource: approvalResource, expected: "1", actual: "1" },
          { resource: activationLedgerResource, expected: "1", actual: "1" },
          { resource: policyResource, expected: "2", actual: "2" },
          { resource: governanceResource, expected: "1", actual: "1" },
          {
            resource: governanceRelationResource,
            expected: "1",
            actual: "1"
          },
          { resource: otherEmployeeResource, expected: "1", actual: "1" },
          { resource: employeeResource, expected: "1", actual: "1" }
        ],
        coolingPeriodEndsAt: NOW,
        approvalNotAfter: GRANT_END
      },
      contentAuthorityRequested: false
    };
    const approverDirectory = makeRequirement({
      id: "policy-activation-approver-directory",
      permissionId: "core:employee.directory.view",
      resource: employeeResource,
      visibility: "secondary_hidden"
    });
    const grants = [
      makeGrant(
        "core:privacy.policy.manage",
        { type: "tenant", tenantId },
        "policy-activation-grant"
      ),
      makeGrant(
        "core:employee.directory.view",
        { type: "tenant", tenantId },
        "policy-activation-directory-grant"
      )
    ];
    const decide = (candidate: PrivacyPolicyGuard) =>
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [
            makeRequirement({
              id: "policy-activation",
              permissionId: "core:privacy.policy.manage",
              resource: policyResource,
              guard: candidate
            }),
            approverDirectory
          ],
          grants
        )
      );

    expect(decide(guard).outcome).toBe("allowed");
    expect(
      decide({ ...guard, requesterEmployeeId: thirdEmployeeId }).outcome
    ).toBe("denied");
    const foreignRelation = resource(
      "core:privacy-policy-governance-binding",
      "privacy_policy_governance_binding:activation",
      otherTenantId
    );
    expect(
      decide({
        ...guard,
        governanceRelationResource: foreignRelation,
        governanceRevisionChecks: guard.governanceRevisionChecks.map(
          (check, index) =>
            index === 0 ? { ...check, resource: foreignRelation } : check
        )
      }).outcome
    ).toBe("denied");
    const foreignPreview = resource(
      "core:privacy-policy-preview",
      "privacy_policy_preview:activation",
      otherTenantId
    );
    expect(
      decide({
        ...guard,
        activationEvidence: {
          ...guard.activationEvidence!,
          previewResource: foreignPreview,
          revisionChecks: guard.activationEvidence!.revisionChecks.map(
            (check, index) =>
              index === 0 ? { ...check, resource: foreignPreview } : check
          )
        }
      }).outcome
    ).toBe("denied");
    const unreviewedPreview = resource(
      "core:privacy-policy-preview",
      "privacy_policy_preview:unreviewed"
    );
    expect(
      decide({
        ...guard,
        activationEvidence: {
          ...guard.activationEvidence!,
          previewResource: unreviewedPreview,
          impactManifestPreviewResource: unreviewedPreview,
          revisionChecks: guard.activationEvidence!.revisionChecks.map(
            (check) =>
              check.resource.entityId === previewResource.entityId
                ? { ...check, resource: unreviewedPreview }
                : check
          )
        }
      }).outcome
    ).toBe("denied");
    const unreviewedImpact = resource(
      "core:privacy-policy-impact-manifest",
      "privacy_policy_impact_manifest:unreviewed"
    );
    expect(
      decide({
        ...guard,
        activationEvidence: {
          ...guard.activationEvidence!,
          impactManifestResource: unreviewedImpact,
          revisionChecks: guard.activationEvidence!.revisionChecks.map(
            (check) =>
              check.resource.entityId === impactResource.entityId
                ? { ...check, resource: unreviewedImpact }
                : check
          )
        }
      }).outcome
    ).toBe("denied");
    const foreignActivationLedger = resource(
      "core:privacy-policy-activation-ledger",
      "privacy_policy_activation_ledger:activation",
      otherTenantId
    );
    expect(
      decide({
        ...guard,
        activationEvidence: {
          ...guard.activationEvidence!,
          activationLedgerResource: foreignActivationLedger,
          revisionChecks: guard.activationEvidence!.revisionChecks.map(
            (check) =>
              check.resource.entityId === activationLedgerResource.entityId
                ? { ...check, resource: foreignActivationLedger }
                : check
          )
        }
      }).outcome
    ).toBe("denied");
    expect(
      decide({
        ...guard,
        activationEvidence: {
          ...guard.activationEvidence!,
          revisionChecks: guard.activationEvidence!.revisionChecks.map(
            (check) =>
              check.resource.entityId === policyResource.entityId
                ? { ...check, expected: "3", actual: "3" }
                : check
          )
        }
      }).outcome
    ).toBe("denied");
    expect(
      decide({
        ...guard,
        activationEvidence: {
          ...guard.activationEvidence!,
          approverLifecycle: "inactive"
        }
      }).outcome
    ).toBe("denied");
  });

  it("keeps third-party privacy evidence purpose policy tenant-local", () => {
    type SubjectEvidenceGuard = Extract<
      InboxV2PolicyGuardEvidence,
      { profileId: "core:rbac.guard.privacy_subject_evidence_roots" }
    >;
    const row = requiredFamilyMatrixRow("privacy_root");
    const primary = row.input.requirements.find(
      ({ permissionId }) =>
        permissionId === "core:privacy.subject_evidence.view"
    );
    if (
      primary?.guard.profileId !==
      "core:rbac.guard.privacy_subject_evidence_roots"
    ) {
      throw new Error("privacy root matrix row is not typed");
    }
    const purposePolicyResource = resource(
      "core:privacy-purpose-policy",
      "privacy_purpose_policy:case-review"
    );
    const guard: SubjectEvidenceGuard = {
      ...primary.guard,
      thirdPartyPolicy: "allow_with_purpose",
      purpose: "core:case-review",
      purposePolicy: {
        resource: purposePolicyResource,
        targetResource: primary.resource,
        approvedPurposeIds: ["core:case-review"],
        revisionChecks: [
          { resource: purposePolicyResource, expected: "1", actual: "1" },
          { resource: primary.resource, expected: "1", actual: "1" }
        ],
        notAfter: GRANT_END
      }
    };
    const decide = (candidate: SubjectEvidenceGuard) =>
      evaluateInboxV2AuthorizationPlan({
        ...row.input,
        requirements: row.input.requirements.map((requirement) =>
          requirement.id === primary.id
            ? { ...requirement, guard: candidate }
            : requirement
        )
      });

    expect(decide(guard).outcome).toBe("allowed");
    const foreignPolicy = resource(
      "core:privacy-purpose-policy",
      "privacy_purpose_policy:case-review",
      otherTenantId
    );
    expect(
      decide({
        ...guard,
        purposePolicy: {
          ...guard.purposePolicy!,
          resource: foreignPolicy,
          revisionChecks: [
            { resource: foreignPolicy, expected: "1", actual: "1" },
            { resource: primary.resource, expected: "1", actual: "1" }
          ]
        }
      }).outcome
    ).toBe("denied");
  });

  it("uses the canonical data-lifecycle policy resource type", () => {
    const policyResource = resource(
      "core:data-lifecycle-policy",
      "data_lifecycle_policy:policy-1"
    );
    const policy = (targetResource: InboxV2EntityKey) =>
      makeRequirement({
        permissionId: "core:privacy.policy.view",
        resource: targetResource,
        guard: {
          profileId: "core:rbac.guard.privacy_policy_revision",
          targetResource,
          policyId: "policy-1",
          governanceContextId: "governance-1",
          governanceContextResource: resource(
            "core:governance-context",
            "governance_context:governance-1"
          ),
          governanceRelationResource: resource(
            "core:privacy-policy-governance-binding",
            "privacy_policy_governance_binding:policy-view"
          ),
          governancePolicyResource: targetResource,
          governanceRelationContextResource: resource(
            "core:governance-context",
            "governance_context:governance-1"
          ),
          governanceRevisionChecks: [
            {
              resource: resource(
                "core:privacy-policy-governance-binding",
                "privacy_policy_governance_binding:policy-view"
              ),
              expected: "1",
              actual: "1"
            },
            { resource: targetResource, expected: "1", actual: "1" },
            {
              resource: resource(
                "core:governance-context",
                "governance_context:governance-1"
              ),
              expected: "1",
              actual: "1"
            }
          ],
          expectedGovernanceRevision: "1",
          currentGovernanceRevision: "1",
          expectedPolicyRevision: "1",
          currentPolicyRevision: "1",
          phase: "view",
          actingEmployeeId: employeeId,
          requesterEmployeeId: employeeId,
          approverEmployeeId: null,
          activationEvidence: null,
          contentAuthorityRequested: false
        }
      });
    const grant = makeGrant("core:privacy.policy.view", {
      type: "tenant",
      tenantId
    });

    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput([policy(policyResource)], [grant])
      ).outcome
    ).toBe("allowed");
    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [policy(resource("core:privacy-policy", "privacy_policy:policy-1"))],
          [grant]
        )
      ).outcome
    ).toBe("denied");
  });

  it("pins privacy decisions to exact roots, governance and entity types", () => {
    const caseResource = resource(
      "core:privacy-request",
      "privacy_request_case:case-1"
    );
    const governanceResource = resource(
      "core:governance-context",
      "governance_context:governance-1"
    );
    const proofResource = resource(
      "core:privacy-discovery-proof",
      "privacy_discovery_proof:proof-1"
    );
    const discoveryManifestResource = resource(
      "core:privacy-discovery-manifest",
      "privacy_discovery_manifest:case-1"
    );
    const policyRuleResource = resource(
      "core:data-lifecycle-policy-rule",
      "data_lifecycle_policy_rule:rule-1"
    );
    const requesterEmployeeResource = resource(
      "core:employee",
      String(otherEmployeeId)
    );
    const deciderEmployeeResource = resource(
      "core:employee",
      String(employeeId)
    );
    const partyBindingResource = resource(
      "core:privacy-request-party-binding",
      "privacy_request_party_binding:case-1"
    );
    const decisionLedgerResource = resource(
      "core:privacy-request-decision-ledger",
      "privacy_request_decision_ledger:case-1"
    );
    const rootDecisionManifestResource = resource(
      "core:privacy-request-root-decision-manifest",
      "privacy_request_root_decision_manifest:case-1"
    );
    const guard: Extract<
      InboxV2PolicyGuardEvidence,
      { profileId: "core:rbac.guard.privacy_request_roots_revision" }
    > = {
      profileId: "core:rbac.guard.privacy_request_roots_revision",
      targetResource: caseResource,
      caseId: "case-1",
      casePartyEvidence: {
        bindingResource: partyBindingResource,
        bindingCaseResource: caseResource,
        requesterEmployeeResource,
        bindingRequesterEmployeeResource: requesterEmployeeResource,
        state: "immutable",
        revisionChecks: [
          { resource: partyBindingResource, expected: "1", actual: "1" },
          { resource: caseResource, expected: "1", actual: "1" },
          { resource: requesterEmployeeResource, expected: "1", actual: "1" }
        ]
      },
      verificationState: "verified",
      expectedRootsRevision: "2",
      currentRootsRevision: "2",
      governanceContextResource: governanceResource,
      expectedGovernanceRevision: "3",
      currentGovernanceRevision: "3",
      discoveryManifestResource,
      discoveryManifestTargetResource: caseResource,
      discoveryManifestRevisionChecks: [
        { resource: discoveryManifestResource, expected: "4", actual: "4" },
        { resource: caseResource, expected: "2", actual: "2" }
      ],
      discoveryManifestRootResources: [conversationResource],
      discoveryManifestMembershipRevisionChecks: [
        { resource: discoveryManifestResource, expected: "4", actual: "4" },
        { resource: caseResource, expected: "2", actual: "2" },
        { resource: conversationResource, expected: "5", actual: "5" }
      ],
      rootDecisions: [
        {
          rootResource: conversationResource,
          discoveryProofResource: proofResource,
          proofRequestResource: caseResource,
          proofRootResource: conversationResource,
          proofRevisionChecks: [
            { resource: proofResource, expected: "4", actual: "4" },
            { resource: caseResource, expected: "2", actual: "2" },
            { resource: conversationResource, expected: "5", actual: "5" }
          ],
          policyRuleId: "rule-1",
          policyRuleResource,
          policyRuleRequestResource: caseResource,
          policyRuleRootResource: conversationResource,
          policyRuleState: "active",
          policyRuleRevisionChecks: [
            { resource: policyRuleResource, expected: "3", actual: "3" },
            { resource: caseResource, expected: "2", actual: "2" },
            { resource: conversationResource, expected: "5", actual: "5" }
          ],
          expectedDecisionRevision: "5",
          currentDecisionRevision: "5",
          decisionState: "pending"
        }
      ],
      phase: "decide",
      actingEmployeeId: employeeId,
      requesterEmployeeId: otherEmployeeId,
      deciderEmployeeId: employeeId,
      executorEmployeeId: null,
      decisionLedger: {
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
            policyRuleId: "rule-1",
            policyRuleResource,
            decisionState: "pending",
            expectedDecisionRevision: "5",
            currentDecisionRevision: "5"
          }
        ],
        rootManifestDecisionSetDigest: "decision-set:case-1:v1",
        ledgerDecisionSetDigest: "decision-set:case-1:v1",
        state: "pending",
        revisionChecks: [
          { resource: decisionLedgerResource, expected: "1", actual: "1" },
          { resource: caseResource, expected: "2", actual: "2" },
          { resource: requesterEmployeeResource, expected: "1", actual: "1" },
          { resource: deciderEmployeeResource, expected: "1", actual: "1" },
          { resource: discoveryManifestResource, expected: "4", actual: "4" },
          {
            resource: rootDecisionManifestResource,
            expected: "1",
            actual: "1"
          },
          { resource: conversationResource, expected: "5", actual: "5" },
          { resource: proofResource, expected: "4", actual: "4" },
          { resource: policyRuleResource, expected: "3", actual: "3" }
        ]
      },
      executorRelation: null,
      contentAuthorityDerivedFromRequester: false
    };
    const requirement = (
      guardEvidence: typeof guard,
      resourceKey = caseResource
    ) =>
      makeRequirement({
        permissionId: "core:privacy.request.decide",
        resource: resourceKey,
        guard: { ...guardEvidence, targetResource: resourceKey }
      });
    const grant = makeGrant("core:privacy.request.decide", {
      type: "tenant",
      tenantId
    });

    expect(
      evaluateInboxV2AuthorizationPlan(makeInput([requirement(guard)], [grant]))
        .outcome
    ).toBe("allowed");
    for (const denied of [
      requirement({ ...guard, rootDecisions: [] }),
      requirement({
        ...guard,
        currentGovernanceRevision: "4"
      }),
      requirement(
        guard,
        resource("core:conversation", "privacy_request_case:case-1")
      )
    ]) {
      expect(
        evaluateInboxV2AuthorizationPlan(makeInput([denied], [grant])).outcome
      ).toBe("denied");
    }
  });

  it("requires a current review and non-empty reason for hold release", () => {
    const holdResource = resource(
      "core:privacy-hold",
      "privacy_hold:hold-release"
    );
    const fixture = makePrivacyHoldFixture({
      permissionId: "core:privacy.hold.release",
      holdResource,
      holdId: "hold-release",
      phase: "release",
      reason: "",
      reviewerEmployeeId: thirdEmployeeId,
      issuerEmployeeId: otherEmployeeId,
      releaserEmployeeId: employeeId
    });
    const requirement = makeRequirement({
      permissionId: "core:privacy.hold.release",
      resource: holdResource,
      guard: fixture.guard
    });

    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [requirement, ...fixture.requirements],
          [
            makeGrant("core:privacy.hold.release", {
              type: "tenant",
              tenantId
            }),
            ...fixture.grants
          ]
        )
      )
    ).toMatchObject({
      outcome: "denied",
      publicErrorCode: "privacy.separation_of_duties"
    });

    const nextReviewAt = "2026-07-12T10:10:00.000Z";
    const allowed = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [
          makeRequirement({
            permissionId: "core:privacy.hold.release",
            resource: holdResource,
            guard: {
              ...fixture.guard,
              reason: "verified legal release",
              nextReviewAt
            }
          }),
          ...fixture.requirements
        ],
        [
          makeGrant("core:privacy.hold.release", {
            type: "tenant",
            tenantId
          }),
          ...fixture.grants
        ]
      )
    );
    expect(allowed).toMatchObject({
      outcome: "allowed",
      notAfter: nextReviewAt
    });
  });

  it("does not accept an unrelated allowed permission as staff-note read authority", () => {
    const note = makeRequirement({
      id: "note",
      permissionId: "core:message.staff_note.create",
      guard: {
        profileId: "core:rbac.guard.canonical_resource",
        resourceState: "active",
        contentBoundary: "staff_only",
        routeInputFields: [],
        companionRequirementIds: ["fake-read"],
        action: { kind: "canonical" }
      }
    });
    const fakeRead = makeRequirement({
      id: "fake-read",
      permissionId: "core:inbox.read"
    });
    const decision = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [note, fakeRead],
        [
          makeGrant(
            "core:message.staff_note.create",
            { type: "tenant", tenantId },
            "grant-note"
          ),
          makeGrant(
            "core:inbox.read",
            { type: "tenant", tenantId },
            "grant-fake"
          )
        ]
      )
    );

    expect(decision).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "secondary_resource_denied" }
    });
  });

  it("cannot replay an exact-scope fact from Conversation A against Conversation B", () => {
    const decision = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [
          makeRequirement({
            resource: hiddenConversationResource,
            permissionId: "core:conversation.read",
            scopeFacts: [
              {
                kind: "conversation",
                ...scopePath(conversationResource, conversationResource),
                conversationId,
                validUntil: LATER
              }
            ]
          })
        ],
        [
          makeGrant("core:conversation.read", {
            type: "conversation",
            tenantId,
            id: conversationId
          })
        ]
      )
    );

    expect(decision).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "scope_not_matched" }
    });
    const forgedAnchor = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [
          makeRequirement({
            resource: hiddenConversationResource,
            permissionId: "core:conversation.read",
            scopeFacts: [
              {
                kind: "conversation",
                ...scopePath(
                  hiddenConversationResource,
                  hiddenConversationResource
                ),
                conversationId,
                validUntil: LATER
              }
            ]
          })
        ],
        [
          makeGrant("core:conversation.read", {
            type: "conversation",
            tenantId,
            id: conversationId
          })
        ]
      )
    );
    expect(forgedAnchor).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "scope_not_matched" }
    });
  });

  it("fails closed for malformed canonical-fact and non-V2 grant provenance", () => {
    const validPath = scopePath(conversationResource, conversationResource);
    const { authorityProvenance: _ignored, ...pathWithoutProvenance } =
      validPath;
    const malformedFact = {
      kind: "conversation",
      ...pathWithoutProvenance,
      conversationId,
      validUntil: LATER
    } as unknown as InboxV2CanonicalScopeFact;
    const factDecision = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [
          makeRequirement({
            permissionId: "core:conversation.read",
            scopeFacts: [malformedFact]
          })
        ],
        [
          makeGrant("core:conversation.read", {
            type: "conversation",
            tenantId,
            id: conversationId
          })
        ]
      )
    );
    const legacyGrant = {
      ...makeGrant("core:inbox.read", { type: "tenant", tenantId }),
      catalogVersion: "legacy-v1"
    } as unknown as InboxV2PolicyGrant;
    const grantDecision = evaluateInboxV2AuthorizationPlan(
      makeInput([makeRequirement()], [legacyGrant])
    );
    const malformedResourceFact = {
      kind: "conversation",
      ...validPath,
      resource: null,
      pathRevisionChecks: [null],
      conversationId,
      validUntil: LATER
    } as unknown as InboxV2CanonicalScopeFact;
    const malformedResourceDecision = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [
          makeRequirement({
            permissionId: "core:conversation.read",
            scopeFacts: [malformedResourceFact]
          })
        ],
        [
          makeGrant("core:conversation.read", {
            type: "conversation",
            tenantId,
            id: conversationId
          })
        ]
      )
    );
    const malformedGrant = {
      ...makeGrant("core:inbox.read", { type: "tenant", tenantId }),
      principal: null,
      scope: null
    } as unknown as InboxV2PolicyGrant;
    const malformedGrantDecision = evaluateInboxV2AuthorizationPlan(
      makeInput([makeRequirement()], [malformedGrant])
    );
    const employeeWithServiceProvenance = {
      ...makeGrant("core:inbox.read", { type: "tenant", tenantId }),
      source: {
        kind: "service_registration",
        origin: "inbox_v2_native",
        serviceRegistrationId: "forged-service-registration",
        bindingResource: resource(
          "core:service-registration",
          "service_registration:forged-service-registration"
        ),
        bindingRevision: revision
      }
    } as unknown as InboxV2PolicyGrant;
    const mismatchedProvenanceDecision = evaluateInboxV2AuthorizationPlan(
      makeInput([makeRequirement()], [employeeWithServiceProvenance])
    );

    expect(factDecision).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "scope_not_matched" }
    });
    expect(grantDecision).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "hard_boundary_denied" }
    });
    expect(malformedResourceDecision).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "scope_not_matched" }
    });
    expect(malformedGrantDecision).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "hard_boundary_denied" }
    });
    expect(mismatchedProvenanceDecision).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "hard_boundary_denied" }
    });
  });

  it("rejects self-referencing and cyclic companion plans", () => {
    const self = makeRequirement({
      id: "self",
      guard: {
        ...canonicalGuard,
        companionRequirementIds: ["self"]
      }
    });
    const left = makeRequirement({
      id: "left",
      guard: { ...canonicalGuard, companionRequirementIds: ["right"] }
    });
    const right = makeRequirement({
      id: "right",
      guard: { ...canonicalGuard, companionRequirementIds: ["left"] }
    });
    const grant = makeGrant("core:inbox.read", {
      type: "tenant",
      tenantId
    });

    expect(
      evaluateInboxV2AuthorizationPlan(makeInput([self], [grant]))
    ).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "hard_boundary_denied" }
    });
    expect(
      evaluateInboxV2AuthorizationPlan(makeInput([left, right], [grant]))
    ).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "hard_boundary_denied" }
    });
  });

  it("does not let an ordinary internal member manage members or moderate", () => {
    const scopeFact: InboxV2CanonicalScopeFact = {
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
    };
    const guard: InboxV2PolicyGuardEvidence = {
      profileId: "core:rbac.guard.internal_membership",
      conversationId,
      employeeId,
      membershipState: "active",
      membershipOrigin: "hulee_internal_command",
      membershipRole: "member",
      contentBoundary: "internal",
      validUntil: LATER
    };
    for (const permissionId of [
      "core:conversation.internal.members.manage",
      "core:message.moderate_internal"
    ] as const) {
      const decision = evaluateInboxV2AuthorizationPlan(
        makeInput(
          [makeRequirement({ permissionId, scopeFacts: [scopeFact], guard })],
          [
            makeGrant(permissionId, {
              type: "internal_participant",
              tenantId
            })
          ]
        )
      );
      expect(decision).toMatchObject({
        outcome: "denied",
        diagnostics: { reason: "hard_boundary_denied" }
      });
    }
  });

  it("does not let a role binding masquerade as direct break-glass", () => {
    const requirement = makeRequirement({
      permissionId: "core:conversation.internal.break_glass_read",
      scopeFacts: [
        {
          kind: "conversation",
          ...scopePath(conversationResource, conversationResource),
          conversationId,
          validUntil: GRANT_END
        }
      ],
      guard: {
        profileId: "core:rbac.guard.internal_break_glass_read",
        conversationId,
        exactGrantConversationId: conversationId,
        grantKind: "direct_grant",
        reason: "incident",
        auditEventId: "audit-1",
        audit: privilegedAudit(
          "internal_break_glass_read",
          conversationResource,
          resource("core:audit-event", "audit-1")
        ),
        accessMode: "read_only",
        validUntil: GRANT_END
      }
    });
    const roleGrant: InboxV2PolicyGrant = {
      ...makeGrant("core:conversation.internal.break_glass_read", {
        type: "conversation",
        tenantId,
        id: conversationId
      }),
      source: {
        kind: "role_binding",
        origin: "inbox_v2_native",
        roleBindingId: "role-binding-1",
        bindingResource: resource(
          "core:role-binding",
          "role_binding:role-binding-1"
        ),
        bindingRevision: revision
      }
    };

    expect(
      evaluateInboxV2AuthorizationPlan(makeInput([requirement], [roleGrant]))
    ).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "hard_boundary_denied" }
    });
  });

  it("applies distinct WorkItem rules for read, claim, reopen and release override", () => {
    const terminalRead = makeWorkRequirement({
      id: "terminal-read",
      permissionId: "core:work.read",
      operation: "read",
      workState: "terminal",
      actorRelation: "none",
      assignmentState: "assigned"
    });
    const claim = makeWorkRequirement({
      id: "claim",
      permissionId: "core:work.claim",
      operation: "claim",
      workState: "active",
      actorRelation: "queue_member",
      assignmentState: "unassigned",
      destinationRequirementIds: ["claim-queue"],
      destinationResources: [queueResource]
    });
    const claimQueue = makeWorkDestinationRequirement({
      id: "claim-queue",
      permissionId: "core:work.claim",
      operation: "claim",
      targetResource: queueResource,
      scopeFact: {
        kind: "queue",
        ...scopePath(workItemResource, queueResource),
        queueId,
        validUntil: LATER
      }
    });
    const releaseOther = makeWorkRequirement({
      id: "release-other",
      permissionId: "core:work.release_other",
      operation: "release_other",
      workState: "active",
      actorRelation: "scoped_supervisor_override",
      assignmentState: "assigned",
      overrideReason: "supervisor recovery",
      overrideRequirementId: null
    });
    const override = makeWorkRequirement({
      id: "override",
      permissionId: "core:work.override",
      operation: "override",
      workState: "terminal",
      actorRelation: "scoped_supervisor_override",
      assignmentState: "assigned",
      overrideReason: "reopen after verified follow-up",
      visibility: "secondary_hidden"
    });
    const reopen = makeWorkRequirement({
      id: "reopen",
      permissionId: "core:work.reopen",
      operation: "reopen",
      workState: "terminal",
      actorRelation: "scoped_supervisor_override",
      assignmentState: "assigned",
      destinationRequirementIds: ["reopen-queue"],
      destinationResources: [queueResource],
      overrideReason: "reopen after verified follow-up",
      overrideRequirementId: "override"
    });
    const reopenQueue = makeWorkDestinationRequirement({
      id: "reopen-queue",
      permissionId: "core:work.reopen",
      operation: "reopen",
      targetResource: queueResource,
      scopeFact: {
        kind: "queue",
        ...scopePath(workItemResource, queueResource),
        queueId,
        validUntil: LATER
      }
    });
    const allowPlan = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [terminalRead, claim, claimQueue, reopen, reopenQueue, override],
        [
          makeGrant("core:work.read", { type: "tenant", tenantId }, "g-read"),
          makeGrant("core:work.claim", { type: "tenant", tenantId }, "g-claim"),
          makeGrant(
            "core:work.reopen",
            { type: "tenant", tenantId },
            "g-reopen"
          ),
          makeGrant(
            "core:work.override",
            { type: "tenant", tenantId },
            "g-override"
          )
        ]
      )
    );
    const denyRelease = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [releaseOther],
        [
          makeGrant("core:work.release_other", {
            type: "tenant",
            tenantId
          })
        ]
      )
    );

    expect(allowPlan.outcome).toBe("allowed");
    expect(denyRelease).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "state_guard_failed" }
    });
  });

  it("requires exact current Queue eligibility before claiming Work", () => {
    const claim = makeWorkRequirement({
      id: "claim-with-queue",
      permissionId: "core:work.claim",
      operation: "claim",
      workState: "active",
      actorRelation: "queue_member",
      assignmentState: "unassigned",
      destinationRequirementIds: ["claim-queue-authority"],
      destinationResources: [queueResource]
    });
    const eligibleQueue = makeWorkDestinationRequirement({
      id: "claim-queue-authority",
      permissionId: "core:work.claim",
      operation: "claim",
      targetResource: queueResource,
      scopeFact: {
        kind: "queue",
        ...scopePath(workItemResource, queueResource),
        queueId,
        validUntil: LATER
      }
    });
    const grant = makeGrant("core:work.claim", { type: "tenant", tenantId });
    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput([claim, eligibleQueue], [grant])
      ).outcome
    ).toBe("allowed");

    const queueGuard = eligibleQueue.guard;
    if (queueGuard.profileId !== "core:rbac.guard.work_item_state") {
      throw new Error("expected Work destination guard");
    }
    for (const invalidQueue of [
      {
        ...eligibleQueue,
        guard: { ...queueGuard, authorityState: "ineligible" as const }
      },
      {
        ...eligibleQueue,
        guard: {
          ...queueGuard,
          eligibleEmployeeId: otherEmployeeId
        }
      },
      {
        ...eligibleQueue,
        guard: {
          ...queueGuard,
          authorityRevisionChecks: [
            { kind: "relation" as const, expected: "1", actual: "2" }
          ]
        }
      },
      {
        ...eligibleQueue,
        guard: {
          ...queueGuard,
          authorityRevisionChecks: [
            { kind: "state" as const, expected: "1", actual: "1" }
          ]
        }
      }
    ]) {
      expect(
        evaluateInboxV2AuthorizationPlan(
          makeInput([claim, invalidQueue], [grant])
        ).outcome
      ).toBe("denied");
    }
    expect(
      evaluateInboxV2AuthorizationPlan(makeInput([claim], [grant])).outcome
    ).toBe("denied");
  });

  it("binds Work destinations to exact Employee, Queue and Team requirements", () => {
    const override = makeWorkRequirement({
      id: "destination-override",
      permissionId: "core:work.override",
      operation: "override",
      workState: "active",
      actorRelation: "scoped_supervisor_override",
      assignmentState: "assigned",
      overrideReason: "authorized destination change",
      visibility: "secondary_hidden"
    });
    const employeeDirectory = makeRequirement({
      id: "destination-employee",
      permissionId: "core:employee.directory.view",
      resource: otherEmployeeResource,
      visibility: "secondary_hidden"
    });
    const queueDestination = makeWorkDestinationRequirement({
      id: "destination-queue",
      permissionId: "core:work.assign",
      operation: "assign",
      targetResource: queueResource,
      scopeFact: {
        kind: "queue",
        ...scopePath(workItemResource, queueResource),
        queueId,
        validUntil: LATER
      }
    });
    const assign = makeWorkRequirement({
      id: "assign-with-destination",
      permissionId: "core:work.assign",
      operation: "assign",
      workState: "active",
      actorRelation: "scoped_supervisor_override",
      assignmentState: "assigned",
      destinationRequirementIds: ["destination-employee", "destination-queue"],
      destinationResources: [otherEmployeeResource, queueResource],
      assignmentEligibility: {
        employeeResource: otherEmployeeResource,
        queueResource,
        relationEmployeeResource: otherEmployeeResource,
        relationQueueResource: queueResource,
        state: "eligible",
        revisionChecks: [{ kind: "relation", expected: "1", actual: "1" }]
      },
      overrideReason: "assign specialist",
      overrideRequirementId: "destination-override"
    });
    const teamDestination = makeWorkDestinationRequirement({
      id: "destination-team",
      permissionId: "core:work.servicing_team.manage",
      operation: "servicing_team_manage",
      targetResource: teamResource,
      scopeFact: {
        kind: "team",
        ...scopePath(workItemResource, teamResource),
        teamId,
        validUntil: LATER
      }
    });
    const servicingTeam = makeWorkRequirement({
      id: "servicing-team",
      permissionId: "core:work.servicing_team.manage",
      operation: "servicing_team_manage",
      workState: "active",
      actorRelation: "scoped_supervisor_override",
      assignmentState: "assigned",
      destinationRequirementIds: ["destination-team"],
      destinationResources: [teamResource],
      servicingTeamChange: {
        workItemResource,
        currentTeamResource: null,
        requestedTeamResource: teamResource,
        relationWorkItemResource: workItemResource,
        relationCurrentTeamResource: null,
        relationRequestedTeamResource: teamResource,
        revisionChecks: [{ kind: "relation", expected: "1", actual: "1" }],
        reason: "change servicing team",
        auditEventResource: resource(
          "core:audit-event",
          "audit_event:servicing-team"
        )
      },
      overrideReason: "change servicing team",
      overrideRequirementId: "destination-override"
    });
    const grants = [
      makeGrant("core:work.assign", { type: "tenant", tenantId }, "assign"),
      makeGrant(
        "core:work.servicing_team.manage",
        { type: "tenant", tenantId },
        "servicing"
      ),
      makeGrant("core:work.override", { type: "tenant", tenantId }, "override"),
      makeGrant(
        "core:employee.directory.view",
        { type: "tenant", tenantId },
        "employee"
      )
    ];

    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [assign, employeeDirectory, queueDestination, override],
          grants
        )
      ).outcome
    ).toBe("allowed");
    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput([servicingTeam, teamDestination, override], grants)
      ).outcome
    ).toBe("allowed");

    const releaseWithoutQueue = {
      ...makeWorkRequirement({
        id: "release-self",
        permissionId: "core:work.release_self",
        operation: "release_self",
        workState: "active",
        actorRelation: "primary_responsible",
        assignmentState: "assigned"
      }),
      scopeFacts: [
        {
          kind: "responsible" as const,
          ...scopePath(workItemResource, workItemResource),
          employeeId,
          workItemId,
          state: "active" as const,
          assignmentRevision: revision,
          currentAssignmentRevision: revision,
          validUntil: LATER
        }
      ]
    };
    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [releaseWithoutQueue],
          [
            makeGrant("core:work.release_self", {
              type: "tenant",
              tenantId
            })
          ]
        )
      ).outcome
    ).toBe("denied");

    const releaseOtherQueue = makeWorkDestinationRequirement({
      id: "release-other-queue",
      permissionId: "core:work.release_other",
      operation: "release_other",
      targetResource: queueResource,
      scopeFact: {
        kind: "queue",
        ...scopePath(workItemResource, queueResource),
        queueId,
        validUntil: LATER
      }
    });
    const releaseOther = makeWorkRequirement({
      id: "release-other-with-queue",
      permissionId: "core:work.release_other",
      operation: "release_other",
      workState: "active",
      actorRelation: "scoped_supervisor_override",
      assignmentState: "assigned",
      destinationRequirementIds: ["release-other-queue"],
      destinationResources: [queueResource],
      overrideReason: "supervisor queue release",
      overrideRequirementId: "destination-override"
    });
    const releaseOtherGrants = [
      ...grants,
      makeGrant(
        "core:work.release_other",
        { type: "tenant", tenantId },
        "release-other"
      )
    ];
    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [releaseOther, releaseOtherQueue, override],
          releaseOtherGrants
        )
      ).outcome
    ).toBe("allowed");
    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput([releaseOther, override], releaseOtherGrants)
      ).outcome
    ).toBe("denied");

    const substitutedQueue = {
      ...queueDestination,
      guard: {
        ...queueDestination.guard,
        authorityTargetResource: teamResource
      }
    } as InboxV2AuthorizationRequirement;
    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [assign, employeeDirectory, substitutedQueue, override],
          grants
        )
      ).outcome
    ).toBe("denied");
  });

  it("binds managed watcher read authority to the target Employee", () => {
    const manage = makeRequirement({
      id: "manage-watcher",
      permissionId: "core:notification.watchers.manage",
      guard: {
        profileId: "core:rbac.guard.notification_target_read",
        targetResource: conversationResource,
        targetEmployeeId: otherEmployeeId,
        targetLifecycle: "active",
        targetReadRequirementId: "target-read"
      }
    });
    const targetReadActorShape = makeRequirement({
      id: "target-read",
      permissionId: "core:conversation.read",
      visibility: "secondary_hidden"
    });
    const preliminary = makeInput(
      [manage, targetReadActorShape],
      [
        makeGrant("core:notification.watchers.manage", {
          type: "tenant",
          tenantId
        })
      ]
    );
    const targetEmployee = inboxV2EmployeeReferenceSchema.parse({
      tenantId,
      kind: "employee",
      id: otherEmployeeId
    });
    const targetCurrentAuthorization = {
      tenantId,
      principal: { kind: "employee" as const, employeeId: otherEmployeeId },
      authorizationEpoch: epoch,
      dependencies: preliminary.currentAuthorization.dependencies
    };
    const targetAuthorization = inboxV2AuthorizationEpochSnapshotSchema.parse({
      tenantId,
      employee: targetEmployee,
      value: epoch,
      dependencies: targetCurrentAuthorization.dependencies,
      evaluatedAt: NOW,
      notAfter: SESSION_END,
      nextAuthorizationBoundary: SESSION_END
    });
    const targetRead: InboxV2AuthorizationRequirement = {
      ...targetReadActorShape,
      authorizationSubject: {
        kind: "independent_employee",
        employee: targetEmployee,
        lifecycle: "active",
        authorization: targetAuthorization,
        currentAuthorization: targetCurrentAuthorization,
        notAfter: SESSION_END
      }
    };
    const targetGrant: InboxV2PolicyGrant = {
      ...makeGrant(
        "core:conversation.read",
        { type: "tenant", tenantId },
        "grant-target-read"
      ),
      principal: { kind: "employee", employeeId: otherEmployeeId }
    };
    const decision = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [manage, targetRead],
        [
          makeGrant(
            "core:notification.watchers.manage",
            { type: "tenant", tenantId },
            "grant-manage-watcher"
          ),
          targetGrant
        ]
      )
    );

    expect(decision.outcome).toBe("allowed");
    if (decision.outcome !== "allowed") return;
    expect(deriveInboxV2Capabilities(decision)).toHaveLength(1);
  });

  it("fails closed for mismatched privacy actor/phase and empty deletion roots", () => {
    const invalid = makeDeletionRequirement({
      permissionId: "core:privacy.deletion.preview",
      phase: "execute",
      actingEmployeeId: otherEmployeeId,
      rootAndHandlerRevisionChecks: []
    });
    const decision = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [invalid],
        [
          makeGrant("core:privacy.deletion.preview", {
            type: "tenant",
            tenantId
          })
        ]
      )
    );

    expect(decision).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "hard_boundary_denied" }
    });
  });

  it("rejects unsafe aggregate-report privacy evidence", () => {
    const decision = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [
          makeRequirement({
            permissionId: "core:reports.view",
            resource: reportResource,
            guard: {
              ...canonicalGuard,
              action: {
                kind: "report_aggregate",
                targetResource: reportResource,
                privacy: {
                  ...safeReportPrivacyEvidence(),
                  minimumCellSize: 1
                }
              }
            }
          })
        ],
        [makeGrant("core:reports.view", { type: "tenant", tenantId })]
      )
    );

    expect(decision).toMatchObject({
      outcome: "denied",
      publicErrorCode: "report.scope_forbidden"
    });
  });

  it("requires drilldown in the PII-export report layer conjunction", () => {
    const row = makeRequirement({
      id: "report-row",
      permissionId: "core:conversation.read"
    });
    const view = makeReportViewRequirement("report-view");
    const drilldown = makeReportConjunctionRequirement(
      "report-drilldown",
      "core:reports.drilldown",
      "drilldown",
      ["report-view"]
    );
    const reportExport = makeRequirement({
      id: "report-export",
      permissionId: "core:reports.export",
      resource: reportResource,
      guard: {
        ...canonicalGuard,
        action: {
          kind: "report_export",
          targetResource: reportResource,
          privacy: safeReportPrivacyEvidence(),
          reportsViewRequirementId: "report-view"
        }
      }
    });
    const piiView = makeReportConjunctionRequirement(
      "report-pii-view",
      "core:reports.pii.view",
      "pii",
      ["report-view", "report-drilldown"]
    );
    const piiExport = makeReportConjunctionRequirement(
      "report-pii-export",
      "core:reports.pii.export",
      "pii_export",
      ["report-view", "report-export", "report-pii-view"]
    );
    const requirements = [
      piiExport,
      piiView,
      reportExport,
      drilldown,
      view,
      row
    ];
    const grants = [
      "core:reports.pii.export",
      "core:reports.pii.view",
      "core:reports.export",
      "core:reports.drilldown",
      "core:reports.view",
      "core:conversation.read"
    ].map((permissionId, index) =>
      makeGrant(
        permissionId as InboxV2PermissionId,
        { type: "tenant", tenantId },
        `report-layer-grant-${index}`
      )
    );

    expect(
      evaluateInboxV2AuthorizationPlan(makeInput(requirements, grants))
    ).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "secondary_resource_denied" }
    });
  });

  it("rejects generic internal-create and delegation self-escalation evidence", () => {
    const genericCreate = makeRequirement({
      permissionId: "core:conversation.internal.create"
    });
    const selfDelegation = makeRequirement({
      permissionId: "core:roles.bind",
      resource: roleBindingResource,
      guard: {
        ...canonicalGuard,
        action: {
          kind: "delegation_change",
          targetResource: roleBindingResource,
          operation: "role_bind",
          actorEmployeeId: employeeId,
          subjectEmployeeId: employeeId,
          subjectEmployeeResource: employeeResource,
          subjectDirectoryRequirementId: "directory",
          delegatedAuthorities: [
            {
              requirementId: "delegated-read",
              permissionId: "core:conversation.read",
              requestedScope: { type: "tenant", tenantId }
            }
          ],
          bindingScope: { type: "tenant", tenantId },
          bindingScopeResource: resource("core:tenant", String(tenantId)),
          bindingRelationResource: resource(
            "core:delegation-effect",
            "delegation_effect:self-escalation"
          ),
          relationBindingResource: roleBindingResource,
          relationSubjectEmployeeResource: employeeResource,
          relationScopeResource: resource("core:tenant", String(tenantId)),
          bindingRevisionChecks: keyedRevisionChecks([
            roleBindingResource,
            resource(
              "core:delegation-effect",
              "delegation_effect:self-escalation"
            ),
            employeeResource,
            resource("core:tenant", String(tenantId))
          ]),
          reason: "self escalation",
          validUntil: GRANT_END,
          audit: privilegedAudit(
            "role_bind",
            roleBindingResource,
            resource("core:audit-event", "audit_event:self-escalation")
          ),
          roleDefinition: {
            resource: resource("core:role", "role:self-escalation"),
            bindingResource: roleBindingResource,
            bindingRoleResource: resource("core:role", "role:self-escalation"),
            permissionSetIds: ["core:conversation.read"],
            revisionChecks: currentRevisionChecks("manifest")
          }
        }
      }
    });

    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [genericCreate],
          [
            makeGrant("core:conversation.internal.create", {
              type: "tenant",
              tenantId
            })
          ]
        )
      )
    ).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "hard_boundary_denied" }
    });
    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [selfDelegation],
          [makeGrant("core:roles.bind", { type: "tenant", tenantId })]
        )
      )
    ).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "separation_of_duties_denied" }
    });
  });

  it("creates only a typed internal topology with exact active employee members", () => {
    type CanonicalGuard = Extract<
      InboxV2PolicyGuardEvidence,
      { profileId: "core:rbac.guard.canonical_resource" }
    >;
    const topologyResource = resource(
      "core:internal-conversation-topology",
      "internal_conversation_topology:create"
    );
    const members = [
      {
        employeeId,
        employeeResource,
        lifecycle: "active" as const,
        role: "owner" as const,
        directoryRequirementId: "create-directory-actor"
      },
      {
        employeeId: otherEmployeeId,
        employeeResource: otherEmployeeResource,
        lifecycle: "active" as const,
        role: "member" as const,
        directoryRequirementId: "create-directory-member"
      },
      {
        employeeId: thirdEmployeeId,
        employeeResource: thirdEmployeeResource,
        lifecycle: "active" as const,
        role: "observer" as const,
        directoryRequirementId: "create-directory-observer"
      }
    ];
    const createAction: CanonicalGuard["action"] = {
      kind: "internal_conversation_create",
      targetResource: conversationResource,
      conversationKind: "internal_group",
      creatorEmployeeId: employeeId,
      members,
      topologyResource,
      topologyConversationResource: conversationResource,
      topologyKind: "internal_group",
      policyResource: resource(
        "core:internal-conversation-policy",
        "internal_conversation_policy:create"
      ),
      policyTopologyResource: topologyResource,
      policyRevisionChecks: currentRevisionChecks("policy")
    };
    const directories = members.map((member) =>
      makeRequirement({
        id: member.directoryRequirementId,
        permissionId: "core:employee.directory.view",
        resource: member.employeeResource,
        visibility: "secondary_hidden"
      })
    );
    const grants = [
      makeGrant("core:conversation.internal.create", {
        type: "tenant",
        tenantId
      }),
      makeGrant("core:employee.directory.view", {
        type: "tenant",
        tenantId
      })
    ];
    const decide = (action: CanonicalGuard["action"]) =>
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [
            makeRequirement({
              permissionId: "core:conversation.internal.create",
              guard: { ...canonicalGuard, action }
            }),
            ...directories
          ],
          grants
        )
      );

    expect(decide(createAction).outcome).toBe("allowed");
    expect(
      decide({
        ...createAction,
        conversationKind: "internal_direct",
        topologyKind: "internal_direct"
      }).outcome
    ).toBe("denied");
    expect(
      decide({
        ...createAction,
        members: members.map((member) =>
          member.employeeId === employeeId
            ? { ...member, role: "member" as const }
            : member
        )
      }).outcome
    ).toBe("denied");
    expect(
      decide({
        ...createAction,
        topologyConversationResource: resource(
          "core:conversation",
          "conversation:substituted"
        )
      }).outcome
    ).toBe("denied");
  });

  it("rejects invalid guard timestamps instead of dropping the boundary", () => {
    const requirement = makeRequirement({
      permissionId: "core:conversation.internal.break_glass_read",
      scopeFacts: [
        {
          kind: "conversation",
          ...scopePath(conversationResource, conversationResource),
          conversationId,
          validUntil: GRANT_END
        }
      ],
      guard: {
        profileId: "core:rbac.guard.internal_break_glass_read",
        conversationId,
        exactGrantConversationId: conversationId,
        grantKind: "direct_grant",
        reason: "incident",
        auditEventId: "audit-1",
        audit: privilegedAudit(
          "internal_break_glass_read",
          conversationResource,
          resource("core:audit-event", "audit-1")
        ),
        accessMode: "read_only",
        validUntil: "not-a-timestamp"
      }
    });
    const decision = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [requirement],
        [
          makeGrant("core:conversation.internal.break_glass_read", {
            type: "conversation",
            tenantId,
            id: conversationId
          })
        ]
      )
    );

    expect(decision).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "hard_boundary_denied" }
    });
  });

  it("authorizes both old and new targets of an access-binding change", () => {
    const bindingResource = resource(
      "core:conversation-access-binding",
      "conversation_access_binding:binding-1"
    );
    const action = {
      kind: "conversation_access_change" as const,
      targetResource: conversationResource,
      operation: "manage" as const,
      bindingResource,
      bindingConversationResource: conversationResource,
      bindingRevisionChecks: keyedRevisionChecks([
        bindingResource,
        conversationResource
      ]),
      oldTargetResource: orgUnitResource,
      oldTargetScope: {
        type: "org_unit" as const,
        tenantId,
        id: orgUnitId,
        mode: "exact" as const
      },
      newTargetResource: teamResource,
      newTargetScope: { type: "team" as const, tenantId, id: teamId },
      targetRevisionChecks: keyedRevisionChecks([
        bindingResource,
        conversationResource,
        orgUnitResource,
        teamResource
      ]),
      reason: "move servicing ownership",
      policyResource: null,
      policyRevisionChecks: []
    };
    const requirement = makeRequirement({
      permissionId: "core:conversation.access_binding.manage",
      scopeFacts: [
        {
          kind: "conversation",
          ...scopePath(conversationResource, conversationResource),
          conversationId,
          validUntil: LATER
        }
      ],
      guard: { ...canonicalGuard, action }
    });
    const exactOnly = makeGrant(
      "core:conversation.access_binding.manage",
      { type: "conversation", tenantId, id: conversationId },
      "access-exact-only"
    );
    const tenantWide = makeGrant(
      "core:conversation.access_binding.manage",
      { type: "tenant", tenantId },
      "access-tenant"
    );

    expect(
      evaluateInboxV2AuthorizationPlan(makeInput([requirement], [exactOnly]))
        .outcome
    ).toBe("denied");
    expect(
      evaluateInboxV2AuthorizationPlan(makeInput([requirement], [tenantWide]))
        .outcome
    ).toBe("allowed");
    const unrelatedBindingResource = resource(
      "core:conversation-access-binding",
      "conversation_access_binding:another-conversation"
    );
    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [
            {
              ...requirement,
              guard: {
                ...canonicalGuard,
                action: {
                  ...action,
                  bindingResource: unrelatedBindingResource,
                  bindingConversationResource: resource(
                    "core:conversation",
                    "conversation:another-conversation"
                  ),
                  bindingRevisionChecks: keyedRevisionChecks([
                    unrelatedBindingResource,
                    resource(
                      "core:conversation",
                      "conversation:another-conversation"
                    )
                  ]),
                  targetRevisionChecks: keyedRevisionChecks([
                    unrelatedBindingResource,
                    resource(
                      "core:conversation",
                      "conversation:another-conversation"
                    ),
                    orgUnitResource,
                    teamResource
                  ])
                }
              }
            }
          ],
          [tenantWide]
        )
      ).outcome
    ).toBe("denied");
    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [
            {
              ...requirement,
              guard: {
                ...canonicalGuard,
                action: { ...action, reason: "" }
              }
            }
          ],
          [tenantWide]
        )
      ).outcome
    ).toBe("denied");
  });

  it("activates collaboration only with an applicable target grant", () => {
    const directory = makeRequirement({
      id: "collaborator-directory",
      permissionId: "core:employee.directory.view",
      resource: otherEmployeeResource,
      visibility: "secondary_hidden"
    });
    const action = {
      kind: "conversation_collaborator_change" as const,
      targetResource: conversationResource,
      targetEmployeeResource: otherEmployeeResource,
      targetEmployeeId: otherEmployeeId,
      targetLifecycle: "active" as const,
      targetDirectoryRequirementId: "collaborator-directory",
      intendedCollaboratorPermissionIds: ["core:conversation.read" as const],
      targetGrantIds: ["target-collaborator-read"],
      expectedRelationRevision: "1",
      currentRelationRevision: "1",
      reason: "specialist assistance"
    };
    const manage = makeRequirement({
      id: "manage-collaborator",
      permissionId: "core:conversation.collaborators.manage",
      guard: { ...canonicalGuard, action }
    });
    const targetGrant: InboxV2PolicyGrant = {
      ...makeGrant(
        "core:conversation.read",
        { type: "collaborator", tenantId },
        "target-collaborator-read"
      ),
      principal: { kind: "employee", employeeId: otherEmployeeId }
    };
    const actorGrants = [
      makeGrant(
        "core:conversation.collaborators.manage",
        { type: "tenant", tenantId },
        "manage-collaborator"
      ),
      makeGrant(
        "core:employee.directory.view",
        { type: "tenant", tenantId },
        "collaborator-directory"
      )
    ];

    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput([manage, directory], actorGrants)
      ).outcome
    ).toBe("denied");
    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput([manage, directory], [...actorGrants, targetGrant])
      ).outcome
    ).toBe("allowed");
    const wrongScopeGrant: InboxV2PolicyGrant = {
      ...targetGrant,
      scope: { type: "tenant", tenantId }
    };
    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput([manage, directory], [...actorGrants, wrongScopeGrant])
      ).outcome
    ).toBe("denied");
  });

  it("binds notification preferences/endpoints to the authenticated Employee", () => {
    const own = makeRequirement({
      id: "own-settings",
      permissionId: "core:notification.preferences.manage_self",
      resource: employeeResource,
      guard: {
        ...canonicalGuard,
        action: {
          kind: "notification_self_settings",
          targetResource: employeeResource,
          employeeResource,
          employeeId,
          endpointOwnerEmployeeId: employeeId,
          ownershipEndpointResource: null,
          ownershipEmployeeResource: employeeResource,
          ownershipRevisionChecks: [
            { kind: "relation", expected: "1", actual: "1" }
          ]
        }
      }
    });
    const other = makeRequirement({
      id: "other-settings",
      permissionId: "core:notification.endpoints.manage_self",
      resource: otherNotificationEndpointResource,
      guard: {
        ...canonicalGuard,
        action: {
          kind: "notification_self_settings",
          targetResource: otherNotificationEndpointResource,
          employeeResource: otherEmployeeResource,
          employeeId: otherEmployeeId,
          endpointOwnerEmployeeId: otherEmployeeId,
          ownershipEndpointResource: otherNotificationEndpointResource,
          ownershipEmployeeResource: otherEmployeeResource,
          ownershipRevisionChecks: [
            { kind: "relation", expected: "1", actual: "1" }
          ]
        }
      }
    });
    const grants = [
      makeGrant("core:notification.preferences.manage_self", {
        type: "tenant",
        tenantId
      }),
      makeGrant(
        "core:notification.endpoints.manage_self",
        { type: "tenant", tenantId },
        "grant-endpoint"
      )
    ];

    expect(
      evaluateInboxV2AuthorizationPlan(makeInput([own], grants)).outcome
    ).toBe("allowed");
    expect(
      evaluateInboxV2AuthorizationPlan(makeInput([other], grants))
    ).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "hard_boundary_denied" }
    });
  });

  it("rejects substituted route/read resources for message lifecycle and sensitive content", () => {
    const edit = makeRequirement({
      id: "edit",
      permissionId: "core:message.edit_own",
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
          operation: "edit",
          targetResource: timelineItemResource,
          actorEmployeeId: employeeId,
          authorEmployeeId: employeeId,
          contentBoundary: "external",
          ...timelineTopologyEvidence("external"),
          authorshipResource: timelineItemAuthorshipResource,
          authorshipTimelineItemResource: timelineItemResource,
          authorshipEmployeeResource: employeeResource,
          authorshipRevisionChecks: currentRevisionChecks("relation"),
          contentReadRequirementIds: ["lifecycle-content-read"],
          deletionMode: null,
          holdProof: null,
          originalRouteRequirementId: "wrong-route",
          originalSourceAccountId: sourceAccountId,
          originalSourceAccountResource: sourceAccountResource,
          originalBindingResource: sourceThreadBindingResource,
          originalBindingSourceAccountResource: sourceAccountResource,
          externalReferenceResource: externalMessageReferenceResource,
          externalReferenceBindingResource: sourceThreadBindingResource,
          externalReferenceTargetResource: timelineItemResource,
          routeRevisionChecks: currentRouteRevisionChecks(),
          capabilityId: "core:capability.message.edit",
          capabilityManifestResource: providerCapabilityManifestResource,
          capabilityManifestSourceAccountResource: sourceAccountResource,
          capabilityRevisionChecks: [
            { kind: "manifest", expected: "1", actual: "1" }
          ],
          capabilityState: "supported",
          capabilityNotAfter: GRANT_END
        }
      }
    });
    const wrongRoute = makeRequirement({
      id: "wrong-route",
      permissionId: "core:source_account.use",
      resource: otherSourceAccountResource,
      scopeFacts: [
        {
          kind: "source_account",
          ...scopePath(otherSourceAccountResource, otherSourceAccountResource),
          sourceAccountId: otherSourceAccountId,
          validUntil: LATER
        }
      ],
      visibility: "secondary_hidden",
      guard: {
        profileId: "core:rbac.guard.source_account_route",
        operation: makeSourceAccountUseOperation(
          otherSourceAccountResource,
          secondSourceThreadBindingResource
        ),
        sourceAccountId: otherSourceAccountId,
        routeSourceAccountId: otherSourceAccountId,
        sourceState: "active",
        bindingState: "active",
        bindingGeneration: "1",
        expectedBindingGeneration: "1",
        capabilityState: "supported",
        capabilityNotAfter: GRANT_END
      }
    });
    const lifecycleContentRead = makeRequirement({
      id: "lifecycle-content-read",
      permissionId: "core:conversation.read",
      resource: conversationResource,
      visibility: "secondary_hidden"
    });
    const editDecision = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [edit, wrongRoute, lifecycleContentRead],
        [
          makeGrant(
            "core:message.edit_own",
            { type: "conversation", tenantId, id: conversationId },
            "grant-edit"
          ),
          makeGrant(
            "core:source_account.use",
            {
              type: "source_account",
              tenantId,
              id: otherSourceAccountId
            },
            "grant-wrong-route"
          ),
          makeGrant(
            "core:conversation.read",
            { type: "tenant", tenantId },
            "grant-lifecycle-content-read"
          )
        ]
      )
    );

    const unrelatedRead = makeRequirement({
      id: "unrelated-read",
      permissionId: "core:conversation.read",
      resource: hiddenConversationResource
    });
    const reaction = makeRequirement({
      id: "reaction",
      permissionId: "core:message.react",
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
          kind: "message_reaction",
          targetResource: timelineItemResource,
          ...timelineTopologyEvidence("external"),
          contentReadResource: conversationResource,
          contentRelationTargetResource: timelineItemResource,
          contentRelationReadResource: conversationResource,
          contentRelationRevisionChecks: [
            { kind: "relation", expected: "1", actual: "1" }
          ],
          contentReadRequirementId: "unrelated-read",
          contentBoundary: "external",
          originalRouteRequirementId: null,
          originalSourceAccountId: null,
          originalSourceAccountResource: null,
          originalBindingResource: null,
          originalBindingSourceAccountResource: null,
          externalReferenceResource: null,
          externalReferenceBindingResource: null,
          externalReferenceTargetResource: null,
          routeRevisionChecks: [],
          capabilityId: "core:capability.message.react",
          capabilityManifestResource: providerCapabilityManifestResource,
          capabilityManifestSourceAccountResource: sourceAccountResource,
          capabilityRevisionChecks: currentRevisionChecks("manifest"),
          capabilityState: "supported",
          capabilityNotAfter: GRANT_END
        }
      }
    });
    const reactionDecision = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [reaction, unrelatedRead],
        [
          makeGrant(
            "core:message.react",
            { type: "conversation", tenantId, id: conversationId },
            "grant-react"
          ),
          makeGrant(
            "core:conversation.read",
            { type: "tenant", tenantId },
            "grant-unrelated-read"
          )
        ]
      )
    );

    const sensitive = makeRequirement({
      id: "recording",
      permissionId: "core:call.recording.view",
      resource: callResource,
      guard: {
        ...canonicalGuard,
        action: {
          kind: "sensitive_content",
          targetResource: callResource,
          baseReadResource: conversationResource,
          baseReadRelationTargetResource: callResource,
          baseReadRelationResource: conversationResource,
          baseReadRelationRevisionChecks: [
            { kind: "relation", expected: "1", actual: "1" }
          ],
          baseReadRequirementId: "unrelated-read",
          purpose: "quality review",
          policyEvidence: {
            kind: "call_recording",
            contentResource: callResource,
            availability: "available",
            retentionNotAfter: GRANT_END,
            consentState: "allowed",
            processingState: "allowed",
            policyResource: resource(
              "core:call-data-access-policy",
              "call_data_access_policy:recording"
            ),
            policyTargetResource: callResource,
            approvedPurposeIds: ["quality review"],
            revisionChecks: [{ kind: "policy", expected: "1", actual: "1" }]
          }
        }
      }
    });
    const sensitiveDecision = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [sensitive, unrelatedRead],
        [
          makeGrant(
            "core:call.recording.view",
            { type: "tenant", tenantId },
            "grant-recording"
          ),
          makeGrant(
            "core:conversation.read",
            { type: "tenant", tenantId },
            "grant-unrelated-read"
          )
        ]
      )
    );

    expect(editDecision).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "secondary_resource_denied" }
    });
    expect(reactionDecision).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "route_guard_failed" }
    });
    expect(sensitiveDecision).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "secondary_resource_denied" }
    });
  });

  it("keeps sensitive-content policy evidence tenant-local", () => {
    type SensitiveAction = Extract<
      Extract<
        InboxV2PolicyGuardEvidence,
        { profileId: "core:rbac.guard.canonical_resource" }
      >["action"],
      { kind: "sensitive_content" }
    >;
    const policyResource = resource(
      "core:call-data-access-policy",
      "call_data_access_policy:tenant-local"
    );
    const action: SensitiveAction = {
      kind: "sensitive_content",
      targetResource: callResource,
      baseReadResource: conversationResource,
      baseReadRelationTargetResource: callResource,
      baseReadRelationResource: conversationResource,
      baseReadRelationRevisionChecks: currentRevisionChecks("relation"),
      baseReadRequirementId: "sensitive-base-read",
      purpose: "quality review",
      policyEvidence: {
        kind: "call_recording",
        contentResource: callResource,
        availability: "available",
        retentionNotAfter: GRANT_END,
        consentState: "allowed",
        processingState: "allowed",
        policyResource,
        policyTargetResource: callResource,
        approvedPurposeIds: ["quality review"],
        revisionChecks: currentRevisionChecks("policy")
      }
    };
    const baseRead = makeRequirement({
      id: "sensitive-base-read",
      permissionId: "core:conversation.read",
      resource: conversationResource,
      visibility: "secondary_hidden"
    });
    const grants = [
      makeGrant("core:call.recording.view", { type: "tenant", tenantId }),
      makeGrant(
        "core:conversation.read",
        { type: "tenant", tenantId },
        "sensitive-base-read"
      )
    ];
    const decide = (candidate: SensitiveAction) =>
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [
            makeRequirement({
              permissionId: "core:call.recording.view",
              resource: callResource,
              guard: { ...canonicalGuard, action: candidate }
            }),
            baseRead
          ],
          grants
        )
      );

    expect(decide(action).outcome).toBe("allowed");
    expect(
      decide({
        ...action,
        policyEvidence: {
          ...action.policyEvidence,
          policyResource: resource(
            "core:call-data-access-policy",
            "call_data_access_policy:tenant-local",
            otherTenantId
          )
        }
      }).outcome
    ).toBe("denied");
  });

  it("binds lifecycle references to the exact binding, account and item", () => {
    const sourceUse = makeRequirement({
      id: "lifecycle-source",
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
      visibility: "secondary_hidden",
      guard: {
        profileId: "core:rbac.guard.source_account_route",
        operation: makeSourceAccountUseOperation(),
        sourceAccountId,
        routeSourceAccountId: sourceAccountId,
        sourceState: "active",
        bindingState: "active",
        bindingGeneration: "1",
        expectedBindingGeneration: "1",
        capabilityState: "supported",
        capabilityNotAfter: GRANT_END
      }
    });
    const lifecycleContentRead = makeRequirement({
      id: "lifecycle-content-read",
      permissionId: "core:conversation.read",
      resource: conversationResource,
      visibility: "secondary_hidden"
    });
    const action = {
      kind: "message_author_action" as const,
      operation: "edit" as const,
      targetResource: timelineItemResource,
      actorEmployeeId: employeeId,
      authorEmployeeId: employeeId,
      contentBoundary: "external" as const,
      ...timelineTopologyEvidence("external"),
      authorshipResource: timelineItemAuthorshipResource,
      authorshipTimelineItemResource: timelineItemResource,
      authorshipEmployeeResource: employeeResource,
      authorshipRevisionChecks: currentRevisionChecks("relation"),
      contentReadRequirementIds: ["lifecycle-content-read"],
      deletionMode: null,
      holdProof: null,
      originalRouteRequirementId: "lifecycle-source",
      originalSourceAccountId: sourceAccountId,
      originalSourceAccountResource: sourceAccountResource,
      originalBindingResource: sourceThreadBindingResource,
      originalBindingSourceAccountResource: sourceAccountResource,
      externalReferenceResource: externalMessageReferenceResource,
      externalReferenceBindingResource: sourceThreadBindingResource,
      externalReferenceTargetResource: timelineItemResource,
      routeRevisionChecks: currentRouteRevisionChecks(),
      capabilityId: "core:capability.message.edit" as const,
      capabilityManifestResource: providerCapabilityManifestResource,
      capabilityManifestSourceAccountResource: sourceAccountResource,
      capabilityRevisionChecks: [
        { kind: "manifest" as const, expected: "1", actual: "1" }
      ],
      capabilityState: "supported" as const,
      capabilityNotAfter: GRANT_END
    };
    const edit = (actionEvidence: typeof action) =>
      makeRequirement({
        id: "lifecycle-edit",
        permissionId: "core:message.edit_own",
        resource: timelineItemResource,
        scopeFacts: [
          {
            kind: "conversation",
            ...scopePath(timelineItemResource, conversationResource),
            conversationId,
            validUntil: LATER
          }
        ],
        guard: { ...canonicalGuard, action: actionEvidence }
      });
    const deleteAction = {
      ...action,
      operation: "delete" as const,
      capabilityId: "core:capability.message.delete" as const,
      deletionMode: "provider_delete" as const,
      holdProof: {
        resource: resource(
          "core:content-hold-index",
          "content_hold_index:lifecycle-message"
        ),
        targetResource: timelineItemResource,
        state: "none" as const,
        revisionChecks: currentRevisionChecks("state")
      }
    };
    const remove = (
      actionEvidence: Extract<
        InboxV2PolicyGuardEvidence,
        { profileId: "core:rbac.guard.canonical_resource" }
      >["action"]
    ): InboxV2AuthorizationRequirement =>
      makeRequirement({
        id: "lifecycle-delete",
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
        guard: { ...canonicalGuard, action: actionEvidence }
      });
    const grants = [
      makeGrant(
        "core:message.edit_own",
        { type: "conversation", tenantId, id: conversationId },
        "lifecycle-edit"
      ),
      makeGrant(
        "core:message.delete_own",
        { type: "conversation", tenantId, id: conversationId },
        "lifecycle-delete"
      ),
      makeGrant(
        "core:source_account.use",
        { type: "source_account", tenantId, id: sourceAccountId },
        "lifecycle-source"
      ),
      makeGrant(
        "core:conversation.read",
        { type: "tenant", tenantId },
        "lifecycle-content-read"
      )
    ];

    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput([edit(action), sourceUse, lifecycleContentRead], grants)
      ).outcome
    ).toBe("allowed");
    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [remove(deleteAction), sourceUse, lifecycleContentRead],
          grants
        )
      ).outcome
    ).toBe("allowed");
    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [
            remove({
              ...deleteAction,
              holdProof: { ...deleteAction.holdProof, state: "active" }
            }),
            sourceUse,
            lifecycleContentRead
          ],
          grants
        )
      ).outcome
    ).toBe("denied");
    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput([remove(action), sourceUse, lifecycleContentRead], grants)
      ).outcome
    ).toBe("denied");
    for (const substituted of [
      {
        ...action,
        externalReferenceTargetResource: resource(
          "core:timeline-item",
          "timeline_item:message-2"
        )
      },
      {
        ...action,
        originalBindingSourceAccountResource: otherSourceAccountResource
      },
      {
        ...action,
        externalReferenceBindingResource: resource(
          "core:source-thread-binding",
          "source_thread_binding:binding-2"
        )
      }
    ]) {
      expect(
        evaluateInboxV2AuthorizationPlan(
          makeInput(
            [edit(substituted), sourceUse, lifecycleContentRead],
            grants
          )
        ).outcome
      ).toBe("denied");
    }
  });

  it("rejects standalone or unreferenced independent-Employee requirements", () => {
    const primary = asIndependentEmployeeRequirement(
      makeRequirement({
        id: "foreign-primary",
        permissionId: "core:conversation.read"
      })
    );
    const hidden = asIndependentEmployeeRequirement(
      makeRequirement({
        id: "foreign-hidden",
        permissionId: "core:conversation.read",
        visibility: "secondary_hidden"
      })
    );
    const targetGrant: InboxV2PolicyGrant = {
      ...makeGrant(
        "core:conversation.read",
        { type: "tenant", tenantId },
        "target-standalone"
      ),
      principal: { kind: "employee", employeeId: otherEmployeeId }
    };

    for (const requirement of [primary, hidden]) {
      expect(
        evaluateInboxV2AuthorizationPlan(
          makeInput([requirement], [targetGrant])
        )
      ).toMatchObject({
        outcome: "denied",
        diagnostics: { reason: "hard_boundary_denied" }
      });
    }
  });

  it("binds internal roles to the canonical membership fact", () => {
    const fact: InboxV2CanonicalScopeFact = {
      kind: "internal_participant",
      ...scopePath(conversationResource, conversationResource),
      employeeId,
      conversationId,
      origin: "hulee_internal_command",
      state: "active",
      role: "observer",
      membershipRevision: revision,
      currentMembershipRevision: revision,
      validUntil: GRANT_END
    };
    const requirement = makeRequirement({
      permissionId: "core:conversation.internal.members.manage",
      scopeFacts: [fact],
      guard: {
        profileId: "core:rbac.guard.internal_membership",
        conversationId,
        employeeId,
        membershipState: "active",
        membershipOrigin: "hulee_internal_command",
        membershipRole: "owner",
        contentBoundary: "internal",
        validUntil: GRANT_END
      }
    });

    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [requirement],
          [
            makeGrant("core:conversation.internal.members.manage", {
              type: "internal_participant",
              tenantId
            })
          ]
        )
      )
    ).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "canonical_relation_not_matched" }
    });
  });

  it("preserves an active owner and exact topology during internal membership changes", () => {
    type InternalGuard = Extract<
      InboxV2PolicyGuardEvidence,
      { profileId: "core:rbac.guard.internal_membership" }
    >;
    type MembershipChange = NonNullable<InternalGuard["membershipChange"]>;
    const row = requiredFamilyMatrixRow("internal_privacy");
    const primary = row.input.requirements.find(
      ({ permissionId }) =>
        permissionId === "core:conversation.internal.members.manage"
    );
    if (
      primary?.guard.profileId !== "core:rbac.guard.internal_membership" ||
      primary.guard.membershipChange === undefined
    ) {
      throw new Error("internal membership matrix row is not typed");
    }
    const guard = primary.guard;
    const change: MembershipChange = guard.membershipChange!;
    const decide = (candidate: MembershipChange) =>
      evaluateInboxV2AuthorizationPlan({
        ...row.input,
        requirements: row.input.requirements.map((requirement) =>
          requirement.id === primary.id
            ? {
                ...requirement,
                guard: { ...guard, membershipChange: candidate }
              }
            : requirement
        )
      });

    expect(evaluateInboxV2AuthorizationPlan(row.input).outcome).toBe("allowed");
    for (const invalidChange of [
      {
        ...change,
        operation: "remove" as const,
        oldRole: "owner" as const,
        newRole: null,
        ownerSet: {
          ...change.ownerSet,
          beforeOwnerMembershipResources: [change.membershipRelationResource],
          afterOwnerMembershipResources: []
        }
      },
      {
        ...change,
        relationConversationResource: resource(
          "core:conversation",
          "conversation:substituted"
        )
      },
      { ...change, targetLifecycle: "inactive" as const },
      {
        ...change,
        mutationRevisionChecks: change.mutationRevisionChecks.map(
          (check, index) => (index === 0 ? { ...check, actual: "2" } : check)
        )
      }
    ]) {
      expect(decide(invalidChange).outcome).toBe("denied");
    }
  });

  it("requires internal-read authority for an internal Inbox entry", () => {
    const membershipFact: InboxV2CanonicalScopeFact = {
      kind: "internal_participant",
      ...scopePath(conversationResource, conversationResource),
      employeeId,
      conversationId,
      origin: "hulee_internal_command",
      state: "active",
      role: "observer",
      membershipRevision: revision,
      currentMembershipRevision: revision,
      validUntil: GRANT_END
    };
    const inbox = makeRequirement({
      id: "internal-inbox",
      permissionId: "core:inbox.read",
      guard: {
        ...canonicalGuard,
        contentBoundary: "none",
        action: {
          kind: "inbox_entry_read",
          targetResource: conversationResource,
          entryBoundary: "internal_metadata",
          internalReadRequirementId: "internal-read",
          topologyResource: conversationTopologyResource,
          topologyTargetResource: conversationResource,
          topologyConversationKind: "internal",
          topologyRevisionChecks: [
            { kind: "state", expected: "1", actual: "1" }
          ]
        }
      }
    });
    const internalRead = makeRequirement({
      id: "internal-read",
      permissionId: "core:conversation.internal.read",
      scopeFacts: [membershipFact],
      visibility: "secondary_hidden",
      guard: {
        profileId: "core:rbac.guard.internal_membership",
        conversationId,
        employeeId,
        membershipState: "active",
        membershipOrigin: "hulee_internal_command",
        membershipRole: "observer",
        contentBoundary: "internal",
        validUntil: GRANT_END
      }
    });
    const grants = [
      makeGrant("core:inbox.read", { type: "tenant", tenantId }, "inbox"),
      makeGrant(
        "core:conversation.internal.read",
        { type: "internal_participant", tenantId },
        "internal-read"
      )
    ];

    expect(
      evaluateInboxV2AuthorizationPlan(makeInput([inbox], grants))
    ).toMatchObject({
      outcome: "denied",
      diagnostics: { reason: "secondary_resource_denied" }
    });
    expect(
      evaluateInboxV2AuthorizationPlan(makeInput([inbox, internalRead], grants))
        .outcome
    ).toBe("allowed");
  });

  it("opens a source item only through a current bounded server descriptor", () => {
    const sourceItem = resource("core:source-item", "source_item:item-1");
    const descriptor = resource(
      "core:source-action-descriptor",
      "source_action_descriptor:descriptor-1"
    );
    const validAction = {
      kind: "source_item_open_external" as const,
      targetResource: sourceItem,
      descriptorResource: descriptor,
      descriptorTargetResource: sourceItem,
      sourceAccountResource,
      descriptorSourceAccountResource: sourceAccountResource,
      descriptorState: "approved" as const,
      actionType: "open_url" as const,
      descriptorRevisionChecks: [
        { kind: "binding" as const, expected: "1", actual: "1" },
        { kind: "state" as const, expected: "1", actual: "1" }
      ],
      notAfter: GRANT_END
    };
    const build = (
      action: typeof validAction | { kind: "canonical" }
    ): InboxV2AuthorizationRequirement =>
      makeRequirement({
        permissionId: "core:source_item.open_external",
        resource: sourceItem,
        guard: { ...canonicalGuard, contentBoundary: "none", action }
      });
    const grant = makeGrant("core:source_item.open_external", {
      type: "tenant",
      tenantId
    });

    expect(
      evaluateInboxV2AuthorizationPlan(makeInput([build(validAction)], [grant]))
        .outcome
    ).toBe("allowed");
    for (const action of [
      { kind: "canonical" as const },
      { ...validAction, descriptorTargetResource: hiddenConversationResource },
      {
        ...validAction,
        descriptorRevisionChecks: [
          { kind: "binding" as const, expected: "1", actual: "2" },
          { kind: "state" as const, expected: "1", actual: "1" }
        ]
      },
      { ...validAction, notAfter: NOW }
    ]) {
      expect(
        evaluateInboxV2AuthorizationPlan(makeInput([build(action)], [grant]))
          .outcome
      ).toBe("denied");
    }
  });

  it("keeps internal reactions provider-free and requires internal content authority", () => {
    const action = {
      kind: "message_reaction" as const,
      targetResource: timelineItemResource,
      ...timelineTopologyEvidence("internal"),
      contentReadResource: conversationResource,
      contentRelationTargetResource: timelineItemResource,
      contentRelationReadResource: conversationResource,
      contentRelationRevisionChecks: [
        { kind: "relation" as const, expected: "1", actual: "1" }
      ],
      contentReadRequirementId: "internal-content-read",
      contentBoundary: "internal" as const,
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
      capabilityState: "not_applicable" as const,
      capabilityNotAfter: null
    };
    const reaction = (
      actionEvidence: Extract<
        InboxV2PolicyGuardEvidence,
        { profileId: "core:rbac.guard.canonical_resource" }
      >["action"]
    ) =>
      makeRequirement({
        id: "internal-reaction",
        permissionId: "core:message.react",
        resource: timelineItemResource,
        scopeFacts: [
          {
            kind: "internal_participant",
            ...scopePath(timelineItemResource, conversationResource),
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
        guard: { ...canonicalGuard, action: actionEvidence }
      });
    const internalRead = makeRequirement({
      id: "internal-content-read",
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
    const grants = [
      makeGrant(
        "core:message.react",
        { type: "internal_participant", tenantId },
        "internal-reaction"
      ),
      makeGrant(
        "core:conversation.internal.read",
        { type: "internal_participant", tenantId },
        "internal-reaction-read"
      )
    ];

    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput([reaction(action), internalRead], grants)
      ).outcome
    ).toBe("allowed");
    for (const invalidAction of [
      { ...action, capabilityState: "supported" as const },
      { ...action, capabilityNotAfter: GRANT_END },
      {
        ...action,
        originalRouteRequirementId: "unexpected-route",
        routeRevisionChecks: currentRouteRevisionChecks()
      }
    ]) {
      expect(
        evaluateInboxV2AuthorizationPlan(
          makeInput([reaction(invalidAction), internalRead], grants)
        ).outcome
      ).toBe("denied");
    }

    const externalRead = makeRequirement({
      id: "internal-content-read",
      permissionId: "core:conversation.read",
      resource: conversationResource,
      visibility: "secondary_hidden"
    });
    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [reaction(action), externalRead],
          [
            grants[0]!,
            makeGrant(
              "core:conversation.read",
              { type: "tenant", tenantId },
              "external-read-cannot-authorize-internal"
            )
          ]
        )
      ).outcome
    ).toBe("denied");
  });

  it("authorizes provider-reference reply only through exact portable route evidence", () => {
    const decide = (
      operation: ProviderReferenceReplyOperation,
      guardOverrides: Partial<ExternalRouteGuardEvidence> = {}
    ) =>
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          externalOperationRequirements(
            "core:message.reply_external",
            operation,
            [],
            conversationResource,
            guardOverrides
          ),
          externalOperationGrants("core:message.reply_external")
        )
      );
    const alternateBindingGuard: Partial<ExternalRouteGuardEvidence> = {
      bindingResource: secondSourceThreadBindingResource,
      capabilityManifestBindingResource: secondSourceThreadBindingResource
    };

    expect(decide(providerReferenceReplyOperation()).outcome).toBe("allowed");
    expect(
      decide(
        providerReferenceReplyOperation({ portability: "external_thread" }),
        alternateBindingGuard
      ).outcome
    ).toBe("allowed");
    expect(
      decide(providerReferenceReplyOperation(), alternateBindingGuard).outcome
    ).toBe("denied");
    expect(
      decide(
        providerReferenceReplyOperation({
          bindingSourceAccountResource: otherSourceAccountResource,
          resourceRevisionChecks: keyedRevisionChecks([
            conversationResource,
            timelineItemResource,
            sourceOccurrenceResource,
            externalMessageReferenceResource,
            sourceThreadBindingResource,
            otherSourceAccountResource,
            externalThreadResource
          ])
        })
      ).outcome
    ).toBe("denied");

    expect(
      decide(
        providerReferenceReplyOperation({ portability: "external_thread" }),
        {
          ...alternateBindingGuard,
          externalThreadResource: secondExternalThreadResource,
          bindingExternalThreadResource: secondExternalThreadResource
        }
      ).outcome
    ).toBe("denied");

    const providerGlobalProof = providerGlobalReplyProof(
      secondSourceThreadBindingResource
    );
    const providerGlobal = providerReferenceReplyOperation({
      portability: "provider_global",
      providerGlobalProof
    });
    const providerGlobalDecision = decide(
      providerGlobal,
      alternateBindingGuard
    );
    expect(providerGlobalDecision.outcome).toBe("allowed");
    if (providerGlobalDecision.outcome === "allowed") {
      expect(providerGlobalDecision.notAfter).toBe("2026-07-12T10:20:00.000Z");
    }

    expect(
      decide(
        providerReferenceReplyOperation({
          resourceRevisionChecks:
            providerReferenceReplyOperation().resourceRevisionChecks.map(
              (check, index) =>
                index === 0 ? { ...check, actual: "2" } : check
            )
        })
      ).outcome
    ).toBe("denied");
    expect(
      decide(
        providerReferenceReplyOperation({
          revisionChecks: [
            { kind: "binding", expected: "1", actual: "1" },
            { kind: "route", expected: "1", actual: "2" },
            { kind: "state", expected: "1", actual: "1" }
          ]
        })
      ).outcome
    ).toBe("denied");
    expect(
      decide(
        providerReferenceReplyOperation({
          portability: "provider_global",
          providerGlobalProof: {
            ...providerGlobalProof,
            revisionChecks: [
              { kind: "binding", expected: "1", actual: "2" },
              { kind: "manifest", expected: "1", actual: "1" }
            ]
          }
        }),
        alternateBindingGuard
      ).outcome
    ).toBe("denied");
    expect(
      decide(
        providerReferenceReplyOperation({
          portability: "provider_global",
          providerGlobalProof: {
            ...providerGlobalProof,
            notAfter: NOW
          }
        }),
        alternateBindingGuard
      ).outcome
    ).toBe("denied");

    expect(
      decide(providerReferenceReplyOperation(), {
        routeFallbackRequested: true
      }).outcome
    ).toBe("denied");
  });

  it("binds every external route permission to operation-specific evidence", () => {
    const copyForward: Extract<
      ExternalRouteOperationEvidence,
      { kind: "forward" }
    > = {
      kind: "forward",
      mode: "copy",
      sourceContentBoundary: "external",
      sourceReadRequirementId: "conversation-read",
      sourceReadResource: conversationResource,
      sourceTimelineItemResource: timelineItemResource,
      timelineItemRelationResource: resource(
        "core:timeline-item-conversation-relation",
        "timeline_item_conversation_relation:message-1"
      ),
      timelineItemRelationItemResource: timelineItemResource,
      timelineItemConversationResource: conversationResource,
      timelineItemRelationRevisionChecks: [
        { kind: "relation", expected: "1", actual: "1" }
      ],
      sourceResourceRevisionChecks: [
        {
          resource: resource(
            "core:timeline-item-conversation-relation",
            "timeline_item_conversation_relation:message-1"
          ),
          expected: "1",
          actual: "1"
        },
        { resource: timelineItemResource, expected: "1", actual: "1" },
        { resource: conversationResource, expected: "1", actual: "1" }
      ],
      sourceOccurrenceResource: null,
      occurrenceTimelineItemResource: null,
      occurrenceReferenceResource: null,
      occurrenceBindingResource: null,
      sourceReferenceResource: null,
      referenceTimelineItemResource: null,
      referenceBindingResource: null,
      sourceBindingResource: null,
      bindingConversationResource: null,
      bindingExternalThreadResource: null,
      bindingSourceAccountResource: null,
      sourceAccountRequirementId: null,
      sourceExternalThreadResource: null,
      portability: "not_applicable",
      providerGlobalProof: null,
      occurrenceRevisionChecks: [],
      nativeResourceRevisionChecks: []
    };
    const nativeForward: Extract<
      ExternalRouteOperationEvidence,
      { kind: "forward" }
    > = {
      ...copyForward,
      mode: "native",
      sourceOccurrenceResource,
      occurrenceTimelineItemResource: timelineItemResource,
      occurrenceReferenceResource: externalMessageReferenceResource,
      occurrenceBindingResource: sourceThreadBindingResource,
      sourceReferenceResource: externalMessageReferenceResource,
      referenceTimelineItemResource: timelineItemResource,
      referenceBindingResource: sourceThreadBindingResource,
      sourceBindingResource: sourceThreadBindingResource,
      bindingConversationResource: conversationResource,
      bindingExternalThreadResource: externalThreadResource,
      bindingSourceAccountResource: sourceAccountResource,
      sourceAccountRequirementId: "source-use",
      sourceExternalThreadResource: externalThreadResource,
      portability: "binding_only",
      occurrenceRevisionChecks: [
        { kind: "binding", expected: "1", actual: "1" }
      ],
      nativeResourceRevisionChecks: [
        { resource: sourceOccurrenceResource, expected: "1", actual: "1" },
        {
          resource: externalMessageReferenceResource,
          expected: "1",
          actual: "1"
        },
        {
          resource: sourceThreadBindingResource,
          expected: "1",
          actual: "1"
        },
        { resource: externalThreadResource, expected: "1", actual: "1" },
        { resource: sourceAccountResource, expected: "1", actual: "1" }
      ]
    };
    const providerContractResource = resource(
      "core:adapter-contract-snapshot",
      "adapter_contract_snapshot:provider-1"
    );
    const providerGlobalForward: Extract<
      ExternalRouteOperationEvidence,
      { kind: "forward" }
    > = {
      ...nativeForward,
      portability: "provider_global",
      providerGlobalProof: {
        resource: resource(
          "core:reference-portability-proof",
          "reference_portability_proof:1"
        ),
        sourceReferenceResource: externalMessageReferenceResource,
        sourceOccurrenceResource,
        originBindingResource: sourceThreadBindingResource,
        originSourceAccountResource: sourceAccountResource,
        destinationBindingResource: sourceThreadBindingResource,
        destinationSourceAccountResource: sourceAccountResource,
        providerContractResource,
        originSourceAccountProviderContractResource: providerContractResource,
        destinationSourceAccountProviderContractResource:
          providerContractResource,
        revisionChecks: [
          { kind: "binding", expected: "1", actual: "1" },
          { kind: "manifest", expected: "1", actual: "1" }
        ],
        resourceRevisionChecks: [
          {
            resource: resource(
              "core:reference-portability-proof",
              "reference_portability_proof:1"
            ),
            expected: "1",
            actual: "1"
          },
          {
            resource: externalMessageReferenceResource,
            expected: "1",
            actual: "1"
          },
          { resource: sourceOccurrenceResource, expected: "1", actual: "1" },
          {
            resource: sourceThreadBindingResource,
            expected: "1",
            actual: "1"
          },
          { resource: sourceAccountResource, expected: "1", actual: "1" },
          { resource: providerContractResource, expected: "1", actual: "1" }
        ],
        notAfter: "2026-07-12T10:20:00.000Z"
      }
    };
    const destinationRead = makeRequirement({
      id: "destination-read-2",
      permissionId: "core:conversation.read",
      resource: hiddenConversationResource,
      visibility: "secondary_hidden"
    });
    const multiSend = makeMultiSendOperation();
    const sourceItemReply: Extract<
      ExternalRouteOperationEvidence,
      { kind: "source_item_reply" }
    > = {
      kind: "source_item_reply",
      sourceItemResource,
      sourceItemReadRequirementId: "source-item-open",
      replyDescriptorResource: sourceReplyDescriptorResource,
      descriptorTargetResource: sourceItemResource,
      descriptorSourceAccountResource: sourceAccountResource,
      descriptorRevisionChecks: [
        { kind: "binding", expected: "1", actual: "1" }
      ]
    };
    const callInitiate: Extract<
      ExternalRouteOperationEvidence,
      { kind: "call_initiate" }
    > = {
      kind: "call_initiate",
      telephonyAccountResource: sourceAccountResource,
      accountRequirementId: "source-use",
      callTargetResource: conversationResource,
      targetRequirementId: "conversation-read",
      clientConversationLinkResource: null,
      linkClientResource: null,
      linkConversationResource: null,
      linkRevisionChecks: [],
      capabilityId: "core:capability.call.initiate",
      capabilityRevisionChecks: [
        { kind: "manifest", expected: "1", actual: "1" }
      ]
    };
    const clientRead = makeRequirement({
      id: "call-client-read",
      permissionId: "core:client.view",
      resource: clientResource,
      scopeFacts: [
        {
          kind: "client",
          ...scopePath(clientResource, clientResource),
          clientId,
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
          authorityResource: clientResource,
          suffix: "call-client-read"
        }),
        contextualRequirementIds: [],
        linkedClientRequirementIds: []
      },
      visibility: "secondary_hidden"
    });
    const clientCall: Extract<
      ExternalRouteOperationEvidence,
      { kind: "call_initiate" }
    > = {
      ...callInitiate,
      callTargetResource: clientResource,
      targetRequirementId: "call-client-read",
      clientConversationLinkResource: resource(
        "core:conversation-client-link",
        "conversation_client_link:call-client"
      ),
      linkClientResource: clientResource,
      linkConversationResource: conversationResource,
      linkRevisionChecks: [{ kind: "relation", expected: "1", actual: "1" }]
    };
    const sourceItemOpen = makeSourceItemOpenRequirement("source-item-open");
    const cases: readonly Readonly<{
      name: string;
      permissionId: ExternalRoutePermissionId;
      operation: ExternalRouteOperationEvidence;
      extras?: readonly InboxV2AuthorizationRequirement[];
      extraGrants?: readonly InboxV2PolicyGrant[];
      target?: InboxV2EntityKey;
      expectedNotAfter?: string;
      primaryScope?: InboxV2PermissionScope;
    }>[] = [
      {
        name: "reply",
        permissionId: "core:message.reply_external",
        operation: newResponseReplyOperation()
      },
      {
        name: "copy forward",
        permissionId: "core:message.forward_external",
        operation: copyForward
      },
      {
        name: "native forward",
        permissionId: "core:message.forward_external",
        operation: nativeForward
      },
      {
        name: "provider-global native forward",
        permissionId: "core:message.forward_external",
        operation: providerGlobalForward,
        expectedNotAfter: "2026-07-12T10:20:00.000Z"
      },
      {
        name: "multi-send",
        permissionId: "core:source.multi_send",
        operation: multiSend,
        extras: [destinationRead],
        expectedNotAfter: "2026-07-12T10:15:00.000Z"
      },
      {
        name: "source item reply",
        permissionId: "core:source_item.reply",
        operation: sourceItemReply,
        extras: [sourceItemOpen],
        extraGrants: [
          makeGrant(
            "core:source_item.open_external",
            { type: "tenant", tenantId },
            "operation-source-item"
          )
        ],
        target: sourceItemResource
      },
      {
        name: "call initiate",
        permissionId: "core:call.initiate",
        operation: callInitiate
      },
      {
        name: "call initiate for Client",
        permissionId: "core:call.initiate",
        operation: clientCall,
        extras: [clientRead],
        extraGrants: [
          makeGrant(
            "core:client.view",
            { type: "client", tenantId, id: clientId },
            "operation-call-client"
          )
        ],
        target: clientResource,
        primaryScope: { type: "client", tenantId, id: clientId }
      }
    ];

    for (const item of cases) {
      const decision = evaluateInboxV2AuthorizationPlan(
        makeInput(
          externalOperationRequirements(
            item.permissionId,
            item.operation,
            item.extras,
            item.target
          ),
          externalOperationGrants(
            item.permissionId,
            item.extraGrants,
            item.primaryScope
          )
        )
      );
      expect(
        decision.outcome,
        JSON.stringify({ name: item.name, decision })
      ).toBe("allowed");
      if (
        decision.outcome === "allowed" &&
        item.expectedNotAfter !== undefined
      ) {
        expect(decision.notAfter).toBe(item.expectedNotAfter);
      }
    }

    const invalidCases: readonly Readonly<{
      permissionId: ExternalRoutePermissionId;
      operation: ExternalRouteOperationEvidence;
      extras?: readonly InboxV2AuthorizationRequirement[];
      extraGrants?: readonly InboxV2PolicyGrant[];
      target?: InboxV2EntityKey;
    }>[] = [
      {
        permissionId: "core:message.forward_external",
        operation: { ...copyForward, portability: "binding_only" }
      },
      {
        permissionId: "core:message.forward_external",
        operation: {
          ...nativeForward,
          occurrenceRevisionChecks: [
            { kind: "binding", expected: "1", actual: "2" }
          ]
        }
      },
      {
        permissionId: "core:message.forward_external",
        operation: {
          ...nativeForward,
          sourceReadRequirementId: "destination-read-2",
          sourceReadResource: hiddenConversationResource,
          timelineItemConversationResource: hiddenConversationResource,
          bindingConversationResource: hiddenConversationResource
        },
        extras: [destinationRead]
      },
      {
        permissionId: "core:message.forward_external",
        operation: {
          ...nativeForward,
          portability: "external_thread",
          sourceReadRequirementId: "destination-read-2",
          sourceReadResource: hiddenConversationResource,
          timelineItemConversationResource: hiddenConversationResource,
          bindingConversationResource: hiddenConversationResource
        },
        extras: [destinationRead]
      },
      {
        permissionId: "core:message.forward_external",
        operation: { ...copyForward, sourceContentBoundary: "internal" }
      },
      {
        permissionId: "core:message.forward_external",
        operation: {
          ...copyForward,
          sourceTimelineItemResource: resource(
            "core:timeline-item",
            "timeline_item:private-substitution"
          )
        }
      },
      {
        permissionId: "core:message.forward_external",
        operation: {
          ...copyForward,
          timelineItemConversationResource: hiddenConversationResource
        }
      },
      {
        permissionId: "core:message.forward_external",
        operation: {
          ...copyForward,
          timelineItemRelationRevisionChecks: [
            { kind: "relation", expected: "1", actual: "2" }
          ]
        }
      },
      {
        permissionId: "core:message.forward_external",
        operation: {
          ...copyForward,
          sourceResourceRevisionChecks:
            copyForward.sourceResourceRevisionChecks.map((check, index) =>
              index === 0 ? { ...check, actual: "2" } : check
            )
        }
      },
      {
        permissionId: "core:message.forward_external",
        operation: {
          ...nativeForward,
          occurrenceTimelineItemResource: resource(
            "core:timeline-item",
            "timeline_item:substituted"
          )
        }
      },
      {
        permissionId: "core:message.forward_external",
        operation: {
          ...providerGlobalForward,
          sourceExternalThreadResource: resource(
            "core:external-thread",
            "external_thread:foreign",
            otherTenantId
          ),
          bindingExternalThreadResource: resource(
            "core:external-thread",
            "external_thread:foreign",
            otherTenantId
          )
        }
      },
      {
        permissionId: "core:message.forward_external",
        operation: {
          ...providerGlobalForward,
          providerGlobalProof: {
            ...providerGlobalForward.providerGlobalProof!,
            sourceReferenceResource: resource(
              "core:external-message-reference",
              "external_message_reference:substituted"
            )
          }
        }
      },
      {
        permissionId: "core:message.forward_external",
        operation: {
          ...nativeForward,
          nativeResourceRevisionChecks:
            nativeForward.nativeResourceRevisionChecks.map((check, index) =>
              index === 0 ? { ...check, actual: "2" } : check
            )
        }
      },
      {
        permissionId: "core:message.forward_external",
        operation: {
          ...providerGlobalForward,
          providerGlobalProof: {
            ...providerGlobalForward.providerGlobalProof!,
            destinationBindingResource: secondSourceThreadBindingResource
          }
        }
      },
      {
        permissionId: "core:message.forward_external",
        operation: {
          ...providerGlobalForward,
          providerGlobalProof: {
            ...providerGlobalForward.providerGlobalProof!,
            destinationSourceAccountProviderContractResource: resource(
              "core:adapter-contract-snapshot",
              "adapter_contract_snapshot:other-provider"
            )
          }
        }
      },
      {
        permissionId: "core:message.forward_external",
        operation: {
          ...providerGlobalForward,
          providerGlobalProof: {
            ...providerGlobalForward.providerGlobalProof!,
            revisionChecks: [
              { kind: "binding", expected: "1", actual: "2" },
              { kind: "manifest", expected: "1", actual: "1" }
            ]
          }
        }
      },
      {
        permissionId: "core:message.forward_external",
        operation: {
          ...providerGlobalForward,
          providerGlobalProof: {
            ...providerGlobalForward.providerGlobalProof!,
            resourceRevisionChecks:
              providerGlobalForward.providerGlobalProof!.resourceRevisionChecks.map(
                (check, index) =>
                  index === 0 ? { ...check, actual: "2" } : check
              )
          }
        }
      },
      {
        permissionId: "core:source.multi_send",
        operation: {
          ...multiSend,
          destinations:
            multiSend.kind === "multi_send"
              ? multiSend.destinations.map((destination, index) =>
                  index === 1
                    ? {
                        ...destination,
                        capabilityState: "unsupported" as const
                      }
                    : destination
                )
              : []
        },
        extras: [destinationRead]
      },
      {
        permissionId: "core:source.multi_send",
        operation: {
          ...multiSend,
          destinations:
            multiSend.kind === "multi_send"
              ? multiSend.destinations.map((destination, index) =>
                  index === 1
                    ? {
                        ...destination,
                        bindingResource: resource(
                          "core:source-thread-binding",
                          "source_thread_binding:foreign",
                          otherTenantId
                        )
                      }
                    : destination
                )
              : []
        },
        extras: [destinationRead]
      },
      {
        permissionId: "core:source_item.reply",
        operation: {
          ...sourceItemReply,
          descriptorTargetResource: conversationResource
        },
        extras: [sourceItemOpen],
        extraGrants: [
          makeGrant(
            "core:source_item.open_external",
            { type: "tenant", tenantId },
            "invalid-source-item"
          )
        ],
        target: sourceItemResource
      },
      {
        permissionId: "core:source_item.reply",
        operation: {
          ...sourceItemReply,
          descriptorSourceAccountResource: otherSourceAccountResource
        },
        extras: [sourceItemOpen],
        extraGrants: [
          makeGrant(
            "core:source_item.open_external",
            { type: "tenant", tenantId },
            "invalid-source-account"
          )
        ],
        target: sourceItemResource
      },
      {
        permissionId: "core:call.initiate",
        operation: {
          ...callInitiate,
          capabilityRevisionChecks: [
            { kind: "manifest", expected: "1", actual: "2" }
          ]
        }
      },
      {
        permissionId: "core:call.initiate",
        operation: {
          ...clientCall,
          linkConversationResource: hiddenConversationResource
        },
        extras: [clientRead],
        extraGrants: [
          makeGrant(
            "core:client.view",
            { type: "client", tenantId, id: clientId },
            "invalid-call-client-link"
          )
        ],
        target: clientResource
      },
      {
        permissionId: "core:message.forward_external",
        operation: newResponseReplyOperation()
      }
    ];
    for (const item of invalidCases) {
      expect(
        evaluateInboxV2AuthorizationPlan(
          makeInput(
            externalOperationRequirements(
              item.permissionId,
              item.operation,
              item.extras,
              item.target
            ),
            externalOperationGrants(item.permissionId, item.extraGrants)
          )
        ).outcome
      ).toBe("denied");
    }
  });

  it("authorizes multi-send independently for every destination scope", () => {
    const operation = makeMultiSendOperation();
    const destinationRead = makeRequirement({
      id: "destination-read-2",
      permissionId: "core:conversation.read",
      resource: hiddenConversationResource,
      visibility: "secondary_hidden"
    });
    const otherOrgUnitId = inboxV2OrgUnitIdSchema.parse("org_unit:org-2");
    const otherOrgUnitResource = resource(
      "core:org-unit",
      String(otherOrgUnitId)
    );
    const orgFact = (
      target: InboxV2EntityKey,
      targetOrgUnitId: typeof orgUnitId,
      targetOrgUnitResource: InboxV2EntityKey
    ): InboxV2CanonicalScopeFact => ({
      kind: "org_unit",
      ...scopePath(target, targetOrgUnitResource),
      orgUnitId: targetOrgUnitId,
      ancestorOrgUnitIds: [],
      closureRevision: revision,
      currentClosureRevision: revision,
      validUntil: LATER
    });
    const requirements = externalOperationRequirements(
      "core:source.multi_send",
      operation,
      [destinationRead]
    ).map((requirement): InboxV2AuthorizationRequirement => {
      if (
        requirement.id === "operation" ||
        requirement.id === "multi-send-authority-1"
      ) {
        return {
          ...requirement,
          scopeFacts: [
            ...requirement.scopeFacts,
            orgFact(conversationResource, orgUnitId, orgUnitResource)
          ]
        };
      }
      if (requirement.id === "multi-send-authority-2") {
        return {
          ...requirement,
          scopeFacts: [
            orgFact(
              hiddenConversationResource,
              otherOrgUnitId,
              otherOrgUnitResource
            )
          ]
        };
      }
      return requirement;
    });
    const orgAGrants = externalOperationGrants("core:source.multi_send", [], {
      type: "org_unit",
      tenantId,
      id: orgUnitId,
      mode: "exact"
    });

    expect(
      evaluateInboxV2AuthorizationPlan(makeInput(requirements, orgAGrants))
    ).toMatchObject({
      outcome: "denied",
      publicErrorCode: "resource.not_found",
      diagnostics: { reason: "secondary_resource_denied" }
    });
    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput(requirements, [
          ...orgAGrants,
          makeGrant(
            "core:source.multi_send",
            {
              type: "org_unit",
              tenantId,
              id: otherOrgUnitId,
              mode: "exact"
            },
            "multi-send-org-b"
          )
        ])
      ).outcome
    ).toBe("allowed");

    const duplicateAuthorityOperation = {
      ...operation,
      destinations: operation.destinations.map((destination, index) =>
        index === 1
          ? {
              ...destination,
              operationRequirementId:
                operation.destinations[0]!.operationRequirementId
            }
          : destination
      )
    };
    const selfAuthorityOperation = {
      ...operation,
      destinations: operation.destinations.map((destination, index) =>
        index === 1
          ? { ...destination, operationRequirementId: "operation" }
          : destination
      )
    };
    for (const invalidOperation of [
      duplicateAuthorityOperation,
      selfAuthorityOperation
    ]) {
      expect(
        evaluateInboxV2AuthorizationPlan(
          makeInput(
            externalOperationRequirements(
              "core:source.multi_send",
              invalidOperation,
              [destinationRead]
            ),
            externalOperationGrants("core:source.multi_send")
          )
        ).outcome
      ).toBe("denied");
    }
    const standaloneAuthority = requirements.find(
      ({ id }) => id === "multi-send-authority-2"
    )!;
    expect(
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [standaloneAuthority],
          [
            makeGrant(
              "core:source.multi_send",
              {
                type: "org_unit",
                tenantId,
                id: otherOrgUnitId,
                mode: "exact"
              },
              "standalone-multi-send-authority"
            )
          ]
        )
      ).outcome
    ).toBe("denied");
  });

  it("binds source account permissions to use, policy and dispatch operations", () => {
    const manage: SourceAccountRouteOperationEvidence = {
      kind: "manage_route_policy",
      policyResource: sourceRoutePolicyResource,
      policySourceAccountResource: sourceAccountResource,
      policyRelationResource: resource(
        "core:source-route-policy-binding",
        "source_route_policy_binding:policy-1"
      ),
      relationPolicyResource: sourceRoutePolicyResource,
      relationSourceAccountResource: sourceAccountResource,
      relationRevisionChecks: currentRevisionChecks("relation"),
      policyRevisionChecks: [{ kind: "policy", expected: "1", actual: "1" }],
      futureDispatchesOnly: true,
      pinnedDispatchMutationRequested: false,
      reason: "update future route policy",
      auditEventId: "audit-route-policy-1"
    };
    const reroute: Extract<
      SourceAccountRouteOperationEvidence,
      { kind: "reroute_dispatch" }
    > = {
      kind: "reroute_dispatch",
      dispatch: {
        resource: outboundDispatchResource,
        originalRouteResource: originalOutboundRouteResource,
        requestedRouteResource: newOutboundRouteResource,
        relationResource: resource(
          "core:outbound-dispatch-route-decision",
          "outbound_dispatch_route_decision:dispatch-1"
        ),
        relationDispatchResource: outboundDispatchResource,
        relationOriginalRouteResource: originalOutboundRouteResource,
        relationRequestedRouteResource: newOutboundRouteResource,
        state: "before_provider_io",
        expectedStateRevision: "1",
        currentStateRevision: "1",
        revisionChecks: keyedRevisionChecks([
          outboundDispatchResource,
          resource(
            "core:outbound-dispatch-route-decision",
            "outbound_dispatch_route_decision:dispatch-1"
          ),
          originalOutboundRouteResource,
          newOutboundRouteResource
        ])
      },
      originalRoute: {
        resource: originalOutboundRouteResource,
        bindingResource: sourceThreadBindingResource,
        sourceAccountResource,
        routeBindingRelationResource: resource(
          "core:outbound-route-binding",
          "outbound_route_binding:route-1"
        ),
        relationRouteResource: originalOutboundRouteResource,
        relationBindingResource: sourceThreadBindingResource,
        conversationResource,
        externalThreadResource,
        bindingConversationResource: conversationResource,
        bindingExternalThreadResource: externalThreadResource,
        bindingSourceAccountResource: sourceAccountResource,
        relationRevisionChecks: currentRevisionChecks("relation")
      },
      newRoute: {
        resource: newOutboundRouteResource,
        bindingResource: secondSourceThreadBindingResource,
        sourceAccountResource: otherSourceAccountResource,
        routeBindingRelationResource: resource(
          "core:outbound-route-binding",
          "outbound_route_binding:route-2"
        ),
        relationRouteResource: newOutboundRouteResource,
        relationBindingResource: secondSourceThreadBindingResource,
        conversationResource,
        externalThreadResource,
        bindingConversationResource: conversationResource,
        bindingExternalThreadResource: externalThreadResource,
        bindingSourceAccountResource: otherSourceAccountResource,
        relationRevisionChecks: currentRevisionChecks("relation")
      },
      originalCapabilityManifest: makeSourceRerouteCapabilityManifest(
        sourceAccountResource,
        sourceThreadBindingResource,
        originalOutboundRouteResource
      ),
      newCapabilityManifest: makeSourceRerouteCapabilityManifest(
        otherSourceAccountResource,
        secondSourceThreadBindingResource,
        newOutboundRouteResource
      ),
      originalSourceRequirementId: "reroute-original-source",
      newSourceRequirementId: "reroute-new-source",
      dispatchState: "before_provider_io",
      routeRevisionChecks: currentRouteRevisionChecks(),
      originalRouteHistoryRecorded: true,
      reason: "retry before provider I/O",
      auditEventId: "audit-reroute-1"
    };
    const rerouteSourceRequirements = [
      makeSourceAccountOperationRequirement(
        "core:source_account.use",
        makeSourceAccountUseOperation(),
        { id: "reroute-original-source", visibility: "secondary_hidden" }
      ),
      makeSourceAccountOperationRequirement(
        "core:source_account.use",
        makeSourceAccountUseOperation(
          otherSourceAccountResource,
          secondSourceThreadBindingResource
        ),
        {
          id: "reroute-new-source",
          sourceAccountId: otherSourceAccountId,
          resource: otherSourceAccountResource,
          visibility: "secondary_hidden"
        }
      )
    ];
    const rerouteSourceGrants = [
      makeGrant(
        "core:source_account.use",
        { type: "source_account", tenantId, id: sourceAccountId },
        "reroute-original-source"
      ),
      makeGrant(
        "core:source_account.use",
        { type: "source_account", tenantId, id: otherSourceAccountId },
        "reroute-new-source"
      )
    ];
    const decide = (
      permissionId: SourceAccountRoutePermissionId,
      operation: SourceAccountRouteOperationEvidence,
      extraRequirements: readonly InboxV2AuthorizationRequirement[] = [],
      extraGrants: readonly InboxV2PolicyGrant[] = []
    ) =>
      evaluateInboxV2AuthorizationPlan(
        makeInput(
          [
            makeSourceAccountOperationRequirement(permissionId, operation),
            ...extraRequirements
          ],
          [
            makeGrant(permissionId, {
              type: "source_account",
              tenantId,
              id: sourceAccountId
            }),
            ...extraGrants
          ]
        )
      );

    expect(
      decide("core:source_account.use", makeSourceAccountUseOperation()).outcome
    ).toBe("allowed");
    expect(decide("core:source.route_policy.manage", manage).outcome).toBe(
      "allowed"
    );
    expect(
      decide(
        "core:source.dispatch.reroute",
        reroute,
        rerouteSourceRequirements,
        rerouteSourceGrants
      ).outcome
    ).toBe("allowed");

    const invalidCases: readonly [
      SourceAccountRoutePermissionId,
      SourceAccountRouteOperationEvidence
    ][] = [
      ["core:source.route_policy.manage", makeSourceAccountUseOperation()],
      [
        "core:source.route_policy.manage",
        {
          ...manage,
          policyRevisionChecks: [{ kind: "policy", expected: "1", actual: "2" }]
        }
      ],
      [
        "core:source.dispatch.reroute",
        { ...reroute, dispatchState: "provider_io_started" }
      ],
      [
        "core:source.dispatch.reroute",
        {
          ...reroute,
          dispatch: {
            ...reroute.dispatch,
            resource: resource(
              "core:outbound-dispatch",
              "outbound_dispatch:substituted"
            )
          }
        }
      ],
      [
        "core:source.dispatch.reroute",
        {
          ...reroute,
          dispatch: {
            ...reroute.dispatch,
            revisionChecks: reroute.dispatch.revisionChecks.map(
              (check, index) =>
                index === 2 ? { ...check, expected: "2", actual: "2" } : check
            )
          }
        }
      ],
      [
        "core:source.dispatch.reroute",
        {
          ...reroute,
          dispatch: {
            ...reroute.dispatch,
            state: "provider_io_started"
          },
          dispatchState: "provider_io_started"
        }
      ],
      [
        "core:source.dispatch.reroute",
        {
          ...reroute,
          dispatch: {
            ...reroute.dispatch,
            revisionChecks: reroute.dispatch.revisionChecks.map(
              (check, index) =>
                index === 0 ? { ...check, actual: "2" } : check
            )
          }
        }
      ],
      [
        "core:source.dispatch.reroute",
        { ...reroute, originalRouteHistoryRecorded: false }
      ],
      [
        "core:source.dispatch.reroute",
        {
          ...reroute,
          newCapabilityManifest: {
            ...reroute.newCapabilityManifest,
            manifestBindingResource: sourceThreadBindingResource
          }
        }
      ],
      [
        "core:source.dispatch.reroute",
        {
          ...reroute,
          originalCapabilityManifest: {
            ...reroute.originalCapabilityManifest,
            revisionChecks:
              reroute.originalCapabilityManifest.revisionChecks.map(
                (check, index) =>
                  index === 0 ? { ...check, actual: "2" } : check
              )
          }
        }
      ],
      [
        "core:source.dispatch.reroute",
        {
          ...reroute,
          newCapabilityManifest: {
            ...reroute.newCapabilityManifest,
            notAfter: NOW
          }
        }
      ],
      [
        "core:source.dispatch.reroute",
        {
          ...reroute,
          newRoute: {
            ...reroute.newRoute,
            resource: originalOutboundRouteResource
          }
        }
      ],
      [
        "core:source.dispatch.reroute",
        {
          ...reroute,
          newRoute: {
            ...reroute.newRoute,
            bindingResource: resource(
              "core:source-thread-binding",
              "source_thread_binding:foreign",
              otherTenantId
            )
          }
        }
      ],
      [
        "core:source.dispatch.reroute",
        {
          ...reroute,
          dispatch: {
            ...reroute.dispatch,
            originalRouteResource: resource(
              "core:outbound-route",
              "outbound_route:unrelated"
            )
          }
        }
      ],
      [
        "core:source.dispatch.reroute",
        {
          ...reroute,
          newRoute: {
            ...reroute.newRoute,
            conversationResource: resource(
              "core:conversation",
              "conversation:unrelated"
            ),
            bindingConversationResource: resource(
              "core:conversation",
              "conversation:unrelated"
            )
          }
        }
      ],
      [
        "core:source.dispatch.reroute",
        {
          ...reroute,
          newRoute: {
            ...reroute.newRoute,
            externalThreadResource: resource(
              "core:external-thread",
              "external_thread:unrelated"
            ),
            bindingExternalThreadResource: resource(
              "core:external-thread",
              "external_thread:unrelated"
            )
          }
        }
      ]
    ];
    for (const [permissionId, operation] of invalidCases) {
      const isReroute = operation.kind === "reroute_dispatch";
      expect(
        decide(
          permissionId,
          operation,
          isReroute ? rerouteSourceRequirements : [],
          isReroute ? rerouteSourceGrants : []
        ).outcome
      ).toBe("denied");
    }
  });

  it("exposes only the stable public authorization decision shape", () => {
    const allowed = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [makeRequirement()],
        [makeGrant("core:inbox.read", { type: "tenant", tenantId })]
      )
    );
    const hidden = evaluateInboxV2AuthorizationPlan(
      makeInput(
        [
          makeRequirement(),
          makeRequirement({
            id: "hidden",
            permissionId: "core:conversation.read",
            resource: hiddenConversationResource,
            visibility: "secondary_hidden"
          })
        ],
        [makeGrant("core:inbox.read", { type: "tenant", tenantId })]
      )
    );
    const allowedPublic = toInboxV2PublicAuthorizationDecision(allowed);
    const hiddenPublic = toInboxV2PublicAuthorizationDecision(hidden);

    expect(Object.keys(allowedPublic).sort()).toEqual(["notAfter", "outcome"]);
    expect(Object.keys(hiddenPublic).sort()).toEqual(["errorCode", "outcome"]);
    expect(hiddenPublic).toEqual({
      outcome: "denied",
      errorCode: "resource.not_found"
    });
  });

  it("keeps every required authorization family in the generated matrix", () => {
    const rows = generatedRequiredFamilyMatrix();
    expect([...new Set(rows.map(({ family }) => family))].sort()).toEqual(
      [...requiredGeneratedAuthorizationFamilies].sort()
    );
    const requiredAxes = [
      "semantic",
      "principal",
      "scope",
      "relation",
      "state",
      "visibility"
    ];
    for (const family of requiredGeneratedAuthorizationFamilies) {
      expect(
        rows.find((row) => row.family === family && row.axis === "semantic")
          ?.expectedOutcome
      ).toBe("allowed");
      expect(
        rows
          .filter((row) => row.family === family)
          .map(({ axis }) => axis)
          .sort()
      ).toEqual([...requiredAxes].sort());
    }
  });

  it.each(generatedRequiredFamilyMatrix())(
    "generated family matrix: $family / $axis / $state / $relation",
    ({ input, expectedOutcome, expectedPublicErrorCode }) => {
      const decision = evaluateInboxV2AuthorizationPlan(input);
      expect(decision.outcome).toBe(expectedOutcome);
      if (expectedPublicErrorCode !== null) {
        expect(decision).toMatchObject({
          outcome: "denied",
          publicErrorCode: expectedPublicErrorCode
        });
      }
    }
  );

  it("keeps an exhaustive semantic owner for every catalog permission", () => {
    expect(Object.keys(permissionSemanticCoverage).sort()).toEqual(
      inboxV2PermissionCatalog.map(({ id }) => id).sort()
    );
    expect(
      Object.values(permissionSemanticCoverage).filter(
        (owner) => owner === "semantic_closure"
      )
    ).toHaveLength(41);
  });

  it.each(inboxV2PermissionCatalog)(
    "fails closed across catalog fences for $id",
    ({ id: permissionId }) => {
      const requirement = makeRequirement({ permissionId });
      const noGrant = makeInput([requirement], []);
      const inactive = {
        ...noGrant,
        principal: {
          ...noGrant.principal,
          kind: "employee",
          lifecycle: "draining"
        } as InboxV2PolicyPrincipal
      };
      const staleRelation = {
        ...noGrant,
        currentAuthorization: {
          ...noGrant.currentAuthorization,
          dependencies: {
            ...noGrant.currentAuthorization.dependencies,
            employeeInboxRelationRevision:
              inboxV2EntityRevisionSchema.parse("999")
          }
        }
      };
      const hidden = makeInput(
        [{ ...requirement, visibility: "secondary_hidden" }],
        []
      );

      expect(evaluateInboxV2AuthorizationPlan(noGrant).outcome).toBe("denied");
      expect(evaluateInboxV2AuthorizationPlan(inactive).outcome).toBe("denied");
      expect(evaluateInboxV2AuthorizationPlan(staleRelation).outcome).toBe(
        "denied"
      );
      expect(evaluateInboxV2AuthorizationPlan(hidden)).toMatchObject({
        outcome: "denied",
        publicErrorCode: "resource.not_found"
      });
    }
  );

  it.each(generatedAuthorizationMatrix())(
    "generated matrix: $name",
    ({ permissionId, principalState, scopeKind, relationState, expected }) => {
      const { scope, facts } = matrixScope(scopeKind, relationState);
      const requirement = makeRequirement({ permissionId, scopeFacts: facts });
      const employeeGrant = makeGrant(permissionId, scope);
      const base = makeInput([requirement], [employeeGrant]);
      const decision =
        principalState === "active_employee"
          ? evaluateInboxV2AuthorizationPlan(base)
          : principalState === "draining_employee"
            ? evaluateInboxV2AuthorizationPlan({
                ...base,
                principal: {
                  ...base.principal,
                  kind: "employee",
                  lifecycle: "draining"
                } as InboxV2PolicyPrincipal
              })
            : evaluateInboxV2AuthorizationPlan(
                asTrustedServiceMatrixInput(base, employeeGrant, permissionId)
              );

      expect(decision.outcome).toBe(expected ? "allowed" : "denied");
    }
  );
});

function makeCrossKindIdentityClaimFixture(
  direction: "employee_to_client_contact" | "client_contact_to_employee"
): Readonly<{
  input: InboxV2AuthorizationPlanInput;
  primaryRequirementId: string;
  oldTargetRequirementId: string;
  oldTargetResource: InboxV2EntityKey;
  newTargetPermissionId:
    | "core:identity.employee_claim.manage"
    | "core:identity.client_contact_claim.manage";
}> {
  const sourceRequirementId = `cross-kind-source:${direction}`;
  const oldTargetRequirementId = `cross-kind-old-target:${direction}`;
  const primaryRequirementId = `cross-kind-primary:${direction}`;
  const oldClientContactResource = resource(
    "core:client-contact",
    "client_contact:cross-kind-old"
  );
  const newClientContactResource = resource(
    "core:client-contact",
    "client_contact:cross-kind-new"
  );
  const oldTargetResource =
    direction === "employee_to_client_contact"
      ? otherEmployeeResource
      : oldClientContactResource;
  const newTargetResource =
    direction === "employee_to_client_contact"
      ? newClientContactResource
      : otherEmployeeResource;
  const newTargetPermissionId =
    direction === "employee_to_client_contact"
      ? ("core:identity.client_contact_claim.manage" as const)
      : ("core:identity.employee_claim.manage" as const);
  const activeClaimResource = resource(
    "core:source-identity-claim",
    `source_identity_claim:cross-kind-${direction}`
  );
  const claimHeadResource = resource(
    "core:source-identity-claim-head",
    `source_identity_claim_head:cross-kind-${direction}`
  );

  const sourceRequirement = makeRequirement({
    id: sourceRequirementId,
    permissionId: "core:identity.source_identity.use",
    resource: sourceExternalIdentityResource,
    visibility: "secondary_hidden",
    guard: {
      profileId: "core:rbac.guard.identity_evidence",
      targetResource: sourceExternalIdentityResource,
      evidenceState: "verified",
      operation: {
        kind: "source_identity_use",
        actorEmployeeId: employeeId,
        evidenceResource: sourceExternalIdentityResource,
        revisionChecks: currentRevisionChecks("relation")
      }
    }
  });
  const oldTargetRequirement = makeRequirement({
    id: oldTargetRequirementId,
    permissionId: "core:identity.claim.revoke",
    resource: oldTargetResource,
    visibility: "secondary_hidden",
    guard: {
      profileId: "core:rbac.guard.identity_evidence",
      targetResource: oldTargetResource,
      evidenceState: "verified",
      operation: {
        kind: "claim_revoke",
        actorEmployeeId: employeeId,
        sourceIdentityResource: sourceExternalIdentityResource,
        sourceIdentityRequirementId: sourceRequirementId,
        sourceIdentityRevisionChecks: currentRevisionChecks("entity"),
        reasonCodeId: "core:cross-kind-reassignment",
        auditEventResource: resource(
          "core:audit-event",
          `audit_event:cross-kind-old-${direction}`
        ),
        auditActorEmployeeId: employeeId,
        auditSourceIdentityResource: sourceExternalIdentityResource,
        auditTargetResource: oldTargetResource,
        auditRevisionChecks: currentRevisionChecks("entity"),
        activeClaimResource,
        claimSourceIdentityResource: sourceExternalIdentityResource,
        existingTargetResource: oldTargetResource,
        claimTargetResource: oldTargetResource,
        activeClaimRevisionChecks: currentRevisionChecks("relation"),
        targetRevisionChecks: currentRevisionChecks("entity")
      }
    }
  });
  const commonClaimOperation = {
    actorEmployeeId: employeeId,
    sourceIdentityResource: sourceExternalIdentityResource,
    sourceIdentityRequirementId: sourceRequirementId,
    sourceIdentityRevisionChecks: currentRevisionChecks("entity"),
    reasonCodeId: "core:cross-kind-reassignment",
    auditEventResource: resource(
      "core:audit-event",
      `audit_event:cross-kind-new-${direction}`
    ),
    auditActorEmployeeId: employeeId,
    auditSourceIdentityResource: sourceExternalIdentityResource,
    auditTargetResource: newTargetResource,
    auditRevisionChecks: currentRevisionChecks("entity"),
    oldTargetResource,
    oldTargetRequirementId,
    newTargetResource,
    claimPolicyResource: identityClaimPolicyResource,
    claimPolicyState: "approved_active" as const,
    claimPolicyVersion: "1",
    evidencePolicyResource: identityClaimPolicyResource,
    evidencePolicyVersion: "1",
    evidenceResource: identityEvidenceResource,
    evidenceSourceIdentityResource: sourceExternalIdentityResource,
    evidenceTargetResource: newTargetResource,
    sensitiveEvidenceIncluded: false,
    evidenceViewRequirementId: null,
    claimPolicyRevisionChecks: currentRevisionChecks("policy"),
    evidenceRevisionChecks: currentRevisionChecks("entity"),
    targetRevisionChecks: currentRevisionChecks("entity"),
    claimHeadResource,
    claimHeadSourceIdentityResource: sourceExternalIdentityResource,
    currentClaimTargetResource: oldTargetResource,
    expectedClaimVersion: "1",
    currentClaimVersion: "1",
    claimRevisionChecks: currentRevisionChecks("relation")
  } as const;
  const primaryRequirement = makeRequirement({
    id: primaryRequirementId,
    permissionId: newTargetPermissionId,
    resource: newTargetResource,
    guard: {
      profileId: "core:rbac.guard.identity_evidence",
      targetResource: newTargetResource,
      evidenceState: "verified",
      operation:
        direction === "employee_to_client_contact"
          ? {
              kind: "client_contact_claim_manage",
              ...commonClaimOperation
            }
          : {
              kind: "employee_claim_manage",
              ...commonClaimOperation,
              newTargetEmployeeId: otherEmployeeId,
              newTargetLifecycle: "active"
            }
    }
  });

  return Object.freeze({
    input: makeInput(
      [primaryRequirement, sourceRequirement, oldTargetRequirement],
      [
        makeGrant(
          newTargetPermissionId,
          { type: "tenant", tenantId },
          `cross-kind-new-${direction}`
        ),
        makeGrant(
          "core:identity.source_identity.use",
          { type: "tenant", tenantId },
          `cross-kind-source-${direction}`
        ),
        makeGrant(
          "core:identity.claim.revoke",
          { type: "tenant", tenantId },
          `cross-kind-old-${direction}`
        )
      ]
    ),
    primaryRequirementId,
    oldTargetRequirementId,
    oldTargetResource,
    newTargetPermissionId
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
      loaderDecisionId: "loader-decision-1",
      projectionRevision: revision,
      observedAt: NOW
    }
  };
}

function currentRevisionChecks(
  kind: "entity" | "relation" | "state" | "manifest" | "policy" = "state"
) {
  return [{ kind, expected: "1", actual: "1" }] as const;
}

function timelineTopologyEvidence<
  const Boundary extends "external" | "internal" | "staff_only"
>(boundary: Boundary) {
  return {
    targetRevisionChecks: currentRevisionChecks("entity"),
    contentTopologyResource: timelineItemTopologyResource,
    topologyTimelineItemResource: timelineItemResource,
    topologyConversationResource: conversationResource,
    topologyBoundary: boundary,
    topologyRevisionChecks: currentRevisionChecks("state")
  } as const;
}

function fileRelationEvidence(
  parentResource: InboxV2EntityKey,
  uploaderEmployeeId: typeof employeeId | null = null
) {
  return {
    parentRelationResource: resource(
      "core:file-parent-relation",
      `file_parent_relation:${String(parentResource.entityId)}`
    ),
    relationFileResource: fileResource,
    relationParentResource: parentResource,
    relationBoundary: "external" as const,
    parentRelationRevisionChecks: currentRevisionChecks("relation"),
    holdIndexResource: resource(
      "core:file-hold-index",
      "file_hold_index:file-1"
    ),
    holdIndexFileResource: fileResource,
    holdRevisionChecks: currentRevisionChecks("state"),
    uploaderRelationResource:
      uploaderEmployeeId === null
        ? null
        : resource(
            "core:file-uploader-relation",
            `file_uploader_relation:${String(uploaderEmployeeId)}`
          ),
    uploaderRelationFileResource:
      uploaderEmployeeId === null ? null : fileResource,
    uploaderEmployeeResource:
      uploaderEmployeeId === null
        ? null
        : resource("core:employee", String(uploaderEmployeeId)),
    uploaderRevisionChecks:
      uploaderEmployeeId === null ? [] : currentRevisionChecks("relation")
  } as const;
}

function makeRequirement(
  overrides: Partial<InboxV2AuthorizationRequirement> = {}
): InboxV2AuthorizationRequirement {
  const permissionId = overrides.permissionId ?? "core:inbox.read";
  const defaultGuard: InboxV2PolicyGuardEvidence =
    permissionId === "core:inbox.read"
      ? {
          ...canonicalGuard,
          action: {
            kind: "inbox_entry_read",
            targetResource: overrides.resource ?? conversationResource,
            entryBoundary: "external_metadata",
            internalReadRequirementId: null,
            topologyResource: conversationTopologyResource,
            topologyTargetResource: overrides.resource ?? conversationResource,
            topologyConversationKind: "external_work",
            topologyRevisionChecks: [
              { kind: "state", expected: "1", actual: "1" }
            ]
          }
        }
      : permissionId === "core:conversation.read"
        ? {
            ...canonicalGuard,
            action: {
              kind: "conversation_content_read",
              targetResource: overrides.resource ?? conversationResource,
              conversationKind: "external_work",
              contentBoundary: "external",
              topologyResource: conversationTopologyResource,
              topologyConversationResource:
                overrides.resource ?? conversationResource,
              topologyConversationKind: "external_work",
              topologyRevisionChecks: [
                { kind: "state", expected: "1", actual: "1" }
              ]
            }
          }
        : canonicalGuard;
  return Object.freeze({
    id: "primary",
    permissionId,
    resource: conversationResource,
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
  id = "grant-1"
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

function keyedRevisionChecks(resources: readonly InboxV2EntityKey[]) {
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
  action: "role_bind" | "internal_membership_add" | "internal_break_glass_read",
  targetResource: InboxV2EntityKey,
  eventResource: InboxV2EntityKey,
  actorResource: InboxV2EntityKey = employeeResource
) {
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

function makePrivacyHoldFixture(
  input: Readonly<{
    permissionId:
      | "core:privacy.hold.view"
      | "core:privacy.hold.issue"
      | "core:privacy.hold.release";
    holdResource: InboxV2EntityKey;
    holdId: string;
    phase: "view" | "issue" | "release";
    reason: string;
    reviewerEmployeeId:
      | typeof employeeId
      | typeof otherEmployeeId
      | typeof thirdEmployeeId
      | null;
    issuerEmployeeId:
      | typeof employeeId
      | typeof otherEmployeeId
      | typeof thirdEmployeeId
      | null;
    releaserEmployeeId:
      | typeof employeeId
      | typeof otherEmployeeId
      | typeof thirdEmployeeId
      | null;
    nextReviewAt?: string;
  }>
) {
  const manifestResource = resource(
    "core:privacy-hold-scope-manifest",
    `privacy_hold_scope_manifest:${input.holdId}`
  );
  const rootResource = resource(
    "core:storage-root",
    `storage_root:hold-${input.holdId}`
  );
  const approverEmployeeResource =
    input.reviewerEmployeeId === null
      ? null
      : resource("core:employee", String(input.reviewerEmployeeId));
  const approvalResource = resource(
    "core:privacy-hold-approval",
    `privacy_hold_approval:${input.holdId}-${input.phase}`
  );
  const issuerEmployeeResource =
    input.issuerEmployeeId === null
      ? null
      : resource("core:employee", String(input.issuerEmployeeId));
  const issuerBindingResource = resource(
    "core:privacy-hold-issuer-binding",
    `privacy_hold_issuer_binding:${input.holdId}`
  );
  const approverDirectoryRequirementId = `privacy-hold-approver-directory-${input.holdId}-${input.phase}`;
  const approverGrantId = `privacy-hold-approver-grant-${input.holdId}-${input.phase}`;
  const approvalEvidence =
    input.phase === "view" ||
    input.reviewerEmployeeId === null ||
    approverEmployeeResource === null
      ? null
      : {
          resource: approvalResource,
          holdResource: input.holdResource,
          manifestResource,
          manifestRootResources: [rootResource],
          approverEmployeeResource,
          approverEmployeeId: input.reviewerEmployeeId,
          approverLifecycle: "active" as const,
          approverDirectoryRequirementId,
          approverGrantId,
          state: "approved" as const,
          revisionChecks: keyedRevisionChecks([
            approvalResource,
            input.holdResource,
            manifestResource,
            approverEmployeeResource,
            rootResource
          ]),
          notAfter: GRANT_END
        };
  const issuerEvidence =
    input.phase === "view" ||
    input.issuerEmployeeId === null ||
    issuerEmployeeResource === null
      ? null
      : {
          resource: issuerBindingResource,
          holdResource: input.holdResource,
          manifestResource,
          manifestRootResources: [rootResource],
          issuerEmployeeResource,
          issuerEmployeeId: input.issuerEmployeeId,
          revisionChecks: keyedRevisionChecks([
            issuerBindingResource,
            input.holdResource,
            manifestResource,
            issuerEmployeeResource,
            rootResource
          ])
        };
  const guard = {
    profileId: "core:rbac.guard.privacy_hold_manifest_revision" as const,
    targetResource: input.holdResource,
    holdId: input.holdId,
    manifestAuthenticity: "authentic" as const,
    manifestResource,
    manifestHoldResource: input.holdResource,
    rootResources: [rootResource],
    manifestRootResources: [rootResource],
    manifestRevisionChecks: keyedRevisionChecks([
      manifestResource,
      input.holdResource,
      rootResource
    ]),
    expectedManifestRevision: "1",
    currentManifestRevision: "1",
    lastReviewedAt: "2026-07-12T09:00:00.000Z",
    nextReviewAt: input.nextReviewAt ?? GRANT_END,
    phase: input.phase,
    actingEmployeeId: employeeId,
    reason: input.reason,
    reviewerEmployeeId: input.reviewerEmployeeId,
    issuerEmployeeId: input.issuerEmployeeId,
    releaserEmployeeId: input.releaserEmployeeId,
    issuerEvidence,
    approvalEvidence,
    contentAuthorityRequested: false as const
  } satisfies InboxV2PolicyGuardEvidence;
  const requirements =
    approvalEvidence === null
      ? []
      : [
          makeRequirement({
            id: approverDirectoryRequirementId,
            permissionId: "core:employee.directory.view",
            resource: approvalEvidence.approverEmployeeResource,
            visibility: "secondary_hidden"
          })
        ];
  const grants =
    approvalEvidence === null
      ? []
      : [
          {
            ...makeGrant(
              input.permissionId,
              { type: "tenant", tenantId },
              approverGrantId
            ),
            principal: {
              kind: "employee" as const,
              employeeId: approvalEvidence.approverEmployeeId
            }
          },
          makeGrant(
            "core:employee.directory.view",
            { type: "tenant", tenantId },
            `${approverDirectoryRequirementId}-grant`
          )
        ];
  return { guard, requirements, grants };
}

function makePrivacyTenantExportFixture(
  input: Readonly<{
    exportResource: InboxV2EntityKey;
    exportId: string;
  }>
) {
  const manifestResource = resource(
    "core:privacy-tenant-export-manifest",
    `privacy_tenant_export_manifest:${input.exportId}`
  );
  const graphResource = resource(
    "core:tenant-resource-graph",
    `tenant_resource_graph:${input.exportId}`
  );
  const rootResource = resource(
    "core:storage-root",
    `storage_root:export-${input.exportId}`
  );
  const approvalResource = resource(
    "core:privacy-tenant-export-approval",
    `privacy_tenant_export_approval:${input.exportId}`
  );
  const requesterEmployeeResource = employeeResource;
  const requesterRelationResource = resource(
    "core:privacy-tenant-export-requester",
    `privacy_tenant_export_requester:${input.exportId}`
  );
  const approverEmployeeResource = otherEmployeeResource;
  const approverDirectoryRequirementId = `privacy-export-approver-directory-${input.exportId}`;
  const approverGrantId = `privacy-export-approver-grant-${input.exportId}`;
  const guard = {
    profileId: "core:rbac.guard.privacy_tenant_export_high_water" as const,
    targetResource: input.exportResource,
    exportId: input.exportId,
    manifestResource,
    manifestExportResource: input.exportResource,
    manifestRequesterEmployeeResource: requesterEmployeeResource,
    manifestRequesterRelationResource: requesterRelationResource,
    graphResource,
    manifestGraphResource: graphResource,
    rootResources: [rootResource],
    manifestRootResources: [rootResource],
    manifestRevisionChecks: keyedRevisionChecks([
      manifestResource,
      input.exportResource,
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
    requesterRelationExportResource: input.exportResource,
    requesterRelationEmployeeResource: requesterEmployeeResource,
    requesterRevisionChecks: keyedRevisionChecks([
      requesterRelationResource,
      input.exportResource,
      requesterEmployeeResource
    ]),
    approverEmployeeId: otherEmployeeId,
    approvalResource,
    approvalExportResource: input.exportResource,
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
    approvalRevisionChecks: keyedRevisionChecks([
      approvalResource,
      input.exportResource,
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
  const requirements = [
    makeRequirement({
      id: approverDirectoryRequirementId,
      permissionId: "core:employee.directory.view",
      resource: approverEmployeeResource,
      visibility: "secondary_hidden"
    })
  ];
  const grants = [
    {
      ...makeGrant(
        "core:privacy.tenant_export",
        { type: "tenant", tenantId },
        approverGrantId
      ),
      principal: { kind: "employee" as const, employeeId: otherEmployeeId }
    },
    makeGrant(
      "core:employee.directory.view",
      { type: "tenant", tenantId },
      `${approverDirectoryRequirementId}-grant`
    )
  ];
  return { guard, requirements, grants };
}

function asIndependentEmployeeRequirement(
  requirement: InboxV2AuthorizationRequirement,
  subjectEmployeeId = otherEmployeeId
): InboxV2AuthorizationRequirement {
  const employee = inboxV2EmployeeReferenceSchema.parse({
    tenantId,
    kind: "employee",
    id: subjectEmployeeId
  });
  const preliminary = makeInput([requirement], []);
  const currentAuthorization = {
    tenantId,
    principal: { kind: "employee" as const, employeeId: subjectEmployeeId },
    authorizationEpoch: epoch,
    dependencies: preliminary.currentAuthorization.dependencies
  };
  const authorization = inboxV2AuthorizationEpochSnapshotSchema.parse({
    tenantId,
    employee,
    value: epoch,
    dependencies: currentAuthorization.dependencies,
    evaluatedAt: NOW,
    notAfter: SESSION_END,
    nextAuthorizationBoundary: SESSION_END
  });
  return {
    ...requirement,
    authorizationSubject: {
      kind: "independent_employee",
      employee,
      lifecycle: "active",
      authorization,
      currentAuthorization,
      notAfter: SESSION_END
    }
  };
}

function makeDependencies(
  requirements: readonly InboxV2AuthorizationRequirement[]
): InboxV2AuthorizationDependencyVector {
  const byResource = new Map<
    string,
    Readonly<{ resource: InboxV2EntityKey; accessRevision: string }>
  >();
  for (const requirement of requirements) {
    const key = `${requirement.resource.tenantId}\u0000${requirement.resource.entityTypeId}\u0000${requirement.resource.entityId}`;
    byResource.set(key, {
      resource: requirement.resource,
      accessRevision: "5"
    });
  }
  return inboxV2AuthorizationDependencyVectorSchema.parse({
    tenantRbacRevision: "1",
    employeeAccessRevision: "2",
    employeeInboxRelationRevision: "3",
    sharedAccessRevision: "4",
    resourceDependencies: [...byResource.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([, dependency]) => dependency),
    temporalBoundaryDigest: DIGEST
  });
}

type ExternalRouteGuardEvidence = Extract<
  InboxV2PolicyGuardEvidence,
  { profileId: "core:rbac.guard.external_route" }
>;
type ExternalRouteOperationEvidence = ExternalRouteGuardEvidence["operation"];
type SourceAccountRouteGuardEvidence = Extract<
  InboxV2PolicyGuardEvidence,
  { profileId: "core:rbac.guard.source_account_route" }
>;
type SourceAccountRouteOperationEvidence =
  SourceAccountRouteGuardEvidence["operation"];

function makeSourceAccountUseOperation(
  targetSourceAccountResource = sourceAccountResource,
  targetBindingResource = sourceThreadBindingResource
): Extract<SourceAccountRouteOperationEvidence, { kind: "use" }> {
  const capabilityManifest = resource(
    "core:provider-capability-manifest",
    `provider_capability_manifest:source-use:${String(targetBindingResource.entityId)}`
  );
  return {
    kind: "use",
    sourceAccountResource: targetSourceAccountResource,
    bindingResource: targetBindingResource,
    capabilityManifest: {
      resource: capabilityManifest,
      capabilityId: "core:capability.source_account.use",
      sourceAccountResource: targetSourceAccountResource,
      bindingResource: targetBindingResource,
      routeResource: null,
      manifestSourceAccountResource: targetSourceAccountResource,
      manifestBindingResource: targetBindingResource,
      manifestRouteResource: null,
      state: "supported",
      revisionChecks: keyedRevisionChecks([
        capabilityManifest,
        targetSourceAccountResource,
        targetBindingResource
      ]),
      notAfter: GRANT_END
    }
  };
}

function makeSourceRerouteCapabilityManifest(
  targetSourceAccountResource: InboxV2EntityKey,
  targetBindingResource: InboxV2EntityKey,
  targetRouteResource: InboxV2EntityKey
): Extract<
  SourceAccountRouteOperationEvidence,
  { kind: "reroute_dispatch" }
>["originalCapabilityManifest"] {
  const capabilityManifest = resource(
    "core:provider-capability-manifest",
    `provider_capability_manifest:source-reroute:${String(targetRouteResource.entityId)}`
  );
  return {
    resource: capabilityManifest,
    capabilityId: "core:capability.source.dispatch.reroute",
    sourceAccountResource: targetSourceAccountResource,
    bindingResource: targetBindingResource,
    routeResource: targetRouteResource,
    manifestSourceAccountResource: targetSourceAccountResource,
    manifestBindingResource: targetBindingResource,
    manifestRouteResource: targetRouteResource,
    state: "supported",
    revisionChecks: keyedRevisionChecks([
      capabilityManifest,
      targetSourceAccountResource,
      targetBindingResource,
      targetRouteResource
    ]),
    notAfter: GRANT_END
  };
}

function makeExternalRouteGuard(
  operation: ExternalRouteOperationEvidence,
  overrides: Partial<ExternalRouteGuardEvidence> = {}
): ExternalRouteGuardEvidence {
  const capabilityId =
    operation.kind === "reply"
      ? "core:capability.message.reply"
      : operation.kind === "forward"
        ? "core:capability.message.forward"
        : operation.kind === "multi_send"
          ? "core:capability.source.multi_send"
          : operation.kind === "source_item_reply"
            ? "core:capability.source_item.reply"
            : "core:capability.call.initiate";
  return {
    profileId: "core:rbac.guard.external_route",
    authorizationMode: "operation",
    multiSendDestinationAuthority: null,
    targetResource: conversationResource,
    conversationResource,
    bindingResource: sourceThreadBindingResource,
    externalThreadResource,
    bindingConversationResource: conversationResource,
    bindingExternalThreadResource: externalThreadResource,
    bindingSourceAccountResource: sourceAccountResource,
    routeRevisionChecks: [
      { kind: "binding", expected: "4", actual: "4" },
      { kind: "route", expected: "2", actual: "2" },
      { kind: "state", expected: "3", actual: "3" }
    ],
    conversationRequirementId: "conversation-read",
    sourceAccountRequirementId: "source-use",
    workRequirementId: "work-read",
    overrideRequirementId: null,
    claimRequirementId: null,
    workItemId,
    workState: "active",
    actorRelation: "primary_responsible",
    queueReplyPolicy: "responsible_only",
    replyPolicyEvidence: {
      resource: resource(
        "core:queue-reply-policy",
        "queue_reply_policy:work-1"
      ),
      conversationResource,
      workItemResource,
      policy: "responsible_only",
      revisionChecks: currentRevisionChecks("state"),
      notAfter: GRANT_END
    },
    workAbsenceProof: null,
    conversationAccessBindingState: "active",
    structuralAccessBinding: null,
    sourceAccountId,
    bindingSourceAccountId: sourceAccountId,
    bindingState: "active",
    bindingGeneration: "4",
    expectedBindingGeneration: "4",
    capabilityState: "supported",
    capabilityId,
    capabilityManifestResource: resource(
      "core:provider-capability-manifest",
      `provider_capability_manifest:${operation.kind}`
    ),
    capabilityManifestSourceAccountResource: sourceAccountResource,
    capabilityManifestBindingResource: sourceThreadBindingResource,
    capabilityRevisionChecks: currentRevisionChecks("manifest"),
    capabilityNotAfter: GRANT_END,
    claimMode: "none",
    overrideReason: null,
    routeFallbackRequested: false,
    ...overrides,
    operation
  };
}

function makeMultiSendDestinationAuthorityRequirement(
  operation: Extract<ExternalRouteOperationEvidence, { kind: "multi_send" }>,
  destination: Extract<
    ExternalRouteOperationEvidence,
    { kind: "multi_send" }
  >["destinations"][number],
  scopeFacts: readonly InboxV2CanonicalScopeFact[] = []
): InboxV2AuthorizationRequirement {
  return makeRequirement({
    id: destination.operationRequirementId,
    permissionId: "core:source.multi_send",
    resource: destination.targetResource,
    scopeFacts,
    visibility: "secondary_hidden",
    guard: makeExternalRouteGuard(operation, {
      authorizationMode: "destination_authority",
      multiSendDestinationAuthority: {
        operationId: operation.operationId,
        targetResource: destination.targetResource,
        bindingResource: destination.bindingResource,
        sourceAccountResource: destination.sourceAccountResource
      },
      targetResource: destination.targetResource,
      conversationResource: destination.targetResource,
      bindingResource: destination.bindingResource,
      externalThreadResource: destination.externalThreadResource,
      bindingConversationResource: destination.targetResource,
      bindingExternalThreadResource: destination.externalThreadResource,
      bindingSourceAccountResource: destination.sourceAccountResource
    })
  });
}

function newResponseReplyOperation(): Extract<
  ExternalRouteOperationEvidence,
  { kind: "reply"; mode: "new_response" }
> {
  return {
    kind: "reply",
    mode: "new_response",
    sourceReadRequirementId: null,
    sourceReadResource: null,
    sourceTimelineItemResource: null,
    sourceOccurrenceResource: null,
    occurrenceTimelineItemResource: null,
    occurrenceReferenceResource: null,
    occurrenceBindingResource: null,
    sourceReferenceResource: null,
    referenceTimelineItemResource: null,
    referenceBindingResource: null,
    revisionChecks: [],
    resourceRevisionChecks: []
  };
}

type ProviderReferenceReplyOperation = Extract<
  ExternalRouteOperationEvidence,
  { kind: "reply"; mode: "provider_reference" }
>;

function providerReferenceReplyOperation(
  overrides: Partial<ProviderReferenceReplyOperation> = {}
): ProviderReferenceReplyOperation {
  return {
    kind: "reply",
    mode: "provider_reference",
    sourceReadRequirementId: "conversation-read",
    sourceReadResource: conversationResource,
    sourceTimelineItemResource: timelineItemResource,
    sourceOccurrenceResource,
    occurrenceTimelineItemResource: timelineItemResource,
    occurrenceReferenceResource: externalMessageReferenceResource,
    occurrenceBindingResource: sourceThreadBindingResource,
    sourceReferenceResource: externalMessageReferenceResource,
    referenceTimelineItemResource: timelineItemResource,
    referenceBindingResource: sourceThreadBindingResource,
    sourceBindingResource: sourceThreadBindingResource,
    bindingConversationResource: conversationResource,
    bindingExternalThreadResource: externalThreadResource,
    bindingSourceAccountResource: sourceAccountResource,
    sourceExternalThreadResource: externalThreadResource,
    portability: "binding_only",
    providerGlobalProof: null,
    revisionChecks: currentRouteRevisionChecks(),
    resourceRevisionChecks: keyedRevisionChecks([
      conversationResource,
      timelineItemResource,
      sourceOccurrenceResource,
      externalMessageReferenceResource,
      sourceThreadBindingResource,
      sourceAccountResource,
      externalThreadResource
    ]),
    ...overrides
  };
}

function providerGlobalReplyProof(
  destinationBindingResource: InboxV2EntityKey,
  destinationSourceAccountResource: InboxV2EntityKey = sourceAccountResource
): NonNullable<ProviderReferenceReplyOperation["providerGlobalProof"]> {
  const proofResource = resource(
    "core:reference-portability-proof",
    `reference_portability_proof:reply:${String(destinationBindingResource.entityId)}`
  );
  const providerContractResource = resource(
    "core:adapter-contract-snapshot",
    "adapter_contract_snapshot:reply-provider-1"
  );
  return {
    resource: proofResource,
    sourceReferenceResource: externalMessageReferenceResource,
    sourceOccurrenceResource,
    originBindingResource: sourceThreadBindingResource,
    originSourceAccountResource: sourceAccountResource,
    destinationBindingResource,
    destinationSourceAccountResource,
    providerContractResource,
    originSourceAccountProviderContractResource: providerContractResource,
    destinationSourceAccountProviderContractResource: providerContractResource,
    revisionChecks: [
      { kind: "binding", expected: "1", actual: "1" },
      { kind: "manifest", expected: "1", actual: "1" }
    ],
    resourceRevisionChecks: keyedRevisionChecks([
      proofResource,
      externalMessageReferenceResource,
      sourceOccurrenceResource,
      sourceThreadBindingResource,
      sourceAccountResource,
      destinationBindingResource,
      destinationSourceAccountResource,
      providerContractResource
    ]),
    notAfter: "2026-07-12T10:20:00.000Z"
  };
}

function makeMultiSendOperation(): Extract<
  ExternalRouteOperationEvidence,
  { kind: "multi_send" }
> {
  return {
    kind: "multi_send",
    operationId: "multi-send-1",
    destinations: [
      {
        targetResource: conversationResource,
        externalThreadResource,
        bindingResource: sourceThreadBindingResource,
        sourceAccountResource,
        bindingConversationResource: conversationResource,
        bindingExternalThreadResource: externalThreadResource,
        bindingSourceAccountResource: sourceAccountResource,
        conversationRequirementId: "conversation-read",
        sourceRequirementId: "source-use",
        operationRequirementId: "multi-send-authority-1",
        revisionChecks: currentRouteRevisionChecks(),
        capabilityId: "core:capability.source.multi_send",
        capabilityManifestResource: providerCapabilityManifestResource,
        capabilityManifestSourceAccountResource: sourceAccountResource,
        capabilityManifestBindingResource: sourceThreadBindingResource,
        capabilityRevisionChecks: currentRevisionChecks("manifest"),
        capabilityState: "supported",
        capabilityNotAfter: GRANT_END
      },
      {
        targetResource: hiddenConversationResource,
        externalThreadResource: secondExternalThreadResource,
        bindingResource: secondSourceThreadBindingResource,
        sourceAccountResource,
        bindingConversationResource: hiddenConversationResource,
        bindingExternalThreadResource: secondExternalThreadResource,
        bindingSourceAccountResource: sourceAccountResource,
        conversationRequirementId: "destination-read-2",
        sourceRequirementId: "source-use",
        operationRequirementId: "multi-send-authority-2",
        revisionChecks: currentRouteRevisionChecks(),
        capabilityId: "core:capability.source.multi_send",
        capabilityManifestResource: providerCapabilityManifestResource,
        capabilityManifestSourceAccountResource: sourceAccountResource,
        capabilityManifestBindingResource: secondSourceThreadBindingResource,
        capabilityRevisionChecks: currentRevisionChecks("manifest"),
        capabilityState: "supported",
        capabilityNotAfter: "2026-07-12T10:15:00.000Z"
      }
    ]
  };
}

function makeSourceAccountRouteGuard(
  operation: SourceAccountRouteOperationEvidence = makeSourceAccountUseOperation(),
  overrides: Partial<SourceAccountRouteGuardEvidence> = {}
): SourceAccountRouteGuardEvidence {
  return {
    profileId: "core:rbac.guard.source_account_route",
    sourceAccountId,
    routeSourceAccountId: sourceAccountId,
    sourceState: "active",
    bindingState: "active",
    bindingGeneration: "4",
    expectedBindingGeneration: "4",
    capabilityState: "supported",
    capabilityNotAfter: GRANT_END,
    ...overrides,
    operation
  };
}

function externalReplyRequirements(): readonly InboxV2AuthorizationRequirement[] {
  const replyGuard = makeExternalRouteGuard(newResponseReplyOperation());
  const sourceGuard = makeSourceAccountRouteGuard();
  return Object.freeze([
    makeRequirement({
      id: "reply",
      permissionId: "core:message.reply_external",
      scopeFacts: [
        {
          kind: "responsible",
          ...scopePath(conversationResource, workItemResource),
          employeeId,
          workItemId,
          state: "active",
          assignmentRevision: revision,
          currentAssignmentRevision: revision,
          validUntil: LATER
        }
      ],
      guard: replyGuard
    }),
    makeRequirement({
      id: "conversation-read",
      permissionId: "core:conversation.read",
      visibility: "secondary_hidden"
    }),
    makeRequirement({
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
      guard: sourceGuard,
      visibility: "secondary_hidden"
    }),
    makeRequirement({
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
    })
  ]);
}

type ExternalRoutePermissionId =
  | "core:message.reply_external"
  | "core:message.forward_external"
  | "core:source.multi_send"
  | "core:source_item.reply"
  | "core:call.initiate";

function externalOperationRequirements(
  permissionId: ExternalRoutePermissionId,
  operation: ExternalRouteOperationEvidence,
  extraRequirements: readonly InboxV2AuthorizationRequirement[] = [],
  targetResource = conversationResource,
  guardOverrides: Partial<ExternalRouteGuardEvidence> = {}
): readonly InboxV2AuthorizationRequirement[] {
  const [, ...baseCompanions] = externalReplyRequirements();
  const primary = makeRequirement({
    id: "operation",
    permissionId,
    resource: targetResource,
    scopeFacts: [
      {
        kind: "responsible",
        ...scopePath(targetResource, workItemResource),
        employeeId,
        workItemId,
        state: "active",
        assignmentRevision: revision,
        currentAssignmentRevision: revision,
        validUntil: LATER
      },
      ...(targetResource.entityTypeId === "core:client"
        ? [
            {
              kind: "client" as const,
              ...scopePath(targetResource, targetResource),
              clientId,
              validUntil: LATER
            }
          ]
        : [])
    ],
    guard: makeExternalRouteGuard(operation, {
      targetResource,
      ...guardOverrides
    })
  });
  const destinationAuthorities =
    operation.kind === "multi_send"
      ? operation.destinations.map((destination) =>
          makeMultiSendDestinationAuthorityRequirement(operation, destination)
        )
      : [];
  return Object.freeze([
    primary,
    ...baseCompanions,
    ...extraRequirements,
    ...destinationAuthorities
  ]);
}

function externalOperationGrants(
  permissionId: ExternalRoutePermissionId,
  extraGrants: readonly InboxV2PolicyGrant[] = [],
  primaryScope: InboxV2PermissionScope = { type: "tenant", tenantId }
): readonly InboxV2PolicyGrant[] {
  return Object.freeze([
    makeGrant(permissionId, primaryScope, "operation"),
    makeGrant(
      "core:conversation.read",
      { type: "tenant", tenantId },
      "operation-conversation"
    ),
    makeGrant(
      "core:source_account.use",
      { type: "source_account", tenantId, id: sourceAccountId },
      "operation-source"
    ),
    makeGrant("core:work.read", { type: "tenant", tenantId }, "operation-work"),
    ...extraGrants
  ]);
}

function makeSourceItemOpenRequirement(
  id: string,
  targetResource = sourceItemResource
): InboxV2AuthorizationRequirement {
  const descriptorResource = resource(
    "core:source-action-descriptor",
    `source_action_descriptor:${id}`
  );
  return makeRequirement({
    id,
    permissionId: "core:source_item.open_external",
    resource: targetResource,
    guard: {
      ...canonicalGuard,
      contentBoundary: "none",
      action: {
        kind: "source_item_open_external",
        targetResource,
        descriptorResource,
        descriptorTargetResource: targetResource,
        sourceAccountResource,
        descriptorSourceAccountResource: sourceAccountResource,
        descriptorState: "approved",
        actionType: "open_url",
        descriptorRevisionChecks: [
          { kind: "binding", expected: "1", actual: "1" },
          { kind: "state", expected: "1", actual: "1" }
        ],
        notAfter: GRANT_END
      }
    },
    visibility: "secondary_hidden"
  });
}

type SourceAccountRoutePermissionId =
  | "core:source_account.use"
  | "core:source.route_policy.manage"
  | "core:source.dispatch.reroute";

function makeSourceAccountOperationRequirement(
  permissionId: SourceAccountRoutePermissionId,
  operation: SourceAccountRouteOperationEvidence,
  overrides: Readonly<{
    id?: string;
    sourceAccountId?: typeof sourceAccountId;
    resource?: InboxV2EntityKey;
    visibility?: "primary" | "secondary_hidden";
  }> = {}
): InboxV2AuthorizationRequirement {
  const targetSourceAccountId = overrides.sourceAccountId ?? sourceAccountId;
  const targetResource = overrides.resource ?? sourceAccountResource;
  return makeRequirement({
    id: overrides.id ?? "primary",
    permissionId,
    resource: targetResource,
    scopeFacts: [
      {
        kind: "source_account",
        ...scopePath(targetResource, targetResource),
        sourceAccountId: targetSourceAccountId,
        validUntil: LATER
      }
    ],
    guard: makeSourceAccountRouteGuard(operation, {
      sourceAccountId: targetSourceAccountId,
      routeSourceAccountId: targetSourceAccountId
    }),
    visibility: overrides.visibility ?? "primary"
  });
}

function makeClientLinkRequirement(
  id: string,
  targetClientId: typeof clientId,
  targetResource: InboxV2EntityKey
): InboxV2AuthorizationRequirement {
  const manifestResource = resource(
    "core:authorization-manifest",
    "authorization_manifest:client-links"
  );
  const linkResource = resource(
    "core:conversation-client-link",
    `conversation_client_link:${id}`
  );
  const auditEventResource = resource(
    "core:audit-event",
    "audit_event:client-links"
  );
  return makeRequirement({
    id,
    permissionId: "core:client.link.manage",
    resource: targetResource,
    scopeFacts: [
      {
        kind: "client",
        ...scopePath(targetResource, targetResource),
        clientId: targetClientId,
        validUntil: LATER
      }
    ],
    guard: {
      profileId: "core:rbac.guard.client_context",
      target: { kind: "client", clientId: targetClientId },
      accessPath: "exact_client_binding",
      pathEvidence: exactClientBindingPathEvidence({
        targetResource,
        clientResource: targetResource,
        authorityResource: targetResource,
        suffix: id
      }),
      contextualRequirementIds: [],
      linkedClientRequirementIds: [],
      mutation: {
        kind: "client_link_target_authority",
        operation: "add",
        clientResource: targetResource,
        conversationResource,
        linkResource,
        relationConversationResource: conversationResource,
        relationClientResource: targetResource,
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
          { kind: "manifest", expected: "1", actual: "1" }
        ],
        reason: "link all authorized Clients atomically",
        auditEventResource,
        auditConversationResource: conversationResource,
        auditClientResource: targetResource,
        auditLinkResource: linkResource
      }
    },
    visibility: "secondary_hidden"
  });
}

function makeConversationClientLinksRequirement(
  id: string,
  clientRequirements: readonly InboxV2AuthorizationRequirement[],
  conversationReadRequirementId: string
): InboxV2AuthorizationRequirement {
  const manifestResource = resource(
    "core:authorization-manifest",
    "authorization_manifest:client-links"
  );
  const auditEventResource = resource(
    "core:audit-event",
    "audit_event:client-links"
  );
  const targets = clientRequirements.map((requirement) => {
    if (
      requirement.guard.profileId !== "core:rbac.guard.client_context" ||
      requirement.guard.mutation?.kind !== "client_link_target_authority"
    ) {
      throw new Error("Expected an exact Client link target authority");
    }
    const mutation = requirement.guard.mutation;
    return {
      clientResource: mutation.clientResource,
      linkResource: mutation.linkResource,
      relationConversationResource: mutation.relationConversationResource,
      relationClientResource: mutation.relationClientResource,
      expectedLinkRevision: mutation.expectedLinkRevision,
      currentLinkRevision: mutation.currentLinkRevision,
      relationRevisionChecks: mutation.relationRevisionChecks,
      clientRequirementId: requirement.id
    };
  });
  return makeRequirement({
    id,
    permissionId: "core:conversation.clients.manage",
    resource: conversationResource,
    guard: {
      profileId: "core:rbac.guard.client_context",
      target: { kind: "conversation", conversationId },
      accessPath: "active_conversation_link",
      pathEvidence: activeConversationLinkPathEvidence({
        targetResource: conversationResource,
        clientResource: targets[0]!.clientResource,
        conversationResource,
        suffix: `conversation-links-${id}`
      }),
      contextualRequirementIds: [conversationReadRequirementId],
      linkedClientRequirementIds: clientRequirements.map(({ id }) => id),
      mutation: {
        kind: "conversation_client_links_change",
        operation: "add",
        conversationResource,
        manifestResource,
        manifestConversationResource: conversationResource,
        requestedTargetCount: targets.length,
        manifestTargetCount: targets.length,
        requestedTargetSetDigest: DIGEST,
        manifestTargetSetDigest: DIGEST,
        manifestRevisionChecks: [
          { kind: "manifest", expected: "1", actual: "1" }
        ],
        targets,
        reason: "link all authorized Clients atomically",
        auditEventResource,
        auditConversationResource: conversationResource,
        auditManifestResource: manifestResource
      }
    }
  });
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

function currentRouteRevisionChecks() {
  return [
    { kind: "binding" as const, expected: "1", actual: "1" },
    { kind: "route" as const, expected: "1", actual: "1" },
    { kind: "state" as const, expected: "1", actual: "1" }
  ];
}

function makeReportViewRequirement(
  id: string
): InboxV2AuthorizationRequirement {
  return makeRequirement({
    id,
    permissionId: "core:reports.view",
    resource: reportResource,
    guard: {
      profileId: "core:rbac.guard.canonical_resource",
      resourceState: "active",
      contentBoundary: "none",
      routeInputFields: [],
      companionRequirementIds: [],
      action: {
        kind: "report_aggregate",
        targetResource: reportResource,
        privacy: safeReportPrivacyEvidence()
      }
    }
  });
}

function makeReportConjunctionRequirement(
  id: string,
  permissionId:
    | "core:reports.drilldown"
    | "core:reports.pii.view"
    | "core:reports.pii.export",
  accessLevel: "drilldown" | "pii" | "pii_export",
  layerRequirementIds: readonly string[]
): InboxV2AuthorizationRequirement {
  return makeRequirement({
    id,
    permissionId,
    resource: reportResource,
    guard: {
      profileId: "core:rbac.guard.report_resource_conjunction",
      targetResource: reportResource,
      accessLevel,
      layerRequirementIds,
      underlyingRequirementIds: ["report-row"],
      underlyingResources: [conversationResource],
      manifestResource: resource(
        "core:authorization-manifest",
        `authorization_manifest:${id}`
      ),
      manifestTargetResource: reportResource,
      manifestRevisionChecks: [
        { kind: "manifest", expected: "1", actual: "1" }
      ],
      scopeAppliedBeforeCountAndPagination: true,
      privateInternalIncluded: false,
      privateInternalRequirementIds: []
    }
  });
}

function makeWorkRequirement(input: {
  id: string;
  permissionId:
    | "core:work.read"
    | "core:work.claim"
    | "core:work.assign"
    | "core:work.servicing_team.manage"
    | "core:work.release_self"
    | "core:work.release_other"
    | "core:work.transfer"
    | "core:work.close"
    | "core:work.reopen"
    | "core:work.override";
  operation:
    | "read"
    | "claim"
    | "assign"
    | "servicing_team_manage"
    | "release_self"
    | "release_other"
    | "transfer"
    | "close"
    | "reopen"
    | "override";
  workState: "active" | "recovery_pending" | "terminal_actionable" | "terminal";
  actorRelation:
    | "primary_responsible"
    | "work_item_collaborator"
    | "scoped_supervisor_override"
    | "queue_member"
    | "none";
  assignmentState: "unassigned" | "assigned" | "recovery_pending";
  destinationRequirementIds?: readonly string[];
  destinationResources?: readonly InboxV2EntityKey[];
  assignmentEligibility?: Extract<
    InboxV2PolicyGuardEvidence,
    { profileId: "core:rbac.guard.work_item_state" }
  >["assignmentEligibility"];
  servicingTeamChange?: Extract<
    InboxV2PolicyGuardEvidence,
    { profileId: "core:rbac.guard.work_item_state" }
  >["servicingTeamChange"];
  overrideReason?: string | null;
  overrideRequirementId?: string | null;
  visibility?: "primary" | "secondary_hidden";
}): InboxV2AuthorizationRequirement {
  return makeRequirement({
    id: input.id,
    permissionId: input.permissionId,
    resource: workItemResource,
    visibility: input.visibility ?? "primary",
    guard: {
      profileId: "core:rbac.guard.work_item_state",
      authorizationMode: "operation",
      workItemId,
      operation: input.operation,
      workState: input.workState,
      actorRelation: input.actorRelation,
      assignmentState: input.assignmentState,
      expectedStateRevision: "1",
      currentStateRevision: "1",
      destinationRequirementIds: input.destinationRequirementIds ?? [],
      destinationResources: input.destinationResources ?? [],
      authorityTargetResource: null,
      authorityState: null,
      eligibleEmployeeId: null,
      authorityRevisionChecks: [],
      assignmentEligibility: input.assignmentEligibility,
      servicingTeamChange: input.servicingTeamChange,
      overrideReason: input.overrideReason ?? null,
      overrideRequirementId: input.overrideRequirementId ?? null
    }
  });
}

function makeWorkDestinationRequirement(input: {
  id: string;
  permissionId:
    | "core:work.claim"
    | "core:work.assign"
    | "core:work.servicing_team.manage"
    | "core:work.release_self"
    | "core:work.release_other"
    | "core:work.transfer"
    | "core:work.reopen";
  operation:
    | "claim"
    | "assign"
    | "servicing_team_manage"
    | "release_self"
    | "release_other"
    | "transfer"
    | "reopen";
  targetResource: InboxV2EntityKey;
  scopeFact: InboxV2CanonicalScopeFact;
}): InboxV2AuthorizationRequirement {
  return makeRequirement({
    id: input.id,
    permissionId: input.permissionId,
    resource: workItemResource,
    scopeFacts: [input.scopeFact],
    visibility: "secondary_hidden",
    guard: {
      profileId: "core:rbac.guard.work_item_state",
      authorizationMode: "destination_authority",
      workItemId,
      operation: input.operation,
      workState: "active",
      actorRelation: "none",
      assignmentState: "assigned",
      expectedStateRevision: "1",
      currentStateRevision: "1",
      destinationRequirementIds: [],
      destinationResources: [],
      authorityTargetResource: input.targetResource,
      authorityState: "eligible",
      eligibleEmployeeId: input.operation === "claim" ? employeeId : null,
      authorityRevisionChecks: [
        { kind: "relation", expected: "1", actual: "1" }
      ],
      overrideReason: null,
      overrideRequirementId: null
    }
  });
}

function makeDeletionGuard(input: {
  phase: "preview" | "approve" | "execute";
  actingEmployeeId: typeof employeeId;
  requesterEmployeeId?: typeof employeeId;
  approverEmployeeId?: typeof employeeId | null;
  executorEmployeeId?: typeof employeeId | null;
  coolingPeriodEndsAt?: string;
  holdState?: "clear" | "active" | "ambiguous";
  ioRequested?: boolean;
  rootAndHandlerRevisionChecks?: readonly {
    kind: "entity" | "handler";
    expected: string;
    actual: string;
  }[];
}): InboxV2PolicyGuardEvidence {
  const rootCheck = input.rootAndHandlerRevisionChecks?.find(
    ({ kind }) => kind === "entity"
  ) ?? { expected: "1", actual: "1" };
  const handlerCheck = input.rootAndHandlerRevisionChecks?.find(
    ({ kind }) => kind === "handler"
  ) ?? { expected: "1", actual: "1" };
  const omitRoots =
    input.rootAndHandlerRevisionChecks !== undefined &&
    !input.rootAndHandlerRevisionChecks.some(({ kind }) => kind === "entity");
  const omitHandlers =
    input.rootAndHandlerRevisionChecks !== undefined &&
    !input.rootAndHandlerRevisionChecks.some(({ kind }) => kind === "handler");
  const roots = omitRoots
    ? []
    : [
        {
          resource: conversationResource,
          rootKind: "sql" as const,
          boundary: "operated_data_plane" as const,
          relationResource: privacyDeletionRootRelationResource,
          relationPlanResource: privacyDeletionResource,
          relationRootResource: conversationResource,
          revisionChecks: [
            {
              resource: privacyDeletionRootRelationResource,
              expected: rootCheck.expected,
              actual: rootCheck.actual
            },
            {
              resource: privacyDeletionResource,
              expected: rootCheck.expected,
              actual: rootCheck.actual
            },
            {
              resource: conversationResource,
              expected: rootCheck.expected,
              actual: rootCheck.actual
            }
          ]
        }
      ];
  const handlers = omitHandlers
    ? []
    : [
        {
          resource: privacyDeleteHandlerResource,
          rootResource: conversationResource,
          relationResource: privacyDeletionHandlerRelationResource,
          relationPlanResource: privacyDeletionResource,
          relationRootResource: conversationResource,
          relationHandlerResource: privacyDeleteHandlerResource,
          revisionChecks: [
            {
              resource: privacyDeletionHandlerRelationResource,
              expected: handlerCheck.expected,
              actual: handlerCheck.actual
            },
            {
              resource: privacyDeletionResource,
              expected: handlerCheck.expected,
              actual: handlerCheck.actual
            },
            {
              resource: conversationResource,
              expected: handlerCheck.expected,
              actual: handlerCheck.actual
            },
            {
              resource: privacyDeleteHandlerResource,
              expected: handlerCheck.expected,
              actual: handlerCheck.actual
            }
          ],
          surfaceKind: "sql" as const,
          executionMode:
            input.phase === "execute"
              ? ("operated_io" as const)
              : ("none" as const),
          externalOutcome: null,
          externalProvider: null
        }
      ];
  const manifestResources = [
    privacyDeletionManifestResource,
    privacyDeletionResource,
    privacyDeletionRequesterRelationResource,
    resource("core:employee", String(input.requesterEmployeeId ?? employeeId)),
    ...roots.map(({ resource }) => resource),
    ...handlers.map(({ resource }) => resource)
  ];
  const holdResources = [
    privacyDeletionHoldIndexResource,
    privacyDeletionResource,
    ...roots.map(({ resource }) => resource)
  ];
  const ioRequested = input.ioRequested ?? input.phase === "execute";
  const effectiveRequesterEmployeeId = input.requesterEmployeeId ?? employeeId;
  const requesterEmployeeResource = resource(
    "core:employee",
    String(effectiveRequesterEmployeeId)
  );
  const effectiveApproverEmployeeId =
    input.approverEmployeeId === undefined
      ? input.phase === "execute"
        ? thirdEmployeeId
        : null
      : input.approverEmployeeId;
  const approvalApproverEmployeeResource =
    effectiveApproverEmployeeId === null
      ? null
      : resource("core:employee", String(effectiveApproverEmployeeId));
  const approvalEvidence =
    input.phase === "execute" &&
    effectiveApproverEmployeeId !== null &&
    approvalApproverEmployeeResource !== null
      ? {
          resource: privacyDeletionApprovalResource,
          planResource: privacyDeletionResource,
          manifestResource: privacyDeletionManifestResource,
          requesterEmployeeResource,
          requesterRelationResource: privacyDeletionRequesterRelationResource,
          approverEmployeeResource: approvalApproverEmployeeResource,
          approverEmployeeId: effectiveApproverEmployeeId,
          approverLifecycle: "active" as const,
          approverDirectoryRequirementId: "deletion-approver-directory",
          approverGrantId: "deletion-approver-grant",
          state: "approved" as const,
          revisionChecks: [
            privacyDeletionApprovalResource,
            privacyDeletionResource,
            privacyDeletionManifestResource,
            privacyDeletionRequesterRelationResource,
            requesterEmployeeResource,
            approvalApproverEmployeeResource,
            ...roots.map(({ resource }) => resource),
            ...handlers.map(({ resource }) => resource)
          ].map((resource) => ({ resource, expected: "1", actual: "1" })),
          notAfter: GRANT_END
        }
      : null;

  return {
    profileId: "core:rbac.guard.privacy_deletion_plan_revisions",
    targetResource: privacyDeletionResource,
    deletionPlanId: "plan-1",
    expectedPlanRevision: "1",
    currentPlanRevision: "1",
    manifestResource: privacyDeletionManifestResource,
    manifestTargetResource: privacyDeletionResource,
    manifestRequesterEmployeeResource: requesterEmployeeResource,
    manifestRequesterRelationResource: privacyDeletionRequesterRelationResource,
    manifestRootResources: roots.map(({ resource }) => resource),
    manifestHandlerResources: handlers.map(({ resource }) => resource),
    manifestRevisionChecks: manifestResources.map((resource) => ({
      resource,
      expected: "1",
      actual: "1"
    })),
    roots,
    handlers,
    requesterEmployeeResource,
    requesterRelationResource: privacyDeletionRequesterRelationResource,
    requesterRelationPlanResource: privacyDeletionResource,
    requesterRelationEmployeeResource: requesterEmployeeResource,
    requesterRevisionChecks: [
      privacyDeletionRequesterRelationResource,
      privacyDeletionResource,
      requesterEmployeeResource
    ].map((resource) => ({ resource, expected: "1", actual: "1" })),
    holdIndexResource: privacyDeletionHoldIndexResource,
    holdIndexPlanResource: privacyDeletionResource,
    holdIndexRootResources: roots.map(({ resource }) => resource),
    holdState: input.holdState ?? "clear",
    holdRevisionChecks: holdResources.map((resource) => ({
      resource,
      expected: "1",
      actual: "1"
    })),
    holdFenceCheckedAt: NOW,
    holdFenceNotAfter: GRANT_END,
    phase: input.phase,
    actingEmployeeId: input.actingEmployeeId,
    requesterEmployeeId: effectiveRequesterEmployeeId,
    approverEmployeeId: effectiveApproverEmployeeId,
    executorEmployeeId: input.executorEmployeeId ?? null,
    approvalEvidence,
    coolingPeriodEndsAt: input.coolingPeriodEndsAt ?? GRANT_END,
    ioRequested
  };
}

function makeDeletionRequirement(input: {
  permissionId:
    | "core:privacy.deletion.preview"
    | "core:privacy.deletion.approve"
    | "core:privacy.deletion.execute";
  phase: "preview" | "approve" | "execute";
  actingEmployeeId: typeof employeeId;
  rootAndHandlerRevisionChecks: readonly {
    kind: "entity" | "handler";
    expected: string;
    actual: string;
  }[];
}): InboxV2AuthorizationRequirement {
  return makeRequirement({
    permissionId: input.permissionId,
    resource: privacyDeletionResource,
    guard: makeDeletionGuard({
      phase: input.phase,
      actingEmployeeId: input.actingEmployeeId,
      rootAndHandlerRevisionChecks: input.rootAndHandlerRevisionChecks
    })
  });
}

const permissionSemanticCoverage = {
  "core:tenant.manage": "semantic_closure",
  "core:employee.directory.view": "policy_suite",
  "core:employee.invite": "semantic_closure",
  "core:employee.profile.manage": "semantic_closure",
  "core:employee.deactivate": "semantic_closure",
  "core:roles.define": "semantic_closure",
  "core:roles.bind": "policy_suite",
  "core:direct_grants.manage": "semantic_closure",
  "core:org_unit.manage": "semantic_closure",
  "core:team.manage": "semantic_closure",
  "core:queue.manage": "policy_suite",
  "core:inbox.read": "policy_suite",
  "core:conversation.read": "policy_suite",
  "core:conversation.internal.read": "policy_suite",
  "core:conversation.internal.create": "policy_suite",
  "core:conversation.internal.members.manage": "policy_suite",
  "core:conversation.internal.owner_recover": "semantic_closure",
  "core:conversation.internal.break_glass_read": "policy_suite",
  "core:conversation.internal.break_glass.issue": "policy_suite",
  "core:conversation.access_binding.manage": "policy_suite",
  "core:conversation.access_binding.apply_policy": "semantic_closure",
  "core:conversation.timeline_append_system": "semantic_closure",
  "core:conversation.collaborators.manage": "policy_suite",
  "core:notification.watch.self": "policy_suite",
  "core:notification.watchers.manage": "policy_suite",
  "core:notification.preferences.manage_self": "policy_suite",
  "core:notification.endpoints.manage_self": "policy_suite",
  "core:message.reply_external": "policy_suite",
  "core:message.send_internal": "policy_suite",
  "core:message.staff_note.read": "semantic_closure",
  "core:message.staff_note.create": "policy_suite",
  "core:message.edit_own": "policy_suite",
  "core:message.delete_own": "semantic_closure",
  "core:message.react": "policy_suite",
  "core:message.moderate_external": "policy_suite",
  "core:message.moderate_internal": "policy_suite",
  "core:message.forward_external": "policy_suite",
  "core:work.read": "policy_suite",
  "core:work.claim": "policy_suite",
  "core:work.assign": "policy_suite",
  "core:work.servicing_team.manage": "policy_suite",
  "core:work.release_self": "semantic_closure",
  "core:work.release_other": "semantic_closure",
  "core:work.transfer": "semantic_closure",
  "core:work.close": "policy_suite",
  "core:work.reopen": "policy_suite",
  "core:work.override": "policy_suite",
  "core:source_account.view": "semantic_closure",
  "core:source_account.diagnostics.view": "semantic_closure",
  "core:source_account.use": "policy_suite",
  "core:source.route_policy.manage": "policy_suite",
  "core:source.dispatch.reroute": "policy_suite",
  "core:source.multi_send": "policy_suite",
  "core:source_item.reply": "policy_suite",
  "core:source_item.open_external": "policy_suite",
  "core:call.initiate": "policy_suite",
  "core:call.recording.view": "policy_suite",
  "core:call.transcript.view": "semantic_closure",
  "core:file.view": "policy_suite",
  "core:file.upload": "policy_suite",
  "core:file.delete": "policy_suite",
  "core:participant.pii.view": "policy_suite",
  "core:client.view": "policy_suite",
  "core:client.contacts.view": "policy_suite",
  "core:client.edit": "semantic_closure",
  "core:client.pipeline.transition": "semantic_closure",
  "core:client.fields.view_sensitive": "semantic_closure",
  "core:client.fields.edit": "semantic_closure",
  "core:client.owner.assign": "semantic_closure",
  "core:client.access_binding.manage": "semantic_closure",
  "core:conversation.clients.manage": "policy_suite",
  "core:client.link.manage": "policy_suite",
  "core:identity.employee_claim.manage": "semantic_closure",
  "core:identity.client_contact_claim.manage": "semantic_closure",
  "core:identity.source_identity.use": "semantic_closure",
  "core:identity.evidence.view": "semantic_closure",
  "core:identity.auto_resolve": "semantic_closure",
  "core:identity.claim.revoke": "semantic_closure",
  "core:identity.merge": "semantic_closure",
  "core:identity.observation.review": "semantic_closure",
  "core:reports.view": "policy_suite",
  "core:reports.workforce_dimension.view": "semantic_closure",
  "core:reports.drilldown": "policy_suite",
  "core:reports.export": "policy_suite",
  "core:reports.pii.view": "policy_suite",
  "core:reports.pii.export": "policy_suite",
  "core:audit.view": "semantic_closure",
  "core:privacy.policy.view": "policy_suite",
  "core:privacy.policy.manage": "policy_suite",
  "core:privacy.request.view": "semantic_closure",
  "core:privacy.request.decide": "policy_suite",
  "core:privacy.request.execute": "semantic_closure",
  "core:privacy.subject_evidence.view": "policy_suite",
  "core:privacy.hold.view": "semantic_closure",
  "core:privacy.hold.issue": "semantic_closure",
  "core:privacy.hold.release": "policy_suite",
  "core:privacy.tenant_export": "policy_suite",
  "core:privacy.deletion.preview": "policy_suite",
  "core:privacy.deletion.approve": "policy_suite",
  "core:privacy.deletion.execute": "policy_suite",
  "core:audit.privacy.view": "semantic_closure",
  "core:audit.privacy.export": "semantic_closure"
} as const satisfies Record<
  InboxV2PermissionId,
  "policy_suite" | "semantic_closure"
>;

const requiredGeneratedAuthorizationFamilies = Object.freeze([
  "responsibility",
  "internal_privacy",
  "staff_note",
  "multi_client",
  "claim",
  "route",
  "aggregate",
  "drilldown",
  "message_lifecycle",
  "privacy_case",
  "privacy_root",
  "hold",
  "export",
  "delete",
  "separation_of_duties",
  "hidden_target"
] as const);

type RequiredGeneratedAuthorizationFamily =
  (typeof requiredGeneratedAuthorizationFamilies)[number];

type RequiredFamilyMatrixRow = Readonly<{
  family: RequiredGeneratedAuthorizationFamily;
  axis:
    | "semantic"
    | "principal"
    | "scope"
    | "relation"
    | "state"
    | "visibility";
  principal: "employee" | "draining_employee";
  permissionId: string;
  scope: string;
  relation: string;
  state: string;
  visibility: "primary" | "secondary_hidden";
  input: InboxV2AuthorizationPlanInput;
  expectedOutcome: "allowed" | "denied";
  expectedPublicErrorCode: string | null;
}>;

type MatrixPrincipalState =
  | "active_employee"
  | "draining_employee"
  | "trusted_service";
type MatrixScopeKind =
  | "tenant"
  | "org_unit"
  | "team"
  | "queue"
  | "client"
  | "conversation"
  | "work_item"
  | "source_account"
  | "responsible"
  | "collaborator"
  | "internal_participant"
  | "client_owner";
type MatrixRelationState = "current" | "stale";

function generatedRequiredFamilyMatrix(): readonly RequiredFamilyMatrixRow[] {
  return requiredGeneratedAuthorizationFamilies.flatMap((family) => {
    const semantic = requiredFamilyMatrixRow(family);
    const relationRevision = inboxV2EntityRevisionSchema.parse("999");
    const primaryIndex = semantic.input.requirements.findIndex(
      ({ permissionId }) => permissionId === semantic.permissionId
    );
    if (primaryIndex < 0) {
      throw new Error(`Missing semantic primary for ${family}`);
    }
    const staleStateRequirements = semantic.input.requirements.map(
      (requirement, index) =>
        index === primaryIndex
          ? { ...requirement, expectedResourceAccessRevision: "999" }
          : requirement
    );
    const hiddenFence = {
      ...semantic.input.requirements[primaryIndex]!,
      visibility: "secondary_hidden" as const
    };
    const hiddenPrimaryBase = makeRequirement({
      id: `family-primary-${family}`
    });
    if (
      hiddenPrimaryBase.guard.profileId !== "core:rbac.guard.canonical_resource"
    ) {
      throw new Error("expected canonical Inbox guard");
    }
    const hiddenPrimary = {
      ...hiddenPrimaryBase,
      guard: {
        ...hiddenPrimaryBase.guard,
        companionRequirementIds: [hiddenFence.id]
      }
    };
    return [
      semantic,
      {
        ...semantic,
        axis: "principal" as const,
        principal: "draining_employee" as const,
        state: "principal_draining",
        input: {
          ...semantic.input,
          principal: {
            ...semantic.input.principal,
            kind: "employee",
            lifecycle: "draining"
          } as InboxV2PolicyPrincipal
        },
        expectedOutcome: "denied" as const,
        expectedPublicErrorCode: null
      },
      {
        ...semantic,
        axis: "scope" as const,
        state: "grant_scope_missing",
        input: {
          ...semantic.input,
          grants: semantic.input.grants.filter(
            ({ permissionId }) => permissionId !== semantic.permissionId
          )
        },
        expectedOutcome: "denied" as const,
        expectedPublicErrorCode: null
      },
      {
        ...semantic,
        axis: "relation" as const,
        state: "relation_revision_changed",
        input: {
          ...semantic.input,
          currentAuthorization: {
            ...semantic.input.currentAuthorization,
            dependencies: {
              ...semantic.input.currentAuthorization.dependencies,
              employeeInboxRelationRevision: relationRevision
            }
          }
        },
        expectedOutcome: "denied" as const,
        expectedPublicErrorCode: "auth.access_revision_stale"
      },
      {
        ...semantic,
        axis: "state" as const,
        state: "resource_access_revision_changed",
        input: makeInput(staleStateRequirements, semantic.input.grants),
        expectedOutcome: "denied" as const,
        expectedPublicErrorCode: null
      },
      {
        ...semantic,
        axis: "visibility" as const,
        visibility: "secondary_hidden" as const,
        state: "hidden_target_missing",
        input: makeInput(
          [
            hiddenPrimary,
            ...semantic.input.requirements.map((requirement, index) =>
              index === primaryIndex ? hiddenFence : requirement
            )
          ],
          [
            makeGrant(
              "core:inbox.read",
              { type: "tenant", tenantId },
              `family-hidden-primary-${family}`
            ),
            ...semantic.input.grants.filter(
              ({ permissionId }) => permissionId !== semantic.permissionId
            )
          ]
        ),
        expectedOutcome: "denied" as const,
        expectedPublicErrorCode: "resource.not_found"
      }
    ];
  });
}

function requiredFamilyMatrixRow(
  family: RequiredGeneratedAuthorizationFamily
): RequiredFamilyMatrixRow {
  const row = (
    permissionId: string,
    scope: string,
    relation: string,
    state: string,
    visibility: "primary" | "secondary_hidden",
    input: InboxV2AuthorizationPlanInput,
    expectedOutcome: "allowed" | "denied",
    expectedPublicErrorCode: string | null = null
  ): RequiredFamilyMatrixRow => ({
    family,
    axis: "semantic",
    principal: "employee",
    permissionId,
    scope,
    relation,
    state,
    visibility,
    input,
    expectedOutcome,
    expectedPublicErrorCode
  });

  if (family === "responsibility") {
    const requirement = {
      ...makeWorkRequirement({
        id: "family-responsibility",
        permissionId: "core:work.read",
        operation: "read",
        workState: "active",
        actorRelation: "primary_responsible",
        assignmentState: "assigned"
      }),
      scopeFacts: [
        {
          kind: "responsible" as const,
          ...scopePath(workItemResource, workItemResource),
          employeeId,
          workItemId,
          state: "active" as const,
          assignmentRevision: revision,
          currentAssignmentRevision: revision,
          validUntil: LATER
        }
      ]
    };
    return row(
      "core:work.read",
      "responsible",
      "primary_responsible",
      "active",
      "primary",
      makeInput(
        [requirement],
        [
          makeGrant("core:work.read", {
            type: "responsible",
            tenantId
          })
        ]
      ),
      "allowed"
    );
  }

  if (family === "internal_privacy") {
    const fact: InboxV2CanonicalScopeFact = {
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
    const targetDirectory = makeRequirement({
      id: "family-internal-target-directory",
      permissionId: "core:employee.directory.view",
      resource: otherEmployeeResource,
      visibility: "secondary_hidden"
    });
    const requirement = makeRequirement({
      permissionId: "core:conversation.internal.members.manage",
      scopeFacts: [fact],
      guard: {
        profileId: "core:rbac.guard.internal_membership",
        conversationId,
        employeeId,
        membershipState: "active",
        membershipOrigin: "hulee_internal_command",
        membershipRole: "owner",
        contentBoundary: "internal",
        validUntil: LATER,
        membershipChange: {
          operation: "add",
          targetEmployeeId: otherEmployeeId,
          targetEmployeeResource: otherEmployeeResource,
          targetDirectoryRequirementId: targetDirectory.id,
          targetLifecycle: "active",
          oldRole: null,
          newRole: "member",
          membershipRelationResource: resource(
            "core:internal-membership",
            "internal_membership:family-target"
          ),
          relationConversationResource: conversationResource,
          relationEmployeeResource: otherEmployeeResource,
          topologyResource: resource(
            "core:internal-conversation-topology",
            "internal_conversation_topology:family"
          ),
          topologyConversationResource: conversationResource,
          successorOwnerRequirementId: null,
          successorOwner: null,
          ownerSet: {
            resource: resource(
              "core:internal-owner-set-manifest",
              "internal_owner_set:family"
            ),
            conversationResource,
            beforeOwnerMembershipResources: [
              resource(
                "core:internal-membership",
                "internal_membership:family-actor-owner"
              )
            ],
            afterOwnerMembershipResources: [
              resource(
                "core:internal-membership",
                "internal_membership:family-actor-owner"
              )
            ]
          },
          mutationRevisionChecks: keyedRevisionChecks([
            conversationResource,
            resource(
              "core:internal-membership",
              "internal_membership:family-target"
            ),
            otherEmployeeResource,
            resource(
              "core:internal-conversation-topology",
              "internal_conversation_topology:family"
            ),
            resource(
              "core:internal-owner-set-manifest",
              "internal_owner_set:family"
            ),
            resource(
              "core:internal-membership",
              "internal_membership:family-actor-owner"
            )
          ]),
          reason: "add an active internal member",
          audit: privilegedAudit(
            "internal_membership_add",
            resource(
              "core:internal-membership",
              "internal_membership:family-target"
            ),
            resource("core:audit-event", "audit_event:family-internal-member")
          )
        }
      }
    });
    return row(
      "core:conversation.internal.members.manage",
      "internal_participant",
      "owner",
      "active",
      "primary",
      makeInput(
        [requirement, targetDirectory],
        [
          makeGrant("core:conversation.internal.members.manage", {
            type: "internal_participant",
            tenantId
          }),
          makeGrant(
            "core:employee.directory.view",
            { type: "tenant", tenantId },
            "family-internal-target-directory"
          )
        ]
      ),
      "allowed"
    );
  }

  if (family === "staff_note") {
    const read = makeRequirement({
      id: "family-staff-read",
      permissionId: "core:conversation.read",
      visibility: "secondary_hidden"
    });
    const note = makeRequirement({
      id: "family-staff-note",
      permissionId: "core:message.staff_note.create",
      guard: {
        ...canonicalGuard,
        contentBoundary: "staff_only",
        routeInputFields: [],
        companionRequirementIds: ["family-staff-read"]
      }
    });
    return row(
      "core:message.staff_note.create",
      "tenant",
      "conversation_read",
      "route_free",
      "primary",
      makeInput(
        [note, read],
        [
          makeGrant("core:message.staff_note.create", {
            type: "tenant",
            tenantId
          }),
          makeGrant(
            "core:conversation.read",
            { type: "tenant", tenantId },
            "family-staff-read"
          )
        ]
      ),
      "allowed"
    );
  }

  if (family === "multi_client") {
    const conversationRead = makeRequirement({
      id: "family-client-conversation-read",
      permissionId: "core:conversation.read",
      visibility: "secondary_hidden"
    });
    const first = makeClientLinkRequirement(
      "family-client-a",
      clientId,
      clientResource
    );
    const second = makeClientLinkRequirement(
      "family-client-b",
      secondClientId,
      secondClientResource
    );
    const primary = makeConversationClientLinksRequirement(
      "family-client-links",
      [first, second],
      conversationRead.id
    );
    return row(
      "core:conversation.clients.manage",
      "conversation_and_clients",
      "two_clients",
      "complete_access",
      "primary",
      makeInput(
        [primary, conversationRead, first, second],
        [
          makeGrant("core:conversation.clients.manage", {
            type: "tenant",
            tenantId
          }),
          makeGrant(
            "core:conversation.read",
            { type: "tenant", tenantId },
            "family-client-conversation-read"
          ),
          makeGrant(
            "core:client.link.manage",
            { type: "client", tenantId, id: clientId },
            "family-client-a"
          ),
          makeGrant(
            "core:client.link.manage",
            { type: "client", tenantId, id: secondClientId },
            "family-client-b"
          )
        ]
      ),
      "allowed"
    );
  }

  if (family === "claim") {
    const claim = makeWorkRequirement({
      id: "family-claim",
      permissionId: "core:work.claim",
      operation: "claim",
      workState: "active",
      actorRelation: "queue_member",
      assignmentState: "unassigned",
      destinationRequirementIds: ["family-claim-queue"],
      destinationResources: [queueResource]
    });
    const claimQueue = makeWorkDestinationRequirement({
      id: "family-claim-queue",
      permissionId: "core:work.claim",
      operation: "claim",
      targetResource: queueResource,
      scopeFact: {
        kind: "queue",
        ...scopePath(workItemResource, queueResource),
        queueId,
        validUntil: LATER
      }
    });
    return row(
      "core:work.claim",
      "tenant",
      "queue_member",
      "unassigned",
      "primary",
      makeInput(
        [claim, claimQueue],
        [makeGrant("core:work.claim", { type: "tenant", tenantId })]
      ),
      "allowed"
    );
  }

  if (family === "route") {
    return row(
      "core:message.reply_external",
      "responsible",
      "primary_responsible",
      "binding_current",
      "primary",
      makeInput(externalReplyRequirements(), [
        makeGrant("core:message.reply_external", {
          type: "tenant",
          tenantId
        }),
        makeGrant(
          "core:conversation.read",
          { type: "tenant", tenantId },
          "family-route-read"
        ),
        makeGrant(
          "core:source_account.use",
          { type: "source_account", tenantId, id: sourceAccountId },
          "family-route-source"
        ),
        makeGrant(
          "core:work.read",
          { type: "tenant", tenantId },
          "family-route-work"
        )
      ]),
      "allowed"
    );
  }

  if (family === "aggregate") {
    const view = makeReportViewRequirement("family-report-view");
    return row(
      "core:reports.view",
      "tenant",
      "aggregate_privacy",
      "suppressed",
      "primary",
      makeInput(
        [view],
        [makeGrant("core:reports.view", { type: "tenant", tenantId })]
      ),
      "allowed"
    );
  }

  if (family === "drilldown") {
    const view = {
      ...makeReportViewRequirement("family-drilldown-view"),
      visibility: "secondary_hidden" as const
    };
    const rowRead = makeRequirement({
      id: "family-drilldown-row",
      permissionId: "core:conversation.read",
      visibility: "secondary_hidden"
    });
    const drilldown = makeRequirement({
      id: "family-drilldown",
      permissionId: "core:reports.drilldown",
      resource: reportResource,
      guard: {
        profileId: "core:rbac.guard.report_resource_conjunction",
        targetResource: reportResource,
        accessLevel: "drilldown",
        layerRequirementIds: ["family-drilldown-view"],
        underlyingRequirementIds: ["family-drilldown-row"],
        underlyingResources: [conversationResource],
        manifestResource: resource(
          "core:authorization-manifest",
          "authorization_manifest:family-drilldown"
        ),
        manifestTargetResource: reportResource,
        manifestRevisionChecks: [
          { kind: "manifest", expected: "1", actual: "1" }
        ],
        scopeAppliedBeforeCountAndPagination: true,
        privateInternalIncluded: false,
        privateInternalRequirementIds: []
      }
    });
    return row(
      "core:reports.drilldown",
      "tenant",
      "underlying_conversation",
      "read_grant_current",
      "primary",
      makeInput(
        [drilldown, view, rowRead],
        [
          makeGrant("core:reports.drilldown", {
            type: "tenant",
            tenantId
          }),
          makeGrant(
            "core:reports.view",
            { type: "tenant", tenantId },
            "family-drilldown-view"
          ),
          makeGrant(
            "core:conversation.read",
            { type: "tenant", tenantId },
            "family-drilldown-row"
          )
        ]
      ),
      "allowed"
    );
  }

  if (family === "message_lifecycle") {
    const internalRead = makeRequirement({
      id: "family-lifecycle-read",
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
    const reaction = makeRequirement({
      permissionId: "core:message.react",
      resource: timelineItemResource,
      scopeFacts: [
        {
          kind: "internal_participant",
          ...scopePath(timelineItemResource, conversationResource),
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
        ...canonicalGuard,
        action: {
          kind: "message_reaction",
          targetResource: timelineItemResource,
          ...timelineTopologyEvidence("internal"),
          contentReadResource: conversationResource,
          contentRelationTargetResource: timelineItemResource,
          contentRelationReadResource: conversationResource,
          contentRelationRevisionChecks: [
            { kind: "relation", expected: "1", actual: "1" }
          ],
          contentReadRequirementId: "family-lifecycle-read",
          contentBoundary: "internal",
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
    return row(
      "core:message.react",
      "internal_participant",
      "internal_member",
      "provider_not_applicable",
      "primary",
      makeInput(
        [reaction, internalRead],
        [
          makeGrant("core:message.react", {
            type: "internal_participant",
            tenantId
          }),
          makeGrant(
            "core:conversation.internal.read",
            { type: "internal_participant", tenantId },
            "family-lifecycle-read"
          )
        ]
      ),
      "allowed"
    );
  }

  if (family === "privacy_case") {
    const caseResource = resource(
      "core:privacy-request",
      "privacy_request_case:family-case"
    );
    const discoveryManifestResource = resource(
      "core:privacy-discovery-manifest",
      "privacy_discovery_manifest:family-case"
    );
    const proofResource = resource(
      "core:privacy-discovery-proof",
      "privacy_discovery_proof:family-case"
    );
    const policyRuleResource = resource(
      "core:data-lifecycle-policy-rule",
      "data_lifecycle_policy_rule:family-rule"
    );
    const requesterEmployeeResource = resource(
      "core:employee",
      String(otherEmployeeId)
    );
    const deciderEmployeeResource = resource(
      "core:employee",
      String(employeeId)
    );
    const partyBindingResource = resource(
      "core:privacy-request-party-binding",
      "privacy_request_party_binding:family-case"
    );
    const decisionLedgerResource = resource(
      "core:privacy-request-decision-ledger",
      "privacy_request_decision_ledger:family-case"
    );
    const rootDecisionManifestResource = resource(
      "core:privacy-request-root-decision-manifest",
      "privacy_request_root_decision_manifest:family-case"
    );
    const requirement = makeRequirement({
      permissionId: "core:privacy.request.decide",
      resource: caseResource,
      guard: {
        profileId: "core:rbac.guard.privacy_request_roots_revision",
        targetResource: caseResource,
        caseId: "family-case",
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
          "governance_context:family"
        ),
        expectedGovernanceRevision: "1",
        currentGovernanceRevision: "1",
        discoveryManifestResource,
        discoveryManifestTargetResource: caseResource,
        discoveryManifestRevisionChecks: [
          {
            resource: discoveryManifestResource,
            expected: "1",
            actual: "1"
          },
          { resource: caseResource, expected: "1", actual: "1" }
        ],
        discoveryManifestRootResources: [conversationResource],
        discoveryManifestMembershipRevisionChecks: [
          {
            resource: discoveryManifestResource,
            expected: "1",
            actual: "1"
          },
          { resource: caseResource, expected: "1", actual: "1" },
          { resource: conversationResource, expected: "1", actual: "1" }
        ],
        rootDecisions: [
          {
            rootResource: conversationResource,
            discoveryProofResource: proofResource,
            proofRequestResource: caseResource,
            proofRootResource: conversationResource,
            proofRevisionChecks: [
              { resource: proofResource, expected: "1", actual: "1" },
              { resource: caseResource, expected: "1", actual: "1" },
              { resource: conversationResource, expected: "1", actual: "1" }
            ],
            policyRuleId: "family-rule",
            policyRuleResource,
            policyRuleRequestResource: caseResource,
            policyRuleRootResource: conversationResource,
            policyRuleState: "active",
            policyRuleRevisionChecks: [
              { resource: policyRuleResource, expected: "1", actual: "1" },
              { resource: caseResource, expected: "1", actual: "1" },
              { resource: conversationResource, expected: "1", actual: "1" }
            ],
            expectedDecisionRevision: "1",
            currentDecisionRevision: "1",
            decisionState: "pending"
          }
        ],
        phase: "decide",
        actingEmployeeId: employeeId,
        requesterEmployeeId: otherEmployeeId,
        deciderEmployeeId: employeeId,
        executorEmployeeId: null,
        decisionLedger: {
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
              policyRuleId: "family-rule",
              policyRuleResource,
              decisionState: "pending",
              expectedDecisionRevision: "1",
              currentDecisionRevision: "1"
            }
          ],
          rootManifestDecisionSetDigest: "decision-set:family-case:v1",
          ledgerDecisionSetDigest: "decision-set:family-case:v1",
          state: "pending",
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
            { resource: conversationResource, expected: "1", actual: "1" },
            { resource: proofResource, expected: "1", actual: "1" },
            { resource: policyRuleResource, expected: "1", actual: "1" }
          ]
        },
        executorRelation: null,
        contentAuthorityDerivedFromRequester: false
      }
    });
    return row(
      "core:privacy.request.decide",
      "tenant",
      "decider",
      "roots_current",
      "primary",
      makeInput(
        [requirement],
        [
          makeGrant("core:privacy.request.decide", {
            type: "tenant",
            tenantId
          })
        ]
      ),
      "allowed"
    );
  }

  if (family === "privacy_root") {
    const caseResource = resource(
      "core:privacy-request",
      "privacy_request_case:family-root"
    );
    const rootRead = makeRequirement({
      id: "family-root-read",
      permissionId: "core:conversation.read",
      resource: conversationResource,
      visibility: "secondary_hidden"
    });
    const requirement = makeRequirement({
      permissionId: "core:privacy.subject_evidence.view",
      resource: caseResource,
      guard: {
        profileId: "core:rbac.guard.privacy_subject_evidence_roots",
        targetResource: caseResource,
        caseId: "family-root",
        evidenceState: "verified",
        exactRootRequirementIds: ["family-root-read"],
        exactRootResources: [conversationResource],
        manifestResource: resource(
          "core:authorization-manifest",
          "authorization_manifest:family-root"
        ),
        manifestTargetResource: caseResource,
        manifestRevisionChecks: [
          { kind: "manifest", expected: "1", actual: "1" }
        ],
        manifestRootResources: [conversationResource],
        manifestMembershipRevisionChecks: [
          {
            resource: resource(
              "core:authorization-manifest",
              "authorization_manifest:family-root"
            ),
            expected: "1",
            actual: "1"
          },
          { resource: caseResource, expected: "1", actual: "1" },
          { resource: conversationResource, expected: "1", actual: "1" }
        ],
        thirdPartyPolicy: "mask",
        purpose: null,
        purposePolicy: null
      }
    });
    return row(
      "core:privacy.subject_evidence.view",
      "tenant",
      "evidence_reader",
      "root_set_current",
      "primary",
      makeInput(
        [requirement, rootRead],
        [
          makeGrant("core:privacy.subject_evidence.view", {
            type: "tenant",
            tenantId
          }),
          makeGrant(
            "core:conversation.read",
            { type: "tenant", tenantId },
            "family-root-read"
          )
        ]
      ),
      "allowed"
    );
  }

  if (family === "hold") {
    const holdResource = resource(
      "core:privacy-hold",
      "privacy_hold:family-hold"
    );
    const fixture = makePrivacyHoldFixture({
      permissionId: "core:privacy.hold.release",
      holdResource,
      holdId: "family-hold",
      phase: "release",
      reason: "verified legal release",
      reviewerEmployeeId: thirdEmployeeId,
      issuerEmployeeId: otherEmployeeId,
      releaserEmployeeId: employeeId
    });
    const requirement = makeRequirement({
      permissionId: "core:privacy.hold.release",
      resource: holdResource,
      guard: fixture.guard
    });
    return row(
      "core:privacy.hold.release",
      "tenant",
      "releaser",
      "review_current",
      "primary",
      makeInput(
        [requirement, ...fixture.requirements],
        [
          makeGrant("core:privacy.hold.release", {
            type: "tenant",
            tenantId
          }),
          ...fixture.grants
        ]
      ),
      "allowed"
    );
  }

  if (family === "export") {
    const exportResource = resource(
      "core:privacy-export-job",
      "privacy_export_job:family-export"
    );
    const fixture = makePrivacyTenantExportFixture({
      exportResource,
      exportId: "family-export"
    });
    const requirement = makeRequirement({
      permissionId: "core:privacy.tenant_export",
      resource: exportResource,
      guard: fixture.guard
    });
    return row(
      "core:privacy.tenant_export",
      "tenant",
      "requester",
      "high_water_current",
      "primary",
      makeInput(
        [requirement, ...fixture.requirements],
        [
          makeGrant("core:privacy.tenant_export", {
            type: "tenant",
            tenantId
          }),
          ...fixture.grants
        ]
      ),
      "allowed"
    );
  }

  if (family === "delete") {
    const requirement = makeDeletionRequirement({
      permissionId: "core:privacy.deletion.preview",
      phase: "preview",
      actingEmployeeId: employeeId,
      rootAndHandlerRevisionChecks: [
        { kind: "entity", expected: "1", actual: "1" },
        { kind: "handler", expected: "1", actual: "1" }
      ]
    });
    return row(
      "core:privacy.deletion.preview",
      "tenant",
      "requester",
      "roots_current",
      "primary",
      makeInput(
        [requirement],
        [
          makeGrant("core:privacy.deletion.preview", {
            type: "tenant",
            tenantId
          })
        ]
      ),
      "allowed"
    );
  }

  if (family === "separation_of_duties") {
    const requirement = makeRequirement({
      permissionId: "core:privacy.deletion.approve",
      resource: privacyDeletionResource,
      guard: makeDeletionGuard({
        phase: "approve",
        actingEmployeeId: employeeId,
        requesterEmployeeId: otherEmployeeId,
        approverEmployeeId: employeeId,
        executorEmployeeId: null
      })
    });
    return row(
      "core:privacy.deletion.approve",
      "tenant",
      "requester_and_approver_distinct",
      "current",
      "primary",
      makeInput(
        [requirement],
        [
          makeGrant("core:privacy.deletion.approve", {
            type: "tenant",
            tenantId
          })
        ]
      ),
      "allowed"
    );
  }

  if (family === "hidden_target") {
    const visible = makeRequirement({
      id: "family-visible-target",
      permissionId: "core:conversation.read",
      resource: hiddenConversationResource
    });
    return row(
      "core:conversation.read",
      "tenant",
      "none",
      "visible_target_authorized",
      "primary",
      makeInput(
        [visible],
        [
          makeGrant(
            "core:conversation.read",
            { type: "tenant", tenantId },
            "family-visible-target"
          )
        ]
      ),
      "allowed"
    );
  }

  return assertUnreachableFamily(family);
}

function assertUnreachableFamily(value: never): never {
  throw new Error(`Unhandled authorization family: ${String(value)}`);
}

function generatedAuthorizationMatrix() {
  const permissions = ["core:inbox.read", "core:conversation.read"] as const;
  const principals: readonly MatrixPrincipalState[] = [
    "active_employee",
    "draining_employee",
    "trusted_service"
  ];
  const scopes: readonly MatrixScopeKind[] = [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "client",
    "conversation",
    "work_item",
    "source_account",
    "responsible",
    "collaborator",
    "internal_participant",
    "client_owner"
  ];
  const relationStates: readonly MatrixRelationState[] = ["current", "stale"];
  return permissions.flatMap((permissionId) =>
    principals.flatMap((principalState) =>
      scopes.flatMap((scopeKind) =>
        relationStates.map((relationState) => {
          const relationScope =
            scopeKind === "responsible" ||
            scopeKind === "collaborator" ||
            scopeKind === "internal_participant" ||
            scopeKind === "client_owner";
          const catalogEntry = inboxV2PermissionCatalog.find(
            ({ id }) => id === permissionId
          )!;
          const permissionAllowsScope =
            catalogEntry.allowedScopes.includes(scopeKind);
          const principalCanMatch = !(
            principalState === "trusted_service" && relationScope
          );
          const temporalMatch =
            scopeKind === "tenant" || relationState === "current";
          const expected =
            principalState !== "draining_employee" &&
            permissionAllowsScope &&
            principalCanMatch &&
            temporalMatch;
          return {
            name: `${permissionId}/${principalState}/${scopeKind}/${relationState}`,
            permissionId,
            principalState,
            scopeKind,
            relationState,
            expected
          };
        })
      )
    )
  );
}

function matrixScope(
  scopeKind: MatrixScopeKind,
  relationState: MatrixRelationState
): Readonly<{
  scope: InboxV2PermissionScope;
  facts: readonly InboxV2CanonicalScopeFact[];
}> {
  const validUntil = relationState === "current" ? LATER : NOW;
  switch (scopeKind) {
    case "tenant":
      return { scope: { type: "tenant", tenantId }, facts: [] };
    case "org_unit":
      return {
        scope: { type: "org_unit", tenantId, id: orgUnitId, mode: "exact" },
        facts: [
          {
            kind: "org_unit",
            ...scopePath(conversationResource, orgUnitResource),
            orgUnitId,
            ancestorOrgUnitIds: [],
            closureRevision: revision,
            currentClosureRevision: revision,
            validUntil
          }
        ]
      };
    case "team":
      return {
        scope: { type: "team", tenantId, id: teamId },
        facts: [
          {
            kind: "team",
            ...scopePath(conversationResource, teamResource),
            teamId,
            validUntil
          }
        ]
      };
    case "queue":
      return {
        scope: { type: "queue", tenantId, id: queueId },
        facts: [
          {
            kind: "queue",
            ...scopePath(conversationResource, queueResource),
            queueId,
            validUntil
          }
        ]
      };
    case "client":
      return {
        scope: { type: "client", tenantId, id: clientId },
        facts: [
          {
            kind: "client",
            ...scopePath(conversationResource, clientResource),
            clientId,
            validUntil
          }
        ]
      };
    case "conversation":
      return {
        scope: { type: "conversation", tenantId, id: conversationId },
        facts: [
          {
            kind: "conversation",
            ...scopePath(conversationResource, conversationResource),
            conversationId,
            validUntil
          }
        ]
      };
    case "work_item":
      return {
        scope: { type: "work_item", tenantId, id: workItemId },
        facts: [
          {
            kind: "work_item",
            ...scopePath(conversationResource, workItemResource),
            workItemId,
            validUntil
          }
        ]
      };
    case "source_account":
      return {
        scope: { type: "source_account", tenantId, id: sourceAccountId },
        facts: [
          {
            kind: "source_account",
            ...scopePath(conversationResource, sourceAccountResource),
            sourceAccountId,
            validUntil
          }
        ]
      };
    case "responsible":
      return {
        scope: { type: "responsible", tenantId },
        facts: [
          {
            kind: "responsible",
            ...scopePath(conversationResource, workItemResource),
            employeeId,
            workItemId,
            state: "active",
            assignmentRevision: revision,
            currentAssignmentRevision: revision,
            validUntil
          }
        ]
      };
    case "collaborator":
      return {
        scope: { type: "collaborator", tenantId },
        facts: [
          {
            kind: "collaborator",
            ...scopePath(conversationResource, conversationResource),
            employeeId,
            subject: { kind: "conversation", conversationId },
            state: "active",
            episodeRevision: revision,
            currentEpisodeRevision: revision,
            validUntil
          }
        ]
      };
    case "internal_participant":
      return {
        scope: { type: "internal_participant", tenantId },
        facts: [
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
            validUntil
          }
        ]
      };
    case "client_owner":
      return {
        scope: { type: "client_owner", tenantId },
        facts: [
          {
            kind: "client_owner",
            ...scopePath(conversationResource, clientResource),
            employeeId,
            clientId,
            state: "active",
            ownershipRevision: revision,
            currentOwnershipRevision: revision,
            validUntil
          }
        ]
      };
  }
}

function asTrustedServiceMatrixInput(
  base: InboxV2AuthorizationPlanInput,
  employeeGrant: InboxV2PolicyGrant,
  permissionId: "core:inbox.read" | "core:conversation.read"
): InboxV2AuthorizationPlanInput {
  const trustedServiceId =
    inboxV2TrustedServiceIdSchema.parse("core:matrix-reader");
  return {
    ...base,
    currentAuthorization: {
      ...base.currentAuthorization,
      principal: { kind: "trusted_service", trustedServiceId }
    },
    principal: {
      kind: "trusted_service",
      tenantId,
      trustedServiceId,
      registrationState: "active",
      authorizationEpoch: epoch,
      dependencies: base.currentAuthorization.dependencies,
      allowedPermissionIds: [permissionId],
      notAfter: SESSION_END
    },
    grants: [
      {
        ...employeeGrant,
        principal: { kind: "trusted_service", trustedServiceId },
        source: {
          kind: "service_registration",
          origin: "inbox_v2_native",
          serviceRegistrationId: "matrix-registration",
          bindingResource: resource(
            "core:service-registration",
            "service_registration:matrix-registration"
          ),
          bindingRevision: revision
        }
      }
    ]
  };
}
