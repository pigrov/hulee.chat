import {
  inboxV2AuthorizationDependencyVectorSchema,
  inboxV2AuthorizationEpochSchema,
  inboxV2AuthorizationEpochSnapshotSchema,
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
  type InboxV2PermissionId,
  type InboxV2PolicyGrant,
  type InboxV2PolicyGuardEvidence
} from "./index";

const NOW = "2026-07-12T10:00:00.000Z";
const AUTHORITY_END = "2026-07-12T10:30:00.000Z";
const SESSION_END = "2026-07-12T11:00:00.000Z";
const DIGEST = `sha256:${"d".repeat(64)}`;

const tenantId = inboxV2TenantIdSchema.parse("tenant:privacy-delete");
const otherTenantId = inboxV2TenantIdSchema.parse("tenant:other");
const employeeId = inboxV2EmployeeIdSchema.parse("employee:executor");
const requesterEmployeeId = inboxV2EmployeeIdSchema.parse("employee:requester");
const approverEmployeeId = inboxV2EmployeeIdSchema.parse("employee:approver");
const spoofRequesterEmployeeId = inboxV2EmployeeIdSchema.parse(
  "employee:spoof-requester"
);
const employee = inboxV2EmployeeReferenceSchema.parse({
  tenantId,
  kind: "employee",
  id: employeeId
});
const epoch = inboxV2AuthorizationEpochSchema.parse(
  "authorization:privacy-delete"
);
const revision = inboxV2EntityRevisionSchema.parse("1");
const sourceAccountId = inboxV2SourceAccountIdSchema.parse(
  "source_account:delete-source"
);
const otherSourceAccountId = inboxV2SourceAccountIdSchema.parse(
  "source_account:other-source"
);

const planResource = resource(
  "core:privacy-deletion-plan",
  "privacy_deletion_plan:plan-1"
);
const otherPlanResource = resource(
  "core:privacy-deletion-plan",
  "privacy_deletion_plan:plan-2"
);
const manifestResource = resource(
  "core:privacy-scope-manifest",
  "privacy_scope_manifest:plan-1"
);
const holdIndexResource = resource(
  "core:privacy-deletion-hold-index",
  "privacy_deletion_hold_index:plan-1"
);
const approvalResource = resource(
  "core:privacy-deletion-approval",
  "privacy_deletion_approval:plan-1"
);
const approverEmployeeResource = resource(
  "core:employee",
  String(approverEmployeeId)
);
const requesterRelationResource = resource(
  "core:privacy-deletion-plan-requester",
  "privacy_deletion_plan_requester:plan-1"
);
const localRootResource = resource(
  "core:conversation",
  "conversation:conversation-1"
);
const externalRootResource = resource(
  "core:external-thread",
  "external_thread:thread-1"
);
const otherRootResource = resource(
  "core:conversation",
  "conversation:conversation-2"
);
const localHandlerResource = resource(
  "core:privacy-delete-handler",
  "privacy_delete_handler:sql-1"
);
const externalHandlerResource = resource(
  "core:privacy-delete-handler",
  "privacy_delete_handler:provider-1"
);
const localRootRelationResource = resource(
  "core:privacy-deletion-plan-root",
  "privacy_deletion_plan_root:sql-1"
);
const externalRootRelationResource = resource(
  "core:privacy-deletion-plan-root",
  "privacy_deletion_plan_root:provider-1"
);
const localHandlerRelationResource = resource(
  "core:privacy-deletion-plan-handler",
  "privacy_deletion_plan_handler:sql-1"
);
const externalHandlerRelationResource = resource(
  "core:privacy-deletion-plan-handler",
  "privacy_deletion_plan_handler:provider-1"
);
const sourceAccountResource = resource(
  "core:source-account",
  String(sourceAccountId)
);
const otherSourceAccountResource = resource(
  "core:source-account",
  String(otherSourceAccountId)
);
const sourceBindingResource = resource(
  "core:source-thread-binding",
  "source_thread_binding:delete-binding"
);
const capabilityManifestResource = resource(
  "core:provider-capability-manifest",
  "provider_capability_manifest:delete-binding"
);

type DeletionGuard = Extract<
  InboxV2PolicyGuardEvidence,
  { profileId: "core:rbac.guard.privacy_deletion_plan_revisions" }
>;
type ExternalDeletionHandler = Extract<
  DeletionGuard["handlers"][number],
  { surfaceKind: "external_route" }
>;

describe("Inbox V2 privacy deletion authorization", () => {
  it("allows an exact local execute plan after cooling with a clear current hold fence", () => {
    const decision = decide(makeLocalGuard(), "core:privacy.deletion.execute");

    expect(decision).toMatchObject({ outcome: "allowed" });
  });

  it("allows supported provider deletion only with exact hidden source-account authority", () => {
    const guard = makeExternalGuard("supported");
    const sourceUse = makeSourceAccountUseRequirement();
    const decision = decide(
      guard,
      "core:privacy.deletion.execute",
      [sourceUse],
      [makeGrant("core:source_account.use", "source-use-grant")]
    );

    expect(decision).toMatchObject({ outcome: "allowed" });
    if (decision.outcome !== "allowed") return;
    expect(decision.notAfter).toBe(AUTHORITY_END);
    expect(
      decision.requirements.find(
        ({ requirementId }) => requirementId === "source-use"
      )
    ).toMatchObject({ authorizationSubjectKind: "supporting" });
  });

  it("allows an unsupported provider surface only as a no-I/O external residual", () => {
    const guard = makeExternalGuard("unsupported");
    const decision = decide(
      guard,
      "core:privacy.deletion.execute",
      [makeSourceAccountUseRequirement()],
      [makeGrant("core:source_account.use", "source-use-grant")]
    );

    expect(guard.ioRequested).toBe(false);
    expect(guard.handlers[0]).toMatchObject({
      executionMode: "external_residual_only",
      externalOutcome: "unsupported"
    });
    expect(decision).toMatchObject({ outcome: "allowed" });
  });

  it.each(["preview", "approve"] as const)(
    "allows external-plan %s without loading provider or source-account authority",
    (phase) => {
      const guard = makeExternalGuard("supported", phase);
      const decision = decide(guard, `core:privacy.deletion.${phase}`);

      expect(guard.handlers[0]).toMatchObject({
        executionMode: "none",
        externalOutcome: "not_started",
        externalProvider: null
      });
      expect(decision).toMatchObject({ outcome: "allowed" });
    }
  );

  it("requires an exact current approved ledger entry and approver authority for execute", () => {
    const base = makeLocalGuard();
    const approval = base.approvalEvidence!;
    const missingEvidence: DeletionGuard = {
      ...base,
      approvalEvidence: null
    };
    const wrongPlan: DeletionGuard = {
      ...base,
      approvalEvidence: { ...approval, planResource: otherPlanResource }
    };
    const pending: DeletionGuard = {
      ...base,
      approvalEvidence: { ...approval, state: "pending" }
    };
    const stale: DeletionGuard = {
      ...base,
      approvalEvidence: {
        ...approval,
        revisionChecks: approval.revisionChecks.map((check, index) =>
          index === 0 ? { ...check, actual: "2" } : check
        )
      }
    };

    expect(
      decide(missingEvidence, "core:privacy.deletion.execute", [], [], {
        includeApprovalAuthority: false
      })
    ).toMatchObject({ outcome: "denied" });
    expect(decide(wrongPlan, "core:privacy.deletion.execute")).toMatchObject({
      outcome: "denied"
    });
    expect(decide(pending, "core:privacy.deletion.execute")).toMatchObject({
      outcome: "denied",
      publicErrorCode: "privacy.approval_required"
    });
    expect(decide(stale, "core:privacy.deletion.execute")).toMatchObject({
      outcome: "denied",
      publicErrorCode: "privacy.approval_required"
    });
    expect(
      decide(base, "core:privacy.deletion.execute", [], [], {
        includeApprovalAuthority: false
      })
    ).toMatchObject({
      outcome: "denied",
      publicErrorCode: "privacy.approval_required"
    });
  });

  it.each(["approve", "execute"] as const)(
    "rejects requester scalar spoofing during %s",
    (phase) => {
      const base = makeLocalGuard(phase);
      const forged: DeletionGuard = {
        ...base,
        requesterEmployeeId: spoofRequesterEmployeeId
      };

      expect(decide(forged, `core:privacy.deletion.${phase}`)).toMatchObject({
        outcome: "denied"
      });
    }
  );

  it.each([
    {
      name: "manifest target substitution",
      mutate: (guard: DeletionGuard): DeletionGuard => ({
        ...guard,
        manifestTargetResource: otherPlanResource
      })
    },
    {
      name: "root-to-plan relation substitution",
      mutate: (guard: DeletionGuard): DeletionGuard => ({
        ...guard,
        roots: [{ ...guard.roots[0]!, relationPlanResource: otherPlanResource }]
      })
    },
    {
      name: "handler-to-root relation substitution",
      mutate: (guard: DeletionGuard): DeletionGuard => ({
        ...guard,
        handlers: [
          {
            ...guard.handlers[0]!,
            relationRootResource: otherRootResource
          }
        ]
      })
    },
    {
      name: "surface relabel",
      mutate: (guard: DeletionGuard): DeletionGuard => ({
        ...guard,
        handlers: [
          {
            ...guard.handlers[0]!,
            surfaceKind: "object",
            executionMode: "operated_io",
            externalOutcome: null,
            externalProvider: null
          }
        ]
      })
    },
    {
      name: "foreign-tenant root",
      mutate: (guard: DeletionGuard): DeletionGuard => ({
        ...guard,
        roots: [
          {
            ...guard.roots[0]!,
            resource: resource(
              "core:conversation",
              "conversation:foreign",
              otherTenantId
            )
          }
        ]
      })
    },
    {
      name: "plan revision relabel inside the manifest",
      mutate: (guard: DeletionGuard): DeletionGuard => ({
        ...guard,
        manifestRevisionChecks: guard.manifestRevisionChecks.map((check) =>
          check.resource.entityTypeId === "core:privacy-deletion-plan"
            ? { ...check, expected: "2", actual: "2" }
            : check
        )
      })
    },
    {
      name: "hold fence checked before the authorization instant",
      mutate: (guard: DeletionGuard): DeletionGuard => ({
        ...guard,
        holdFenceCheckedAt: "2026-07-12T09:59:59.000Z"
      })
    }
  ])("denies $name", ({ mutate }) => {
    expect(
      decide(mutate(makeLocalGuard()), "core:privacy.deletion.execute")
    ).toMatchObject({ outcome: "denied" });
  });

  it("rejects stale and active hold fences before destructive authorization", () => {
    const stale = makeLocalGuard();
    const staleHold: DeletionGuard = {
      ...stale,
      holdRevisionChecks: stale.holdRevisionChecks.map((check, index) =>
        index === 0 ? { ...check, actual: "2" } : check
      )
    };
    const active: DeletionGuard = { ...makeLocalGuard(), holdState: "active" };

    expect(decide(staleHold, "core:privacy.deletion.execute")).toMatchObject({
      outcome: "denied",
      publicErrorCode: "privacy.revision_changed"
    });
    expect(decide(active, "core:privacy.deletion.execute")).toMatchObject({
      outcome: "denied",
      publicErrorCode: "privacy.hold_active"
    });
  });

  it.each(["preview", "approve"] as const)(
    "never permits %s to request handler I/O",
    (phase) => {
      const base = makeLocalGuard(phase);
      const handler = base.handlers[0]!;
      if (handler.surfaceKind === "external_route") {
        throw new Error("Expected a local deletion handler fixture.");
      }
      const guard: DeletionGuard = {
        ...base,
        handlers: [
          {
            ...handler,
            executionMode: "operated_io"
          }
        ],
        ioRequested: true
      };

      expect(decide(guard, `core:privacy.deletion.${phase}`)).toMatchObject({
        outcome: "denied"
      });
    }
  );

  it.each([
    {
      name: "missing source-account companion",
      prepare: (guard: DeletionGuard) => ({
        guard,
        companions: [] as InboxV2AuthorizationRequirement[],
        grants: [] as InboxV2PolicyGrant[]
      })
    },
    {
      name: "visible source-account companion",
      prepare: (guard: DeletionGuard) => ({
        guard,
        companions: [
          {
            ...makeSourceAccountUseRequirement(),
            visibility: "primary" as const
          }
        ],
        grants: [makeGrant("core:source_account.use", "source-use-grant")]
      })
    },
    {
      name: "different source-account companion",
      prepare: (guard: DeletionGuard) => ({
        guard,
        companions: [
          makeSourceAccountUseRequirement(
            otherSourceAccountId,
            otherSourceAccountResource
          )
        ],
        grants: [makeGrant("core:source_account.use", "source-use-grant")]
      })
    },
    {
      name: "source-account authority from another binding generation",
      prepare: (guard: DeletionGuard) => ({
        guard,
        companions: [
          makeSourceAccountUseRequirement(
            sourceAccountId,
            sourceAccountResource,
            "2"
          )
        ],
        grants: [makeGrant("core:source_account.use", "source-use-grant")]
      })
    }
  ])("denies provider delete with $name", ({ prepare }) => {
    const test = prepare(makeExternalGuard("supported"));
    expect(
      decide(
        test.guard,
        "core:privacy.deletion.execute",
        test.companions,
        test.grants
      )
    ).toMatchObject({ outcome: "denied" });
  });

  it("denies binding/source substitution and a stale capability manifest", () => {
    const base = makeExternalGuard("supported");
    const handler = base.handlers[0] as ExternalDeletionHandler;
    const provider = handler.externalProvider;
    if (provider === null) {
      throw new Error("Expected provider authority on execute fixture.");
    }
    const substituted: DeletionGuard = {
      ...base,
      handlers: [
        {
          ...handler,
          externalProvider: {
            ...provider,
            bindingSourceAccountResource: otherSourceAccountResource
          }
        }
      ]
    };
    const stale: DeletionGuard = {
      ...base,
      handlers: [
        {
          ...handler,
          externalProvider: {
            ...provider,
            capabilityRevisionChecks: provider.capabilityRevisionChecks.map(
              (check, index) =>
                index === 0 ? { ...check, actual: "2" } : check
            )
          }
        }
      ]
    };
    const companions = [makeSourceAccountUseRequirement()];
    const grants = [makeGrant("core:source_account.use", "source-use-grant")];

    expect(
      decide(substituted, "core:privacy.deletion.execute", companions, grants)
    ).toMatchObject({ outcome: "denied" });
    expect(
      decide(stale, "core:privacy.deletion.execute", companions, grants)
    ).toMatchObject({
      outcome: "denied",
      publicErrorCode: "privacy.revision_changed"
    });
  });

  it("denies provider I/O when the exact capability manifest says unsupported", () => {
    const base = makeExternalGuard("unsupported");
    const handler = base.handlers[0] as ExternalDeletionHandler;
    const guard: DeletionGuard = {
      ...base,
      handlers: [
        {
          ...handler,
          executionMode: "provider_io",
          externalOutcome: "requested"
        }
      ],
      ioRequested: true
    };

    expect(
      decide(
        guard,
        "core:privacy.deletion.execute",
        [makeSourceAccountUseRequirement()],
        [makeGrant("core:source_account.use", "source-use-grant")]
      )
    ).toMatchObject({ outcome: "denied" });
  });
});

function makeLocalGuard(
  phase: "preview" | "approve" | "execute" = "execute"
): DeletionGuard {
  const root = {
    resource: localRootResource,
    rootKind: "sql" as const,
    boundary: "operated_data_plane" as const,
    relationResource: localRootRelationResource,
    relationPlanResource: planResource,
    relationRootResource: localRootResource,
    revisionChecks: keyed([
      localRootRelationResource,
      planResource,
      localRootResource
    ])
  };
  const handler = {
    resource: localHandlerResource,
    rootResource: localRootResource,
    relationResource: localHandlerRelationResource,
    relationPlanResource: planResource,
    relationRootResource: localRootResource,
    relationHandlerResource: localHandlerResource,
    revisionChecks: keyed([
      localHandlerRelationResource,
      planResource,
      localRootResource,
      localHandlerResource
    ]),
    surfaceKind: "sql" as const,
    executionMode:
      phase === "execute" ? ("operated_io" as const) : ("none" as const),
    externalOutcome: null,
    externalProvider: null
  };
  return makeGuardBase({
    phase,
    root,
    handler,
    ioRequested: phase === "execute"
  });
}

function makeExternalGuard(
  capabilityState: "supported" | "unsupported",
  phase: "preview" | "approve" | "execute" = "execute"
): DeletionGuard {
  const root = {
    resource: externalRootResource,
    rootKind: "external_route" as const,
    boundary: "outside_operated_data_plane" as const,
    relationResource: externalRootRelationResource,
    relationPlanResource: planResource,
    relationRootResource: externalRootResource,
    revisionChecks: keyed([
      externalRootRelationResource,
      planResource,
      externalRootResource
    ])
  };
  const handler: ExternalDeletionHandler = {
    resource: externalHandlerResource,
    rootResource: externalRootResource,
    relationResource: externalHandlerRelationResource,
    relationPlanResource: planResource,
    relationRootResource: externalRootResource,
    relationHandlerResource: externalHandlerResource,
    revisionChecks: keyed([
      externalHandlerRelationResource,
      planResource,
      externalRootResource,
      externalHandlerResource
    ]),
    surfaceKind: "external_route",
    executionMode:
      phase !== "execute"
        ? "none"
        : capabilityState === "supported"
          ? "provider_io"
          : "external_residual_only",
    externalOutcome:
      phase !== "execute"
        ? "not_started"
        : capabilityState === "supported"
          ? "requested"
          : "unsupported",
    externalProvider:
      phase === "execute"
        ? {
            sourceAccountResource,
            bindingResource: sourceBindingResource,
            bindingRootResource: externalRootResource,
            bindingSourceAccountResource: sourceAccountResource,
            bindingRevisionChecks: keyed([
              sourceBindingResource,
              externalRootResource,
              sourceAccountResource
            ]),
            capabilityId: "core:capability.message.delete",
            capabilityState,
            capabilityManifestResource,
            capabilityManifestSourceAccountResource: sourceAccountResource,
            capabilityManifestBindingResource: sourceBindingResource,
            capabilityManifestHandlerResource: externalHandlerResource,
            capabilityRevisionChecks: keyed([
              capabilityManifestResource,
              sourceAccountResource,
              sourceBindingResource,
              externalHandlerResource
            ]),
            capabilityNotAfter: AUTHORITY_END,
            sourceAccountUseRequirementId: "source-use"
          }
        : null
  };
  return makeGuardBase({
    phase,
    root,
    handler,
    ioRequested: phase === "execute" && capabilityState === "supported"
  });
}

function makeGuardBase(input: {
  phase: "preview" | "approve" | "execute";
  root: DeletionGuard["roots"][number];
  handler: DeletionGuard["handlers"][number];
  ioRequested: boolean;
}): DeletionGuard {
  const roots = [input.root];
  const handlers = [input.handler];
  const boundRequesterEmployeeId =
    input.phase === "preview" ? employeeId : requesterEmployeeId;
  const boundRequesterEmployeeResource = resource(
    "core:employee",
    String(boundRequesterEmployeeId)
  );
  return {
    profileId: "core:rbac.guard.privacy_deletion_plan_revisions",
    targetResource: planResource,
    deletionPlanId: "plan-1",
    expectedPlanRevision: "1",
    currentPlanRevision: "1",
    manifestResource,
    manifestTargetResource: planResource,
    manifestRequesterEmployeeResource: boundRequesterEmployeeResource,
    manifestRequesterRelationResource: requesterRelationResource,
    manifestRootResources: roots.map(({ resource }) => resource),
    manifestHandlerResources: handlers.map(({ resource }) => resource),
    manifestRevisionChecks: keyed([
      manifestResource,
      planResource,
      requesterRelationResource,
      boundRequesterEmployeeResource,
      ...roots.map(({ resource }) => resource),
      ...handlers.map(({ resource }) => resource)
    ]),
    roots,
    handlers,
    requesterEmployeeResource: boundRequesterEmployeeResource,
    requesterRelationResource,
    requesterRelationPlanResource: planResource,
    requesterRelationEmployeeResource: boundRequesterEmployeeResource,
    requesterRevisionChecks: keyed([
      requesterRelationResource,
      planResource,
      boundRequesterEmployeeResource
    ]),
    holdIndexResource,
    holdIndexPlanResource: planResource,
    holdIndexRootResources: roots.map(({ resource }) => resource),
    holdState: "clear",
    holdRevisionChecks: keyed([
      holdIndexResource,
      planResource,
      ...roots.map(({ resource }) => resource)
    ]),
    holdFenceCheckedAt: NOW,
    holdFenceNotAfter: AUTHORITY_END,
    phase: input.phase,
    actingEmployeeId: employeeId,
    requesterEmployeeId: boundRequesterEmployeeId,
    approverEmployeeId:
      input.phase === "preview"
        ? null
        : input.phase === "approve"
          ? employeeId
          : approverEmployeeId,
    executorEmployeeId: input.phase === "execute" ? employeeId : null,
    approvalEvidence:
      input.phase === "execute"
        ? {
            resource: approvalResource,
            planResource,
            manifestResource,
            requesterEmployeeResource: boundRequesterEmployeeResource,
            requesterRelationResource,
            approverEmployeeResource,
            approverEmployeeId,
            approverLifecycle: "active",
            approverDirectoryRequirementId: "approver-directory",
            approverGrantId: "approval-grant",
            state: "approved",
            revisionChecks: keyed([
              approvalResource,
              planResource,
              manifestResource,
              requesterRelationResource,
              boundRequesterEmployeeResource,
              approverEmployeeResource,
              ...roots.map(({ resource }) => resource),
              ...handlers.map(({ resource }) => resource)
            ]),
            notAfter: AUTHORITY_END
          }
        : null,
    coolingPeriodEndsAt: "2026-07-12T09:00:00.000Z",
    ioRequested: input.ioRequested
  };
}

function makeSourceAccountUseRequirement(
  id = sourceAccountId,
  target = sourceAccountResource,
  bindingGeneration = "1"
): InboxV2AuthorizationRequirement {
  const useCapabilityManifestResource = resource(
    "core:provider-capability-manifest",
    `provider_capability_manifest:source-use:${String(id)}`
  );
  return makeRequirement({
    id: "source-use",
    permissionId: "core:source_account.use",
    resource: target,
    visibility: "secondary_hidden",
    guard: {
      profileId: "core:rbac.guard.source_account_route",
      operation: {
        kind: "use",
        sourceAccountResource: target,
        bindingResource: sourceBindingResource,
        capabilityManifest: {
          resource: useCapabilityManifestResource,
          capabilityId: "core:capability.source_account.use",
          sourceAccountResource: target,
          bindingResource: sourceBindingResource,
          routeResource: null,
          manifestSourceAccountResource: target,
          manifestBindingResource: sourceBindingResource,
          manifestRouteResource: null,
          state: "supported",
          revisionChecks: keyed([
            useCapabilityManifestResource,
            target,
            sourceBindingResource
          ]),
          notAfter: AUTHORITY_END
        }
      },
      sourceAccountId: id,
      routeSourceAccountId: id,
      sourceState: "active",
      bindingState: "active",
      bindingGeneration,
      expectedBindingGeneration: bindingGeneration,
      capabilityState: "supported",
      capabilityNotAfter: AUTHORITY_END
    }
  });
}

function decide(
  guard: DeletionGuard,
  permissionId:
    | "core:privacy.deletion.preview"
    | "core:privacy.deletion.approve"
    | "core:privacy.deletion.execute",
  companions: readonly InboxV2AuthorizationRequirement[] = [],
  companionGrants: readonly InboxV2PolicyGrant[] = [],
  options: Readonly<{ includeApprovalAuthority?: boolean }> = {}
) {
  const approval = guard.approvalEvidence;
  const includeApprovalAuthority =
    guard.phase === "execute" &&
    approval !== null &&
    options.includeApprovalAuthority !== false;
  const approvalRequirements = includeApprovalAuthority
    ? [
        makeRequirement({
          id: approval.approverDirectoryRequirementId,
          permissionId: "core:employee.directory.view",
          resource: approval.approverEmployeeResource,
          visibility: "secondary_hidden",
          guard: {
            profileId: "core:rbac.guard.canonical_resource",
            resourceState: "active",
            contentBoundary: "none",
            routeInputFields: [],
            companionRequirementIds: [],
            action: { kind: "canonical" }
          }
        })
      ]
    : [];
  const approvalGrants = includeApprovalAuthority
    ? [
        makeGrant("core:employee.directory.view", "approver-directory-grant"),
        makeGrant(
          "core:privacy.deletion.approve",
          approval.approverGrantId,
          approval.approverEmployeeId
        )
      ]
    : [];
  return evaluateInboxV2AuthorizationPlan(
    makeInput(
      [
        makeRequirement({
          id: "delete",
          permissionId,
          resource: planResource,
          guard
        }),
        ...approvalRequirements,
        ...companions
      ],
      [
        makeGrant(permissionId, "delete-grant"),
        ...approvalGrants,
        ...companionGrants
      ]
    )
  );
}

function makeRequirement(
  overrides: Partial<InboxV2AuthorizationRequirement>
): InboxV2AuthorizationRequirement {
  return {
    id: "delete",
    permissionId: "core:privacy.deletion.execute",
    resource: planResource,
    resourceAccessRevision: "5",
    expectedResourceAccessRevision: "5",
    scopeFacts: [],
    revisionChecks: [],
    guard: makeLocalGuard(),
    visibility: "primary",
    authorizationSubject: { kind: "actor" },
    ...overrides
  };
}

function makeGrant(
  permissionId: InboxV2PermissionId,
  id: string,
  principalEmployeeId = employeeId
): Extract<InboxV2PolicyGrant, { principal: { kind: "employee" } }> {
  return {
    id,
    tenantId,
    principal: { kind: "employee", employeeId: principalEmployeeId },
    permissionId,
    catalogSchemaId: "core:inbox-v2.permission-scope-catalog",
    catalogVersion: "v1",
    scope: { type: "tenant", tenantId },
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
  for (const requirement of requirements) {
    resources.set(entityKeyString(requirement.resource), requirement.resource);
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

function keyed(resources: readonly InboxV2EntityKey[]) {
  return resources.map((resource) => ({
    resource,
    expected: "1",
    actual: "1"
  }));
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

function entityKeyString(resource: InboxV2EntityKey): string {
  return `${resource.tenantId}\u0000${resource.entityTypeId}\u0000${resource.entityId}`;
}
