import { z } from "zod";

import { inboxV2CatalogIdSchema } from "./catalog";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2ConversationReferenceSchema,
  inboxV2EmployeeReferenceSchema,
  inboxV2ExternalMessageReferenceRefSchema,
  inboxV2ExternalThreadReferenceSchema,
  inboxV2OutboundRouteIdSchema,
  inboxV2OutboundRouteReferenceSchema,
  inboxV2SourceAccountReferenceSchema,
  inboxV2SourceConnectionReferenceSchema,
  inboxV2SourceOccurrenceReferenceSchema,
  inboxV2SourceThreadBindingReferenceSchema,
  inboxV2TenantIdSchema,
  inboxV2ThreadRoutePolicyIdSchema,
  inboxV2ThreadRoutePolicyReferenceSchema
} from "./ids";
import { inboxV2ExternalReferencePortabilitySchema } from "./external-message-reference";
import { inboxV2AuthorizationEpochSchema } from "./authorization-epoch";
import {
  inboxV2AdapterContractSnapshotSchema,
  inboxV2OpaqueAdapterRouteDescriptorSchema,
  inboxV2RoutingTokenSchema,
  inboxV2RoutingTrustedServiceIdSchema,
  inboxV2SafeSourceDiagnosticSchema,
  inboxV2SourceContentKindIdSchema,
  inboxV2SourceOperationIdSchema,
  inboxV2SourcePermissionIdSchema,
  inboxV2SourceRoutePolicyIdSchema,
  type InboxV2AdapterContractSnapshot
} from "./source-routing-primitives";
import { inboxV2SourceThreadBindingFenceSchema } from "./source-thread-binding";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";

export const INBOX_V2_THREAD_ROUTE_POLICY_SCHEMA_ID =
  "core:inbox-v2.thread-route-policy" as const;
export const INBOX_V2_OUTBOUND_ROUTE_RESOLUTION_INPUT_SCHEMA_ID =
  "core:inbox-v2.outbound-route-resolution-input" as const;
export const INBOX_V2_OUTBOUND_ROUTE_SELECTION_RESULT_SCHEMA_ID =
  "core:inbox-v2.outbound-route-selection-result" as const;
export const INBOX_V2_OUTBOUND_ROUTE_SCHEMA_ID =
  "core:inbox-v2.outbound-route" as const;
export const INBOX_V2_OUTBOUND_ROUTE_RESOLUTION_COMMIT_SCHEMA_ID =
  "core:inbox-v2.outbound-route-resolution-commit" as const;
export const INBOX_V2_OUTBOUND_ROUTE_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;
export const INBOX_V2_ROUTE_POLICY_FALLBACK_MAX = 32;

const routeErrorCodes = [
  "route.not_found",
  "route.ambiguous",
  "route.forbidden",
  "route.inactive",
  "route.account_unavailable",
  "route.binding_changed",
  "route.policy_changed",
  "route.capability_missing",
  "route.reference_nonportable",
  "route.reply_window_expired",
  "route.audience_mismatch",
  "route.runtime_unavailable",
  "route.invalid_intent"
] as const;

const routeRetryabilityByCode = {
  "route.not_found": "terminal",
  "route.ambiguous": "terminal",
  "route.forbidden": "terminal",
  "route.inactive": "terminal",
  "route.account_unavailable": "terminal",
  "route.binding_changed": "retryable_resolution",
  "route.policy_changed": "retryable_resolution",
  "route.capability_missing": "terminal",
  "route.reference_nonportable": "terminal",
  "route.reply_window_expired": "terminal",
  "route.audience_mismatch": "terminal",
  "route.runtime_unavailable": "retryable_same_route",
  "route.invalid_intent": "terminal"
} as const satisfies Record<(typeof routeErrorCodes)[number], string>;

export const inboxV2OutboundRouteErrorCodeSchema = z.enum(routeErrorCodes);
export const inboxV2OutboundRouteErrorRetryabilitySchema = z.enum([
  "terminal",
  "retryable_resolution",
  "retryable_same_route"
]);

/** Stable, provider-neutral failure returned before a dispatch can exist. */
export const inboxV2OutboundRouteErrorSchema = z
  .object({
    code: inboxV2OutboundRouteErrorCodeSchema,
    retryability: inboxV2OutboundRouteErrorRetryabilitySchema,
    diagnostic: inboxV2SafeSourceDiagnosticSchema.nullable()
  })
  .strict()
  .superRefine((error, context) => {
    if (error.retryability !== routeRetryabilityByCode[error.code]) {
      addIssue(
        context,
        ["retryability"],
        "Route error retryability is fixed by its stable error code."
      );
    }
    if (
      error.diagnostic !== null &&
      error.diagnostic.retryable !== (error.retryability !== "terminal")
    ) {
      addIssue(
        context,
        ["diagnostic", "retryable"],
        "Safe diagnostic retryability must agree with the stable route error."
      );
    }
  });

export const inboxV2OutboundRoutePrincipalSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("employee"),
        employee: inboxV2EmployeeReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("trusted_service"),
        trustedServiceId: inboxV2RoutingTrustedServiceIdSchema
      })
      .strict()
  ]
);

const routeAuthorizationTargetSchema = z
  .object({
    conversation: inboxV2ConversationReferenceSchema,
    externalThread: inboxV2ExternalThreadReferenceSchema,
    sourceThreadBinding: inboxV2SourceThreadBindingReferenceSchema,
    sourceAccount: inboxV2SourceAccountReferenceSchema,
    sourceConnection: inboxV2SourceConnectionReferenceSchema,
    operationId: inboxV2SourceOperationIdSchema,
    contentKindId: inboxV2SourceContentKindIdSchema.nullable(),
    authorizationEpoch: inboxV2AuthorizationEpochSchema,
    bindingFence: inboxV2SourceThreadBindingFenceSchema,
    referenceTarget: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("none") }).strict(),
      z
        .object({
          kind: z.literal("external_message"),
          externalMessageReference: inboxV2ExternalMessageReferenceRefSchema,
          sourceOccurrence: inboxV2SourceOccurrenceReferenceSchema
        })
        .strict()
    ])
  })
  .strict();

const routeAuthorizationDecisionFields = {
  tenantId: inboxV2TenantIdSchema,
  principal: inboxV2OutboundRoutePrincipalSchema,
  target: routeAuthorizationTargetSchema,
  effect: z.enum(["allow", "deny"]),
  matchedPermissionIds: z.array(inboxV2SourcePermissionIdSchema).max(64),
  decisionToken: inboxV2RoutingTokenSchema,
  decisionRevision: inboxV2EntityRevisionSchema,
  loadedByTrustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
  decidedAt: inboxV2TimestampSchema,
  notAfter: inboxV2TimestampSchema
} as const;

/** Server-loaded Conversation/action authority. It is never a UI boolean. */
export const inboxV2ConversationRouteAuthorizationDecisionSchema = z
  .object({
    decisionKind: z.literal("conversation_action"),
    requiredPermissionId: inboxV2SourcePermissionIdSchema,
    ...routeAuthorizationDecisionFields
  })
  .strict()
  .superRefine(addAuthorizationDecisionIssues);

/** Separate server-loaded authority for this exact account and binding. */
export const inboxV2SourceAccountRouteAuthorizationDecisionSchema = z
  .object({
    decisionKind: z.literal("source_account_use"),
    requiredPermissionId: z.literal("core:source_account.use"),
    ...routeAuthorizationDecisionFields
  })
  .strict()
  .superRefine(addAuthorizationDecisionIssues);

export const inboxV2ThreadRouteFallbackPolicySchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("none") }).strict(),
    z
      .object({
        kind: z.literal("ordered_allowlist"),
        allowedBindings: z
          .array(inboxV2SourceThreadBindingReferenceSchema)
          .min(1)
          .max(INBOX_V2_ROUTE_POLICY_FALLBACK_MAX)
      })
      .strict()
      .superRefine((fallback, context) => {
        addDuplicateReferenceIssues(
          context,
          fallback.allowedBindings,
          ["allowedBindings"],
          "Fallback allowlist"
        );
      })
  ]
);

/**
 * One versioned policy for an exact thread/operation/content tuple. The default
 * is no fallback; an ordered allowlist is an explicit audited configuration.
 */
export const inboxV2ThreadRoutePolicySchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2ThreadRoutePolicyIdSchema,
    conversation: inboxV2ConversationReferenceSchema,
    externalThread: inboxV2ExternalThreadReferenceSchema,
    operationId: inboxV2SourceOperationIdSchema,
    contentKindId: inboxV2SourceContentKindIdSchema.nullable(),
    policyId: inboxV2SourceRoutePolicyIdSchema,
    requiredConversationPermissionId: inboxV2SourcePermissionIdSchema,
    preferredBinding: inboxV2SourceThreadBindingReferenceSchema.nullable(),
    fallback: inboxV2ThreadRouteFallbackPolicySchema,
    revision: inboxV2EntityRevisionSchema,
    createdAt: inboxV2TimestampSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((policy, context) => {
    for (const [field, reference] of [
      ["conversation", policy.conversation],
      ["externalThread", policy.externalThread]
    ] as const) {
      addTenantReferenceIssue(context, policy.tenantId, reference, [field]);
    }
    if (policy.preferredBinding !== null) {
      addTenantReferenceIssue(
        context,
        policy.tenantId,
        policy.preferredBinding,
        ["preferredBinding"]
      );
    }
    if (policy.fallback.kind === "ordered_allowlist") {
      for (const [
        index,
        binding
      ] of policy.fallback.allowedBindings.entries()) {
        addTenantReferenceIssue(context, policy.tenantId, binding, [
          "fallback",
          "allowedBindings",
          index
        ]);
        if (
          policy.preferredBinding !== null &&
          sameReference(policy.preferredBinding, binding)
        ) {
          addIssue(
            context,
            ["fallback", "allowedBindings", index],
            "Preferred binding is not duplicated in the fallback allowlist."
          );
        }
      }
    }
    if (!isInboxV2TimestampOrderValid(policy.createdAt, policy.updatedAt)) {
      addIssue(
        context,
        ["updatedAt"],
        "Thread route policy update cannot predate creation."
      );
    }
  });

export const inboxV2OutboundRouteIntentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("automatic") }).strict(),
  z
    .object({
      kind: z.literal("explicit_binding"),
      binding: inboxV2SourceThreadBindingReferenceSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("explicit_occurrence"),
      occurrence: inboxV2SourceOccurrenceReferenceSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("explicit_reroute"),
      originalRoute: inboxV2OutboundRouteReferenceSchema,
      replacementBinding: inboxV2SourceThreadBindingReferenceSchema,
      reasonId: inboxV2CatalogIdSchema
    })
    .strict()
]);

/** Trusted, bounded proof that the exact occurrence owns this reference. */
export const inboxV2OutboundReferenceResolutionDecisionSchema = z
  .object({
    decisionKind: z.literal("external_message_reference_resolution"),
    tenantId: inboxV2TenantIdSchema,
    externalThread: inboxV2ExternalThreadReferenceSchema,
    externalMessageReference: inboxV2ExternalMessageReferenceRefSchema,
    sourceOccurrence: inboxV2SourceOccurrenceReferenceSchema,
    originBinding: inboxV2SourceThreadBindingReferenceSchema,
    originSourceAccount: inboxV2SourceAccountReferenceSchema,
    occurrenceRevision: inboxV2EntityRevisionSchema,
    occurrenceBindingGeneration: inboxV2EntityRevisionSchema,
    portability: inboxV2ExternalReferencePortabilitySchema,
    referenceWindow: z.discriminatedUnion("state", [
      z.object({ state: z.literal("not_applicable") }).strict(),
      z
        .object({
          state: z.literal("valid"),
          notAfter: inboxV2TimestampSchema
        })
        .strict(),
      z
        .object({
          state: z.literal("expired"),
          expiredAt: inboxV2TimestampSchema
        })
        .strict()
    ]),
    decisionToken: inboxV2RoutingTokenSchema,
    decisionRevision: inboxV2EntityRevisionSchema,
    loadedByTrustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
    decidedAt: inboxV2TimestampSchema,
    notAfter: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((decision, context) => {
    for (const [field, reference] of [
      ["externalThread", decision.externalThread],
      ["externalMessageReference", decision.externalMessageReference],
      ["sourceOccurrence", decision.sourceOccurrence],
      ["originBinding", decision.originBinding],
      ["originSourceAccount", decision.originSourceAccount]
    ] as const) {
      addTenantReferenceIssue(context, decision.tenantId, reference, [field]);
    }
    if (!isInboxV2TimestampOrderValid(decision.decidedAt, decision.notAfter)) {
      addIssue(
        context,
        ["notAfter"],
        "Reference-resolution authority cannot expire before it is decided."
      );
    }
  });

export const inboxV2OutboundRouteReferenceContextSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("none") }).strict(),
    z
      .object({
        kind: z.literal("external_message"),
        externalThread: inboxV2ExternalThreadReferenceSchema,
        externalMessageReference: inboxV2ExternalMessageReferenceRefSchema,
        sourceOccurrence: inboxV2SourceOccurrenceReferenceSchema,
        originBinding: inboxV2SourceThreadBindingReferenceSchema,
        originSourceAccount: inboxV2SourceAccountReferenceSchema,
        portability: inboxV2ExternalReferencePortabilitySchema,
        resolutionDecision: inboxV2OutboundReferenceResolutionDecisionSchema
      })
      .strict()
  ]
);

export const inboxV2OutboundRouteRuntimeObservationSchema = z
  .object({
    state: z.enum(["unknown", "ready", "degraded", "unavailable"]),
    revision: inboxV2EntityRevisionSchema,
    observedAt: inboxV2TimestampSchema,
    diagnostic: inboxV2SafeSourceDiagnosticSchema.nullable()
  })
  .strict()
  .superRefine((observation, context) => {
    if (
      (observation.state === "degraded" ||
        observation.state === "unavailable") &&
      observation.diagnostic === null
    ) {
      addIssue(
        context,
        ["diagnostic"],
        "Degraded or unavailable runtime readiness requires a safe diagnostic."
      );
    }
    if (observation.state === "ready" && observation.diagnostic !== null) {
      addIssue(
        context,
        ["diagnostic"],
        "Ready runtime observation cannot retain a failure diagnostic."
      );
    }
  });

export const inboxV2OutboundRouteCandidateEligibilitySchema =
  z.discriminatedUnion("state", [
    z.object({ state: z.literal("eligible") }).strict(),
    z
      .object({
        state: z.literal("ineligible"),
        error: inboxV2OutboundRouteErrorSchema
      })
      .strict()
      .superRefine((eligibility, context) => {
        if (eligibility.error.code === "route.runtime_unavailable") {
          addIssue(
            context,
            ["error", "code"],
            "Runtime readiness is not structural route eligibility."
          );
        }
      })
  ]);

/**
 * One exact server-loaded route candidate. Runtime observation is deliberately
 * outside its structural eligibility and outside the six-field binding fence.
 */
export const inboxV2OutboundRouteCandidateSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    conversation: inboxV2ConversationReferenceSchema,
    externalThread: inboxV2ExternalThreadReferenceSchema,
    sourceThreadBinding: inboxV2SourceThreadBindingReferenceSchema,
    sourceAccount: inboxV2SourceAccountReferenceSchema,
    sourceConnection: inboxV2SourceConnectionReferenceSchema,
    operationId: inboxV2SourceOperationIdSchema,
    contentKindId: inboxV2SourceContentKindIdSchema.nullable(),
    authorizationEpoch: inboxV2AuthorizationEpochSchema,
    bindingFence: inboxV2SourceThreadBindingFenceSchema,
    adapterContract: inboxV2AdapterContractSnapshotSchema,
    routeDescriptor: inboxV2OpaqueAdapterRouteDescriptorSchema,
    conversationAuthorization:
      inboxV2ConversationRouteAuthorizationDecisionSchema,
    sourceAccountAuthorization:
      inboxV2SourceAccountRouteAuthorizationDecisionSchema,
    eligibility: inboxV2OutboundRouteCandidateEligibilitySchema,
    runtimeObservation: inboxV2OutboundRouteRuntimeObservationSchema
  })
  .strict()
  .superRefine((candidate, context) => {
    for (const [field, reference] of [
      ["conversation", candidate.conversation],
      ["externalThread", candidate.externalThread],
      ["sourceThreadBinding", candidate.sourceThreadBinding],
      ["sourceAccount", candidate.sourceAccount],
      ["sourceConnection", candidate.sourceConnection]
    ] as const) {
      addTenantReferenceIssue(context, candidate.tenantId, reference, [field]);
    }
    if (
      !sameAdapterContractSnapshot(
        candidate.adapterContract,
        candidate.routeDescriptor.adapterContract
      )
    ) {
      addIssue(
        context,
        ["routeDescriptor", "adapterContract"],
        "Candidate descriptor must use its pinned adapter contract snapshot."
      );
    }
    if (
      String(candidate.bindingFence.routeDescriptorRevision) !==
      String(candidate.routeDescriptor.descriptorRevision)
    ) {
      addIssue(
        context,
        ["bindingFence", "routeDescriptorRevision"],
        "Candidate fence must pin the exact opaque descriptor revision."
      );
    }
    addCandidateAuthorizationIssues(
      context,
      candidate,
      candidate.conversationAuthorization,
      ["conversationAuthorization"]
    );
    addCandidateAuthorizationIssues(
      context,
      candidate,
      candidate.sourceAccountAuthorization,
      ["sourceAccountAuthorization"]
    );
    if (
      !samePrincipal(
        candidate.conversationAuthorization.principal,
        candidate.sourceAccountAuthorization.principal
      )
    ) {
      addIssue(
        context,
        ["sourceAccountAuthorization", "principal"],
        "Conversation and SourceAccount decisions must authorize one principal."
      );
    }
    if (
      !sameValue(
        candidate.conversationAuthorization.target.referenceTarget,
        candidate.sourceAccountAuthorization.target.referenceTarget
      )
    ) {
      addIssue(
        context,
        ["sourceAccountAuthorization", "target", "referenceTarget"],
        "Both conjunctive decisions must authorize the same exact reference target."
      );
    }
    const denied =
      candidate.conversationAuthorization.effect === "deny" ||
      candidate.sourceAccountAuthorization.effect === "deny";
    if (denied) {
      if (
        candidate.eligibility.state !== "ineligible" ||
        candidate.eligibility.error.code !== "route.forbidden"
      ) {
        addIssue(
          context,
          ["eligibility"],
          "A denied authorization decision makes the exact candidate forbidden."
        );
      }
    } else if (candidate.eligibility.state === "eligible") {
      // The two independent allow decisions are intentionally conjunctive.
    }
  });

const selectableRouteCandidateSchema =
  inboxV2OutboundRouteCandidateSchema.superRefine((candidate, context) => {
    if (candidate.eligibility.state !== "eligible") {
      addIssue(
        context,
        ["eligibility"],
        "Selectable snapshot slots contain only structurally eligible candidates."
      );
    }
    if (
      candidate.conversationAuthorization.effect !== "allow" ||
      candidate.sourceAccountAuthorization.effect !== "allow"
    ) {
      addIssue(
        context,
        ["conversationAuthorization", "effect"],
        "Selectable candidates require both independent allow decisions."
      );
    }
  });

const fallbackCandidateSlotSchema = z
  .object({
    candidate: selectableRouteCandidateSchema,
    policyOrdinal: z
      .number()
      .int()
      .min(0)
      .max(INBOX_V2_ROUTE_POLICY_FALLBACK_MAX - 1)
  })
  .strict();

/**
 * Constant-size selection projection: it never exposes or scans a tenant's
 * lifetime binding set. Count plus four semantic slots is O(1).
 */
export const inboxV2OutboundRouteCandidateSnapshotSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    conversation: inboxV2ConversationReferenceSchema,
    externalThread: inboxV2ExternalThreadReferenceSchema,
    operationId: inboxV2SourceOperationIdSchema,
    contentKindId: inboxV2SourceContentKindIdSchema.nullable(),
    authorizationEpoch: inboxV2AuthorizationEpochSchema,
    routePolicy: inboxV2ThreadRoutePolicyReferenceSchema,
    routePolicyRevision: inboxV2EntityRevisionSchema,
    automaticCompatibleEligibleCount: z
      .number()
      .int()
      .min(0)
      .max(1_000_000_000),
    explicitTarget: inboxV2OutboundRouteCandidateSchema.nullable(),
    preferredCandidate: selectableRouteCandidateSchema.nullable(),
    soleEligibleCandidate: selectableRouteCandidateSchema.nullable(),
    fallbackCandidate: fallbackCandidateSlotSchema.nullable(),
    zeroCandidateError: inboxV2OutboundRouteErrorSchema.nullable(),
    snapshotToken: inboxV2RoutingTokenSchema,
    loadedByTrustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
    loadedAt: inboxV2TimestampSchema,
    notAfter: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((snapshot, context) => {
    for (const [field, reference] of [
      ["conversation", snapshot.conversation],
      ["externalThread", snapshot.externalThread],
      ["routePolicy", snapshot.routePolicy]
    ] as const) {
      addTenantReferenceIssue(context, snapshot.tenantId, reference, [field]);
    }
    for (const [field, candidate] of candidateSnapshotSlots(snapshot)) {
      if (candidate !== null) {
        addCandidateSnapshotContextIssues(context, snapshot, candidate, [
          field
        ]);
      }
    }
    if (!isInboxV2TimestampOrderValid(snapshot.loadedAt, snapshot.notAfter)) {
      addIssue(
        context,
        ["notAfter"],
        "Candidate snapshot expiry cannot predate its trusted load time."
      );
    }
    if (snapshot.zeroCandidateError?.code === "route.runtime_unavailable") {
      addIssue(
        context,
        ["zeroCandidateError", "code"],
        "Runtime unavailability cannot erase a structurally valid route candidate."
      );
    }
    if (
      snapshot.automaticCompatibleEligibleCount === 0 &&
      (snapshot.soleEligibleCandidate !== null ||
        snapshot.preferredCandidate !== null ||
        snapshot.fallbackCandidate !== null ||
        snapshot.zeroCandidateError === null)
    ) {
      addIssue(
        context,
        ["automaticCompatibleEligibleCount"],
        "Zero compatible candidates require one stable zero-route error and no selectable slots."
      );
    }
    if (
      snapshot.automaticCompatibleEligibleCount === 1 &&
      (snapshot.soleEligibleCandidate === null ||
        snapshot.zeroCandidateError !== null)
    ) {
      addIssue(
        context,
        ["soleEligibleCandidate"],
        "Exactly one compatible candidate requires the sole-candidate slot."
      );
    }
    if (
      snapshot.automaticCompatibleEligibleCount === 1 &&
      snapshot.soleEligibleCandidate !== null
    ) {
      for (const [field, candidate] of [
        ["preferredCandidate", snapshot.preferredCandidate],
        ["fallbackCandidate", snapshot.fallbackCandidate?.candidate ?? null]
      ] as const) {
        if (
          candidate !== null &&
          !sameCandidateIdentity(candidate, snapshot.soleEligibleCandidate)
        ) {
          addIssue(
            context,
            [field],
            "Every populated one-candidate slot must identify the exact sole candidate."
          );
        }
      }
    }
    if (
      snapshot.automaticCompatibleEligibleCount > 1 &&
      (snapshot.soleEligibleCandidate !== null ||
        snapshot.zeroCandidateError !== null)
    ) {
      addIssue(
        context,
        ["soleEligibleCandidate"],
        "Multiple compatible candidates cannot claim a sole or zero result."
      );
    }
  });

export const inboxV2OutboundRouteResolutionInputSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    principal: inboxV2OutboundRoutePrincipalSchema,
    conversation: inboxV2ConversationReferenceSchema,
    externalThread: inboxV2ExternalThreadReferenceSchema,
    operationId: inboxV2SourceOperationIdSchema,
    contentKindId: inboxV2SourceContentKindIdSchema.nullable(),
    authorizationEpoch: inboxV2AuthorizationEpochSchema,
    intent: inboxV2OutboundRouteIntentSchema,
    referenceContext: inboxV2OutboundRouteReferenceContextSchema,
    routePolicy: inboxV2ThreadRoutePolicySchema,
    candidates: inboxV2OutboundRouteCandidateSnapshotSchema,
    mutationToken: inboxV2RoutingTokenSchema,
    idempotencyToken: inboxV2RoutingTokenSchema,
    correlationToken: inboxV2RoutingTokenSchema,
    requestedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((input, context) => {
    addResolutionInputContextIssues(context, input);
    addResolutionIntentIssues(context, input);
    addResolutionPolicySlotIssues(context, input);
  });

export const inboxV2OutboundRouteSelectionReasonSchema = z.enum([
  "explicit_binding",
  "explicit_occurrence",
  "explicit_reroute",
  "preferred_binding",
  "sole_eligible_binding",
  "policy_fallback"
]);

const selectedRouteResultSchema = z
  .object({
    kind: z.literal("selected"),
    candidate: selectableRouteCandidateSchema,
    selectionReason: inboxV2OutboundRouteSelectionReasonSchema,
    fallbackPolicyOrdinal: z
      .number()
      .int()
      .min(0)
      .max(INBOX_V2_ROUTE_POLICY_FALLBACK_MAX - 1)
      .nullable()
  })
  .strict()
  .superRefine((result, context) => {
    if (
      (result.selectionReason === "policy_fallback") !==
      (result.fallbackPolicyOrdinal !== null)
    ) {
      addIssue(
        context,
        ["fallbackPolicyOrdinal"],
        "Only an explicit policy fallback carries its allowlist ordinal."
      );
    }
  });

const failedRouteResultSchema = z
  .object({
    kind: z.literal("failed"),
    error: inboxV2OutboundRouteErrorSchema
  })
  .strict();

export const inboxV2OutboundRouteSelectionResultSchema = z.discriminatedUnion(
  "kind",
  [selectedRouteResultSchema, failedRouteResultSchema]
);

/**
 * Pure deterministic selection. It validates its bounded input and never reads
 * global state, database order or a Client/contact field.
 */
export function resolveInboxV2OutboundRoute(
  input: unknown
): InboxV2OutboundRouteSelectionResult {
  const parsed = inboxV2OutboundRouteResolutionInputSchema.safeParse(input);

  if (!parsed.success) {
    return failedRoute("route.invalid_intent");
  }

  const request = parsed.data;
  if (request.intent.kind !== "automatic") {
    const candidate = request.candidates.explicitTarget;
    if (candidate === null) {
      return failedRoute("route.not_found");
    }
    const failure = candidateSelectionError(
      candidate,
      request.referenceContext,
      request.requestedAt
    );
    if (failure !== null) {
      return { kind: "failed", error: failure };
    }
    return {
      kind: "selected",
      candidate,
      selectionReason: request.intent.kind,
      fallbackPolicyOrdinal: null
    };
  }

  const preferred = request.candidates.preferredCandidate;
  if (preferred !== null) {
    return {
      kind: "selected",
      candidate: preferred,
      selectionReason: "preferred_binding",
      fallbackPolicyOrdinal: null
    };
  }

  const sole = request.candidates.soleEligibleCandidate;
  if (sole !== null) {
    return {
      kind: "selected",
      candidate: sole,
      selectionReason: "sole_eligible_binding",
      fallbackPolicyOrdinal: null
    };
  }

  const fallback = request.candidates.fallbackCandidate;
  if (fallback !== null) {
    return {
      kind: "selected",
      candidate: fallback.candidate,
      selectionReason: "policy_fallback",
      fallbackPolicyOrdinal: fallback.policyOrdinal
    };
  }

  if (request.candidates.automaticCompatibleEligibleCount === 0) {
    return {
      kind: "failed",
      error:
        request.candidates.zeroCandidateError ?? routeError("route.not_found")
    };
  }

  return failedRoute("route.ambiguous");
}

const routeSelectionAuditSchema = z
  .object({
    intent: inboxV2OutboundRouteIntentSchema,
    reason: inboxV2OutboundRouteSelectionReasonSchema,
    candidateSnapshotToken: inboxV2RoutingTokenSchema,
    candidateSnapshotNotAfter: inboxV2TimestampSchema,
    fallbackPolicyOrdinal: z
      .number()
      .int()
      .min(0)
      .max(INBOX_V2_ROUTE_POLICY_FALLBACK_MAX - 1)
      .nullable(),
    selectedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((audit, context) => {
    if (
      (audit.reason === "policy_fallback") !==
      (audit.fallbackPolicyOrdinal !== null)
    ) {
      addIssue(
        context,
        ["fallbackPolicyOrdinal"],
        "Fallback audit is present only for policy fallback selection."
      );
    }
  });

/** Immutable provider destination pinned before OutboundDispatch creation. */
export const inboxV2OutboundRouteSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2OutboundRouteIdSchema,
    principal: inboxV2OutboundRoutePrincipalSchema,
    conversation: inboxV2ConversationReferenceSchema,
    externalThread: inboxV2ExternalThreadReferenceSchema,
    sourceThreadBinding: inboxV2SourceThreadBindingReferenceSchema,
    sourceAccount: inboxV2SourceAccountReferenceSchema,
    sourceConnection: inboxV2SourceConnectionReferenceSchema,
    operationId: inboxV2SourceOperationIdSchema,
    contentKindId: inboxV2SourceContentKindIdSchema.nullable(),
    authorizationEpoch: inboxV2AuthorizationEpochSchema,
    requiredConversationPermissionId: inboxV2SourcePermissionIdSchema,
    bindingFence: inboxV2SourceThreadBindingFenceSchema,
    adapterContract: inboxV2AdapterContractSnapshotSchema,
    routeDescriptor: inboxV2OpaqueAdapterRouteDescriptorSchema,
    routePolicy: inboxV2ThreadRoutePolicyReferenceSchema,
    routePolicyRevision: inboxV2EntityRevisionSchema,
    conversationAuthorization:
      inboxV2ConversationRouteAuthorizationDecisionSchema,
    sourceAccountAuthorization:
      inboxV2SourceAccountRouteAuthorizationDecisionSchema,
    referenceContext: inboxV2OutboundRouteReferenceContextSchema,
    runtimeObservationAtResolution:
      inboxV2OutboundRouteRuntimeObservationSchema,
    selection: routeSelectionAuditSchema,
    mutationToken: inboxV2RoutingTokenSchema,
    idempotencyToken: inboxV2RoutingTokenSchema,
    correlationToken: inboxV2RoutingTokenSchema,
    revision: inboxV2EntityRevisionSchema,
    createdAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((route, context) => {
    if (route.principal.kind === "employee") {
      addTenantReferenceIssue(
        context,
        route.tenantId,
        route.principal.employee,
        ["principal", "employee"]
      );
    }
    for (const [field, reference] of [
      ["conversation", route.conversation],
      ["externalThread", route.externalThread],
      ["sourceThreadBinding", route.sourceThreadBinding],
      ["sourceAccount", route.sourceAccount],
      ["sourceConnection", route.sourceConnection],
      ["routePolicy", route.routePolicy]
    ] as const) {
      addTenantReferenceIssue(context, route.tenantId, reference, [field]);
    }
    if (route.referenceContext.kind === "external_message") {
      addReferenceContextTenantIssues(
        context,
        route.tenantId,
        route.externalThread,
        route.referenceContext,
        ["referenceContext"]
      );
    }
    if (route.selection.intent.kind !== "automatic") {
      addIntentTenantIssues(context, route.tenantId, route.selection.intent, [
        "selection",
        "intent"
      ]);
    }
    if (String(route.revision) !== "1") {
      addIssue(
        context,
        ["revision"],
        "Immutable OutboundRoute remains at revision 1."
      );
    }
    if (route.createdAt !== route.selection.selectedAt) {
      addIssue(
        context,
        ["createdAt"],
        "OutboundRoute creation is the immutable route-selection boundary."
      );
    }
    if (
      Date.parse(route.createdAt) >
      Date.parse(route.selection.candidateSnapshotNotAfter)
    ) {
      addIssue(
        context,
        ["selection", "candidateSnapshotNotAfter"],
        "Route must be created while its bounded candidate snapshot is current."
      );
    }
    if (
      !sameAdapterContractSnapshot(
        route.adapterContract,
        route.routeDescriptor.adapterContract
      )
    ) {
      addIssue(
        context,
        ["routeDescriptor", "adapterContract"],
        "Stored route descriptor must use the pinned route adapter snapshot."
      );
    }
    if (
      String(route.bindingFence.routeDescriptorRevision) !==
      String(route.routeDescriptor.descriptorRevision)
    ) {
      addIssue(
        context,
        ["bindingFence", "routeDescriptorRevision"],
        "Stored route fence must pin the exact descriptor revision."
      );
    }
    addStoredRouteAuthorizationIssues(context, route);
    addStoredRouteIntentIssues(context, route);
  });

/**
 * Atomic resolution proof. A failed result requires no route; a selected result
 * must create exactly the immutable route described by that candidate.
 */
export const inboxV2OutboundRouteResolutionCommitSchema = z
  .object({
    input: inboxV2OutboundRouteResolutionInputSchema,
    result: inboxV2OutboundRouteSelectionResultSchema,
    route: inboxV2OutboundRouteSchema.nullable()
  })
  .strict()
  .superRefine((commit, context) => {
    const expected = resolveInboxV2OutboundRoute(commit.input);
    if (!sameValue(expected, commit.result)) {
      addIssue(
        context,
        ["result"],
        "Resolution result must equal the deterministic bounded resolver output."
      );
      return;
    }
    const { input, result, route } = commit;
    if (result.kind === "failed") {
      if (route !== null) {
        addIssue(
          context,
          ["route"],
          "Failed resolution cannot create an OutboundRoute."
        );
      }
      return;
    }
    if (route === null) {
      addIssue(
        context,
        ["route"],
        "Selected resolution requires one immutable OutboundRoute."
      );
      return;
    }
    addRouteSelectionCommitIssues(context, { input, result, route });
  });

export const inboxV2ThreadRoutePolicyEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_THREAD_ROUTE_POLICY_SCHEMA_ID,
    INBOX_V2_OUTBOUND_ROUTE_SCHEMA_VERSION,
    inboxV2ThreadRoutePolicySchema
  );
export const inboxV2OutboundRouteResolutionInputEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_OUTBOUND_ROUTE_RESOLUTION_INPUT_SCHEMA_ID,
    INBOX_V2_OUTBOUND_ROUTE_SCHEMA_VERSION,
    inboxV2OutboundRouteResolutionInputSchema
  );
export const inboxV2OutboundRouteSelectionResultEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_OUTBOUND_ROUTE_SELECTION_RESULT_SCHEMA_ID,
    INBOX_V2_OUTBOUND_ROUTE_SCHEMA_VERSION,
    inboxV2OutboundRouteSelectionResultSchema
  );
export const inboxV2OutboundRouteEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_OUTBOUND_ROUTE_SCHEMA_ID,
    INBOX_V2_OUTBOUND_ROUTE_SCHEMA_VERSION,
    inboxV2OutboundRouteSchema
  );
export const inboxV2OutboundRouteResolutionCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_OUTBOUND_ROUTE_RESOLUTION_COMMIT_SCHEMA_ID,
    INBOX_V2_OUTBOUND_ROUTE_SCHEMA_VERSION,
    inboxV2OutboundRouteResolutionCommitSchema
  );

export type InboxV2OutboundRouteError = z.infer<
  typeof inboxV2OutboundRouteErrorSchema
>;
export type InboxV2OutboundRoutePrincipal = z.infer<
  typeof inboxV2OutboundRoutePrincipalSchema
>;
export type InboxV2ConversationRouteAuthorizationDecision = z.infer<
  typeof inboxV2ConversationRouteAuthorizationDecisionSchema
>;
export type InboxV2SourceAccountRouteAuthorizationDecision = z.infer<
  typeof inboxV2SourceAccountRouteAuthorizationDecisionSchema
>;
export type InboxV2ThreadRoutePolicy = z.infer<
  typeof inboxV2ThreadRoutePolicySchema
>;
export type InboxV2OutboundRouteIntent = z.infer<
  typeof inboxV2OutboundRouteIntentSchema
>;
export type InboxV2OutboundRouteReferenceContext = z.infer<
  typeof inboxV2OutboundRouteReferenceContextSchema
>;
export type InboxV2OutboundRouteCandidate = z.infer<
  typeof inboxV2OutboundRouteCandidateSchema
>;
export type InboxV2OutboundRouteCandidateSnapshot = z.infer<
  typeof inboxV2OutboundRouteCandidateSnapshotSchema
>;
export type InboxV2OutboundRouteResolutionInput = z.infer<
  typeof inboxV2OutboundRouteResolutionInputSchema
>;
export type InboxV2OutboundRouteSelectionResult = z.infer<
  typeof inboxV2OutboundRouteSelectionResultSchema
>;
export type InboxV2OutboundRoute = z.infer<typeof inboxV2OutboundRouteSchema>;
export type InboxV2OutboundRouteResolutionCommit = z.infer<
  typeof inboxV2OutboundRouteResolutionCommitSchema
>;

type RouteAuthorizationDecision =
  | z.infer<typeof inboxV2ConversationRouteAuthorizationDecisionSchema>
  | z.infer<typeof inboxV2SourceAccountRouteAuthorizationDecisionSchema>;

function addAuthorizationDecisionIssues(
  decision: RouteAuthorizationDecision,
  context: z.RefinementCtx
): void {
  addDuplicateStringIssues(context, decision.matchedPermissionIds, [
    "matchedPermissionIds"
  ]);
  if (
    decision.effect === "allow" &&
    !decision.matchedPermissionIds.some(
      (permissionId) =>
        String(permissionId) === String(decision.requiredPermissionId)
    )
  ) {
    addIssue(
      context,
      ["matchedPermissionIds"],
      "An allow decision must match its exact typed authorization purpose."
    );
  }
  if (!isInboxV2TimestampOrderValid(decision.decidedAt, decision.notAfter)) {
    addIssue(
      context,
      ["notAfter"],
      "Authorization decision expiry cannot predate its decision time."
    );
  }
  for (const [field, reference] of [
    ["conversation", decision.target.conversation],
    ["externalThread", decision.target.externalThread],
    ["sourceThreadBinding", decision.target.sourceThreadBinding],
    ["sourceAccount", decision.target.sourceAccount],
    ["sourceConnection", decision.target.sourceConnection]
  ] as const) {
    addTenantReferenceIssue(context, decision.tenantId, reference, [
      "target",
      field
    ]);
  }
  if (decision.principal.kind === "employee") {
    addTenantReferenceIssue(
      context,
      decision.tenantId,
      decision.principal.employee,
      ["principal", "employee"]
    );
  }
}

function addCandidateAuthorizationIssues(
  context: z.RefinementCtx,
  candidate: InboxV2OutboundRouteCandidate,
  decision:
    | InboxV2ConversationRouteAuthorizationDecision
    | InboxV2SourceAccountRouteAuthorizationDecision,
  path: PropertyKey[]
): void {
  const target = decision.target;
  if (
    decision.tenantId !== candidate.tenantId ||
    !sameReference(target.conversation, candidate.conversation) ||
    !sameReference(target.externalThread, candidate.externalThread) ||
    !sameReference(target.sourceThreadBinding, candidate.sourceThreadBinding) ||
    !sameReference(target.sourceAccount, candidate.sourceAccount) ||
    !sameReference(target.sourceConnection, candidate.sourceConnection) ||
    target.operationId !== candidate.operationId ||
    target.contentKindId !== candidate.contentKindId ||
    target.authorizationEpoch !== candidate.authorizationEpoch ||
    !sameValue(target.bindingFence, candidate.bindingFence)
  ) {
    addIssue(
      context,
      path,
      "Authorization decision must bind the candidate's exact tenant, thread, account, operation, epoch and fence."
    );
  }
}

function candidateSnapshotSlots(
  snapshot: InboxV2OutboundRouteCandidateSnapshot
): readonly [string, InboxV2OutboundRouteCandidate | null][] {
  return [
    ["explicitTarget", snapshot.explicitTarget],
    ["preferredCandidate", snapshot.preferredCandidate],
    ["soleEligibleCandidate", snapshot.soleEligibleCandidate],
    ["fallbackCandidate", snapshot.fallbackCandidate?.candidate ?? null]
  ];
}

function addCandidateSnapshotContextIssues(
  context: z.RefinementCtx,
  snapshot: InboxV2OutboundRouteCandidateSnapshot,
  candidate: InboxV2OutboundRouteCandidate,
  path: PropertyKey[]
): void {
  if (
    candidate.tenantId !== snapshot.tenantId ||
    !sameReference(candidate.conversation, snapshot.conversation) ||
    !sameReference(candidate.externalThread, snapshot.externalThread) ||
    candidate.operationId !== snapshot.operationId ||
    candidate.contentKindId !== snapshot.contentKindId ||
    candidate.authorizationEpoch !== snapshot.authorizationEpoch
  ) {
    addIssue(
      context,
      path,
      "Candidate snapshot slots must share one exact resolution context."
    );
  }
  for (const [field, decision] of [
    ["conversationAuthorization", candidate.conversationAuthorization],
    ["sourceAccountAuthorization", candidate.sourceAccountAuthorization]
  ] as const) {
    if (
      Date.parse(decision.decidedAt) > Date.parse(snapshot.loadedAt) ||
      Date.parse(decision.notAfter) < Date.parse(snapshot.loadedAt)
    ) {
      addIssue(
        context,
        [...path, field, "notAfter"],
        "Candidate authorization must be current at the trusted snapshot boundary."
      );
    }
  }
}

function addResolutionInputContextIssues(
  context: z.RefinementCtx,
  input: InboxV2OutboundRouteResolutionInput
): void {
  for (const [field, reference] of [
    ["conversation", input.conversation],
    ["externalThread", input.externalThread]
  ] as const) {
    addTenantReferenceIssue(context, input.tenantId, reference, [field]);
  }
  if (input.principal.kind === "employee") {
    addTenantReferenceIssue(context, input.tenantId, input.principal.employee, [
      "principal",
      "employee"
    ]);
  }
  if (
    input.routePolicy.tenantId !== input.tenantId ||
    input.candidates.tenantId !== input.tenantId ||
    !sameReference(input.routePolicy.conversation, input.conversation) ||
    !sameReference(input.candidates.conversation, input.conversation) ||
    !sameReference(input.routePolicy.externalThread, input.externalThread) ||
    !sameReference(input.candidates.externalThread, input.externalThread) ||
    input.routePolicy.operationId !== input.operationId ||
    input.candidates.operationId !== input.operationId ||
    input.routePolicy.contentKindId !== input.contentKindId ||
    input.candidates.contentKindId !== input.contentKindId ||
    input.candidates.authorizationEpoch !== input.authorizationEpoch ||
    !sameReference(
      input.candidates.routePolicy,
      policyReferenceOf(input.routePolicy)
    ) ||
    String(input.candidates.routePolicyRevision) !==
      String(input.routePolicy.revision)
  ) {
    addIssue(
      context,
      ["candidates"],
      "Policy and bounded candidate snapshot must match the exact route request."
    );
  }
  if (Date.parse(input.candidates.loadedAt) > Date.parse(input.requestedAt)) {
    addIssue(
      context,
      ["requestedAt"],
      "Route request cannot predate its server-loaded candidate snapshot."
    );
  }
  if (Date.parse(input.candidates.notAfter) < Date.parse(input.requestedAt)) {
    addIssue(
      context,
      ["candidates", "notAfter"],
      "Route request requires a current bounded candidate snapshot."
    );
  }
  if (input.referenceContext.kind === "external_message") {
    addReferenceContextTenantIssues(
      context,
      input.tenantId,
      input.externalThread,
      input.referenceContext,
      ["referenceContext"]
    );
    addReferenceResolutionDecisionIssues(
      context,
      input.referenceContext,
      input.requestedAt,
      ["referenceContext", "resolutionDecision"]
    );
  }
  for (const [, candidate] of candidateSnapshotSlots(input.candidates)) {
    if (candidate !== null) {
      if (
        !samePrincipal(
          candidate.conversationAuthorization.principal,
          input.principal
        )
      ) {
        addIssue(
          context,
          ["candidates"],
          "Every candidate must be authorized for the exact request principal."
        );
      }
      if (
        candidate.conversationAuthorization.requiredPermissionId !==
        input.routePolicy.requiredConversationPermissionId
      ) {
        addIssue(
          context,
          ["candidates", "conversationAuthorization", "requiredPermissionId"],
          "Conversation authorization must prove the operation policy's exact permission."
        );
      }
      for (const [field, decision] of [
        ["conversationAuthorization", candidate.conversationAuthorization],
        ["sourceAccountAuthorization", candidate.sourceAccountAuthorization]
      ] as const) {
        if (Date.parse(decision.notAfter) < Date.parse(input.requestedAt)) {
          addIssue(
            context,
            ["candidates", field, "notAfter"],
            "Route authorization must remain current at request time."
          );
        }
        if (
          !sameValue(
            decision.target.referenceTarget,
            referenceAuthorizationTargetOf(input.referenceContext)
          )
        ) {
          addIssue(
            context,
            ["candidates", field, "target", "referenceTarget"],
            "Route authorization must bind the exact message reference and occurrence."
          );
        }
      }
    }
  }
}

function addResolutionIntentIssues(
  context: z.RefinementCtx,
  input: InboxV2OutboundRouteResolutionInput
): void {
  const explicit = input.candidates.explicitTarget;
  addIntentTenantIssues(context, input.tenantId, input.intent, ["intent"]);
  if (input.intent.kind === "automatic") {
    if (explicit !== null) {
      addIssue(
        context,
        ["candidates", "explicitTarget"],
        "Automatic routing does not carry an explicit target."
      );
    }
    return;
  }
  if (explicit === null) {
    return;
  }
  if (
    input.intent.kind === "explicit_binding" &&
    !sameReference(input.intent.binding, explicit.sourceThreadBinding)
  ) {
    addIssue(
      context,
      ["candidates", "explicitTarget", "sourceThreadBinding"],
      "Explicit binding intent must load only that exact binding."
    );
  }
  if (input.intent.kind === "explicit_occurrence") {
    if (
      input.referenceContext.kind !== "external_message" ||
      !sameReference(
        input.intent.occurrence,
        input.referenceContext.sourceOccurrence
      ) ||
      !sameReference(
        explicit.sourceThreadBinding,
        input.referenceContext.originBinding
      )
    ) {
      addIssue(
        context,
        ["intent"],
        "Explicit occurrence intent pins that occurrence's exact origin binding."
      );
    }
  }
  if (
    input.intent.kind === "explicit_reroute" &&
    !sameReference(
      input.intent.replacementBinding,
      explicit.sourceThreadBinding
    )
  ) {
    addIssue(
      context,
      ["candidates", "explicitTarget", "sourceThreadBinding"],
      "Explicit reroute must load only its named replacement binding."
    );
  }
}

function addResolutionPolicySlotIssues(
  context: z.RefinementCtx,
  input: InboxV2OutboundRouteResolutionInput
): void {
  const { preferredCandidate, soleEligibleCandidate, fallbackCandidate } =
    input.candidates;
  if (preferredCandidate !== null) {
    if (
      input.routePolicy.preferredBinding === null ||
      !sameReference(
        preferredCandidate.sourceThreadBinding,
        input.routePolicy.preferredBinding
      )
    ) {
      addIssue(
        context,
        ["candidates", "preferredCandidate"],
        "Preferred candidate must be the exact current policy preference."
      );
    }
    addSelectableReferenceCompatibilityIssue(
      context,
      preferredCandidate,
      input.referenceContext,
      input.requestedAt,
      ["candidates", "preferredCandidate"]
    );
  }
  if (soleEligibleCandidate !== null) {
    addSelectableReferenceCompatibilityIssue(
      context,
      soleEligibleCandidate,
      input.referenceContext,
      input.requestedAt,
      ["candidates", "soleEligibleCandidate"]
    );
  }
  if (fallbackCandidate !== null) {
    if (input.routePolicy.fallback.kind !== "ordered_allowlist") {
      addIssue(
        context,
        ["candidates", "fallbackCandidate"],
        "Fallback candidate requires an explicit ordered policy allowlist."
      );
    } else {
      const allowed =
        input.routePolicy.fallback.allowedBindings[
          fallbackCandidate.policyOrdinal
        ];
      if (
        allowed === undefined ||
        !sameReference(allowed, fallbackCandidate.candidate.sourceThreadBinding)
      ) {
        addIssue(
          context,
          ["candidates", "fallbackCandidate", "policyOrdinal"],
          "Fallback candidate must match its exact deterministic allowlist ordinal."
        );
      }
    }
    addSelectableReferenceCompatibilityIssue(
      context,
      fallbackCandidate.candidate,
      input.referenceContext,
      input.requestedAt,
      ["candidates", "fallbackCandidate", "candidate"]
    );
  }
}

function addSelectableReferenceCompatibilityIssue(
  context: z.RefinementCtx,
  candidate: InboxV2OutboundRouteCandidate,
  referenceContext: InboxV2OutboundRouteReferenceContext,
  requestedAt: string,
  path: PropertyKey[]
): void {
  if (
    referenceCompatibilityError(candidate, referenceContext, requestedAt) !==
    null
  ) {
    addIssue(
      context,
      path,
      "Selectable candidate must be compatible with the exact message reference."
    );
  }
}

function candidateSelectionError(
  candidate: InboxV2OutboundRouteCandidate,
  referenceContext: InboxV2OutboundRouteReferenceContext,
  requestedAt: string
): InboxV2OutboundRouteError | null {
  if (candidate.eligibility.state === "ineligible") {
    return candidate.eligibility.error;
  }
  if (
    candidate.conversationAuthorization.effect !== "allow" ||
    candidate.sourceAccountAuthorization.effect !== "allow"
  ) {
    return routeError("route.forbidden");
  }
  return referenceCompatibilityError(candidate, referenceContext, requestedAt);
}

function referenceCompatibilityError(
  candidate: InboxV2OutboundRouteCandidate,
  referenceContext: InboxV2OutboundRouteReferenceContext,
  requestedAt: string
): InboxV2OutboundRouteError | null {
  if (referenceContext.kind === "none") {
    return null;
  }
  if (
    !sameReference(candidate.externalThread, referenceContext.externalThread)
  ) {
    return routeError("route.audience_mismatch");
  }
  if (
    referenceContext.resolutionDecision.referenceWindow.state === "expired" ||
    (referenceContext.resolutionDecision.referenceWindow.state === "valid" &&
      Date.parse(referenceContext.resolutionDecision.referenceWindow.notAfter) <
        Date.parse(requestedAt))
  ) {
    return routeError("route.reply_window_expired");
  }
  if (
    !sameAdapterContractSnapshot(
      candidate.adapterContract,
      referenceContext.portability.adapterContract
    )
  ) {
    return routeError("route.reference_nonportable");
  }
  if (
    referenceContext.portability.kind === "binding_only" &&
    (!sameReference(
      candidate.sourceThreadBinding,
      referenceContext.originBinding
    ) ||
      !sameReference(
        candidate.sourceAccount,
        referenceContext.originSourceAccount
      ))
  ) {
    return routeError("route.reference_nonportable");
  }
  return null;
}

function addRouteSelectionCommitIssues(
  context: z.RefinementCtx,
  commit: {
    input: InboxV2OutboundRouteResolutionInput;
    result: Extract<InboxV2OutboundRouteSelectionResult, { kind: "selected" }>;
    route: InboxV2OutboundRoute;
  }
): void {
  const { input, result, route } = commit;
  const candidate = result.candidate;
  const exactPairs: readonly [PropertyKey[], unknown, unknown][] = [
    [["tenantId"], route.tenantId, input.tenantId],
    [["principal"], route.principal, input.principal],
    [["conversation"], route.conversation, candidate.conversation],
    [["externalThread"], route.externalThread, candidate.externalThread],
    [
      ["sourceThreadBinding"],
      route.sourceThreadBinding,
      candidate.sourceThreadBinding
    ],
    [["sourceAccount"], route.sourceAccount, candidate.sourceAccount],
    [["sourceConnection"], route.sourceConnection, candidate.sourceConnection],
    [["operationId"], route.operationId, input.operationId],
    [["contentKindId"], route.contentKindId, input.contentKindId],
    [
      ["authorizationEpoch"],
      route.authorizationEpoch,
      input.authorizationEpoch
    ],
    [
      ["requiredConversationPermissionId"],
      route.requiredConversationPermissionId,
      input.routePolicy.requiredConversationPermissionId
    ],
    [["bindingFence"], route.bindingFence, candidate.bindingFence],
    [["adapterContract"], route.adapterContract, candidate.adapterContract],
    [["routeDescriptor"], route.routeDescriptor, candidate.routeDescriptor],
    [["routePolicy"], route.routePolicy, policyReferenceOf(input.routePolicy)],
    [
      ["routePolicyRevision"],
      route.routePolicyRevision,
      input.routePolicy.revision
    ],
    [
      ["conversationAuthorization"],
      route.conversationAuthorization,
      candidate.conversationAuthorization
    ],
    [
      ["sourceAccountAuthorization"],
      route.sourceAccountAuthorization,
      candidate.sourceAccountAuthorization
    ],
    [["referenceContext"], route.referenceContext, input.referenceContext],
    [
      ["runtimeObservationAtResolution"],
      route.runtimeObservationAtResolution,
      candidate.runtimeObservation
    ],
    [["selection", "intent"], route.selection.intent, input.intent],
    [["selection", "reason"], route.selection.reason, result.selectionReason],
    [
      ["selection", "candidateSnapshotToken"],
      route.selection.candidateSnapshotToken,
      input.candidates.snapshotToken
    ],
    [
      ["selection", "candidateSnapshotNotAfter"],
      route.selection.candidateSnapshotNotAfter,
      input.candidates.notAfter
    ],
    [
      ["selection", "fallbackPolicyOrdinal"],
      route.selection.fallbackPolicyOrdinal,
      result.fallbackPolicyOrdinal
    ],
    [["mutationToken"], route.mutationToken, input.mutationToken],
    [["idempotencyToken"], route.idempotencyToken, input.idempotencyToken],
    [["correlationToken"], route.correlationToken, input.correlationToken]
  ];
  for (const [path, actual, expected] of exactPairs) {
    if (!sameValue(actual, expected)) {
      addIssue(
        context,
        ["route", ...path],
        "Immutable route must exactly preserve the selected candidate and request."
      );
    }
  }
  if (!isInboxV2TimestampOrderValid(input.requestedAt, route.createdAt)) {
    addIssue(
      context,
      ["route", "createdAt"],
      "Immutable route cannot be created before the route request."
    );
  }
}

function addReferenceContextTenantIssues(
  context: z.RefinementCtx,
  tenantId: string,
  externalThread: { tenantId: string; kind: string; id: string },
  referenceContext: Extract<
    InboxV2OutboundRouteReferenceContext,
    { kind: "external_message" }
  >,
  path: PropertyKey[]
): void {
  for (const [field, reference] of [
    ["externalThread", referenceContext.externalThread],
    ["externalMessageReference", referenceContext.externalMessageReference],
    ["sourceOccurrence", referenceContext.sourceOccurrence],
    ["originBinding", referenceContext.originBinding],
    ["originSourceAccount", referenceContext.originSourceAccount]
  ] as const) {
    addTenantReferenceIssue(context, tenantId, reference, [...path, field]);
  }
  if (!sameReference(referenceContext.externalThread, externalThread)) {
    addIssue(
      context,
      [...path, "externalThread"],
      "Outbound message reference cannot cross ExternalThread."
    );
  }
  const decision = referenceContext.resolutionDecision;
  if (
    decision.tenantId !== tenantId ||
    !sameReference(decision.externalThread, referenceContext.externalThread) ||
    !sameReference(
      decision.externalMessageReference,
      referenceContext.externalMessageReference
    ) ||
    !sameReference(
      decision.sourceOccurrence,
      referenceContext.sourceOccurrence
    ) ||
    !sameReference(decision.originBinding, referenceContext.originBinding) ||
    !sameReference(
      decision.originSourceAccount,
      referenceContext.originSourceAccount
    ) ||
    !sameValue(decision.portability, referenceContext.portability)
  ) {
    addIssue(
      context,
      [...path, "resolutionDecision"],
      "Trusted reference decision must bind the exact thread, reference, occurrence, origin and portability evidence."
    );
  }
}

function addReferenceResolutionDecisionIssues(
  context: z.RefinementCtx,
  referenceContext: Extract<
    InboxV2OutboundRouteReferenceContext,
    { kind: "external_message" }
  >,
  at: string,
  path: PropertyKey[]
): void {
  const decision = referenceContext.resolutionDecision;
  if (
    Date.parse(decision.decidedAt) > Date.parse(at) ||
    Date.parse(decision.notAfter) < Date.parse(at)
  ) {
    addIssue(
      context,
      [...path, "notAfter"],
      "Exact reference-resolution authority must be current at route selection."
    );
  }
}

function referenceAuthorizationTargetOf(
  context: InboxV2OutboundRouteReferenceContext
): z.infer<typeof routeAuthorizationTargetSchema>["referenceTarget"] {
  return context.kind === "none"
    ? { kind: "none" }
    : {
        kind: "external_message",
        externalMessageReference: context.externalMessageReference,
        sourceOccurrence: context.sourceOccurrence
      };
}

function addStoredRouteAuthorizationIssues(
  context: z.RefinementCtx,
  route: InboxV2OutboundRoute
): void {
  const expectedTarget = {
    conversation: route.conversation,
    externalThread: route.externalThread,
    sourceThreadBinding: route.sourceThreadBinding,
    sourceAccount: route.sourceAccount,
    sourceConnection: route.sourceConnection,
    operationId: route.operationId,
    contentKindId: route.contentKindId,
    authorizationEpoch: route.authorizationEpoch,
    bindingFence: route.bindingFence,
    referenceTarget: referenceAuthorizationTargetOf(route.referenceContext)
  };
  for (const [field, decision] of [
    ["conversationAuthorization", route.conversationAuthorization],
    ["sourceAccountAuthorization", route.sourceAccountAuthorization]
  ] as const) {
    if (
      decision.tenantId !== route.tenantId ||
      !samePrincipal(decision.principal, route.principal) ||
      !sameValue(decision.target, expectedTarget) ||
      decision.effect !== "allow" ||
      Date.parse(decision.decidedAt) > Date.parse(route.createdAt) ||
      Date.parse(decision.notAfter) < Date.parse(route.createdAt)
    ) {
      addIssue(
        context,
        [field],
        "Stored route requires two current allow decisions for its exact principal, target, epoch and fence."
      );
    }
  }
  if (
    route.conversationAuthorization.requiredPermissionId !==
    route.requiredConversationPermissionId
  ) {
    addIssue(
      context,
      ["conversationAuthorization", "requiredPermissionId"],
      "Stored route must preserve its exact operation-specific Conversation permission."
    );
  }
  if (route.referenceContext.kind === "external_message") {
    addReferenceResolutionDecisionIssues(
      context,
      route.referenceContext,
      route.createdAt,
      ["referenceContext", "resolutionDecision"]
    );
    const window = route.referenceContext.resolutionDecision.referenceWindow;
    if (
      window.state === "expired" ||
      (window.state === "valid" &&
        Date.parse(window.notAfter) < Date.parse(route.createdAt))
    ) {
      addIssue(
        context,
        ["referenceContext", "resolutionDecision", "referenceWindow"],
        "Stored route requires a reference window valid at route creation."
      );
    }
  }
}

function addStoredRouteIntentIssues(
  context: z.RefinementCtx,
  route: InboxV2OutboundRoute
): void {
  const { intent, reason } = route.selection;
  if (intent.kind === "automatic") {
    if (
      reason !== "preferred_binding" &&
      reason !== "sole_eligible_binding" &&
      reason !== "policy_fallback"
    ) {
      addIssue(
        context,
        ["selection", "reason"],
        "Automatic route audit requires an automatic selection reason."
      );
    }
    return;
  }
  if (reason !== intent.kind) {
    addIssue(
      context,
      ["selection", "reason"],
      "Explicit route audit reason must match its fail-stop intent."
    );
  }
  if (
    intent.kind === "explicit_binding" &&
    !sameReference(intent.binding, route.sourceThreadBinding)
  ) {
    addIssue(
      context,
      ["selection", "intent", "binding"],
      "Stored explicit-binding route must use only its named binding."
    );
  }
  if (intent.kind === "explicit_occurrence") {
    if (
      route.referenceContext.kind !== "external_message" ||
      !sameReference(
        intent.occurrence,
        route.referenceContext.sourceOccurrence
      ) ||
      !sameReference(
        route.sourceThreadBinding,
        route.referenceContext.originBinding
      )
    ) {
      addIssue(
        context,
        ["selection", "intent"],
        "Stored explicit-occurrence route must retain the exact occurrence origin."
      );
    }
  }
  if (
    intent.kind === "explicit_reroute" &&
    !sameReference(intent.replacementBinding, route.sourceThreadBinding)
  ) {
    addIssue(
      context,
      ["selection", "intent", "replacementBinding"],
      "Stored reroute must use only its named replacement binding."
    );
  }
}

function addIntentTenantIssues(
  context: z.RefinementCtx,
  tenantId: string,
  intent: InboxV2OutboundRouteIntent,
  path: PropertyKey[]
): void {
  if (intent.kind === "explicit_binding") {
    addTenantReferenceIssue(context, tenantId, intent.binding, [
      ...path,
      "binding"
    ]);
  }
  if (intent.kind === "explicit_occurrence") {
    addTenantReferenceIssue(context, tenantId, intent.occurrence, [
      ...path,
      "occurrence"
    ]);
  }
  if (intent.kind === "explicit_reroute") {
    addTenantReferenceIssue(context, tenantId, intent.originalRoute, [
      ...path,
      "originalRoute"
    ]);
    addTenantReferenceIssue(context, tenantId, intent.replacementBinding, [
      ...path,
      "replacementBinding"
    ]);
  }
}

function policyReferenceOf(
  policy: InboxV2ThreadRoutePolicy
): z.infer<typeof inboxV2ThreadRoutePolicyReferenceSchema> {
  return inboxV2ThreadRoutePolicyReferenceSchema.parse({
    tenantId: policy.tenantId,
    kind: "thread_route_policy",
    id: policy.id
  });
}

function routeError(
  code: z.infer<typeof inboxV2OutboundRouteErrorCodeSchema>
): InboxV2OutboundRouteError {
  return inboxV2OutboundRouteErrorSchema.parse({
    code,
    retryability: routeRetryabilityByCode[code],
    diagnostic: null
  });
}

function failedRoute(
  code: z.infer<typeof inboxV2OutboundRouteErrorCodeSchema>
): InboxV2OutboundRouteSelectionResult {
  return { kind: "failed", error: routeError(code) };
}

function sameAdapterContractSnapshot(
  left: InboxV2AdapterContractSnapshot,
  right: InboxV2AdapterContractSnapshot
): boolean {
  return (
    left.contractId === right.contractId &&
    left.contractVersion === right.contractVersion &&
    String(left.declarationRevision) === String(right.declarationRevision) &&
    left.surfaceId === right.surfaceId &&
    left.loadedByTrustedServiceId === right.loadedByTrustedServiceId &&
    left.loadedAt === right.loadedAt
  );
}

function samePrincipal(
  left: InboxV2OutboundRoutePrincipal,
  right: InboxV2OutboundRoutePrincipal
): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  return left.kind === "employee" && right.kind === "employee"
    ? sameReference(left.employee, right.employee)
    : left.kind === "trusted_service" && right.kind === "trusted_service"
      ? left.trustedServiceId === right.trustedServiceId
      : false;
}

function sameCandidateIdentity(
  left: InboxV2OutboundRouteCandidate,
  right: InboxV2OutboundRouteCandidate
): boolean {
  return sameValue(left, right);
}

function sameReference(
  left: { tenantId: string; kind: string; id: string },
  right: { tenantId: string; kind: string; id: string }
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.kind === right.kind &&
    String(left.id) === String(right.id)
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addTenantReferenceIssue(
  context: z.RefinementCtx,
  tenantId: string,
  reference: { tenantId: string },
  path: PropertyKey[]
): void {
  if (reference.tenantId !== tenantId) {
    addIssue(context, path, "Inbox V2 route references must share one tenant.");
  }
}

function addDuplicateReferenceIssues(
  context: z.RefinementCtx,
  references: readonly { tenantId: string; kind: string; id: string }[],
  path: PropertyKey[],
  label: string
): void {
  const keys = new Set<string>();
  for (const [index, reference] of references.entries()) {
    const key = `${reference.tenantId}\u0000${reference.kind}\u0000${String(reference.id)}`;
    if (keys.has(key)) {
      addIssue(
        context,
        [...path, index],
        `${label} references must be unique.`
      );
    }
    keys.add(key);
  }
}

function addDuplicateStringIssues(
  context: z.RefinementCtx,
  values: readonly string[],
  path: PropertyKey[]
): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) {
      addIssue(context, [...path, index], "Catalog IDs must be unique.");
    }
    seen.add(value);
  }
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
