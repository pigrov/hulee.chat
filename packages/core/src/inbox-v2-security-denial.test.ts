import {
  INBOX_V2_SECURITY_DENIAL_POLICY,
  inboxV2AuthorizationDependencyVectorSchema,
  inboxV2AuthorizationEpochSchema,
  inboxV2AuthorizationEpochSnapshotSchema,
  inboxV2BigintCounterSchema,
  inboxV2EmployeeIdSchema,
  inboxV2EmployeeReferenceSchema,
  inboxV2EntityKeySchema,
  inboxV2EntityRevisionSchema,
  inboxV2InternalOpaqueReferenceSchema,
  inboxV2SecurityDenialShardForActorFingerprint,
  inboxV2SecurityDenialWindowForObservedAt,
  inboxV2TenantIdSchema,
  type InboxV2BigintCounter,
  type InboxV2InternalOpaqueReference,
  type InboxV2SecurityDenialAction,
  type InboxV2SecurityDenialAttempt,
  type InboxV2SecurityDenialResult,
  type InboxV2SecurityDenialReviewType
} from "@hulee/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  InboxV2AuthorizationInternalReason,
  InboxV2AuthorizationPlanInput,
  InboxV2AuthorizationPublicErrorCode,
  InboxV2AuthorizationRequirement,
  InboxV2PolicyGrant,
  InboxV2PolicyGuardEvidence
} from "./inbox-v2-authorization-policy";
import { evaluateInboxV2AuthorizationPlan } from "./inbox-v2-authorization-policy";
import {
  createInboxV2DeploymentSecurityTenantScope,
  createInboxV2SecurityDenialFingerprintProof,
  createInboxV2VerifiedSecurityTenantScope,
  executeInboxV2AuthorizationGate,
  planInboxV2SecurityDenial,
  tryObserveInboxV2SecurityDenial,
  type InboxV2DeniedAuthorizationDecision,
  type InboxV2SecurityDenialContext,
  type InboxV2SecurityDenialSink
} from "./inbox-v2-security-denial";

const tenantId = inboxV2TenantIdSchema.parse("tenant:security-denial-core");
const otherTenantId = inboxV2TenantIdSchema.parse(
  "tenant:security-denial-target"
);
const deploymentBucketTenantId = inboxV2TenantIdSchema.parse(
  "tenant:system.security-denial.test-deployment"
);
const employeeId = inboxV2EmployeeIdSchema.parse("employee:security-operator");
const employee = inboxV2EmployeeReferenceSchema.parse({
  tenantId,
  kind: "employee",
  id: employeeId
});
const employeeResource = inboxV2EntityKeySchema.parse({
  tenantId,
  entityTypeId: "core:employee",
  entityId: employeeId
});
const revision = inboxV2EntityRevisionSchema.parse("1");
const authorizationEpoch = inboxV2AuthorizationEpochSchema.parse(
  "authorization:security-denial-epoch"
);
const evaluatedAt = "2026-07-15T10:10:00.000Z";
const sinkObservedAt = "2026-07-15T10:20:00.000Z";
const notAfter = "2026-07-15T11:10:00.000Z";
const hmacKey = new Uint8Array(32).fill(0x5a);

afterEach(() => {
  vi.useRealTimers();
});

function denied(
  reason: InboxV2AuthorizationInternalReason = "hidden_target",
  publicErrorCode: InboxV2AuthorizationPublicErrorCode = "resource.not_found",
  action: InboxV2SecurityDenialAction = "resource.read",
  attribution: Readonly<{
    tenantId: typeof tenantId | null;
    principalClass: "employee" | "trusted_service" | "invalid_or_anonymous";
  }> = { tenantId, principalClass: "employee" }
): InboxV2DeniedAuthorizationDecision {
  return {
    outcome: "denied",
    tenantId,
    evaluatedAt,
    securityDenialAction: action,
    securityDenialTenantId: attribution.tenantId,
    securityDenialPrincipalClass: attribution.principalClass,
    publicErrorCode,
    diagnostics: { reason, failedRequirementId: "must-never-be-persisted" }
  };
}

function context(
  action: InboxV2SecurityDenialAction = "resource.read",
  overrides: Partial<InboxV2SecurityDenialContext> &
    Readonly<{
      actorStableKey?: string;
      dedupeStableKey?: string;
    }> = {}
): InboxV2SecurityDenialContext {
  const principalClass = overrides.principalClass ?? "employee";
  const tenantScope =
    overrides.tenantScope ?? createInboxV2VerifiedSecurityTenantScope(tenantId);
  const fingerprints =
    overrides.fingerprints ??
    createInboxV2SecurityDenialFingerprintProof({
      tenantId: tenantScope.tenantId,
      action,
      principalClass,
      fingerprintKeyEpoch: "security-denial-key:0123456789abcdef",
      hmacKey,
      actorStableKey: overrides.actorStableKey ?? "employee:security-operator",
      dedupeStableKey: overrides.dedupeStableKey ?? "opaque:attempt-target"
    });
  return {
    principalClass,
    tenantScope,
    fingerprints,
    reviewCandidateRef: overrides.reviewCandidateRef ?? null
  };
}

function storedResultForAttempt(
  attempt: InboxV2SecurityDenialAttempt,
  overrides: Partial<InboxV2SecurityDenialResult> = {}
): InboxV2SecurityDenialResult {
  const observedAt = overrides.observedAt ?? sinkObservedAt;
  const window = inboxV2SecurityDenialWindowForObservedAt(observedAt);
  return {
    observationReceipt: attempt.observationReceipt,
    tenantId: attempt.tenantId,
    observedAt,
    disposition: "recorded",
    shardNo: inboxV2SecurityDenialShardForActorFingerprint(
      attempt.actorFingerprint
    ),
    ...window,
    shardAttemptCount: counter("1"),
    detailOccurrenceCount: counter("1"),
    admittedDetailBucketCount: 1,
    overflowCount: counter("0"),
    counterSaturated: false,
    reviewWrites:
      attempt.reviewSignal === null
        ? []
        : [
            {
              reviewType: attempt.reviewSignal.reviewType,
              disposition: "candidate_created"
            }
          ],
    ...overrides
  };
}

function counter(value: string): InboxV2BigintCounter {
  return inboxV2BigintCounterSchema.parse(value);
}

function internalRef(hex: string): InboxV2InternalOpaqueReference {
  return inboxV2InternalOpaqueReferenceSchema.parse(`internal-ref:${hex}`);
}

function capturingSink() {
  const attempts: InboxV2SecurityDenialAttempt[] = [];
  const signals: AbortSignal[] = [];
  const sink: InboxV2SecurityDenialSink = {
    async record(attempt, options) {
      attempts.push(attempt);
      signals.push(options.signal);
      return storedResultForAttempt(attempt);
    }
  };
  return { attempts, signals, sink };
}

function permissionForAction(action: InboxV2SecurityDenialAction): string {
  const exact: Partial<Record<InboxV2SecurityDenialAction, string>> = {
    "privacy.hold.issue": "core:privacy.hold.issue",
    "privacy.hold.release": "core:privacy.hold.release",
    "privacy.subject_evidence.view": "core:privacy.subject_evidence.view",
    "privacy.tenant_export": "core:privacy.tenant_export",
    "privacy.deletion.preview": "core:privacy.deletion.preview",
    "privacy.deletion.approve": "core:privacy.deletion.approve",
    "privacy.deletion.execute": "core:privacy.deletion.execute",
    "identity.claim": "core:identity.employee_claim.manage",
    "authorization.privileged_mutation": "core:tenant.manage",
    "resource.mutate": "core:client.edit"
  };
  return exact[action] ?? "core:employee.directory.view";
}

function authorizationPlan(
  input: {
    allowed?: boolean;
    action?: InboxV2SecurityDenialAction;
  } = {}
): InboxV2AuthorizationPlanInput {
  const allowed = input.allowed ?? false;
  const action = input.action ?? "resource.read";
  const permissionId = permissionForAction(action);
  const primaryRequirement: InboxV2AuthorizationRequirement = Object.freeze({
    id: "protected-operation",
    permissionId,
    resource: employeeResource,
    resourceAccessRevision: "5",
    expectedResourceAccessRevision: "5",
    scopeFacts: Object.freeze([]),
    revisionChecks: Object.freeze([]),
    guard: Object.freeze({
      profileId: "core:rbac.guard.canonical_resource",
      resourceState: "active",
      contentBoundary: "external",
      routeInputFields: Object.freeze([]),
      companionRequirementIds: Object.freeze([]),
      action: Object.freeze({ kind: "canonical" as const })
    } satisfies InboxV2PolicyGuardEvidence),
    visibility: "primary",
    authorizationSubject: Object.freeze({ kind: "actor" as const })
  });
  const requirements: readonly InboxV2AuthorizationRequirement[] = allowed
    ? [primaryRequirement]
    : [
        primaryRequirement,
        Object.freeze({
          ...primaryRequirement,
          id: "protected-hidden-companion",
          visibility: "secondary_hidden" as const
        })
      ];
  const dependencies = inboxV2AuthorizationDependencyVectorSchema.parse({
    tenantRbacRevision: "1",
    employeeAccessRevision: "2",
    employeeInboxRelationRevision: "3",
    sharedAccessRevision: "4",
    resourceDependencies: [{ resource: employeeResource, accessRevision: "5" }],
    temporalBoundaryDigest: `sha256:${"a".repeat(64)}`
  });
  const authorization = inboxV2AuthorizationEpochSnapshotSchema.parse({
    tenantId,
    employee,
    value: authorizationEpoch,
    dependencies,
    evaluatedAt,
    notAfter,
    nextAuthorizationBoundary: notAfter
  });
  const grants: readonly InboxV2PolicyGrant[] = allowed
    ? [
        {
          id: "security-denial-test-grant",
          tenantId,
          principal: { kind: "employee", employeeId },
          permissionId: permissionId as Extract<
            InboxV2PolicyGrant,
            { principal: { kind: "employee" } }
          >["permissionId"],
          catalogSchemaId: "core:inbox-v2.permission-scope-catalog",
          catalogVersion: "v1",
          scope: { type: "tenant", tenantId },
          source: {
            kind: "direct_grant",
            origin: "inbox_v2_native",
            directGrantId: "direct-security-denial-test-grant",
            bindingResource: inboxV2EntityKeySchema.parse({
              tenantId,
              entityTypeId: "core:direct-grant",
              entityId: "direct_grant:direct-security-denial-test-grant"
            }),
            bindingRevision: revision
          },
          revision,
          validFrom: null,
          validUntil: notAfter,
          revokedAt: null
        }
      ]
    : [];
  return Object.freeze({
    tenantId,
    evaluatedAt,
    principal: Object.freeze({
      kind: "employee" as const,
      employee,
      lifecycle: "active" as const,
      session: Object.freeze({
        state: "active" as const,
        authorization,
        notAfter
      })
    }),
    currentAuthorization: Object.freeze({
      tenantId,
      principal: Object.freeze({ kind: "employee" as const, employeeId }),
      authorizationEpoch,
      dependencies
    }),
    grants: Object.freeze(grants),
    requirements: Object.freeze(requirements)
  });
}

async function successfulObservation(): Promise<void> {
  await tryObserveInboxV2SecurityDenial({
    decision: denied(),
    context: context(),
    sink: {
      async record(attempt) {
        return storedResultForAttempt(attempt);
      }
    }
  });
}

describe("Inbox V2 bounded security-denial application boundary", () => {
  it("classifies hidden and cross-tenant targets without retaining target IDs", () => {
    const hidden = planInboxV2SecurityDenial({
      decision: denied("hidden_target", "resource.not_found"),
      context: context()
    });
    const crossTenantDecision = {
      ...denied("tenant_boundary_mismatch", "resource.not_found"),
      tenantId: otherTenantId
    };
    const crossTenant = planInboxV2SecurityDenial({
      decision: crossTenantDecision,
      context: context()
    });

    expect(hidden).toMatchObject({
      denialKind: "unknown_or_hidden_resource",
      publicErrorClass: "not_found",
      risk: "high",
      reviewSignal: { reviewType: "guessed_identifier_probe" }
    });
    expect(crossTenant).toMatchObject({
      tenantId,
      denialKind: "cross_tenant_probe",
      publicErrorClass: "not_found",
      risk: "critical",
      reviewSignal: { reviewType: "cross_tenant_probe" }
    });
    for (const value of [hidden, crossTenant]) {
      expect(JSON.stringify(value)).not.toContain("must-never-be-persisted");
      expect(value).not.toHaveProperty("targetId");
      expect(value).not.toHaveProperty("failedRequirementId");
      expect(value).not.toHaveProperty("occurredAt");
      expect(value).not.toHaveProperty("decisionEvaluatedAt");
      expect(value.observationReceipt).toMatch(
        /^security-denial-observation:[a-f0-9]{64}$/u
      );
    }
  });

  it("builds stable tenant/purpose/actor-bound HMACs and one canonical shard", () => {
    const firstContext = context();
    const sameContext = context();
    const otherActorContext = context("resource.read", {
      actorStableKey: "employee:other"
    });
    const otherActionContext = context("resource.mutate");
    const first = planInboxV2SecurityDenial({
      decision: denied(),
      context: firstContext
    });
    const same = planInboxV2SecurityDenial({
      decision: denied(),
      context: sameContext
    });
    const otherActor = planInboxV2SecurityDenial({
      decision: denied(),
      context: otherActorContext
    });
    const otherAction = planInboxV2SecurityDenial({
      decision: denied(
        "hidden_target",
        "resource.not_found",
        "resource.mutate"
      ),
      context: otherActionContext
    });

    expect(first.dedupeFingerprint).toBe(same.dedupeFingerprint);
    expect(first.observationReceipt).not.toBe(same.observationReceipt);
    expect(otherActorContext.fingerprints.actorFingerprint).not.toBe(
      firstContext.fingerprints.actorFingerprint
    );
    expect(otherActor.dedupeFingerprint).not.toBe(first.dedupeFingerprint);
    expect(otherActionContext.fingerprints.actorFingerprint).toBe(
      firstContext.fingerprints.actorFingerprint
    );
    expect(otherAction.dedupeFingerprint).not.toBe(first.dedupeFingerprint);
    expect(
      inboxV2SecurityDenialShardForActorFingerprint(first.actorFingerprint)
    ).toBe(
      Number.parseInt(first.actorFingerprint.slice(12, 20), 16) %
        INBOX_V2_SECURITY_DENIAL_POLICY.shardCount
    );
    expect(() =>
      createInboxV2SecurityDenialFingerprintProof({
        tenantId,
        action: "resource.read",
        principalClass: "employee",
        fingerprintKeyEpoch: "security-denial-key:0123456789abcdef",
        hmacKey: new Uint8Array(16),
        actorStableKey: "actor",
        dedupeStableKey: "target"
      })
    ).toThrow(/at least 32 bytes/u);
  });

  it("includes the stored denial classification in the dedupe bucket identity", () => {
    const hidden = planInboxV2SecurityDenial({
      decision: denied("hidden_target", "resource.not_found"),
      context: context()
    });
    const missingPermission = planInboxV2SecurityDenial({
      decision: denied("missing_permission", "permission.denied"),
      context: context()
    });

    expect(hidden).toMatchObject({
      denialKind: "unknown_or_hidden_resource",
      publicErrorClass: "not_found"
    });
    expect(missingPermission).toMatchObject({
      denialKind: "missing_permission",
      publicErrorClass: "permission_denied"
    });
    expect(missingPermission.dedupeFingerprint).not.toBe(
      hidden.dedupeFingerprint
    );
  });

  it("uses the canonical self-claim error and one reviewable candidate", () => {
    const candidateRef = internalRef("c".repeat(32));
    const attempt = planInboxV2SecurityDenial({
      decision: denied(
        "separation_of_duties_denied",
        "identity.claim_self_forbidden",
        "identity.claim"
      ),
      context: context("identity.claim", { reviewCandidateRef: candidateRef })
    });
    expect(attempt).toMatchObject({
      denialKind: "manual_self_claim",
      publicErrorClass: "identity_claim_self_forbidden",
      reviewSignal: {
        reviewType: "manual_self_claim",
        alertType: "identity_claim_review",
        candidateRef
      }
    });
  });

  it("derives every lifecycle review from the authorization action and redacts refs", () => {
    const matrix: readonly [
      InboxV2SecurityDenialAction,
      InboxV2SecurityDenialReviewType,
      "high" | "critical"
    ][] = [
      ["privacy.hold.issue", "privacy_hold_issue_denied", "high"],
      ["privacy.hold.release", "privacy_hold_release_denied", "high"],
      [
        "privacy.subject_evidence.view",
        "privacy_evidence_access_denied",
        "high"
      ],
      ["privacy.tenant_export", "tenant_export_denied", "high"],
      ["privacy.deletion.preview", "destructive_preview_denied", "high"],
      ["privacy.deletion.approve", "destructive_approval_denied", "high"],
      ["privacy.deletion.execute", "destructive_execution_denied", "critical"]
    ];
    for (const [action, reviewType, risk] of matrix) {
      expect(
        evaluateInboxV2AuthorizationPlan(authorizationPlan({ action }))
      ).toMatchObject({
        outcome: "denied",
        securityDenialAction: action
      });
      expect(
        planInboxV2SecurityDenial({
          decision: denied("missing_permission", "permission.denied", action),
          context: context(action, {
            reviewCandidateRef: internalRef("d".repeat(32))
          })
        })
      ).toMatchObject({
        action,
        risk,
        reviewSignal: {
          reviewType,
          alertType: "privacy_control_review",
          candidateRef: null
        }
      });
    }
    for (const action of [
      "authorization.privileged_mutation",
      "identity.claim",
      "resource.mutate"
    ] as const) {
      expect(
        evaluateInboxV2AuthorizationPlan(authorizationPlan({ action }))
      ).toMatchObject({ outcome: "denied", securityDenialAction: action });
    }
  });

  it("binds sink results to the exact attempt and rejects foreign/coherence drift", async () => {
    await successfulObservation();
    const health = vi.fn();
    const observation = await tryObserveInboxV2SecurityDenial({
      decision: denied(),
      context: context(),
      sink: {
        async record(attempt) {
          return storedResultForAttempt(attempt, { tenantId: otherTenantId });
        }
      },
      reportHealth: health
    });
    expect(observation).toEqual({
      outcome: "sink_unavailable",
      failureClass: "invalid_result"
    });
    expect(health).toHaveBeenCalledWith(
      expect.objectContaining({ failureClass: "invalid_result" })
    );
  });

  it("rejects a cached result from a previous denial observation", async () => {
    await successfulObservation();
    const cachedAttempt = planInboxV2SecurityDenial({
      decision: denied(),
      context: context()
    });
    const cachedResult = storedResultForAttempt(cachedAttempt);

    await expect(
      tryObserveInboxV2SecurityDenial({
        decision: denied(),
        context: context(),
        sink: {
          async record() {
            return cachedResult;
          }
        }
      })
    ).resolves.toEqual({
      outcome: "sink_unavailable",
      failureClass: "invalid_result"
    });
  });

  it("does not let a sink mutate the attempt to validate a cached result", async () => {
    await successfulObservation();
    const cachedAttempt = planInboxV2SecurityDenial({
      decision: denied(),
      context: context()
    });
    const cachedResult = storedResultForAttempt(cachedAttempt);
    let mutationApplied: boolean | undefined;

    await expect(
      tryObserveInboxV2SecurityDenial({
        decision: denied(),
        context: context(),
        sink: {
          async record(attempt) {
            mutationApplied = Reflect.set(
              attempt,
              "observationReceipt",
              cachedAttempt.observationReceipt
            );
            return cachedResult;
          }
        }
      })
    ).resolves.toEqual({
      outcome: "sink_unavailable",
      failureClass: "invalid_result"
    });
    expect(mutationApplied).toBe(false);
  });

  it("lets only the sink receive time anchor the persisted window", async () => {
    await successfulObservation();
    const callerSelectedPolicyTime = "2099-12-31T23:59:59.000Z";
    const dbObservedAt = "2026-07-16T03:25:00.000Z";
    let capturedAttempt: InboxV2SecurityDenialAttempt | undefined;
    const observation = await tryObserveInboxV2SecurityDenial({
      decision: { ...denied(), evaluatedAt: callerSelectedPolicyTime },
      context: context(),
      sink: {
        async record(attempt) {
          capturedAttempt = attempt;
          return storedResultForAttempt(attempt, { observedAt: dbObservedAt });
        }
      }
    });

    expect(capturedAttempt).not.toHaveProperty("occurredAt");
    expect(capturedAttempt).not.toHaveProperty("decisionEvaluatedAt");
    expect(observation).toMatchObject({
      outcome: "recorded",
      result: {
        observedAt: dbObservedAt,
        windowStartedAt: "2026-07-16T03:00:00.000Z",
        windowEndedAt: "2026-07-16T04:00:00.000Z"
      }
    });
    expect(JSON.stringify(capturedAttempt)).not.toContain(
      callerSelectedPolicyTime
    );
  });

  it("owns authorization evaluation and never executes protected work after denial", async () => {
    await successfulObservation();
    const { attempts, sink } = capturingSink();
    const commandClaim = vi.fn();
    const pagination = vi.fn();
    const artifact = vi.fn();
    const mutation = vi.fn();
    const executeAllowed = vi.fn(async () => {
      commandClaim();
      pagination();
      artifact();
      mutation();
      return "must-not-run";
    });
    const onDenialObserved = vi.fn();

    const result = await executeInboxV2AuthorizationGate({
      authorizationPlan: authorizationPlan(),
      denialContext: context(),
      denialSink: sink,
      executeAllowed,
      onDenialObserved
    });

    expect(result).toEqual({
      outcome: "denied",
      publicDecision: { outcome: "denied", errorCode: "resource.not_found" }
    });
    expect(result).not.toHaveProperty("observation");
    expect(onDenialObserved).toHaveBeenCalledWith({
      outcome: "recorded",
      result: expect.any(Object)
    });
    expect(attempts).toHaveLength(1);
    expect(executeAllowed).not.toHaveBeenCalled();
    expect(commandClaim).not.toHaveBeenCalled();
    expect(pagination).not.toHaveBeenCalled();
    expect(artifact).not.toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
  });

  it("executes allowed domain work exactly once without observing a denial", async () => {
    const sink = { record: vi.fn() } as unknown as InboxV2SecurityDenialSink;
    const executeAllowed = vi.fn(async () => "ok");
    const plan = authorizationPlan({ allowed: true });
    const preflight = evaluateInboxV2AuthorizationPlan(plan);
    expect(preflight, JSON.stringify(preflight)).toMatchObject({
      outcome: "allowed"
    });
    await expect(
      executeInboxV2AuthorizationGate({
        authorizationPlan: plan,
        denialContext: context(),
        denialSink: sink,
        executeAllowed
      })
    ).resolves.toMatchObject({ outcome: "allowed", value: "ok" });
    expect(sink.record).not.toHaveBeenCalled();
    expect(executeAllowed).toHaveBeenCalledTimes(1);
  });

  it("binds the lifecycle action to the same plan that produced the denial", async () => {
    await successfulObservation();
    const sink = { record: vi.fn() } as unknown as InboxV2SecurityDenialSink;
    const observed = vi.fn();
    const result = await executeInboxV2AuthorizationGate({
      authorizationPlan: authorizationPlan({
        action: "privacy.deletion.execute"
      }),
      denialContext: context("resource.read"),
      denialSink: sink,
      executeAllowed: vi.fn(async () => "no"),
      onDenialObserved: observed
    });
    expect(result).toEqual({
      outcome: "denied",
      publicDecision: { outcome: "denied", errorCode: "resource.not_found" }
    });
    expect(sink.record).not.toHaveBeenCalled();
    expect(observed).toHaveBeenCalledWith({
      outcome: "sink_unavailable",
      failureClass: "invalid_attempt"
    });
  });

  it("keeps the public denial stable when a sink rejects or throws synchronously", async () => {
    await successfulObservation();
    for (const sink of [
      {
        async record() {
          throw new Error("database unavailable with sensitive diagnostics");
        }
      },
      {
        record(): Promise<InboxV2SecurityDenialResult> {
          throw new Error("synchronous adapter throw with secret");
        }
      }
    ]) {
      const health = vi.fn();
      const observed = vi.fn();
      const result = await executeInboxV2AuthorizationGate({
        authorizationPlan: authorizationPlan(),
        denialContext: context(),
        denialSink: sink,
        executeAllowed: vi.fn(async () => "no"),
        reportHealth: health,
        onDenialObserved: observed
      });
      expect(result).toEqual({
        outcome: "denied",
        publicDecision: { outcome: "denied", errorCode: "resource.not_found" }
      });
      expect(observed).toHaveBeenCalledWith({
        outcome: "sink_unavailable",
        failureClass: "sink_rejected"
      });
      expect(JSON.stringify(health.mock.calls)).not.toMatch(
        /sensitive|secret/u
      );
      await successfulObservation();
    }
  });

  it("aborts a timed-out sink while preserving a stable denial", async () => {
    await successfulObservation();
    vi.useFakeTimers();
    let observedSignal: AbortSignal | undefined;
    const pending = tryObserveInboxV2SecurityDenial({
      decision: denied(),
      context: context(),
      sink: {
        record(_attempt, options) {
          observedSignal = options.signal;
          return new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () =>
              reject(new Error("aborted"))
            );
          });
        }
      },
      timeoutMilliseconds: 10
    });
    await vi.advanceTimersByTimeAsync(11);
    await expect(pending).resolves.toEqual({
      outcome: "sink_unavailable",
      failureClass: "sink_timeout"
    });
    expect(observedSignal?.aborted).toBe(true);
    await Promise.resolve();
  });

  it("uses a deployment bucket for anonymous denial attribution", () => {
    const tenantScope =
      createInboxV2DeploymentSecurityTenantScope("test-deployment");
    const anonymousContext = context("resource.read", {
      principalClass: "invalid_or_anonymous",
      tenantScope
    });
    const attempt = planInboxV2SecurityDenial({
      decision: denied(
        "principal_invalid",
        "auth.session_invalid",
        "resource.read",
        {
          tenantId: null,
          principalClass: "invalid_or_anonymous"
        }
      ),
      context: anonymousContext
    });
    expect(attempt.tenantId).toBe(deploymentBucketTenantId);
    expect(attempt.tenantId).not.toBe(otherTenantId);
    expect(() =>
      createInboxV2DeploymentSecurityTenantScope(String(otherTenantId))
    ).toThrow(/bootstrap identifier/u);
  });

  it("opens a short circuit after consecutive failures and recovers after cooldown", async () => {
    await successfulObservation();
    vi.useFakeTimers();
    const sink: InboxV2SecurityDenialSink = {
      async record() {
        throw new Error("down");
      }
    };
    for (let index = 0; index < 3; index += 1) {
      await expect(
        tryObserveInboxV2SecurityDenial({
          decision: denied(),
          context: context(),
          sink
        })
      ).resolves.toMatchObject({ failureClass: "sink_rejected" });
    }
    await expect(
      tryObserveInboxV2SecurityDenial({
        decision: denied(),
        context: context(),
        sink
      })
    ).resolves.toEqual({
      outcome: "sink_unavailable",
      failureClass: "circuit_open"
    });
    await vi.advanceTimersByTimeAsync(
      INBOX_V2_SECURITY_DENIAL_POLICY.circuitCooldownMilliseconds + 1
    );
    await successfulObservation();
  });

  it("coalesces and caps never-settling health and observation callbacks", async () => {
    await successfulObservation();
    vi.useFakeTimers();
    const never = new Promise<void>(() => undefined);
    const reportHealth = vi.fn(() => never);
    const onDenialObserved = vi.fn(() => never);
    const rejectingSink: InboxV2SecurityDenialSink = {
      async record() {
        throw new Error("telemetry-bound-test");
      }
    };

    for (let index = 0; index < 20; index += 1) {
      await executeInboxV2AuthorizationGate({
        authorizationPlan: authorizationPlan(),
        denialContext: context(),
        denialSink: rejectingSink,
        executeAllowed: vi.fn(async () => "no"),
        reportHealth,
        onDenialObserved
      });
    }

    expect(reportHealth).toHaveBeenCalledTimes(2);
    expect(onDenialObserved).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(
      INBOX_V2_SECURITY_DENIAL_POLICY.circuitCooldownMilliseconds + 1
    );
    await successfulObservation();
  });

  it("caps hung work process-wide even when every request creates a new sink wrapper", async () => {
    await successfulObservation();
    vi.useFakeTimers();
    const invocations: number[] = [];
    const never = new Promise<void>(() => undefined);
    const reportHealth = vi.fn(() => never);
    const observations = Array.from(
      { length: INBOX_V2_SECURITY_DENIAL_POLICY.maxInFlightObservations + 1 },
      (_, index) =>
        tryObserveInboxV2SecurityDenial({
          decision: denied(),
          context: context(),
          sink: {
            record() {
              invocations.push(index);
              return new Promise(() => undefined);
            }
          },
          timeoutMilliseconds: 10,
          reportHealth
        })
    );
    await Promise.resolve();
    await expect(observations.at(-1)).resolves.toEqual({
      outcome: "sink_unavailable",
      failureClass: "sink_overloaded"
    });
    expect(invocations).toHaveLength(
      INBOX_V2_SECURITY_DENIAL_POLICY.maxInFlightObservations
    );
    const overloadFlood = await Promise.all(
      Array.from({ length: 1_000 }, (_, index) =>
        tryObserveInboxV2SecurityDenial({
          decision: denied(),
          context: context("resource.read", {
            dedupeStableKey: `opaque:flood-${index}`
          }),
          sink: {
            record() {
              return new Promise(() => undefined);
            }
          },
          timeoutMilliseconds: 10,
          reportHealth
        })
      )
    );
    expect(
      overloadFlood.every(
        (observation) =>
          observation.outcome === "sink_unavailable" &&
          observation.failureClass === "sink_overloaded"
      )
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(11);
    await expect(Promise.all(observations.slice(0, -1))).resolves.toHaveLength(
      INBOX_V2_SECURITY_DENIAL_POLICY.maxInFlightObservations
    );
    expect(reportHealth).toHaveBeenCalledTimes(2);
  });
});
