import { describe, expect, it } from "vitest";

import {
  INBOX_V2_OUTBOUND_ROUTE_RESOLUTION_COMMIT_SCHEMA_ID,
  INBOX_V2_OUTBOUND_ROUTE_RESOLUTION_INPUT_SCHEMA_ID,
  INBOX_V2_OUTBOUND_ROUTE_SCHEMA_ID,
  INBOX_V2_OUTBOUND_ROUTE_SCHEMA_VERSION,
  INBOX_V2_OUTBOUND_ROUTE_SELECTION_RESULT_SCHEMA_ID,
  INBOX_V2_THREAD_ROUTE_POLICY_SCHEMA_ID,
  inboxV2ConversationRouteAuthorizationDecisionSchema,
  inboxV2OutboundRouteCandidateSnapshotSchema,
  inboxV2OutboundRouteEnvelopeSchema,
  inboxV2OutboundRouteResolutionCommitEnvelopeSchema,
  inboxV2OutboundRouteResolutionCommitSchema,
  inboxV2OutboundRouteResolutionInputEnvelopeSchema,
  inboxV2OutboundRouteResolutionInputSchema,
  inboxV2OutboundRouteSchema,
  inboxV2OutboundRouteSelectionResultEnvelopeSchema,
  inboxV2SourceAccountRouteAuthorizationDecisionSchema,
  inboxV2ThreadRoutePolicyEnvelopeSchema,
  inboxV2ThreadRoutePolicySchema,
  materializeInboxV2OutboundRouteResolutionCommit,
  resolveInboxV2OutboundRoute
} from "./outbound-route";

const tenantId = "tenant:tenant-1";
const otherTenantId = "tenant:tenant-2";
const loadedAt = "2026-07-11T10:00:00.000Z";
const requestedAt = "2026-07-11T10:01:00.000Z";
const createdAt = "2026-07-11T10:02:00.000Z";
const notAfter = "2026-07-11T11:00:00.000Z";

function reference(kind: string, id: string, tenant = tenantId) {
  return { tenantId: tenant, kind, id };
}

const conversation = reference("conversation", "conversation:conversation-1");
const externalThread = reference("external_thread", "external_thread:thread-1");
const principal = {
  kind: "employee",
  employee: reference("employee", "employee:employee-1")
} as const;
const adapterContract = {
  contractId: "module:synthetic-source:direct-contract",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "module:synthetic-source:group-surface",
  loadedByTrustedServiceId: "core:source-runtime",
  loadedAt
} as const;
const bindingFence = {
  accountGeneration: "1",
  bindingGeneration: "1",
  remoteAccessRevision: "2",
  administrativeRevision: "3",
  capabilityRevision: "4",
  routeDescriptorRevision: "5"
} as const;
const operationId = "core:reply";
const contentKindId = "core:text";
const authorizationEpoch = "authorization:epoch-0001";
const replyPermissionId = "core:message.reply_external";
const sendPermissionId = "core:message.forward_external";

function binding(suffix: string) {
  return reference(
    "source_thread_binding",
    `source_thread_binding:binding-${suffix}`
  );
}

function account(suffix: string) {
  return reference("source_account", `source_account:account-${suffix}`);
}

function connection(suffix: string) {
  return reference(
    "source_connection",
    `source_connection:connection-${suffix}`
  );
}

const routePolicyReference = reference(
  "thread_route_policy",
  "thread_route_policy:policy-1"
);

function policy(input?: {
  preferred?: ReturnType<typeof binding> | null;
  fallback?: ReturnType<typeof binding>[];
  requiredPermissionId?: string;
}) {
  return {
    tenantId,
    id: "thread_route_policy:policy-1",
    conversation,
    externalThread,
    operationId,
    contentKindId,
    policyId: "core:ordered-explicit-policy",
    requiredConversationPermissionId:
      input?.requiredPermissionId ?? replyPermissionId,
    preferredBinding: input?.preferred ?? null,
    fallback:
      input?.fallback === undefined
        ? { kind: "none" as const }
        : {
            kind: "ordered_allowlist" as const,
            allowedBindings: input.fallback
          },
    revision: "7",
    createdAt: loadedAt,
    updatedAt: loadedAt
  };
}

function routeDescriptor(suffix: string) {
  return {
    adapterContract,
    descriptorSchemaId: "module:synthetic-source:group-route",
    descriptorVersion: "v1",
    descriptorRevision: "5",
    destinationKindId: "module:synthetic-source:group-peer",
    destinationSubject: `Group-${suffix}`,
    attributes: [],
    descriptorDigestSha256:
      suffix === "b"
        ? "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  } as const;
}

function occurrenceDescriptor(adapterMismatch = false) {
  return {
    adapterContract: adapterMismatch
      ? { ...adapterContract, declarationRevision: "99" as const }
      : adapterContract,
    descriptorSchemaId: "module:synthetic-source:message-occurrence",
    descriptorVersion: "v1",
    capabilityRevision: "4",
    providerReferences: [
      {
        kindId: "module:synthetic-source:provider-message-id",
        subject: "provider-message-1"
      },
      {
        kindId: "module:synthetic-source:quoted-context-token",
        subject: "opaque-quoted-context-token"
      }
    ],
    descriptorDigestSha256:
      "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  } as const;
}

function authorizationTarget(
  suffix: string,
  referenceTarget: Record<string, unknown> = { kind: "none" }
) {
  return {
    conversation,
    externalThread,
    sourceThreadBinding: binding(suffix),
    sourceAccount: account(suffix),
    sourceConnection: connection(suffix),
    operationId,
    contentKindId,
    authorizationEpoch,
    bindingFence,
    referenceTarget
  };
}

function candidate(
  suffix: string,
  input?: {
    eligibility?: Record<string, unknown>;
    runtimeState?: "unknown" | "ready" | "degraded" | "unavailable";
    decisionNotAfter?: string;
    conversationPermissionId?: string;
    referenceTarget?: Record<string, unknown>;
    principal?: typeof principal;
  }
) {
  const runtimeState = input?.runtimeState ?? "ready";
  const routePrincipal = input?.principal ?? principal;
  const target = authorizationTarget(suffix, input?.referenceTarget);
  const decisionExpiry = input?.decisionNotAfter ?? notAfter;
  const conversationPermission =
    input?.conversationPermissionId ?? replyPermissionId;
  const decisionBase = {
    tenantId,
    principal: routePrincipal,
    target,
    effect: "allow" as const,
    decisionRevision: "1",
    loadedByTrustedServiceId: "core:authorization-service",
    decidedAt: loadedAt,
    notAfter: decisionExpiry
  };

  return {
    tenantId,
    conversation,
    externalThread,
    sourceThreadBinding: binding(suffix),
    sourceAccount: account(suffix),
    sourceConnection: connection(suffix),
    operationId,
    contentKindId,
    authorizationEpoch,
    bindingFence,
    adapterContract,
    routeDescriptor: routeDescriptor(suffix),
    conversationAuthorization: {
      ...decisionBase,
      decisionKind: "conversation_action" as const,
      requiredPermissionId: conversationPermission,
      matchedPermissionIds: [conversationPermission],
      decisionToken: `decision:conversation-${suffix}`
    },
    sourceAccountAuthorization: {
      ...decisionBase,
      decisionKind: "source_account_use" as const,
      requiredPermissionId: "core:source_account.use" as const,
      matchedPermissionIds: ["core:source_account.use"],
      decisionToken: `decision:source-account-${suffix}`
    },
    eligibility: input?.eligibility ?? { state: "eligible" as const },
    runtimeObservation: {
      state: runtimeState,
      revision: "9",
      observedAt: loadedAt,
      diagnostic:
        runtimeState === "degraded" || runtimeState === "unavailable"
          ? {
              codeId: "core:runtime-unavailable",
              retryable: true,
              correlationToken: `runtime:diagnostic-${suffix}`,
              safeOperatorHintId: null
            }
          : null
    }
  };
}

function routeError(
  code:
    | "route.not_found"
    | "route.ambiguous"
    | "route.inactive"
    | "route.reference_unavailable"
    | "route.reference_nonportable"
    | "route.reply_window_expired"
    | "route.runtime_unavailable"
) {
  const retryability =
    code === "route.runtime_unavailable" ? "retryable_same_route" : "terminal";
  return { code, retryability, diagnostic: null } as const;
}

function snapshot(input?: {
  count?: number;
  explicit?: ReturnType<typeof candidate> | null;
  preferred?: ReturnType<typeof candidate> | null;
  sole?: ReturnType<typeof candidate> | null;
  fallback?: {
    candidate: ReturnType<typeof candidate>;
    policyOrdinal: number;
  } | null;
  zeroError?: ReturnType<typeof routeError> | null;
}) {
  const count = input?.count ?? 1;
  return {
    tenantId,
    conversation,
    externalThread,
    operationId,
    contentKindId,
    authorizationEpoch,
    routePolicy: routePolicyReference,
    routePolicyRevision: "7",
    automaticCompatibleEligibleCount: count,
    explicitTarget: input?.explicit ?? null,
    preferredCandidate: input?.preferred ?? null,
    soleEligibleCandidate:
      input?.sole === undefined
        ? count === 1
          ? candidate("a")
          : null
        : input.sole,
    fallbackCandidate: input?.fallback ?? null,
    zeroCandidateError:
      input?.zeroError === undefined
        ? count === 0
          ? routeError("route.not_found")
          : null
        : input.zeroError,
    snapshotToken: "snapshot:route-candidates-0001",
    loadedByTrustedServiceId: "core:route-resolver",
    loadedAt,
    notAfter
  };
}

function resolutionInput(input?: {
  intent?: Record<string, unknown>;
  referenceContext?: Record<string, unknown>;
  routePolicy?: ReturnType<typeof policy>;
  candidates?: ReturnType<typeof snapshot>;
  requestedAt?: string;
}) {
  return {
    tenantId,
    principal,
    conversation,
    externalThread,
    operationId,
    contentKindId,
    authorizationEpoch,
    intent: input?.intent ?? { kind: "automatic" },
    referenceContext: input?.referenceContext ?? { kind: "none" },
    routePolicy: input?.routePolicy ?? policy(),
    candidates: input?.candidates ?? snapshot(),
    mutationToken: "mutation:route-0001",
    idempotencyToken: "idempotency:route-0001",
    correlationToken: "correlation:route-0001",
    requestedAt: input?.requestedAt ?? requestedAt
  };
}

function externalReferenceContext(input?: {
  portability?: "binding_only" | "external_thread" | "provider_global";
  availability?:
    | "available"
    | "provider_deleted"
    | "provider_unavailable"
    | "unknown";
  availabilityObservedAt?: string;
  availabilityDescriptorDigestSha256?: string;
  availabilityObserverMismatch?: boolean;
  descriptorAdapterMismatch?: boolean;
  referenceWindow?:
    | { state: "not_applicable" }
    | { state: "valid"; notAfter: string }
    | { state: "expired"; expiredAt: string };
}) {
  const externalMessageReference = reference(
    "external_message_reference",
    "external_message_reference:message-1"
  );
  const sourceOccurrence = reference(
    "source_occurrence",
    "source_occurrence:occurrence-1"
  );
  const originBinding = binding("a");
  const originSourceAccount = account("a");
  const portability = {
    kind: input?.portability ?? "binding_only",
    adapterContract,
    decisionStrength:
      input?.portability === "external_thread" ||
      input?.portability === "provider_global"
        ? ("authoritative" as const)
        : ("safe_default" as const)
  };
  const descriptor = occurrenceDescriptor(input?.descriptorAdapterMismatch);
  return {
    kind: "external_message" as const,
    externalThread,
    externalMessageReference,
    sourceOccurrence,
    originBinding,
    originSourceAccount,
    portability,
    resolutionDecision: {
      decisionKind: "external_message_reference_resolution" as const,
      tenantId,
      externalThread,
      externalMessageReference,
      sourceOccurrence,
      originBinding,
      originSourceAccount,
      occurrenceRevision: "3",
      occurrenceBindingGeneration: "1",
      occurrenceDescriptor: descriptor,
      portability,
      availabilityObservation: {
        observationKind: "external_message_reference_availability" as const,
        tenantId,
        externalThread,
        externalMessageReference,
        sourceOccurrence,
        occurrenceRevision: "3",
        occurrenceDescriptorDigestSha256:
          input?.availabilityDescriptorDigestSha256 ??
          descriptor.descriptorDigestSha256,
        adapterContract,
        state: input?.availability ?? ("available" as const),
        diagnostic: null,
        observationToken: "observation:reference-availability-0001",
        observedByTrustedServiceId: input?.availabilityObserverMismatch
          ? "core:forged-reference-observer"
          : adapterContract.loadedByTrustedServiceId,
        observedAt: input?.availabilityObservedAt ?? loadedAt,
        notAfter
      },
      referenceWindow: input?.referenceWindow ?? {
        state: "valid" as const,
        notAfter
      },
      decisionToken: "decision:reference-resolution-0001",
      decisionRevision: "1",
      loadedByTrustedServiceId: "core:reference-resolver",
      decidedAt: loadedAt,
      notAfter
    }
  };
}

function candidateForReference(
  suffix: string,
  context: ReturnType<typeof externalReferenceContext>,
  input?: Parameters<typeof candidate>[1]
) {
  return candidate(suffix, {
    ...input,
    referenceTarget: {
      kind: "external_message",
      externalMessageReference: context.externalMessageReference,
      sourceOccurrence: context.sourceOccurrence
    }
  });
}

function immutableRoute(
  input: ReturnType<typeof resolutionInput>,
  selected: Extract<
    ReturnType<typeof resolveInboxV2OutboundRoute>,
    { kind: "selected" }
  >
) {
  const routeCandidate = selected.candidate;
  return {
    tenantId,
    id: "outbound_route:route-1",
    principal,
    conversation,
    externalThread,
    sourceThreadBinding: routeCandidate.sourceThreadBinding,
    sourceAccount: routeCandidate.sourceAccount,
    sourceConnection: routeCandidate.sourceConnection,
    operationId,
    contentKindId,
    authorizationEpoch,
    requiredConversationPermissionId:
      input.routePolicy.requiredConversationPermissionId,
    bindingFence: routeCandidate.bindingFence,
    adapterContract: routeCandidate.adapterContract,
    routeDescriptor: routeCandidate.routeDescriptor,
    routePolicy: routePolicyReference,
    routePolicyRevision: "7",
    conversationAuthorization: routeCandidate.conversationAuthorization,
    sourceAccountAuthorization: routeCandidate.sourceAccountAuthorization,
    referenceContext: input.referenceContext,
    runtimeObservationAtResolution: routeCandidate.runtimeObservation,
    selection: {
      intent: input.intent,
      reason: selected.selectionReason,
      candidateSnapshotToken: input.candidates.snapshotToken,
      candidateSnapshotNotAfter: input.candidates.notAfter,
      fallbackPolicyOrdinal: selected.fallbackPolicyOrdinal,
      selectedAt: createdAt
    },
    mutationToken: input.mutationToken,
    idempotencyToken: input.idempotencyToken,
    correlationToken: input.correlationToken,
    revision: "1",
    createdAt
  };
}

describe("Inbox V2 outbound route contracts", () => {
  it("versions a thread policy with explicit preference and bounded fallback", () => {
    const value = policy({ preferred: binding("a"), fallback: [binding("b")] });
    expect(inboxV2ThreadRoutePolicySchema.safeParse(value).success).toBe(true);
    expect(
      inboxV2ThreadRoutePolicySchema.safeParse({
        ...value,
        fallback: {
          kind: "ordered_allowlist",
          allowedBindings: [binding("b"), binding("b")]
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2ThreadRoutePolicySchema.safeParse({
        ...value,
        fallback: {
          kind: "ordered_allowlist",
          allowedBindings: [binding("a")]
        }
      }).success
    ).toBe(false);
  });

  it("returns stable zero and ambiguous errors without creating a route", () => {
    const zero = resolutionInput({ candidates: snapshot({ count: 0 }) });
    const multiple = resolutionInput({
      candidates: snapshot({ count: 2, sole: null })
    });
    expect(resolveInboxV2OutboundRoute(zero)).toEqual({
      kind: "failed",
      error: routeError("route.not_found")
    });
    expect(resolveInboxV2OutboundRoute(multiple)).toEqual({
      kind: "failed",
      error: routeError("route.ambiguous")
    });
    expect(
      inboxV2OutboundRouteResolutionCommitSchema.safeParse({
        input: zero,
        result: resolveInboxV2OutboundRoute(zero),
        route: null
      }).success
    ).toBe(true);
  });

  it("selects preferred, sole and deterministic allowed fallback in order", () => {
    const preferredCandidate = candidate("a");
    const preferredInput = resolutionInput({
      routePolicy: policy({ preferred: binding("a") }),
      candidates: snapshot({
        count: 2,
        preferred: preferredCandidate,
        sole: null
      })
    });
    expect(resolveInboxV2OutboundRoute(preferredInput)).toMatchObject({
      kind: "selected",
      selectionReason: "preferred_binding",
      candidate: { sourceThreadBinding: binding("a") }
    });

    expect(resolveInboxV2OutboundRoute(resolutionInput())).toMatchObject({
      kind: "selected",
      selectionReason: "sole_eligible_binding",
      candidate: { sourceThreadBinding: binding("a") }
    });

    const fallbackInput = resolutionInput({
      routePolicy: policy({ fallback: [binding("b")] }),
      candidates: snapshot({
        count: 2,
        sole: null,
        fallback: { candidate: candidate("b"), policyOrdinal: 0 }
      })
    });
    expect(resolveInboxV2OutboundRoute(fallbackInput)).toMatchObject({
      kind: "selected",
      selectionReason: "policy_fallback",
      fallbackPolicyOrdinal: 0,
      candidate: { sourceThreadBinding: binding("b") }
    });
  });

  it("makes every explicit target fail-stop even when automatic slots exist", () => {
    const rejected = candidate("b", {
      eligibility: {
        state: "ineligible",
        error: routeError("route.inactive")
      }
    });
    const withRejectedTarget = resolutionInput({
      intent: { kind: "explicit_binding", binding: binding("b") },
      routePolicy: policy({ preferred: binding("a") }),
      candidates: snapshot({
        count: 1,
        explicit: rejected,
        preferred: candidate("a"),
        sole: candidate("a")
      })
    });
    expect(resolveInboxV2OutboundRoute(withRejectedTarget)).toEqual({
      kind: "failed",
      error: routeError("route.inactive")
    });

    const absentTarget = resolutionInput({
      intent: { kind: "explicit_binding", binding: binding("b") },
      routePolicy: policy({ preferred: binding("a") }),
      candidates: snapshot({
        count: 1,
        explicit: null,
        preferred: candidate("a"),
        sole: candidate("a")
      })
    });
    expect(resolveInboxV2OutboundRoute(absentTarget)).toEqual({
      kind: "failed",
      error: routeError("route.not_found")
    });
  });

  it.each(["provider_deleted", "provider_unavailable", "unknown"] as const)(
    "fails a %s explicit reference without using preferred or policy fallback",
    (availability) => {
      const context = externalReferenceContext({ availability });
      const origin = candidateForReference("a", context);
      const input = resolutionInput({
        intent: {
          kind: "explicit_occurrence",
          occurrence: context.sourceOccurrence
        },
        referenceContext: context,
        routePolicy: policy({
          preferred: binding("b"),
          fallback: [binding("a")]
        }),
        candidates: snapshot({
          count: 2,
          explicit: origin,
          preferred: candidateForReference("b", context),
          sole: null,
          fallback: {
            candidate: candidateForReference("a", context),
            policyOrdinal: 0
          }
        })
      });

      expect(
        inboxV2OutboundRouteResolutionInputSchema.safeParse(input).success
      ).toBe(true);
      expect(resolveInboxV2OutboundRoute(input)).toEqual({
        kind: "failed",
        error: routeError("route.reference_unavailable")
      });
    }
  );

  it("does not use policy fallback for an automatic provider reference", () => {
    const context = externalReferenceContext({
      portability: "external_thread"
    });
    const input = resolutionInput({
      referenceContext: context,
      routePolicy: policy({ fallback: [binding("a")] }),
      candidates: snapshot({
        count: 2,
        explicit: null,
        preferred: null,
        sole: null,
        fallback: {
          candidate: candidateForReference("a", context),
          policyOrdinal: 0
        }
      })
    });

    expect(resolveInboxV2OutboundRoute(input)).toEqual({
      kind: "failed",
      error: routeError("route.ambiguous")
    });
  });

  it("keeps group destination separate from the opaque quoted reference token", () => {
    const context = externalReferenceContext({
      portability: "external_thread"
    });
    const crossBinding = candidateForReference("b", context);
    const input = resolutionInput({
      referenceContext: context,
      routePolicy: policy({ preferred: binding("b") }),
      candidates: snapshot({
        count: 2,
        preferred: crossBinding,
        sole: null
      })
    });

    const commit = materializeInboxV2OutboundRouteResolutionCommit(input, {
      routeId: "outbound_route:group-reply",
      selectedAt: createdAt
    });
    expect(commit.route).toMatchObject({
      sourceThreadBinding: binding("b"),
      routeDescriptor: {
        destinationKindId: "module:synthetic-source:group-peer",
        destinationSubject: "Group-b"
      },
      referenceContext: {
        originBinding: binding("a"),
        resolutionDecision: {
          occurrenceDescriptor: {
            providerReferences: expect.arrayContaining([
              {
                kindId: "module:synthetic-source:quoted-context-token",
                subject: "opaque-quoted-context-token"
              }
            ])
          }
        }
      }
    });
  });

  it("requires two exact server-loaded authorization decisions", () => {
    const valid = candidate("a");
    expect(
      inboxV2ConversationRouteAuthorizationDecisionSchema.safeParse(
        valid.conversationAuthorization
      ).success
    ).toBe(true);
    expect(
      inboxV2SourceAccountRouteAuthorizationDecisionSchema.safeParse(
        valid.sourceAccountAuthorization
      ).success
    ).toBe(true);
    expect(
      inboxV2ConversationRouteAuthorizationDecisionSchema.safeParse({
        ...valid.conversationAuthorization,
        matchedPermissionIds: ["core:inbox.read"]
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceAccountRouteAuthorizationDecisionSchema.safeParse({
        ...valid.sourceAccountAuthorization,
        matchedPermissionIds: [replyPermissionId]
      }).success
    ).toBe(false);

    const wrongTenant = candidate("a");
    wrongTenant.sourceAccountAuthorization.target.sourceAccount = account("a");
    wrongTenant.sourceAccountAuthorization.target.sourceAccount.tenantId =
      otherTenantId;
    expect(
      inboxV2OutboundRouteResolutionInputSchema.safeParse(
        resolutionInput({
          candidates: snapshot({ count: 1, sole: wrongTenant })
        })
      ).success
    ).toBe(false);
  });

  it("binds the exact operation permission and rejects authority expired after load", () => {
    const sendAuthorized = candidate("a", {
      conversationPermissionId: sendPermissionId
    });
    const wrongOperationPermission = resolutionInput({
      routePolicy: policy({ requiredPermissionId: replyPermissionId }),
      candidates: snapshot({ count: 1, sole: sendAuthorized })
    });
    expect(
      inboxV2OutboundRouteResolutionInputSchema.safeParse(
        wrongOperationPermission
      ).success
    ).toBe(false);

    const expiredAfterSnapshot = candidate("a", {
      decisionNotAfter: "2026-07-11T10:00:30.000Z"
    });
    const staleInput = resolutionInput({
      candidates: snapshot({ count: 1, sole: expiredAfterSnapshot })
    });
    expect(
      inboxV2OutboundRouteResolutionInputSchema.safeParse(staleInput).success
    ).toBe(false);
    expect(resolveInboxV2OutboundRoute(staleInput)).toMatchObject({
      kind: "failed",
      error: { code: "route.invalid_intent" }
    });
  });

  it("rejects forged reference evidence and nonportable explicit reroute", () => {
    const context = externalReferenceContext();
    const replacement = candidateForReference("b", context);
    const rerouteInput = resolutionInput({
      intent: {
        kind: "explicit_reroute",
        originalRoute: reference("outbound_route", "outbound_route:old"),
        originalDispatch: reference(
          "outbound_dispatch",
          "outbound_dispatch:old"
        ),
        expectedOriginalDispatchRevision: "1",
        replacementBinding: binding("b"),
        reasonId: "core:operator-reroute"
      },
      referenceContext: context,
      candidates: snapshot({
        count: 1,
        explicit: replacement,
        sole: candidateForReference("a", context)
      })
    });
    expect(resolveInboxV2OutboundRoute(rerouteInput)).toEqual({
      kind: "failed",
      error: routeError("route.reference_nonportable")
    });

    const forged = externalReferenceContext();
    forged.resolutionDecision.sourceOccurrence = reference(
      "source_occurrence",
      "source_occurrence:unrelated"
    );
    const origin = candidateForReference("a", forged);
    expect(
      inboxV2OutboundRouteResolutionInputSchema.safeParse(
        resolutionInput({
          intent: {
            kind: "explicit_occurrence",
            occurrence: forged.sourceOccurrence
          },
          referenceContext: forged,
          candidates: snapshot({ count: 1, explicit: origin, sole: origin })
        })
      ).success
    ).toBe(false);

    const forgedDescriptor = externalReferenceContext({
      availabilityDescriptorDigestSha256:
        "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
    });
    const forgedDescriptorOrigin = candidateForReference("a", forgedDescriptor);
    expect(
      inboxV2OutboundRouteResolutionInputSchema.safeParse(
        resolutionInput({
          intent: {
            kind: "explicit_occurrence",
            occurrence: forgedDescriptor.sourceOccurrence
          },
          referenceContext: forgedDescriptor,
          candidates: snapshot({
            count: 1,
            explicit: forgedDescriptorOrigin,
            sole: forgedDescriptorOrigin
          })
        })
      ).success
    ).toBe(false);
  });

  it("requires coherent adapter and availability observation timestamps", () => {
    for (const context of [
      externalReferenceContext({ descriptorAdapterMismatch: true }),
      externalReferenceContext({ availabilityObservedAt: createdAt }),
      externalReferenceContext({ availabilityObserverMismatch: true })
    ]) {
      const origin = candidateForReference("a", context);
      expect(
        inboxV2OutboundRouteResolutionInputSchema.safeParse(
          resolutionInput({
            intent: {
              kind: "explicit_occurrence",
              occurrence: context.sourceOccurrence
            },
            referenceContext: context,
            candidates: snapshot({
              count: 1,
              explicit: origin,
              sole: origin
            })
          })
        ).success
      ).toBe(false);
    }
  });

  it("rejects authoritative provider-global proof that crosses ExternalThread", () => {
    const context = externalReferenceContext({
      portability: "provider_global"
    });
    const otherThread = reference(
      "external_thread",
      "external_thread:thread-other"
    );
    context.externalThread = otherThread;
    context.resolutionDecision.externalThread = otherThread;
    context.resolutionDecision.availabilityObservation.externalThread =
      otherThread;
    const origin = candidateForReference("a", context);

    expect(
      inboxV2OutboundRouteResolutionInputSchema.safeParse(
        resolutionInput({
          intent: {
            kind: "explicit_occurrence",
            occurrence: context.sourceOccurrence
          },
          referenceContext: context,
          candidates: snapshot({ count: 1, explicit: origin, sole: origin })
        })
      ).success
    ).toBe(false);
  });

  it("pins an allowed explicit reroute to only the named replacement binding", () => {
    const replacement = candidate("b");
    const input = resolutionInput({
      intent: {
        kind: "explicit_reroute",
        originalRoute: reference("outbound_route", "outbound_route:original"),
        originalDispatch: reference(
          "outbound_dispatch",
          "outbound_dispatch:original"
        ),
        expectedOriginalDispatchRevision: "1",
        replacementBinding: binding("b"),
        reasonId: "core:operator-reroute"
      },
      candidates: snapshot({
        count: 1,
        explicit: replacement,
        sole: candidate("a")
      })
    });

    expect(resolveInboxV2OutboundRoute(input)).toMatchObject({
      kind: "selected",
      candidate: { sourceThreadBinding: binding("b") },
      selectionReason: "explicit_reroute",
      fallbackPolicyOrdinal: null
    });
    const commit = materializeInboxV2OutboundRouteResolutionCommit(input, {
      routeId: "outbound_route:rerouted",
      selectedAt: createdAt
    });
    expect(commit.route).toMatchObject({
      id: "outbound_route:rerouted",
      sourceThreadBinding: binding("b"),
      selection: {
        reason: "explicit_reroute",
        intent: {
          kind: "explicit_reroute",
          replacementBinding: binding("b")
        }
      }
    });

    expect(
      inboxV2OutboundRouteResolutionInputSchema.safeParse({
        ...input,
        intent: {
          ...input.intent,
          originalDispatch: reference(
            "outbound_dispatch",
            "outbound_dispatch:other-tenant",
            otherTenantId
          )
        }
      }).success
    ).toBe(false);
  });

  it("reports an expired reply window distinctly", () => {
    const context = externalReferenceContext({
      referenceWindow: {
        state: "expired",
        expiredAt: "2026-07-11T09:59:00.000Z"
      }
    });
    const origin = candidateForReference("a", context);
    const input = resolutionInput({
      intent: { kind: "explicit_binding", binding: binding("a") },
      referenceContext: context,
      candidates: snapshot({
        count: 0,
        explicit: origin,
        sole: null,
        zeroError: routeError("route.reply_window_expired")
      })
    });
    expect(resolveInboxV2OutboundRoute(input)).toEqual({
      kind: "failed",
      error: routeError("route.reply_window_expired")
    });
  });

  it("keeps runtime readiness outside eligibility and pins the same route", () => {
    const unavailable = candidate("a", { runtimeState: "unavailable" });
    const input = resolutionInput({
      candidates: snapshot({ count: 1, sole: unavailable })
    });
    const result = resolveInboxV2OutboundRoute(input);
    expect(result).toMatchObject({
      kind: "selected",
      candidate: {
        sourceThreadBinding: binding("a"),
        runtimeObservation: { state: "unavailable" }
      }
    });
    expect(
      inboxV2OutboundRouteCandidateSnapshotSchema.safeParse(
        snapshot({
          count: 0,
          zeroError: routeError("route.runtime_unavailable")
        })
      ).success
    ).toBe(false);
    if (result.kind !== "selected") {
      throw new Error("Expected a structurally selected route.");
    }
    const commit = materializeInboxV2OutboundRouteResolutionCommit(input, {
      routeId: "outbound_route:route-1",
      selectedAt: createdAt
    });
    const route = commit.route;
    if (route === null) {
      throw new Error("Expected a materialized immutable route.");
    }
    expect(inboxV2OutboundRouteSchema.safeParse(route).success).toBe(true);
    expect(
      inboxV2OutboundRouteResolutionCommitSchema.safeParse(commit).success
    ).toBe(true);
    expect(route.sourceThreadBinding).toEqual(binding("a"));
    expect(route.runtimeObservationAtResolution.state).toBe("unavailable");
    expect("runtimeHealthRevision" in route.bindingFence).toBe(false);
  });

  it("materializes failed resolution without inventing a route", () => {
    const input = resolutionInput({ candidates: snapshot({ count: 0 }) });
    const commit = materializeInboxV2OutboundRouteResolutionCommit(input, {
      routeId: "outbound_route:not-consumed",
      selectedAt: createdAt
    });

    expect(commit.result).toEqual({
      kind: "failed",
      error: routeError("route.not_found")
    });
    expect(commit.route).toBeNull();
    expect(
      inboxV2OutboundRouteResolutionCommitSchema.safeParse(commit).success
    ).toBe(true);
  });

  it("makes the standalone immutable route fail closed outside its commit", () => {
    const input = resolutionInput();
    const result = resolveInboxV2OutboundRoute(input);
    if (result.kind !== "selected") {
      throw new Error("Expected selected route fixture.");
    }
    const route = immutableRoute(input, result);
    expect(inboxV2OutboundRouteSchema.safeParse(route).success).toBe(true);

    const mutations = [
      {
        ...route,
        sourceAccountAuthorization: {
          ...route.sourceAccountAuthorization,
          target: {
            ...route.sourceAccountAuthorization.target,
            sourceAccount: account("b")
          }
        }
      },
      {
        ...route,
        conversationAuthorization: {
          ...route.conversationAuthorization,
          target: {
            ...route.conversationAuthorization.target,
            bindingFence: { ...bindingFence, capabilityRevision: "99" }
          }
        }
      },
      {
        ...route,
        sourceAccountAuthorization: {
          ...route.sourceAccountAuthorization,
          effect: "deny"
        }
      },
      {
        ...route,
        principal: {
          kind: "employee",
          employee: reference("employee", "employee:other")
        }
      },
      {
        ...route,
        conversationAuthorization: {
          ...route.conversationAuthorization,
          notAfter: requestedAt
        }
      }
    ];
    for (const mutation of mutations) {
      expect(inboxV2OutboundRouteSchema.safeParse(mutation).success).toBe(
        false
      );
    }
  });

  it("rejects poisoned one-candidate slots and binds route to resolver output", () => {
    expect(
      inboxV2OutboundRouteCandidateSnapshotSchema.safeParse(
        snapshot({
          count: 1,
          sole: candidate("a"),
          preferred: candidate("b")
        })
      ).success
    ).toBe(false);

    const input = resolutionInput();
    const result = resolveInboxV2OutboundRoute(input);
    if (result.kind !== "selected") {
      throw new Error("Expected selected route fixture.");
    }
    const route = immutableRoute(input, result);
    expect(
      inboxV2OutboundRouteResolutionCommitSchema.safeParse({
        input,
        result,
        route
      }).success
    ).toBe(true);
    expect(
      inboxV2OutboundRouteResolutionCommitSchema.safeParse({
        input,
        result,
        route: { ...route, sourceThreadBinding: binding("b") }
      }).success
    ).toBe(false);
  });

  it("binds all route contracts to exact v1 envelopes", () => {
    const input = resolutionInput();
    const result = resolveInboxV2OutboundRoute(input);
    if (result.kind !== "selected") {
      throw new Error("Expected selected route fixture.");
    }
    const route = immutableRoute(input, result);
    const commit = { input, result, route };
    const cases = [
      {
        schema: inboxV2ThreadRoutePolicyEnvelopeSchema,
        schemaId: INBOX_V2_THREAD_ROUTE_POLICY_SCHEMA_ID,
        payload: input.routePolicy
      },
      {
        schema: inboxV2OutboundRouteResolutionInputEnvelopeSchema,
        schemaId: INBOX_V2_OUTBOUND_ROUTE_RESOLUTION_INPUT_SCHEMA_ID,
        payload: input
      },
      {
        schema: inboxV2OutboundRouteSelectionResultEnvelopeSchema,
        schemaId: INBOX_V2_OUTBOUND_ROUTE_SELECTION_RESULT_SCHEMA_ID,
        payload: result
      },
      {
        schema: inboxV2OutboundRouteEnvelopeSchema,
        schemaId: INBOX_V2_OUTBOUND_ROUTE_SCHEMA_ID,
        payload: route
      },
      {
        schema: inboxV2OutboundRouteResolutionCommitEnvelopeSchema,
        schemaId: INBOX_V2_OUTBOUND_ROUTE_RESOLUTION_COMMIT_SCHEMA_ID,
        payload: commit
      }
    ] as const;
    for (const { schema, schemaId, payload } of cases) {
      const envelope = {
        schemaId,
        schemaVersion: INBOX_V2_OUTBOUND_ROUTE_SCHEMA_VERSION,
        payload
      };
      expect(schema.safeParse(envelope).success).toBe(true);
      expect(
        schema.safeParse({ ...envelope, schemaVersion: "v2" }).success
      ).toBe(false);
      expect(schema.safeParse({ ...envelope, future: true }).success).toBe(
        false
      );
    }
  });
});
