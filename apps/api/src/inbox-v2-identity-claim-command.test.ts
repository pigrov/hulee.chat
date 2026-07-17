import {
  inboxV2AuthorizationDependencyVectorSchema,
  inboxV2AuthorizationEpochSchema,
  inboxV2AuthorizationEpochSnapshotSchema,
  inboxV2ClientContactIdSchema,
  inboxV2EmployeeIdSchema,
  inboxV2EmployeeReferenceSchema,
  inboxV2EntityKeySchema,
  inboxV2EntityRevisionSchema,
  inboxV2InternalEntityReferenceSchema,
  inboxV2InternalOpaqueReferenceSchema,
  inboxV2NormalizedInboundEventIdSchema,
  inboxV2SourceExternalIdentityIdSchema,
  inboxV2SourceIdentityClaimIdSchema,
  inboxV2SourceIdentityClaimTransitionIdSchema,
  inboxV2SourceIdentityClaimVersionSchema,
  inboxV2TenantIdSchema,
  inboxV2TrustedServiceIdSchema,
  type InboxV2AuthorizationDependencyVector,
  type InboxV2EntityKey,
  type InboxV2SecurityDenialAttempt,
  type InboxV2SourceIdentityClaim
} from "@hulee/contracts";
import {
  createInboxV2SecurityDenialFingerprintProof,
  createInboxV2VerifiedSecurityTenantScope,
  evaluateInboxV2AuthorizationPlan,
  type InboxV2AuthorizationPlanInput,
  type InboxV2AuthorizationRequirement,
  type InboxV2PermissionId,
  type InboxV2PolicyGrant,
  type InboxV2SecurityDenialContext,
  type InboxV2SecurityDenialSink
} from "@hulee/core";
import type {
  ApplyInboxV2SourceIdentityClaimTransitionInput,
  InboxV2AuthorizedCommandCoordinator,
  InboxV2AuthorizedCommandMutationContext,
  InboxV2SourceIdentityClaimRepository,
  WithInboxV2AuthorizedCommandMutationInput
} from "@hulee/db";
import { describe, expect, it, vi } from "vitest";

import {
  calculateInboxV2IdentityClaimIntentDigest,
  createInboxV2IdentityClaimCommandService,
  createInboxV2IdentityClaimEvidenceManifest,
  type InboxV2IdentityClaimCommand,
  type InboxV2IdentityClaimIntentKind,
  type InboxV2PreparedIdentityClaimAuthorizationBinding,
  type InboxV2PreparedIdentityClaimCommand
} from "./inbox-v2-identity-claim-command";

const NOW = "2026-07-17T09:00:00.000Z";
const LATER = "2026-07-17T10:00:00.000Z";
const DIGEST = `sha256:${"a".repeat(64)}`;
const tenantId = inboxV2TenantIdSchema.parse("tenant:tenant-1");
const actorEmployeeId = inboxV2EmployeeIdSchema.parse("employee:employee-1");
const targetEmployeeId = inboxV2EmployeeIdSchema.parse("employee:employee-2");
const targetClientContactId = inboxV2ClientContactIdSchema.parse(
  "client_contact:contact-2"
);
const trustedServiceId = inboxV2TrustedServiceIdSchema.parse(
  "core:identity-resolver"
);
const sourceExternalIdentityId = inboxV2SourceExternalIdentityIdSchema.parse(
  "source_external_identity:identity-1"
);
const actorEmployee = inboxV2EmployeeReferenceSchema.parse({
  tenantId,
  kind: "employee",
  id: actorEmployeeId
});
const revision = inboxV2EntityRevisionSchema.parse("1");
const epoch = inboxV2AuthorizationEpochSchema.parse(
  "authorization:src004-epoch"
);
const claimVersion = inboxV2SourceIdentityClaimVersionSchema.parse("1");
const automaticAssessmentId = "identity_resolution:src004";
const automaticPolicyId = "core:src004-auto-policy";
const sourceIdentityResource = resource(
  "core:source-external-identity",
  sourceExternalIdentityId
);
const evidenceResource = resource(
  "core:identity-evidence",
  "identity_evidence:src004"
);
const evidenceReferences = [
  {
    kind: "normalized_inbound_event" as const,
    reference: {
      tenantId,
      kind: "normalized_inbound_event" as const,
      id: inboxV2NormalizedInboundEventIdSchema.parse(
        "normalized_inbound_event:src004"
      )
    }
  }
] satisfies InboxV2SourceIdentityClaim["evidenceReferences"];

describe("Inbox V2 identity claim command boundary", () => {
  it("authorizes a ClientContact-to-Employee reassignment only inside the coordinator context", async () => {
    const fixture = manualClaimFixture({
      kind: "employee",
      id: targetEmployeeId
    });
    const repository = {
      applyTransitionInAuthorizedContext: vi.fn(async () => ({
        kind: "applied" as const,
        transition: { id: fixture.transition.transitionId }
      }))
    } as unknown as Pick<
      InboxV2SourceIdentityClaimRepository,
      "applyTransitionInAuthorizedContext"
    >;
    const coordinator = inMemoryCoordinator();
    const service = createInboxV2IdentityClaimCommandService({
      preparer: preparerFor(fixture.prepared),
      denialSink: rejectingDenialSink().sink,
      coordinator,
      repository
    });

    const policyDecision = evaluateInboxV2AuthorizationPlan(
      fixture.prepared.authorizationPlan
    );
    expect(policyDecision, JSON.stringify(policyDecision)).toMatchObject({
      outcome: "allowed"
    });

    const result = await service.claimEmployee({
      tenantId,
      sourceExternalIdentityId,
      employeeId: targetEmployeeId,
      expectedVersion: claimVersion,
      evidenceReferences,
      clientMutationId: "client-mutation:src004-employee"
    });

    expect(result.outcome).toBe("applied");
    expect(repository.applyTransitionInAuthorizedContext).toHaveBeenCalledTimes(
      1
    );
    expect(repository.applyTransitionInAuthorizedContext).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { kind: "employee", employeeId: actorEmployeeId },
        profile: "domain"
      }),
      fixture.transition,
      {
        authorizationDecisionId:
          fixture.prepared.authorizedMutation.command.authorizationDecisionId,
        expectedActiveClaim: {
          claimId: "source_identity_claim:previous",
          target: {
            kind: "client_contact",
            clientContactId: "client_contact:previous"
          }
        }
      }
    );
  });

  it("keeps ClientContact claims behind their dedicated permission", async () => {
    const fixture = manualClaimFixture({
      kind: "client_contact",
      id: targetClientContactId
    });
    const repository = successfulRepository(fixture.transition.transitionId);
    const coordinator = inMemoryCoordinator();
    const service = createInboxV2IdentityClaimCommandService({
      preparer: preparerFor(fixture.prepared),
      denialSink: rejectingDenialSink().sink,
      coordinator,
      repository
    });

    expect(
      evaluateInboxV2AuthorizationPlan(fixture.prepared.authorizationPlan)
    ).toMatchObject({ outcome: "allowed" });
    expect(
      await service.claimClientContact({
        tenantId,
        sourceExternalIdentityId,
        clientContactId: targetClientContactId,
        expectedVersion: claimVersion,
        evidenceReferences,
        clientMutationId: "client-mutation:src004-employee"
      })
    ).toMatchObject({ outcome: "applied" });

    const wrongPermissionPrepared: InboxV2PreparedIdentityClaimCommand = {
      ...fixture.prepared,
      authorizationPlan: {
        ...fixture.prepared.authorizationPlan,
        requirements: fixture.prepared.authorizationPlan.requirements.map(
          (item) =>
            item.permissionId === "core:identity.client_contact_claim.manage"
              ? {
                  ...item,
                  permissionId: "core:identity.employee_claim.manage"
                }
              : item
        )
      }
    };
    const blockedRepository = successfulRepository(
      fixture.transition.transitionId
    );
    const blockedCoordinator = inMemoryCoordinator();
    const blockedService = createInboxV2IdentityClaimCommandService({
      preparer: preparerFor(wrongPermissionPrepared),
      denialSink: rejectingDenialSink().sink,
      coordinator: blockedCoordinator,
      repository: blockedRepository
    });
    await expect(
      blockedService.claimClientContact({
        tenantId,
        sourceExternalIdentityId,
        clientContactId: targetClientContactId,
        expectedVersion: claimVersion,
        evidenceReferences,
        clientMutationId: "client-mutation:src004-employee"
      })
    ).rejects.toMatchObject({ code: "permission.denied" });
    expect(
      blockedCoordinator.withAuthorizedCommandMutation
    ).not.toHaveBeenCalled();
    expect(
      blockedRepository.applyTransitionInAuthorizedContext
    ).not.toHaveBeenCalled();
  });

  it("allows a reviewed re-claim at a nonzero version only with exact active-claim absence", async () => {
    const fixture = manualClaimFixture({
      kind: "employee",
      id: targetEmployeeId
    });
    const requirements = fixture.prepared.authorizationPlan.requirements
      .filter(
        (item) =>
          !(
            item.guard.profileId === "core:rbac.guard.identity_evidence" &&
            item.guard.operation.kind === "claim_revoke"
          )
      )
      .map((item) => {
        if (
          item.guard.profileId !== "core:rbac.guard.identity_evidence" ||
          item.guard.operation.kind !== "employee_claim_manage"
        ) {
          return item;
        }
        return {
          ...item,
          guard: {
            ...item.guard,
            operation: {
              ...item.guard.operation,
              oldTargetResource: null,
              oldTargetRequirementId: null,
              currentClaimTargetResource: null
            }
          }
        };
      });
    const plan = authorizationPlan(
      requirements,
      fixture.prepared.authorizationPlan.grants
    );
    const authorizationBinding = {
      kind: "manual_claim" as const,
      activeClaimResource: null,
      activeTargetResource: null,
      expectedClaimVersion: claimVersion
    } satisfies InboxV2PreparedIdentityClaimAuthorizationBinding;
    const command: InboxV2IdentityClaimCommand = {
      tenantId,
      sourceExternalIdentityId,
      employeeId: targetEmployeeId,
      expectedVersion: claimVersion,
      evidenceReferences,
      clientMutationId: "client-mutation:src004-employee"
    };
    const prepared: InboxV2PreparedIdentityClaimCommand = {
      ...fixture.prepared,
      authorizationPlan: plan,
      authorizedMutation: authorizedMutationForPlan(
        command.clientMutationId,
        { kind: "employee", employeeId: actorEmployeeId },
        plan,
        {
          kind: "manual_employee",
          command,
          transition: fixture.transition,
          authorizationBinding,
          evidenceManifest: fixture.prepared.evidenceManifest
        }
      ),
      authorizationBinding
    };
    const repository = successfulRepository(fixture.transition.transitionId);
    const service = createInboxV2IdentityClaimCommandService({
      preparer: preparerFor(prepared),
      denialSink: rejectingDenialSink().sink,
      coordinator: inMemoryCoordinator(),
      repository
    });

    expect(evaluateInboxV2AuthorizationPlan(plan).outcome).toBe("allowed");
    await expect(service.claimEmployee(command)).resolves.toMatchObject({
      outcome: "applied"
    });
    expect(repository.applyTransitionInAuthorizedContext).toHaveBeenCalledWith(
      expect.anything(),
      fixture.transition,
      {
        authorizationDecisionId:
          prepared.authorizedMutation.command.authorizationDecisionId,
        expectedActiveClaim: null
      }
    );
  });

  it("binds manual revoke to the exact source, active target and claim version", async () => {
    const fixture = revokeFixture();
    const repository = successfulRepository(fixture.transition.transitionId);
    const coordinator = inMemoryCoordinator();
    const service = createInboxV2IdentityClaimCommandService({
      preparer: preparerFor(fixture.prepared),
      denialSink: rejectingDenialSink().sink,
      coordinator,
      repository
    });

    expect(
      evaluateInboxV2AuthorizationPlan(fixture.prepared.authorizationPlan)
    ).toMatchObject({ outcome: "allowed" });
    expect(
      await service.revokeClaim({
        tenantId,
        sourceExternalIdentityId,
        expectedVersion: claimVersion,
        clientMutationId: "client-mutation:src004-revoke"
      })
    ).toMatchObject({ outcome: "applied" });

    const foreignSource = resource(
      "core:source-external-identity",
      "source_external_identity:substituted"
    );
    const sourceSubstitution: InboxV2PreparedIdentityClaimCommand = {
      ...fixture.prepared,
      authorizationPlan: {
        ...fixture.prepared.authorizationPlan,
        requirements: fixture.prepared.authorizationPlan.requirements.map(
          (item) =>
            item.guard.profileId === "core:rbac.guard.identity_evidence" &&
            item.guard.operation.kind === "claim_revoke"
              ? {
                  ...item,
                  guard: {
                    ...item.guard,
                    operation: {
                      ...item.guard.operation,
                      sourceIdentityResource: foreignSource,
                      claimSourceIdentityResource: foreignSource
                    }
                  }
                }
              : item
        )
      }
    };
    const targetSubstitution: InboxV2PreparedIdentityClaimCommand = {
      ...fixture.prepared,
      authorizationBinding: {
        ...fixture.prepared.authorizationBinding,
        kind: "manual_revoke",
        activeTargetResource: resource(
          "core:client-contact",
          "client_contact:substituted"
        ),
        activeClaimResource: fixture.activeClaimResource,
        expectedClaimVersion: claimVersion
      }
    };
    const versionSubstitution: InboxV2PreparedIdentityClaimCommand = {
      ...fixture.prepared,
      authorizationBinding: {
        kind: "manual_revoke",
        activeTargetResource: fixture.activeTargetResource,
        activeClaimResource: fixture.activeClaimResource,
        expectedClaimVersion: inboxV2SourceIdentityClaimVersionSchema.parse("2")
      }
    };

    for (const prepared of [
      sourceSubstitution,
      targetSubstitution,
      versionSubstitution
    ]) {
      const blockedRepository = successfulRepository(
        fixture.transition.transitionId
      );
      const blockedCoordinator = inMemoryCoordinator();
      const blockedService = createInboxV2IdentityClaimCommandService({
        preparer: preparerFor(prepared),
        denialSink: rejectingDenialSink().sink,
        coordinator: blockedCoordinator,
        repository: blockedRepository
      });
      await expect(
        blockedService.revokeClaim({
          tenantId,
          sourceExternalIdentityId,
          expectedVersion: claimVersion,
          clientMutationId: "client-mutation:src004-revoke"
        })
      ).rejects.toMatchObject({ code: "permission.denied" });
      expect(
        blockedCoordinator.withAuthorizedCommandMutation
      ).not.toHaveBeenCalled();
      expect(
        blockedRepository.applyTransitionInAuthorizedContext
      ).not.toHaveBeenCalled();
    }
  });

  it("allows only the exact trusted verified automatic resolution assessment", async () => {
    const fixture = automaticFixture();
    const repository = successfulRepository(fixture.transition.transitionId);
    const coordinator = inMemoryCoordinator();
    const service = createInboxV2IdentityClaimCommandService({
      preparer: preparerFor(fixture.prepared),
      denialSink: rejectingDenialSink().sink,
      coordinator,
      repository
    });

    expect(
      evaluateInboxV2AuthorizationPlan(fixture.prepared.authorizationPlan)
    ).toMatchObject({ outcome: "allowed" });
    expect(
      await service.autoResolve({
        tenantId,
        sourceExternalIdentityId,
        assessmentId: automaticAssessmentId,
        expectedVersion: null,
        clientMutationId: "client-mutation:src004-auto"
      })
    ).toMatchObject({ outcome: "applied" });

    const foreignEvidence = resource(
      "core:identity-evidence",
      "identity_evidence:substituted"
    );
    const evidenceSubstitution: InboxV2PreparedIdentityClaimCommand = {
      ...fixture.prepared,
      evidenceManifest: createInboxV2IdentityClaimEvidenceManifest({
        resource: foreignEvidence,
        references: evidenceReferences
      })
    };
    const foreignTrustedServiceId = inboxV2TrustedServiceIdSchema.parse(
      "core:substituted-resolver"
    );
    const trustedServiceSubstitution: InboxV2PreparedIdentityClaimCommand = {
      ...fixture.prepared,
      transition: {
        ...fixture.transition,
        decision: {
          ...fixture.automaticDecision,
          kind: "automatic_policy",
          trustedServiceId: foreignTrustedServiceId,
          reviewState: "not_required"
        }
      }
    };
    const targetSubstitution: InboxV2PreparedIdentityClaimCommand = {
      ...fixture.prepared,
      transition: {
        ...fixture.transition,
        operation: {
          ...fixture.automaticOperation,
          kind: "claim_client_contact",
          clientContactId: inboxV2ClientContactIdSchema.parse(
            "client_contact:substituted"
          )
        }
      }
    };
    const unverifiedBootstrap: InboxV2PreparedIdentityClaimCommand = {
      ...fixture.prepared,
      transition: {
        ...fixture.transition,
        operation: {
          ...fixture.automaticOperation,
          confidence: "strong"
        }
      }
    };
    const cases = [
      {
        prepared: fixture.prepared,
        assessmentId: "identity_resolution:substituted"
      },
      { prepared: evidenceSubstitution, assessmentId: automaticAssessmentId },
      {
        prepared: trustedServiceSubstitution,
        assessmentId: automaticAssessmentId
      },
      { prepared: targetSubstitution, assessmentId: automaticAssessmentId },
      { prepared: unverifiedBootstrap, assessmentId: automaticAssessmentId }
    ];

    for (const testCase of cases) {
      const blockedRepository = successfulRepository(
        fixture.transition.transitionId
      );
      const blockedCoordinator = inMemoryCoordinator();
      const blockedService = createInboxV2IdentityClaimCommandService({
        preparer: preparerFor(testCase.prepared),
        denialSink: rejectingDenialSink().sink,
        coordinator: blockedCoordinator,
        repository: blockedRepository
      });
      await expect(
        blockedService.autoResolve({
          tenantId,
          sourceExternalIdentityId,
          assessmentId: testCase.assessmentId,
          expectedVersion: null,
          clientMutationId: "client-mutation:src004-auto"
        })
      ).rejects.toMatchObject({ code: "permission.denied" });
      expect(
        blockedCoordinator.withAuthorizedCommandMutation
      ).not.toHaveBeenCalled();
      expect(
        blockedRepository.applyTransitionInAuthorizedContext
      ).not.toHaveBeenCalled();
    }
  });

  it("closes intent hash, semantic audit, authorization proof, revisions and active state before coordinator entry", async () => {
    const fixture = manualClaimFixture({
      kind: "employee",
      id: targetEmployeeId
    });
    const mutation = fixture.prepared.authorizedMutation;
    const secondaryDecision =
      mutation.records.audit.authorizationDecisionRefs.find(
        ({ id }) => id !== mutation.command.authorizationDecisionId
      );
    if (secondaryDecision === undefined) {
      throw new Error("fixture requires a secondary authorization decision");
    }
    const cases: readonly InboxV2PreparedIdentityClaimCommand[] = [
      {
        ...fixture.prepared,
        authorizedMutation: {
          ...mutation,
          command: {
            ...mutation.command,
            authorizationEpoch: inboxV2AuthorizationEpochSchema.parse(
              "authorization:substituted-epoch"
            )
          }
        }
      },
      {
        ...fixture.prepared,
        authorizedMutation: {
          ...mutation,
          command: { ...mutation.command, requestHash: DIGEST as never }
        }
      },
      {
        ...fixture.prepared,
        authorizedMutation: {
          ...mutation,
          command: {
            ...mutation.command,
            commandTypeId: "core:identity.claim.substituted" as never
          }
        }
      },
      {
        ...fixture.prepared,
        authorizedMutation: {
          ...mutation,
          records: {
            ...mutation.records,
            audit: {
              ...mutation.records.audit,
              actionId: "core:identity.claim.revoke"
            }
          }
        }
      },
      {
        ...fixture.prepared,
        authorizedMutation: {
          ...mutation,
          records: {
            ...mutation.records,
            audit: {
              ...mutation.records.audit,
              target: inboxV2InternalEntityReferenceSchema.parse({
                ...mutation.records.audit.target,
                entityId: `internal-ref:${"d".repeat(64)}`
              })
            }
          }
        }
      },
      {
        ...fixture.prepared,
        authorizedMutation: {
          ...mutation,
          records: {
            ...mutation.records,
            audit: {
              ...mutation.records.audit,
              authorizationDecisionRefs:
                mutation.records.audit.authorizationDecisionRefs.map(
                  (decision) =>
                    decision.id === mutation.command.authorizationDecisionId
                      ? {
                          ...decision,
                          authorizationEpoch:
                            inboxV2AuthorizationEpochSchema.parse(
                              "authorization:substituted-decision-epoch"
                            )
                        }
                      : decision
                )
            }
          }
        }
      },
      {
        ...fixture.prepared,
        authorizationPlan: {
          ...fixture.prepared.authorizationPlan,
          currentAuthorization: {
            ...fixture.prepared.authorizationPlan.currentAuthorization,
            dependencies: {
              ...fixture.prepared.authorizationPlan.currentAuthorization
                .dependencies,
              sharedAccessRevision: "9" as never
            }
          }
        }
      },
      {
        ...fixture.prepared,
        authorizedMutation: {
          ...mutation,
          command: {
            ...mutation.command,
            authorizationDecisionId: secondaryDecision.id
          }
        }
      },
      {
        ...fixture.prepared,
        authorizedMutation: {
          ...mutation,
          revisions: {
            ...mutation.revisions,
            expectedTenantRbacRevision: "2"
          }
        }
      },
      {
        ...fixture.prepared,
        authorizedMutation: {
          ...mutation,
          records: {
            ...mutation.records,
            audit: {
              ...mutation.records.audit,
              authorizationDecisionRefs:
                mutation.records.audit.authorizationDecisionRefs.map(
                  (decision) =>
                    decision.id === mutation.command.authorizationDecisionId
                      ? { ...decision, resourceAccessRevision: "2" as never }
                      : decision
                )
            }
          }
        }
      },
      {
        ...fixture.prepared,
        authorizationBinding: {
          ...fixture.prepared.authorizationBinding,
          kind: "manual_claim",
          activeClaimResource: resource(
            "core:source-identity-claim",
            "source_identity_claim:substituted"
          ),
          activeTargetResource: resource(
            "core:client-contact",
            "client_contact:previous"
          ),
          expectedClaimVersion: claimVersion
        }
      },
      {
        ...fixture.prepared,
        authorizationBinding: {
          ...fixture.prepared.authorizationBinding,
          kind: "manual_claim",
          activeClaimResource: resource(
            "core:source-identity-claim",
            "source_identity_claim:previous"
          ),
          activeTargetResource: resource(
            "core:client-contact",
            "client_contact:substituted"
          ),
          expectedClaimVersion: claimVersion
        }
      }
    ];

    for (const prepared of cases) {
      const repository = successfulRepository(fixture.transition.transitionId);
      const coordinator = inMemoryCoordinator();
      const service = createInboxV2IdentityClaimCommandService({
        preparer: preparerFor(prepared),
        denialSink: rejectingDenialSink().sink,
        coordinator,
        repository
      });
      await expect(
        service.claimEmployee({
          tenantId,
          sourceExternalIdentityId,
          employeeId: targetEmployeeId,
          expectedVersion: claimVersion,
          evidenceReferences,
          clientMutationId: "client-mutation:src004-employee"
        })
      ).rejects.toMatchObject({ code: "permission.denied" });
      expect(coordinator.withAuthorizedCommandMutation).not.toHaveBeenCalled();
      expect(
        repository.applyTransitionInAuthorizedContext
      ).not.toHaveBeenCalled();
    }
  });

  it("denies manual self-claim, emits a review candidate and performs no domain write", async () => {
    const fixture = manualClaimFixture({
      kind: "employee",
      id: actorEmployeeId
    });
    const denial = rejectingDenialSink();
    const repository = {
      applyTransitionInAuthorizedContext: vi.fn()
    } as unknown as Pick<
      InboxV2SourceIdentityClaimRepository,
      "applyTransitionInAuthorizedContext"
    >;
    const coordinator = inMemoryCoordinator();
    const service = createInboxV2IdentityClaimCommandService({
      preparer: preparerFor(fixture.prepared),
      denialSink: denial.sink,
      coordinator,
      repository
    });

    const result = await service.claimEmployee({
      tenantId,
      sourceExternalIdentityId,
      employeeId: actorEmployeeId,
      expectedVersion: claimVersion,
      evidenceReferences,
      clientMutationId: "client-mutation:src004-employee"
    });

    expect(result).toEqual({
      outcome: "denied",
      errorCode: "identity.claim_self_forbidden"
    });
    expect(
      repository.applyTransitionInAuthorizedContext
    ).not.toHaveBeenCalled();
    expect(coordinator.withAuthorizedCommandMutation).not.toHaveBeenCalled();
    expect(denial.attempts).toHaveLength(1);
    expect(denial.attempts[0]).toMatchObject({
      action: "identity.claim",
      denialKind: "manual_self_claim",
      reviewSignal: {
        reviewType: "manual_self_claim",
        alertType: "identity_claim_review"
      }
    });
  });

  it("rejects evidence substitution and runtime migration before authorization or persistence", async () => {
    const fixture = manualClaimFixture({
      kind: "employee",
      id: targetEmployeeId
    });
    const foreignEvidence = [
      {
        ...evidenceReferences[0],
        reference: {
          ...evidenceReferences[0]!.reference,
          id: inboxV2NormalizedInboundEventIdSchema.parse(
            "normalized_inbound_event:substituted"
          )
        }
      }
    ];
    const migrationPrepared: InboxV2PreparedIdentityClaimCommand = {
      ...fixture.prepared,
      transition: {
        ...fixture.transition,
        decision: {
          kind: "migration",
          trustedServiceId:
            inboxV2TrustedServiceIdSchema.parse("core:forged-import"),
          reviewState: "not_required"
        }
      }
    };
    const repository = {
      applyTransitionInAuthorizedContext: vi.fn()
    } as unknown as Pick<
      InboxV2SourceIdentityClaimRepository,
      "applyTransitionInAuthorizedContext"
    >;
    const coordinator = inMemoryCoordinator();
    const service = createInboxV2IdentityClaimCommandService({
      preparer: preparerFor(fixture.prepared),
      denialSink: rejectingDenialSink().sink,
      coordinator,
      repository
    });

    await expect(
      service.claimEmployee({
        tenantId,
        sourceExternalIdentityId,
        employeeId: targetEmployeeId,
        expectedVersion: claimVersion,
        evidenceReferences: foreignEvidence,
        clientMutationId: "client-mutation:src004-employee"
      })
    ).rejects.toMatchObject({ code: "permission.denied" });

    const migrationService = createInboxV2IdentityClaimCommandService({
      preparer: preparerFor(migrationPrepared),
      denialSink: rejectingDenialSink().sink,
      coordinator,
      repository
    });
    await expect(
      migrationService.claimEmployee({
        tenantId,
        sourceExternalIdentityId,
        employeeId: targetEmployeeId,
        expectedVersion: claimVersion,
        evidenceReferences,
        clientMutationId: "client-mutation:src004-employee"
      })
    ).rejects.toMatchObject({ code: "permission.denied" });
    expect(
      repository.applyTransitionInAuthorizedContext
    ).not.toHaveBeenCalled();
    expect(coordinator.withAuthorizedCommandMutation).not.toHaveBeenCalled();
  });
});

function manualClaimFixture(
  target:
    | Readonly<{ kind: "employee"; id: typeof actorEmployeeId }>
    | Readonly<{
        kind: "client_contact";
        id: typeof targetClientContactId;
      }>
) {
  const targetResource =
    target.kind === "employee"
      ? resource("core:employee", target.id)
      : resource("core:client-contact", target.id);
  const sourceRequirementId = "src004-source-use";
  const oldTargetRequirementId = "src004-old-target-revoke";
  const oldTargetResource = resource(
    "core:client-contact",
    "client_contact:previous"
  );
  const activeClaimResource = resource(
    "core:source-identity-claim",
    "source_identity_claim:previous"
  );
  const evidenceManifest = createInboxV2IdentityClaimEvidenceManifest({
    resource: evidenceResource,
    references: evidenceReferences
  });
  const sourceRequirement = requirement({
    id: sourceRequirementId,
    permissionId: "core:identity.source_identity.use",
    resource: sourceIdentityResource,
    visibility: "secondary_hidden",
    guard: {
      profileId: "core:rbac.guard.identity_evidence",
      targetResource: sourceIdentityResource,
      evidenceState: "verified",
      operation: {
        kind: "source_identity_use",
        actorEmployeeId,
        evidenceResource: sourceIdentityResource,
        revisionChecks: currentChecks("relation")
      }
    }
  });
  const oldTargetRequirement = requirement({
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
        actorEmployeeId,
        sourceIdentityResource,
        sourceIdentityRequirementId: sourceRequirementId,
        sourceIdentityRevisionChecks: currentChecks("entity"),
        reasonCodeId: "core:src004-reassignment",
        auditEventResource: resource(
          "core:audit-event",
          "audit_event:src004-old-target"
        ),
        auditActorEmployeeId: actorEmployeeId,
        auditSourceIdentityResource: sourceIdentityResource,
        auditTargetResource: oldTargetResource,
        auditRevisionChecks: currentChecks("entity"),
        activeClaimResource,
        claimSourceIdentityResource: sourceIdentityResource,
        existingTargetResource: oldTargetResource,
        claimTargetResource: oldTargetResource,
        activeClaimRevisionChecks: currentChecks("relation"),
        targetRevisionChecks: currentChecks("entity")
      }
    }
  });
  const claimOperation = {
    actorEmployeeId,
    sourceIdentityResource,
    sourceIdentityRequirementId: sourceRequirementId,
    sourceIdentityRevisionChecks: currentChecks("entity"),
    reasonCodeId: "core:src004-manual-claim",
    auditEventResource: resource("core:audit-event", "audit_event:src004"),
    auditActorEmployeeId: actorEmployeeId,
    auditSourceIdentityResource: sourceIdentityResource,
    auditTargetResource: targetResource,
    auditRevisionChecks: currentChecks("entity"),
    oldTargetResource,
    oldTargetRequirementId,
    newTargetResource: targetResource,
    claimPolicyResource: resource(
      "core:identity-claim-policy",
      "identity_claim_policy:src004"
    ),
    claimPolicyState: "approved_active" as const,
    claimPolicyVersion: "1",
    evidencePolicyResource: resource(
      "core:identity-claim-policy",
      "identity_claim_policy:src004"
    ),
    evidencePolicyVersion: "1",
    evidenceResource,
    evidenceSourceIdentityResource: sourceIdentityResource,
    evidenceTargetResource: targetResource,
    sensitiveEvidenceIncluded: false,
    evidenceViewRequirementId: null,
    claimPolicyRevisionChecks: currentChecks("policy"),
    evidenceRevisionChecks: currentChecks("entity"),
    targetRevisionChecks: currentChecks("entity"),
    claimHeadResource: resource(
      "core:source-identity-claim-head",
      "source_identity_claim_head:src004"
    ),
    claimHeadSourceIdentityResource: sourceIdentityResource,
    currentClaimTargetResource: oldTargetResource,
    expectedClaimVersion: claimVersion,
    currentClaimVersion: claimVersion,
    claimRevisionChecks: currentChecks("relation")
  };
  const primaryRequirement = requirement({
    id: "src004-primary",
    permissionId:
      target.kind === "employee"
        ? "core:identity.employee_claim.manage"
        : "core:identity.client_contact_claim.manage",
    resource: targetResource,
    guard: {
      profileId: "core:rbac.guard.identity_evidence",
      targetResource,
      evidenceState: "verified",
      operation:
        target.kind === "employee"
          ? {
              ...claimOperation,
              kind: "employee_claim_manage" as const,
              newTargetEmployeeId: target.id,
              newTargetLifecycle: "active" as const
            }
          : {
              ...claimOperation,
              kind: "client_contact_claim_manage" as const
            }
    }
  });
  const plan = authorizationPlan(
    [primaryRequirement, sourceRequirement, oldTargetRequirement],
    [
      grant(
        target.kind === "employee"
          ? "core:identity.employee_claim.manage"
          : "core:identity.client_contact_claim.manage",
        "manage"
      ),
      grant("core:identity.source_identity.use", "source"),
      grant("core:identity.claim.revoke", "revoke")
    ]
  );
  const transition: ApplyInboxV2SourceIdentityClaimTransitionInput = {
    tenantId,
    sourceExternalIdentityId,
    transitionId: inboxV2SourceIdentityClaimTransitionIdSchema.parse(
      "source_identity_claim_transition:src004"
    ),
    expectedVersion: claimVersion,
    operation:
      target.kind === "employee"
        ? {
            kind: "claim_employee",
            claimId: inboxV2SourceIdentityClaimIdSchema.parse(
              "source_identity_claim:src004"
            ),
            employeeId: target.id,
            confidence: "verified",
            evidenceReferences
          }
        : {
            kind: "claim_client_contact",
            claimId: inboxV2SourceIdentityClaimIdSchema.parse(
              "source_identity_claim:src004"
            ),
            clientContactId: target.id,
            confidence: "verified",
            evidenceReferences
          },
    decision: {
      kind: "manual",
      actorEmployee,
      reviewState: "approved"
    },
    policyId: "identity_claim_policy:src004" as never,
    policyVersion: "v1",
    reasonCodeId: "identity_claim_reason:src004" as never,
    occurredAt: NOW
  };
  const authorizationBinding = {
    kind: "manual_claim" as const,
    activeClaimResource,
    activeTargetResource: oldTargetResource,
    expectedClaimVersion: claimVersion
  } satisfies InboxV2PreparedIdentityClaimAuthorizationBinding;
  const command: InboxV2IdentityClaimCommand =
    target.kind === "employee"
      ? {
          tenantId,
          sourceExternalIdentityId,
          employeeId: target.id,
          expectedVersion: claimVersion,
          evidenceReferences,
          clientMutationId: "client-mutation:src004-employee"
        }
      : {
          tenantId,
          sourceExternalIdentityId,
          clientContactId: target.id,
          expectedVersion: claimVersion,
          evidenceReferences,
          clientMutationId: "client-mutation:src004-employee"
        };
  const authorizedMutation = authorizedMutationForPlan(
    "client-mutation:src004-employee",
    { kind: "employee", employeeId: actorEmployeeId },
    plan,
    {
      kind:
        target.kind === "employee"
          ? "manual_employee"
          : "manual_client_contact",
      command,
      transition,
      authorizationBinding,
      evidenceManifest
    }
  );
  const prepared: InboxV2PreparedIdentityClaimCommand = {
    authorizationPlan: plan,
    denialContext: denialContext(),
    authorizedMutation,
    transition,
    evidenceManifest,
    authorizationBinding
  };
  return { prepared, transition };
}

function revokeFixture() {
  const sourceRequirementId = "src004-revoke-source-use";
  const activeTargetResource = resource(
    "core:client-contact",
    "client_contact:previous"
  );
  const activeClaimResource = resource(
    "core:source-identity-claim",
    "source_identity_claim:previous"
  );
  const sourceRequirement = requirement({
    id: sourceRequirementId,
    permissionId: "core:identity.source_identity.use",
    resource: sourceIdentityResource,
    visibility: "secondary_hidden",
    guard: {
      profileId: "core:rbac.guard.identity_evidence",
      targetResource: sourceIdentityResource,
      evidenceState: "verified",
      operation: {
        kind: "source_identity_use",
        actorEmployeeId,
        evidenceResource: sourceIdentityResource,
        revisionChecks: currentChecks("relation")
      }
    }
  });
  const revokeRequirement = requirement({
    id: "src004-revoke-primary",
    permissionId: "core:identity.claim.revoke",
    resource: activeTargetResource,
    guard: {
      profileId: "core:rbac.guard.identity_evidence",
      targetResource: activeTargetResource,
      evidenceState: "verified",
      operation: {
        kind: "claim_revoke",
        actorEmployeeId,
        sourceIdentityResource,
        sourceIdentityRequirementId: sourceRequirementId,
        sourceIdentityRevisionChecks: currentChecks("entity"),
        reasonCodeId: "core:src004-revoke",
        auditEventResource: resource(
          "core:audit-event",
          "audit_event:src004-revoke"
        ),
        auditActorEmployeeId: actorEmployeeId,
        auditSourceIdentityResource: sourceIdentityResource,
        auditTargetResource: activeTargetResource,
        auditRevisionChecks: currentChecks("entity"),
        activeClaimResource,
        claimSourceIdentityResource: sourceIdentityResource,
        existingTargetResource: activeTargetResource,
        claimTargetResource: activeTargetResource,
        activeClaimRevisionChecks: currentChecks("relation"),
        targetRevisionChecks: currentChecks("entity")
      }
    }
  });
  const transition: ApplyInboxV2SourceIdentityClaimTransitionInput = {
    tenantId,
    sourceExternalIdentityId,
    transitionId: inboxV2SourceIdentityClaimTransitionIdSchema.parse(
      "source_identity_claim_transition:src004-revoke"
    ),
    expectedVersion: claimVersion,
    operation: { kind: "revoke" },
    decision: {
      kind: "manual",
      actorEmployee,
      reviewState: "approved"
    },
    policyId: "identity_claim_policy:src004" as never,
    policyVersion: "v1",
    reasonCodeId: "identity_claim_reason:src004-revoke" as never,
    occurredAt: NOW
  };
  const plan = authorizationPlan(
    [revokeRequirement, sourceRequirement],
    [
      grant("core:identity.claim.revoke", "revoke"),
      grant("core:identity.source_identity.use", "source")
    ]
  );
  const authorizationBinding = {
    kind: "manual_revoke" as const,
    activeClaimResource,
    activeTargetResource,
    expectedClaimVersion: claimVersion
  } satisfies InboxV2PreparedIdentityClaimAuthorizationBinding;
  const command: InboxV2IdentityClaimCommand = {
    tenantId,
    sourceExternalIdentityId,
    expectedVersion: claimVersion,
    clientMutationId: "client-mutation:src004-revoke"
  };
  const prepared: InboxV2PreparedIdentityClaimCommand = {
    authorizationPlan: plan,
    denialContext: denialContext(),
    authorizedMutation: authorizedMutationForPlan(
      "client-mutation:src004-revoke",
      {
        kind: "employee",
        employeeId: actorEmployeeId
      },
      plan,
      {
        kind: "manual_revoke",
        command,
        transition,
        authorizationBinding,
        evidenceManifest: null
      }
    ),
    transition,
    evidenceManifest: null,
    authorizationBinding
  };
  return {
    prepared,
    transition,
    activeClaimResource,
    activeTargetResource
  };
}

function automaticFixture() {
  const resolutionDecisionResource = resource(
    "core:identity-resolution",
    automaticAssessmentId
  );
  const resolutionRelationResource = resource(
    "core:identity-resolution-binding",
    "identity_resolution_binding:src004"
  );
  const targetResource = resource("core:client-contact", targetClientContactId);
  const policyResource = resource(
    "core:identity-claim-policy",
    automaticPolicyId
  );
  const claimHeadResource = resource(
    "core:source-identity-claim-head",
    "source_identity_claim_head:src004-auto"
  );
  const auditEventResource = resource(
    "core:audit-event",
    "audit_event:src004-auto"
  );
  const manifestResource = resource(
    "core:identity-auto-resolution-policy-rule-manifest",
    "identity_auto_resolution_policy_rule_manifest:src004"
  );
  const resolutionResources = [
    resolutionDecisionResource,
    resolutionRelationResource,
    sourceIdentityResource,
    targetResource,
    policyResource,
    evidenceResource,
    claimHeadResource,
    auditEventResource
  ];
  const manifestResources = [
    manifestResource,
    policyResource,
    sourceIdentityResource,
    evidenceResource,
    targetResource
  ];
  const primaryRequirement = requirement({
    id: "src004-auto-primary",
    permissionId: "core:identity.auto_resolve",
    resource: resolutionDecisionResource,
    guard: {
      profileId: "core:rbac.guard.identity_evidence",
      targetResource: resolutionDecisionResource,
      evidenceState: "verified",
      operation: {
        kind: "auto_resolve",
        trustedServiceId,
        manualActorEmployeeId: null,
        resolutionDecisionResource,
        resolutionRelationResource,
        decisionSourceIdentityResource: sourceIdentityResource,
        decisionClaimTargetResource: targetResource,
        decisionPolicyResource: policyResource,
        resolutionResourceRevisionChecks:
          keyedCurrentChecks(resolutionResources),
        sourceIdentityResource,
        evidenceResource,
        claimTargetResource: targetResource,
        evidenceSourceIdentityResource: sourceIdentityResource,
        evidenceClaimTargetResource: targetResource,
        evidenceKind: "verified_scope_correct",
        policyResource,
        policyState: "approved_active",
        policyId: automaticPolicyId,
        policyVersion: "v1",
        evidencePolicyId: automaticPolicyId,
        evidencePolicyVersion: "v1",
        policyRuleManifest: {
          resource: manifestResource,
          policyResource,
          sourceIdentityResource,
          evidenceResource,
          claimTargetResource: targetResource,
          ruleId: "core:src004-verified-auto-resolution",
          ruleVersion: "v1",
          evidenceRuleId: "core:src004-verified-auto-resolution",
          evidenceRuleVersion: "v1",
          state: "approved_active",
          revisionChecks: keyedCurrentChecks(manifestResources),
          notAfter: LATER
        },
        policyAllowedTargetKind: "client_contact",
        targetKind: "client_contact",
        targetEmployeeId: null,
        targetEmployeeLifecycle: null,
        sourceIdentityResolution: { state: "unresolved" },
        claimHeadResource,
        claimHeadSourceIdentityResource: sourceIdentityResource,
        currentClaimTargetResource: null,
        expectedClaimVersion: null,
        currentClaimVersion: null,
        auditEventResource,
        auditSourceIdentityResource: sourceIdentityResource,
        auditClaimTargetResource: targetResource,
        auditTrustedServiceId: trustedServiceId,
        reasonCodeId: "core:src004-verified-auto-resolution",
        resolutionRevisionChecks: currentChecks("entity"),
        sourceIdentityRevisionChecks: currentChecks("entity"),
        evidenceRevisionChecks: currentChecks("entity"),
        targetRevisionChecks: currentChecks("entity"),
        policyRevisionChecks: currentChecks("policy"),
        claimRevisionChecks: currentChecks("relation"),
        auditRevisionChecks: currentChecks("entity")
      }
    }
  });
  const automaticOperation: Extract<
    ApplyInboxV2SourceIdentityClaimTransitionInput["operation"],
    { kind: "claim_client_contact" }
  > = {
    kind: "claim_client_contact",
    claimId: inboxV2SourceIdentityClaimIdSchema.parse(
      "source_identity_claim:src004-auto"
    ),
    clientContactId: targetClientContactId,
    confidence: "verified",
    evidenceReferences
  };
  const automaticDecision = {
    kind: "automatic_policy" as const,
    trustedServiceId,
    reviewState: "not_required" as const,
    policyAuthority: {
      family: "source_identity_claim" as const,
      definitionContractVersion: "v1" as never,
      definitionDigestSha256: "c".repeat(64),
      activationHeadRevision: revision
    }
  };
  const transition: ApplyInboxV2SourceIdentityClaimTransitionInput = {
    tenantId,
    sourceExternalIdentityId,
    transitionId: inboxV2SourceIdentityClaimTransitionIdSchema.parse(
      "source_identity_claim_transition:src004-auto"
    ),
    expectedVersion: null,
    operation: automaticOperation,
    decision: automaticDecision,
    policyId: automaticPolicyId as never,
    policyVersion: "v1",
    reasonCodeId: "core:src004-verified-auto-resolution" as never,
    occurredAt: NOW
  };
  const plan = trustedAuthorizationPlan(primaryRequirement);
  const evidenceManifest = createInboxV2IdentityClaimEvidenceManifest({
    resource: evidenceResource,
    references: evidenceReferences
  });
  const authorizationBinding = {
    kind: "automatic" as const,
    resolutionDecisionResource,
    activeClaimResource: null,
    activeTargetResource: null,
    expectedClaimVersion: null
  } satisfies InboxV2PreparedIdentityClaimAuthorizationBinding;
  const command: InboxV2IdentityClaimCommand = {
    tenantId,
    sourceExternalIdentityId,
    assessmentId: automaticAssessmentId,
    expectedVersion: null,
    clientMutationId: "client-mutation:src004-auto"
  };
  const prepared: InboxV2PreparedIdentityClaimCommand = {
    authorizationPlan: plan,
    denialContext: denialContext("trusted_service"),
    authorizedMutation: authorizedMutationForPlan(
      "client-mutation:src004-auto",
      {
        kind: "trusted_service",
        trustedServiceId
      },
      plan,
      {
        kind: "automatic",
        command,
        transition,
        authorizationBinding,
        evidenceManifest
      }
    ),
    transition,
    evidenceManifest,
    authorizationBinding
  };
  return { prepared, transition, automaticDecision, automaticOperation };
}

function authorizedMutationForPlan(
  clientMutationId: string,
  actor: WithInboxV2AuthorizedCommandMutationInput["command"]["actor"],
  plan: InboxV2AuthorizationPlanInput,
  intent: Readonly<{
    kind: InboxV2IdentityClaimIntentKind;
    command: InboxV2IdentityClaimCommand;
    transition: ApplyInboxV2SourceIdentityClaimTransitionInput;
    authorizationBinding: InboxV2PreparedIdentityClaimAuthorizationBinding;
    evidenceManifest: InboxV2PreparedIdentityClaimCommand["evidenceManifest"];
  }>
): WithInboxV2AuthorizedCommandMutationInput {
  const decisions = [...plan.requirements]
    .sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0
    )
    .map((item, index) => ({
      tenantId,
      id: `authorization-decision:${clientMutationId}:${String(index).padStart(3, "0")}`,
      authorizationEpoch: plan.currentAuthorization.authorizationEpoch,
      principal:
        actor.kind === "employee"
          ? { kind: "employee" as const, employee: actorEmployee }
          : {
              kind: "trusted_service" as const,
              trustedServiceId: actor.trustedServiceId
            },
      permissionId: item.permissionId,
      resourceScopeId: "core:tenant",
      resource: item.resource,
      resourceAccessRevision: item.resourceAccessRevision,
      decisionRevision: revision,
      decisionHash: DIGEST,
      outcome: "allowed" as const,
      decidedAt: NOW,
      notAfter: LATER
    }));
  const primaryDecision = decisions.find(
    (_, index) =>
      [...plan.requirements].sort((left, right) =>
        left.id < right.id ? -1 : left.id > right.id ? 1 : 0
      )[index]?.visibility === "primary"
  );
  if (primaryDecision === undefined)
    throw new Error("missing primary decision");
  const requestHash = calculateInboxV2IdentityClaimIntentDigest({
    ...intent,
    authorizationPlan: plan
  });
  const auditActionId =
    intent.kind === "manual_employee"
      ? "core:identity.claim.employee"
      : intent.kind === "manual_client_contact"
        ? "core:identity.claim.client_contact"
        : intent.kind === "manual_revoke"
          ? "core:identity.claim.revoke"
          : "core:identity.claim.auto_resolve";
  return {
    tenantId,
    occurredAt: NOW,
    command: {
      id: `command:${clientMutationId}`,
      clientMutationId,
      commandTypeId: "core:identity.claim",
      requestHash,
      actor,
      authorizationDecisionId: primaryDecision.id,
      authorizationEpoch: plan.currentAuthorization.authorizationEpoch,
      authorizedAt: NOW
    },
    revisions: {
      expectedTenantRbacRevision:
        plan.currentAuthorization.dependencies.tenantRbacRevision,
      expectedSharedAccessRevision:
        plan.currentAuthorization.dependencies.sharedAccessRevision,
      advanceTenantRbac: false,
      advanceSharedAccess: false,
      employees:
        actor.kind === "employee"
          ? [
              {
                employeeId: actor.employeeId,
                expectedEmployeeAccessRevision:
                  plan.currentAuthorization.dependencies.employeeAccessRevision,
                expectedEmployeeInboxRelationRevision:
                  plan.currentAuthorization.dependencies
                    .employeeInboxRelationRevision,
                advanceEmployeeAccess: false,
                advanceEmployeeInboxRelation: false
              }
            ]
          : [],
      resources: []
    },
    records: {
      mutationId: `mutation:${clientMutationId}`,
      relationKind: null,
      audit: {
        actionId: auditActionId,
        target: {
          tenantId,
          entityTypeId: "core:identity-claim-intent",
          entityId: inboxV2InternalOpaqueReferenceSchema.parse(
            `internal-ref:${requestHash.slice("sha256:".length)}`
          )
        },
        reasonCodeId: intent.transition.reasonCodeId,
        policyVersion: intent.transition.policyVersion,
        occurredAt: intent.transition.occurredAt,
        recordedAt: intent.transition.occurredAt,
        authorizationDecisionRefs: decisions,
        matchedPermissionIds: [
          ...new Set(plan.requirements.map(({ permissionId }) => permissionId))
        ].sort()
      }
    }
  } as unknown as WithInboxV2AuthorizedCommandMutationInput;
}

function preparerFor(prepared: InboxV2PreparedIdentityClaimCommand) {
  return {
    prepareEmployeeClaim: vi.fn(async () => prepared),
    prepareClientContactClaim: vi.fn(async () => prepared),
    prepareRevoke: vi.fn(async () => prepared),
    prepareAutomaticClaim: vi.fn(async () => prepared)
  };
}

function successfulRepository(
  transitionId: ApplyInboxV2SourceIdentityClaimTransitionInput["transitionId"]
): Pick<
  InboxV2SourceIdentityClaimRepository,
  "applyTransitionInAuthorizedContext"
> & {
  applyTransitionInAuthorizedContext: ReturnType<typeof vi.fn>;
} {
  return {
    applyTransitionInAuthorizedContext: vi.fn(async () => ({
      kind: "applied" as const,
      transition: { id: transitionId }
    }))
  } as never;
}

function inMemoryCoordinator(): InboxV2AuthorizedCommandCoordinator & {
  withAuthorizedCommandMutation: ReturnType<typeof vi.fn>;
} {
  const withAuthorizedCommandMutation = vi.fn(
    async (
      input: WithInboxV2AuthorizedCommandMutationInput,
      persist: (context: InboxV2AuthorizedCommandMutationContext) => Promise<{
        result: unknown;
      }>
    ) => {
      const result = await persist({
        executor: {
          async execute() {
            return { rows: [] };
          }
        },
        tenantId: input.tenantId,
        commandId: input.command.id,
        clientMutationId: input.command.clientMutationId,
        commandTypeId: input.command.commandTypeId,
        actor: input.command.actor,
        authorizationEpoch: input.command.authorizationEpoch,
        authorizationDecisionId: input.command.authorizationDecisionId,
        authorizationDecisionRefs:
          input.records.audit.authorizationDecisionRefs,
        authorizationResourceRevisionFences: input.revisions.resources,
        authorizedAt: input.command.authorizedAt,
        occurredAt: input.occurredAt,
        mutationId: input.records.mutationId,
        profile: "domain",
        revisionEffects: []
      });
      return {
        kind: "applied" as const,
        result: result.result,
        status: {
          commandId: input.command.id,
          mutationId: input.records.mutationId,
          publicResultCode: input.command.publicResultCode,
          resultReference: input.command.resultReference,
          sensitiveResultReference: null,
          streamCommitId: input.records.streamCommitId,
          streamEpoch: input.records.expectedStreamEpoch,
          streamPosition: "1",
          committedAt: input.occurredAt
        },
        revisionEffects: []
      };
    }
  );
  return { withAuthorizedCommandMutation } as never;
}

function rejectingDenialSink(): {
  attempts: InboxV2SecurityDenialAttempt[];
  sink: InboxV2SecurityDenialSink;
} {
  const attempts: InboxV2SecurityDenialAttempt[] = [];
  return {
    attempts,
    sink: {
      async record(attempt) {
        attempts.push(attempt);
        throw new Error("intentional test sink rejection");
      }
    }
  };
}

function denialContext(
  principalClass: "employee" | "trusted_service" = "employee"
): InboxV2SecurityDenialContext {
  const tenantScope = createInboxV2VerifiedSecurityTenantScope(tenantId);
  const actorStableKey =
    principalClass === "employee" ? actorEmployeeId : trustedServiceId;
  return {
    principalClass,
    tenantScope,
    fingerprints: createInboxV2SecurityDenialFingerprintProof({
      tenantId,
      action: "identity.claim",
      principalClass,
      fingerprintKeyEpoch: "security-denial-key:0123456789abcdef",
      hmacKey: new Uint8Array(32).fill(7),
      actorStableKey,
      dedupeStableKey: sourceExternalIdentityId
    }),
    reviewCandidateRef: inboxV2InternalOpaqueReferenceSchema.parse(
      `internal-ref:${"b".repeat(64)}`
    )
  };
}

function authorizationPlan(
  requirements: readonly InboxV2AuthorizationRequirement[],
  grants: readonly InboxV2PolicyGrant[]
): InboxV2AuthorizationPlanInput {
  const dependencies = dependenciesFor(requirements);
  const authorization = inboxV2AuthorizationEpochSnapshotSchema.parse({
    tenantId,
    employee: actorEmployee,
    value: epoch,
    dependencies,
    evaluatedAt: NOW,
    notAfter: LATER,
    nextAuthorizationBoundary: LATER
  });
  return {
    tenantId,
    evaluatedAt: NOW,
    principal: {
      kind: "employee",
      employee: actorEmployee,
      lifecycle: "active",
      session: { state: "active", authorization, notAfter: LATER }
    },
    currentAuthorization: {
      tenantId,
      principal: { kind: "employee", employeeId: actorEmployeeId },
      authorizationEpoch: epoch,
      dependencies
    },
    grants,
    requirements
  };
}

function trustedAuthorizationPlan(
  primaryRequirement: InboxV2AuthorizationRequirement
): InboxV2AuthorizationPlanInput {
  const requirements = [primaryRequirement];
  const dependencies = dependenciesFor(requirements);
  return {
    tenantId,
    evaluatedAt: NOW,
    principal: {
      kind: "trusted_service",
      tenantId,
      trustedServiceId,
      registrationState: "active",
      authorizationEpoch: epoch,
      dependencies,
      allowedPermissionIds: ["core:identity.auto_resolve"],
      notAfter: LATER
    },
    currentAuthorization: {
      tenantId,
      principal: { kind: "trusted_service", trustedServiceId },
      authorizationEpoch: epoch,
      dependencies
    },
    grants: [
      {
        id: "grant-auto-resolve",
        tenantId,
        principal: { kind: "trusted_service", trustedServiceId },
        permissionId: "core:identity.auto_resolve",
        catalogSchemaId: "core:inbox-v2.permission-scope-catalog",
        catalogVersion: "v1",
        scope: { type: "tenant", tenantId },
        source: {
          kind: "service_registration",
          origin: "inbox_v2_native",
          serviceRegistrationId: "identity-resolver",
          bindingResource: resource(
            "core:service-registration",
            "service_registration:identity-resolver"
          ),
          bindingRevision: revision
        },
        revision,
        validFrom: null,
        validUntil: LATER,
        revokedAt: null
      }
    ],
    requirements
  };
}

function requirement(
  overrides: Partial<InboxV2AuthorizationRequirement>
): InboxV2AuthorizationRequirement {
  return {
    id: "requirement",
    permissionId: "core:identity.source_identity.use",
    resource: sourceIdentityResource,
    resourceAccessRevision: "5",
    expectedResourceAccessRevision: "5",
    scopeFacts: [],
    revisionChecks: [],
    guard: {
      profileId: "core:rbac.guard.identity_evidence",
      targetResource: sourceIdentityResource,
      evidenceState: "verified",
      operation: {
        kind: "source_identity_use",
        actorEmployeeId,
        evidenceResource: sourceIdentityResource,
        revisionChecks: currentChecks("relation")
      }
    },
    visibility: "primary",
    authorizationSubject: { kind: "actor" },
    ...overrides
  };
}

function grant(
  permissionId: InboxV2PermissionId,
  suffix: string
): InboxV2PolicyGrant {
  return {
    id: `grant-${suffix}`,
    tenantId,
    principal: { kind: "employee", employeeId: actorEmployeeId },
    permissionId,
    catalogSchemaId: "core:inbox-v2.permission-scope-catalog",
    catalogVersion: "v1",
    scope: { type: "tenant", tenantId },
    source: {
      kind: "direct_grant",
      origin: "inbox_v2_native",
      directGrantId: `direct-${suffix}`,
      bindingResource: resource(
        "core:direct-grant",
        `direct_grant:direct-${suffix}`
      ),
      bindingRevision: revision
    },
    revision,
    validFrom: null,
    validUntil: LATER,
    revokedAt: null
  };
}

function dependenciesFor(
  requirements: readonly InboxV2AuthorizationRequirement[]
): InboxV2AuthorizationDependencyVector {
  const resources = new Map<string, InboxV2EntityKey>();
  for (const item of requirements) {
    resources.set(
      `${item.resource.entityTypeId}\0${item.resource.entityId}`,
      item.resource
    );
  }
  return inboxV2AuthorizationDependencyVectorSchema.parse({
    tenantRbacRevision: "1",
    employeeAccessRevision: "2",
    employeeInboxRelationRevision: "3",
    sharedAccessRevision: "4",
    resourceDependencies: [...resources.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([, item]) => ({
        resource: item,
        accessRevision: "5"
      })),
    temporalBoundaryDigest: DIGEST
  });
}

function resource(entityTypeId: string, entityId: string): InboxV2EntityKey {
  return inboxV2EntityKeySchema.parse({ tenantId, entityTypeId, entityId });
}

function currentChecks(
  kind: "entity" | "relation" | "policy"
): readonly [{ kind: typeof kind; expected: "1"; actual: "1" }] {
  return [{ kind, expected: "1", actual: "1" }];
}

function keyedCurrentChecks(resources: readonly InboxV2EntityKey[]) {
  return resources.map((item) => ({
    resource: item,
    expected: "1" as const,
    actual: "1" as const
  }));
}
