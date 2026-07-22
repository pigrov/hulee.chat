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
  inboxV2MessageReferenceSchema,
  inboxV2OutboundDispatchArtifactIdSchema,
  inboxV2OutboundDispatchArtifactReferenceLinkIdSchema,
  inboxV2OutboundDispatchArtifactReferenceSchema,
  inboxV2OutboundDispatchAttemptIdSchema,
  inboxV2OutboundDispatchAttemptReferenceSchema,
  inboxV2OutboundDispatchIdSchema,
  inboxV2OutboundDispatchReconciliationDecisionIdSchema,
  inboxV2OutboundDispatchReconciliationDecisionReferenceSchema,
  inboxV2OutboundDispatchReferenceSchema,
  inboxV2OutboundMultiSendOperationIdSchema,
  inboxV2OutboundMultiSendOperationReferenceSchema,
  inboxV2OutboundRouteReferenceSchema,
  inboxV2SourceAccountReferenceSchema,
  inboxV2SourceThreadBindingReferenceSchema,
  inboxV2SourceOccurrenceReferenceSchema,
  inboxV2TenantIdSchema
} from "./ids";
import { inboxV2NamespacedIdSchema } from "./namespace";
import {
  inboxV2SourceOccurrenceResolutionCommitSchema,
  type InboxV2SourceOccurrenceResolutionCommit
} from "./external-message-reference";
import {
  inboxV2OutboundRouteErrorSchema,
  inboxV2OutboundRouteSchema,
  type InboxV2OutboundRoute
} from "./outbound-route";
import { inboxV2SourceThreadBindingCurrentHeadSchema } from "./source-thread-binding";
import { calculateInboxV2CanonicalSha256 } from "./recipient-sync-hash";
import { inboxV2AuthorizationEpochSchema } from "./authorization-epoch";
import {
  inboxV2AdapterContractSnapshotSchema,
  inboxV2RoutingTokenSchema,
  inboxV2RoutingTrustedServiceIdSchema,
  inboxV2SafeSourceDiagnosticSchema,
  inboxV2SourcePermissionIdSchema
} from "./source-routing-primitives";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";
import {
  inboxV2OutboxIntentIdSchema,
  type InboxV2OutboxIntentId
} from "./sync-primitives";

export const INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID =
  "core:inbox-v2.outbound-dispatch" as const;
export const INBOX_V2_OUTBOUND_DISPATCH_ATTEMPT_SCHEMA_ID =
  "core:inbox-v2.outbound-dispatch-attempt" as const;
export const INBOX_V2_OUTBOUND_DISPATCH_ATTEMPT_COMMIT_SCHEMA_ID =
  "core:inbox-v2.outbound-dispatch-attempt-commit" as const;
export const INBOX_V2_OUTBOUND_DISPATCH_RECONCILIATION_DECISION_SCHEMA_ID =
  "core:inbox-v2.outbound-dispatch-reconciliation-decision" as const;
export const INBOX_V2_OUTBOUND_DISPATCH_RECONCILIATION_COMMIT_SCHEMA_ID =
  "core:inbox-v2.outbound-dispatch-reconciliation-commit" as const;
export const INBOX_V2_OUTBOUND_DISPATCH_ROUTE_FAILURE_COMMIT_SCHEMA_ID =
  "core:inbox-v2.outbound-dispatch-route-failure-commit" as const;
export const INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_ID =
  "core:inbox-v2.outbound-dispatch-reroute-commit" as const;
export const INBOX_V2_OUTBOUND_DISPATCH_ARTIFACT_SCHEMA_ID =
  "core:inbox-v2.outbound-dispatch-artifact" as const;
export const INBOX_V2_OUTBOUND_DISPATCH_ARTIFACT_REFERENCE_LINK_SCHEMA_ID =
  "core:inbox-v2.outbound-dispatch-artifact-reference-link" as const;
export const INBOX_V2_OUTBOUND_DISPATCH_ARTIFACT_ASSOCIATION_COMMIT_SCHEMA_ID =
  "core:inbox-v2.outbound-dispatch-artifact-association-commit" as const;
export const INBOX_V2_OUTBOUND_MULTI_SEND_OPERATION_SCHEMA_ID =
  "core:inbox-v2.outbound-multi-send-operation" as const;
export const INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;
export const INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;
export const INBOX_V2_PROVIDER_ARTIFACT_OUTCOMES_MIXED_DIAGNOSTIC_CODE_ID =
  "core:provider-artifact-outcomes-mixed" as const;
export const INBOX_V2_RECONCILE_BEFORE_RETRY_HINT_ID =
  "core:reconcile-before-retry" as const;

/**
 * A mixed provider-artifact result is never a direct retry signal: at least
 * one artifact may already exist remotely. Preserve each artifact diagnostic
 * separately and fence the aggregate attempt with this reconciliation marker.
 */
export function createInboxV2MixedProviderArtifactOutcomeDiagnostic(
  correlationToken: string
) {
  return inboxV2SafeSourceDiagnosticSchema.parse({
    codeId: INBOX_V2_PROVIDER_ARTIFACT_OUTCOMES_MIXED_DIAGNOSTIC_CODE_ID,
    retryable: false,
    correlationToken,
    safeOperatorHintId: INBOX_V2_RECONCILE_BEFORE_RETRY_HINT_ID
  });
}

export const inboxV2OutboundActorSchema = z.discriminatedUnion("kind", [
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
]);

export const inboxV2DispatchRetrySafetySchema = z
  .object({
    adapterContract: inboxV2AdapterContractSnapshotSchema,
    declaredByTrustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
    declarationToken: inboxV2RoutingTokenSchema,
    declaredAt: inboxV2TimestampSchema,
    mechanism: z.enum([
      "provider_idempotency_key",
      "recoverable_client_marker",
      "unsafe_or_unknown"
    ]),
    providerCorrelationToken: inboxV2RoutingTokenSchema.nullable(),
    automaticRetryAllowed: z.boolean()
  })
  .strict()
  .superRefine((safety, context) => {
    if (
      safety.declaredByTrustedServiceId !==
        safety.adapterContract.loadedByTrustedServiceId ||
      !isInboxV2TimestampOrderValid(
        safety.adapterContract.loadedAt,
        safety.declaredAt
      )
    ) {
      addIssue(
        context,
        ["declaredByTrustedServiceId"],
        "Retry safety must be declared by the pinned adapter/runtime after its contract snapshot was loaded."
      );
    }
    if (
      safety.mechanism !== "unsafe_or_unknown" &&
      safety.providerCorrelationToken === null
    ) {
      addIssue(
        context,
        ["providerCorrelationToken"],
        "Proven retry safety requires its exact provider/client correlation token."
      );
    }
    if (
      safety.mechanism === "unsafe_or_unknown" &&
      (safety.automaticRetryAllowed || safety.providerCorrelationToken !== null)
    ) {
      addIssue(
        context,
        ["mechanism"],
        "Unsafe retry safety has neither a proven correlation token nor automatic retry authority."
      );
    }
  });

export const inboxV2OutboundDispatchStateSchema = z.enum([
  "queued",
  "attempting",
  "accepted",
  "retryable_failure",
  "terminal_failure",
  "outcome_unknown",
  "cancelled"
]);

export const inboxV2OutboundDispatchSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2OutboundDispatchIdSchema,
    message: inboxV2MessageReferenceSchema,
    route: inboxV2OutboundRouteReferenceSchema,
    multiSendOperation:
      inboxV2OutboundMultiSendOperationReferenceSchema.nullable(),
    state: inboxV2OutboundDispatchStateSchema,
    attemptCount: z.number().int().min(0).max(1_000_000),
    activeAttempt: inboxV2OutboundDispatchAttemptReferenceSchema.nullable(),
    lastAttempt: inboxV2OutboundDispatchAttemptReferenceSchema.nullable(),
    retryAuthorization:
      inboxV2OutboundDispatchReconciliationDecisionReferenceSchema.nullable(),
    revision: inboxV2EntityRevisionSchema,
    createdAt: inboxV2TimestampSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((dispatch, context) => {
    addTenantReferenceIssue(context, dispatch.tenantId, dispatch.message, [
      "message"
    ]);
    addTenantReferenceIssue(context, dispatch.tenantId, dispatch.route, [
      "route"
    ]);
    if (dispatch.multiSendOperation !== null) {
      addTenantReferenceIssue(
        context,
        dispatch.tenantId,
        dispatch.multiSendOperation,
        ["multiSendOperation"]
      );
    }
    for (const [field, reference] of [
      ["activeAttempt", dispatch.activeAttempt],
      ["lastAttempt", dispatch.lastAttempt],
      ["retryAuthorization", dispatch.retryAuthorization]
    ] as const) {
      if (reference !== null) {
        addTenantReferenceIssue(context, dispatch.tenantId, reference, [field]);
      }
    }

    if (
      dispatch.state === "queued" &&
      (dispatch.attemptCount !== 0 ||
        dispatch.activeAttempt !== null ||
        dispatch.lastAttempt !== null ||
        dispatch.retryAuthorization !== null)
    ) {
      addIssue(
        context,
        ["state"],
        "A queued dispatch has not opened a provider attempt."
      );
    }
    if (
      (dispatch.state === "queued" && dispatch.revision !== "1") ||
      (dispatch.state !== "queued" && dispatch.revision === "1")
    ) {
      addIssue(
        context,
        ["revision"],
        "Outbound dispatch starts queued at revision 1 and every state change advances it."
      );
    }
    if (
      dispatch.state === "attempting" &&
      (dispatch.activeAttempt === null ||
        dispatch.lastAttempt === null ||
        !sameReference(dispatch.activeAttempt, dispatch.lastAttempt) ||
        dispatch.attemptCount < 1)
    ) {
      addIssue(
        context,
        ["activeAttempt"],
        "An attempting dispatch must pin its current durable attempt."
      );
    }
    if (
      dispatch.state !== "queued" &&
      dispatch.state !== "attempting" &&
      dispatch.activeAttempt !== null
    ) {
      addIssue(
        context,
        ["activeAttempt"],
        "A dispatch without provider I/O in progress has no active attempt."
      );
    }
    if (
      dispatch.state !== "retryable_failure" &&
      dispatch.retryAuthorization !== null
    ) {
      addIssue(
        context,
        ["retryAuthorization"],
        "Only a reconciled retryable failure can carry a retry authorization."
      );
    }
    if (
      dispatch.attemptCount > 0 &&
      dispatch.lastAttempt === null &&
      dispatch.state !== "cancelled"
    ) {
      addIssue(
        context,
        ["lastAttempt"],
        "Attempted dispatch must retain its last attempt reference."
      );
    }
    if (!isInboxV2TimestampOrderValid(dispatch.createdAt, dispatch.updatedAt)) {
      addIssue(
        context,
        ["updatedAt"],
        "Outbound dispatch update cannot predate creation."
      );
    }
  });

export const inboxV2OutboundDispatchAttemptOutcomeSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("pending") }).strict(),
    z
      .object({
        kind: z.literal("accepted"),
        completedAt: inboxV2TimestampSchema,
        providerAcknowledgementToken: inboxV2RoutingTokenSchema.nullable()
      })
      .strict(),
    z
      .object({
        kind: z.literal("retryable_failure"),
        completedAt: inboxV2TimestampSchema,
        retryAt: inboxV2TimestampSchema,
        diagnostic: inboxV2SafeSourceDiagnosticSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("terminal_failure"),
        completedAt: inboxV2TimestampSchema,
        diagnostic: inboxV2SafeSourceDiagnosticSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("outcome_unknown"),
        completedAt: inboxV2TimestampSchema,
        diagnostic: inboxV2SafeSourceDiagnosticSchema,
        requiredAction: z.enum([
          "automated_reconciliation_required",
          "operator_duplicate_risk_decision_required"
        ])
      })
      .strict()
  ]
);

export const inboxV2OutboundDispatchAttemptCompletionSourceSchema = z.enum([
  "provider_result",
  "provider_observation",
  "lease_expired",
  "preflight_blocked"
]);

/** A provider-call attempt is opened and committed before any network I/O. */
export const inboxV2OutboundDispatchAttemptSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2OutboundDispatchAttemptIdSchema,
    dispatch: inboxV2OutboundDispatchReferenceSchema,
    route: inboxV2OutboundRouteReferenceSchema,
    attemptNumber: z.number().int().min(1).max(1_000_000),
    claimToken: inboxV2RoutingTokenSchema,
    retrySafety: inboxV2DispatchRetrySafetySchema,
    leaseExpiresAt: inboxV2TimestampSchema,
    openedAt: inboxV2TimestampSchema,
    outcome: inboxV2OutboundDispatchAttemptOutcomeSchema,
    completionSource:
      inboxV2OutboundDispatchAttemptCompletionSourceSchema.nullable(),
    revision: inboxV2EntityRevisionSchema
  })
  .strict()
  .superRefine((attempt, context) => {
    addTenantReferenceIssue(context, attempt.tenantId, attempt.dispatch, [
      "dispatch"
    ]);
    addTenantReferenceIssue(context, attempt.tenantId, attempt.route, [
      "route"
    ]);

    if (
      !isInboxV2TimestampOrderValid(attempt.openedAt, attempt.leaseExpiresAt) ||
      Date.parse(attempt.leaseExpiresAt) === Date.parse(attempt.openedAt)
    ) {
      addIssue(
        context,
        ["leaseExpiresAt"],
        "Provider attempt lease must extend beyond its durable open time."
      );
    }
    const completedAt =
      attempt.outcome.kind === "pending" ? null : attempt.outcome.completedAt;
    if (
      completedAt !== null &&
      !isInboxV2TimestampOrderValid(attempt.openedAt, completedAt)
    ) {
      addIssue(
        context,
        ["outcome", "completedAt"],
        "Provider attempt outcome cannot predate its durable open."
      );
    }
    if (
      attempt.outcome.kind === "retryable_failure" &&
      !isInboxV2TimestampOrderValid(
        attempt.outcome.completedAt,
        attempt.outcome.retryAt
      )
    ) {
      addIssue(
        context,
        ["outcome", "retryAt"],
        "Retry scheduling cannot predate the failed provider attempt."
      );
    }
    if (
      attempt.outcome.kind === "retryable_failure" &&
      !attempt.outcome.diagnostic.retryable
    ) {
      addIssue(
        context,
        ["outcome", "diagnostic", "retryable"],
        "A retryable provider failure requires a retryable safe diagnostic."
      );
    }
    if (
      attempt.outcome.kind === "terminal_failure" &&
      attempt.outcome.diagnostic.retryable
    ) {
      addIssue(
        context,
        ["outcome", "diagnostic", "retryable"],
        "A terminal provider failure cannot claim automatic retryability."
      );
    }
    if (attempt.outcome.kind === "outcome_unknown") {
      const mixedArtifactOutcome =
        attempt.outcome.diagnostic.codeId ===
        "core:provider-artifact-outcomes-mixed";
      const requiredAction =
        mixedArtifactOutcome || !attempt.retrySafety.automaticRetryAllowed
          ? "operator_duplicate_risk_decision_required"
          : "automated_reconciliation_required";
      if (attempt.outcome.requiredAction !== requiredAction) {
        addIssue(
          context,
          ["outcome", "requiredAction"],
          "Unknown outcome action is fixed by retry safety, except mixed artifact outcomes always require an operator duplicate-risk decision."
        );
      }
    }
    if (
      (attempt.outcome.kind === "pending") !==
      (attempt.completionSource === null)
    ) {
      addIssue(
        context,
        ["completionSource"],
        "Only a pending attempt has no immutable completion source."
      );
    }
    if (attempt.completionSource === "lease_expired") {
      if (
        attempt.outcome.kind !== "outcome_unknown" ||
        Date.parse(attempt.outcome.completedAt) <
          Date.parse(attempt.leaseExpiresAt)
      ) {
        addIssue(
          context,
          ["completionSource"],
          "Lease expiry closes only to outcome_unknown at or after the lease boundary."
        );
      }
    }
    if (
      attempt.completionSource === "provider_result" &&
      attempt.outcome.kind !== "pending" &&
      Date.parse(attempt.outcome.completedAt) >
        Date.parse(attempt.leaseExpiresAt)
    ) {
      addIssue(
        context,
        ["outcome", "completedAt"],
        "A provider-result holder cannot complete after its durable lease expired."
      );
    }
    if (
      attempt.completionSource === "provider_observation" &&
      attempt.outcome.kind !== "accepted"
    ) {
      addIssue(
        context,
        ["completionSource"],
        "An exact provider observation may close a pending attempt only as accepted provider truth."
      );
    }
    if (
      attempt.completionSource === "preflight_blocked" &&
      attempt.outcome.kind !== "retryable_failure" &&
      attempt.outcome.kind !== "terminal_failure"
    ) {
      addIssue(
        context,
        ["completionSource"],
        "Preflight blocking records only a typed retryable or terminal zero-I/O failure."
      );
    }
    if (
      attempt.completionSource === "preflight_blocked" &&
      attempt.outcome.kind !== "pending" &&
      Date.parse(attempt.outcome.completedAt) >
        Date.parse(attempt.leaseExpiresAt)
    ) {
      addIssue(
        context,
        ["outcome", "completedAt"],
        "Preflight must close its claim before the lease expires."
      );
    }
    if (
      (attempt.outcome.kind === "pending" &&
        (attempt.revision !== "1" || attempt.completionSource !== null)) ||
      (attempt.outcome.kind !== "pending" &&
        (attempt.revision !== "2" || attempt.completionSource === null))
    ) {
      addIssue(
        context,
        ["revision"],
        "Provider attempt starts at revision 1 and closes exactly once at revision 2."
      );
    }
  });

export const inboxV2OutboundDispatchOperatorRetryAuthorizationDecisionSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    employee: inboxV2EmployeeReferenceSchema,
    dispatch: inboxV2OutboundDispatchReferenceSchema,
    route: inboxV2OutboundRouteReferenceSchema,
    unknownAttempt: inboxV2OutboundDispatchAttemptReferenceSchema,
    requiredPermissionId: z.literal(
      "core:outbound_dispatch.duplicate-risk-retry"
    ),
    authorizationEpoch: inboxV2AuthorizationEpochSchema,
    effect: z.enum(["allow", "deny"]),
    matchedPermissionIds: z.array(inboxV2SourcePermissionIdSchema).max(64),
    decisionToken: inboxV2RoutingTokenSchema,
    decisionRevision: inboxV2EntityRevisionSchema,
    loadedByTrustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
    decidedAt: inboxV2TimestampSchema,
    notAfter: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((decision, context) => {
    for (const [field, reference] of [
      ["employee", decision.employee],
      ["dispatch", decision.dispatch],
      ["route", decision.route],
      ["unknownAttempt", decision.unknownAttempt]
    ] as const) {
      addTenantReferenceIssue(context, decision.tenantId, reference, [field]);
    }
    if (!isInboxV2TimestampOrderValid(decision.decidedAt, decision.notAfter)) {
      addIssue(
        context,
        ["notAfter"],
        "Operator retry authorization cannot expire before its decision time."
      );
    }
    const uniquePermissions = new Set(
      decision.matchedPermissionIds.map(String)
    );
    if (uniquePermissions.size !== decision.matchedPermissionIds.length) {
      addIssue(
        context,
        ["matchedPermissionIds"],
        "Operator retry authorization permissions must be unique."
      );
    }
    if (
      decision.effect === "allow" &&
      !uniquePermissions.has(decision.requiredPermissionId)
    ) {
      addIssue(
        context,
        ["matchedPermissionIds"],
        "Operator retry allow must match the exact duplicate-risk retry permission."
      );
    }
  });

export const inboxV2OutboundDispatchRetryAuthorizationSchema =
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("automatic"),
        trustedServiceId: inboxV2RoutingTrustedServiceIdSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("employee_duplicate_risk_override"),
        employee: inboxV2EmployeeReferenceSchema,
        duplicateRiskAcknowledged: z.literal(true),
        reasonId: inboxV2CatalogIdSchema,
        reason: z
          .string()
          .min(1)
          .max(500)
          .refine((value) => /\S/u.test(value), {
            message: "Duplicate-risk override reason cannot be blank."
          }),
        operatorAuthorization:
          inboxV2OutboundDispatchOperatorRetryAuthorizationDecisionSchema
      })
      .strict()
  ]);

export const inboxV2OutboundDispatchReconciliationResultSchema =
  z.discriminatedUnion("state", [
    z
      .object({
        state: z.literal("accepted"),
        providerAcknowledgementToken: inboxV2RoutingTokenSchema.nullable(),
        evidenceToken: inboxV2RoutingTokenSchema
      })
      .strict(),
    z
      .object({
        state: z.literal("terminal_failure"),
        diagnostic: inboxV2SafeSourceDiagnosticSchema,
        evidenceToken: inboxV2RoutingTokenSchema
      })
      .strict(),
    z
      .object({
        state: z.literal("retryable_failure"),
        retryAt: inboxV2TimestampSchema,
        diagnostic: inboxV2SafeSourceDiagnosticSchema,
        authorization: inboxV2OutboundDispatchRetryAuthorizationSchema,
        evidenceToken: inboxV2RoutingTokenSchema
      })
      .strict()
  ]);

/** Append-only resolution of one exact immutable outcome_unknown attempt. */
export const inboxV2OutboundDispatchReconciliationDecisionSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2OutboundDispatchReconciliationDecisionIdSchema,
    dispatch: inboxV2OutboundDispatchReferenceSchema,
    route: inboxV2OutboundRouteReferenceSchema,
    routeSnapshot: inboxV2OutboundRouteSchema,
    unknownAttempt: inboxV2OutboundDispatchAttemptSchema,
    decidedBy: inboxV2OutboundActorSchema,
    authorizationEpoch: inboxV2AuthorizationEpochSchema.nullable(),
    result: inboxV2OutboundDispatchReconciliationResultSchema,
    decidedAt: inboxV2TimestampSchema,
    revision: inboxV2EntityRevisionSchema
  })
  .strict()
  .superRefine((decision, context) => {
    for (const [field, reference] of [
      ["dispatch", decision.dispatch],
      ["route", decision.route]
    ] as const) {
      addTenantReferenceIssue(context, decision.tenantId, reference, [field]);
    }
    if (decision.decidedBy.kind === "employee") {
      addTenantReferenceIssue(
        context,
        decision.tenantId,
        decision.decidedBy.employee,
        ["decidedBy", "employee"]
      );
    }
    if (
      decision.routeSnapshot.tenantId !== decision.tenantId ||
      !sameReference(
        decision.route,
        routeReferenceOf(decision.routeSnapshot)
      ) ||
      !sameAdapterContract(
        decision.unknownAttempt.retrySafety.adapterContract,
        decision.routeSnapshot.adapterContract
      ) ||
      decision.unknownAttempt.tenantId !== decision.tenantId ||
      !sameReference(decision.unknownAttempt.dispatch, decision.dispatch) ||
      !sameReference(decision.unknownAttempt.route, decision.route) ||
      decision.unknownAttempt.outcome.kind !== "outcome_unknown" ||
      decision.unknownAttempt.completionSource === null ||
      decision.unknownAttempt.revision !== "2"
    ) {
      addIssue(
        context,
        ["unknownAttempt"],
        "Reconciliation decision must preserve one exact closed outcome_unknown attempt."
      );
    }
    if (
      decision.unknownAttempt.outcome.kind === "outcome_unknown" &&
      !isInboxV2TimestampOrderValid(
        decision.unknownAttempt.outcome.completedAt,
        decision.decidedAt
      )
    ) {
      addIssue(
        context,
        ["decidedAt"],
        "Reconciliation cannot predate the unknown attempt outcome."
      );
    }
    if (decision.result.state === "terminal_failure") {
      if (decision.result.diagnostic.retryable) {
        addIssue(
          context,
          ["result", "diagnostic", "retryable"],
          "Terminal reconciliation cannot claim retryability."
        );
      }
    }
    if (
      decision.result.state !== "retryable_failure" &&
      (decision.decidedBy.kind !== "trusted_service" ||
        decision.authorizationEpoch !== null ||
        decision.decidedBy.trustedServiceId !==
          decision.unknownAttempt.retrySafety.adapterContract
            .loadedByTrustedServiceId)
    ) {
      addIssue(
        context,
        ["decidedBy"],
        "Accepted or terminal provider outcomes require the pinned adapter/runtime trusted authority."
      );
    }
    if (decision.result.state === "retryable_failure") {
      if (
        !decision.result.diagnostic.retryable ||
        !isInboxV2TimestampOrderValid(
          decision.decidedAt,
          decision.result.retryAt
        )
      ) {
        addIssue(
          context,
          ["result"],
          "Retry authorization requires a retryable diagnostic and a future retry boundary."
        );
      }
      const authorization = decision.result.authorization;
      if (authorization.kind === "automatic") {
        if (
          !decision.unknownAttempt.retrySafety.automaticRetryAllowed ||
          decision.authorizationEpoch !== null ||
          decision.decidedBy.kind !== "trusted_service" ||
          authorization.trustedServiceId !==
            decision.decidedBy.trustedServiceId ||
          authorization.trustedServiceId !==
            decision.unknownAttempt.retrySafety.adapterContract
              .loadedByTrustedServiceId
        ) {
          addIssue(
            context,
            ["result", "authorization"],
            "Automatic retry requires pre-I/O retry safety and the exact deciding trusted service."
          );
        }
      } else {
        const operatorDecision = authorization.operatorAuthorization;
        addTenantReferenceIssue(
          context,
          decision.tenantId,
          authorization.employee,
          ["result", "authorization", "employee"]
        );
        if (
          decision.decidedBy.kind !== "employee" ||
          !sameReference(authorization.employee, decision.decidedBy.employee) ||
          decision.authorizationEpoch === null ||
          operatorDecision.tenantId !== decision.tenantId ||
          !sameReference(operatorDecision.employee, authorization.employee) ||
          !sameReference(operatorDecision.dispatch, decision.dispatch) ||
          !sameReference(operatorDecision.route, decision.route) ||
          !sameReference(
            operatorDecision.unknownAttempt,
            attemptReferenceOf(decision.unknownAttempt)
          ) ||
          operatorDecision.authorizationEpoch !== decision.authorizationEpoch ||
          operatorDecision.effect !== "allow" ||
          !operatorDecision.matchedPermissionIds.some(
            (permissionId) =>
              String(permissionId) === operatorDecision.requiredPermissionId
          ) ||
          Date.parse(operatorDecision.decidedAt) >
            Date.parse(decision.decidedAt) ||
          Date.parse(operatorDecision.notAfter) < Date.parse(decision.decidedAt)
        ) {
          addIssue(
            context,
            ["result", "authorization", "employee"],
            "Unsafe retry requires the exact deciding Employee and duplicate-risk acknowledgement."
          );
        }
      }
      if (
        !decision.unknownAttempt.retrySafety.automaticRetryAllowed &&
        authorization.kind !== "employee_duplicate_risk_override"
      ) {
        addIssue(
          context,
          ["result", "authorization"],
          "Unsafe or unknown retry safety can be overridden only by an Employee."
        );
      }
    }
    if (decision.revision !== "1") {
      addIssue(
        context,
        ["revision"],
        "Append-only reconciliation decision remains at revision 1."
      );
    }
  });

const inboxV2OpenDispatchAttemptCommitSchema = z
  .object({
    kind: z.literal("open_attempt"),
    tenantId: inboxV2TenantIdSchema,
    routeSnapshot: inboxV2OutboundRouteSchema,
    bindingHeadSnapshot: inboxV2SourceThreadBindingCurrentHeadSchema,
    dispatchBefore: inboxV2OutboundDispatchSchema,
    priorAttempt: inboxV2OutboundDispatchAttemptSchema.nullable(),
    retryAuthorizationDecision:
      inboxV2OutboundDispatchReconciliationDecisionSchema.nullable(),
    attempt: inboxV2OutboundDispatchAttemptSchema,
    dispatchAfter: inboxV2OutboundDispatchSchema
  })
  .strict()
  .superRefine((commit, context) => {
    addOpenDispatchAttemptCommitIssues(commit, context);
  });

const inboxV2CompleteDispatchAttemptCommitSchema = z
  .object({
    kind: z.literal("complete_attempt"),
    tenantId: inboxV2TenantIdSchema,
    dispatchBefore: inboxV2OutboundDispatchSchema,
    attemptBefore: inboxV2OutboundDispatchAttemptSchema,
    attemptAfter: inboxV2OutboundDispatchAttemptSchema,
    completionSource: inboxV2OutboundDispatchAttemptCompletionSourceSchema,
    completedByTrustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
    dispatchAfter: inboxV2OutboundDispatchSchema
  })
  .strict()
  .superRefine((commit, context) => {
    addCompleteDispatchAttemptCommitIssues(commit, context);
  });

export const inboxV2OutboundDispatchAttemptCommitSchema = z.discriminatedUnion(
  "kind",
  [
    inboxV2OpenDispatchAttemptCommitSchema,
    inboxV2CompleteDispatchAttemptCommitSchema
  ]
);

/** CAS transition that resolves dispatch state without mutating the attempt. */
export const inboxV2OutboundDispatchReconciliationCommitSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    dispatchBefore: inboxV2OutboundDispatchSchema,
    decision: inboxV2OutboundDispatchReconciliationDecisionSchema,
    dispatchAfter: inboxV2OutboundDispatchSchema
  })
  .strict()
  .superRefine((commit, context) => {
    addReconciliationCommitIssues(commit, context);
  });

/** Structural terminal transition or runtime retry proof with zero provider I/O. */
export const inboxV2OutboundDispatchRouteFailureCommitSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    routeSnapshot: inboxV2OutboundRouteSchema,
    bindingHeadSnapshot: inboxV2SourceThreadBindingCurrentHeadSchema,
    error: inboxV2OutboundRouteErrorSchema,
    dispatchBefore: inboxV2OutboundDispatchSchema,
    dispatchAfter: inboxV2OutboundDispatchSchema,
    failedByTrustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
    failedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((commit, context) => {
    addRouteFailureCommitIssues(commit, context);
  });

/** Atomic proof that a queued dispatch was cancelled before its replacement. */
export const inboxV2OutboundDispatchRerouteCommitSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    original: z
      .object({
        dispatchBefore: inboxV2OutboundDispatchSchema,
        dispatchAfter: inboxV2OutboundDispatchSchema,
        outboxIntentId: inboxV2OutboxIntentIdSchema
      })
      .strict(),
    replacement: z
      .object({
        message: inboxV2MessageReferenceSchema,
        route: inboxV2OutboundRouteReferenceSchema,
        dispatch: inboxV2OutboundDispatchReferenceSchema,
        outboxIntentId: inboxV2OutboxIntentIdSchema
      })
      .strict(),
    reasonId: inboxV2CatalogIdSchema,
    changedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((commit, context) => {
    addRerouteCommitIssues(commit, context);
  });

/** One canonical outbox result shared by atomic persistence and worker replay. */
export type InboxV2RouteFailureOutboxFinalization =
  | Readonly<{
      kind: "retry";
      resultHash: ReturnType<typeof calculateInboxV2CanonicalSha256>;
      errorCode: ReturnType<typeof inboxV2NamespacedIdSchema.parse>;
      retryAfterSeconds: number;
    }>
  | Readonly<{
      kind: "dead";
      resultHash: ReturnType<typeof calculateInboxV2CanonicalSha256>;
      errorCode: ReturnType<typeof inboxV2NamespacedIdSchema.parse>;
      resultReference: null;
    }>;

export function deriveInboxV2RouteFailureOutboxFinalization(
  input: Readonly<{
    intentId: InboxV2OutboxIntentId;
    commit: InboxV2OutboundDispatchRouteFailureCommit;
  }>
): InboxV2RouteFailureOutboxFinalization {
  const intentId = inboxV2OutboxIntentIdSchema.parse(input.intentId);
  const commit = inboxV2OutboundDispatchRouteFailureCommitSchema.parse(
    input.commit
  );
  const resultHash = calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.provider-dispatch-route-failure",
    hashVersion: "v1",
    intentId,
    commit
  });
  const errorCode = inboxV2NamespacedIdSchema.parse(
    `core:${commit.error.code}`
  );
  return commit.error.code === "route.runtime_unavailable"
    ? {
        kind: "retry",
        resultHash,
        errorCode,
        retryAfterSeconds: deterministicRuntimeRetrySeconds(resultHash)
      }
    : {
        kind: "dead",
        resultHash,
        errorCode,
        resultReference: null
      };
}

function deterministicRuntimeRetrySeconds(resultHash: string): number {
  const digest = resultHash.includes(":")
    ? resultHash.slice(resultHash.lastIndexOf(":") + 1)
    : resultHash;
  const entropy = Number.parseInt(digest.slice(0, 8), 16);
  const minimumSeconds = 5;
  const maximumSeconds = 60;
  return minimumSeconds + (entropy % (maximumSeconds - minimumSeconds + 1));
}

export const inboxV2OutboundDispatchArtifactSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2OutboundDispatchArtifactIdSchema,
    dispatch: inboxV2OutboundDispatchReferenceSchema,
    route: inboxV2OutboundRouteReferenceSchema,
    attempt: inboxV2OutboundDispatchAttemptReferenceSchema,
    ordinal: z.number().int().min(1).max(100),
    state: z.enum(["accepted", "failed", "outcome_unknown"]),
    diagnostic: inboxV2SafeSourceDiagnosticSchema.nullable(),
    createdAt: inboxV2TimestampSchema,
    revision: inboxV2EntityRevisionSchema
  })
  .strict()
  .superRefine((artifact, context) => {
    for (const [field, reference] of [
      ["dispatch", artifact.dispatch],
      ["route", artifact.route],
      ["attempt", artifact.attempt]
    ] as const) {
      addTenantReferenceIssue(context, artifact.tenantId, reference, [field]);
    }
    if (artifact.revision !== "1") {
      addIssue(
        context,
        ["revision"],
        "Immutable provider dispatch artifact remains at revision 1."
      );
    }
    if (artifact.state === "accepted" && artifact.diagnostic !== null) {
      addIssue(
        context,
        ["diagnostic"],
        "Accepted provider artifact cannot carry a failure diagnostic."
      );
    }
    if (artifact.state !== "accepted" && artifact.diagnostic === null) {
      addIssue(
        context,
        ["diagnostic"],
        "Failed or uncertain provider artifact requires a safe diagnostic."
      );
    }
  });

const inboxV2OutboundDispatchArtifactIdentitySchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    dispatch: inboxV2OutboundDispatchReferenceSchema,
    route: inboxV2OutboundRouteReferenceSchema,
    attempt: inboxV2OutboundDispatchAttemptReferenceSchema,
    ordinal: z.number().int().min(1).max(100)
  })
  .strict()
  .superRefine((identity, context) => {
    for (const [field, reference] of [
      ["dispatch", identity.dispatch],
      ["route", identity.route],
      ["attempt", identity.attempt]
    ] as const) {
      addTenantReferenceIssue(context, identity.tenantId, reference, [field]);
    }
  });

export type InboxV2OutboundDispatchArtifactIdentity = z.input<
  typeof inboxV2OutboundDispatchArtifactIdentitySchema
>;

/**
 * Stable identity for one provider-side artifact produced by one exact attempt.
 * Retries use another Attempt and therefore cannot collide with, or overwrite,
 * the immutable artifact evidence of an earlier provider call.
 */
export function deriveInboxV2OutboundDispatchArtifactId(
  input: InboxV2OutboundDispatchArtifactIdentity
) {
  const identity = inboxV2OutboundDispatchArtifactIdentitySchema.parse(input);
  const digest = calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.outbound-dispatch-artifact-identity",
    hashVersion: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
    identity
  });
  return inboxV2OutboundDispatchArtifactIdSchema.parse(
    `outbound_dispatch_artifact:${digest.slice("sha256:".length)}`
  );
}

/** Append-only late association; the accepted artifact itself never mutates. */
export const inboxV2OutboundDispatchArtifactReferenceLinkSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2OutboundDispatchArtifactReferenceLinkIdSchema,
    artifact: inboxV2OutboundDispatchArtifactReferenceSchema,
    dispatch: inboxV2OutboundDispatchReferenceSchema,
    route: inboxV2OutboundRouteReferenceSchema,
    attempt: inboxV2OutboundDispatchAttemptReferenceSchema,
    externalThread: inboxV2ExternalThreadReferenceSchema,
    externalMessageReference: inboxV2ExternalMessageReferenceRefSchema,
    sourceOccurrence: inboxV2SourceOccurrenceReferenceSchema,
    associationEvidence: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("provider_response_attempt") }).strict(),
      z
        .object({
          kind: z.literal("provider_echo_correlation"),
          providerReferenceKindId: inboxV2CatalogIdSchema,
          correlationToken: inboxV2RoutingTokenSchema
        })
        .strict()
    ]),
    linkedByTrustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
    linkedAt: inboxV2TimestampSchema,
    revision: inboxV2EntityRevisionSchema
  })
  .strict()
  .superRefine((link, context) => {
    for (const [field, reference] of [
      ["artifact", link.artifact],
      ["dispatch", link.dispatch],
      ["route", link.route],
      ["attempt", link.attempt],
      ["externalThread", link.externalThread],
      ["externalMessageReference", link.externalMessageReference],
      ["sourceOccurrence", link.sourceOccurrence]
    ] as const) {
      addTenantReferenceIssue(context, link.tenantId, reference, [field]);
    }
    if (link.revision !== "1") {
      addIssue(
        context,
        ["revision"],
        "Append-only artifact reference link remains at revision 1."
      );
    }
  });

/**
 * Bounded proof for provider-response or provider-echo arrival in either order.
 * It associates one immutable accepted artifact with one resolved occurrence.
 */
export const inboxV2OutboundDispatchArtifactAssociationCommitSchema = z
  .object({
    artifact: inboxV2OutboundDispatchArtifactSchema,
    dispatch: inboxV2OutboundDispatchSchema,
    attempt: inboxV2OutboundDispatchAttemptSchema,
    route: inboxV2OutboundRouteSchema,
    occurrenceResolution: inboxV2SourceOccurrenceResolutionCommitSchema,
    link: inboxV2OutboundDispatchArtifactReferenceLinkSchema
  })
  .strict()
  .superRefine((commit, context) => {
    addArtifactAssociationCommitIssues(commit, context);
  });

export const inboxV2OutboundMultiSendChildSchema = z
  .object({
    conversation: inboxV2ConversationReferenceSchema,
    externalThread: inboxV2ExternalThreadReferenceSchema,
    binding: inboxV2SourceThreadBindingReferenceSchema,
    sourceAccount: inboxV2SourceAccountReferenceSchema,
    route: inboxV2OutboundRouteReferenceSchema,
    dispatch: inboxV2OutboundDispatchReferenceSchema
  })
  .strict();

/** Normal send has one route; explicit multi-send is this separate family. */
export const inboxV2OutboundMultiSendOperationSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2OutboundMultiSendOperationIdSchema,
    actor: inboxV2OutboundActorSchema,
    mutationToken: inboxV2RoutingTokenSchema,
    idempotencyToken: inboxV2RoutingTokenSchema,
    correlationToken: inboxV2RoutingTokenSchema,
    children: z.array(inboxV2OutboundMultiSendChildSchema).min(2).max(100),
    createdAt: inboxV2TimestampSchema,
    revision: inboxV2EntityRevisionSchema
  })
  .strict()
  .superRefine((operation, context) => {
    if (operation.actor.kind === "employee") {
      addTenantReferenceIssue(
        context,
        operation.tenantId,
        operation.actor.employee,
        ["actor", "employee"]
      );
    }

    const dispatchIds = new Set<string>();
    const routeIds = new Set<string>();
    const targetKeys = new Set<string>();
    for (const [index, child] of operation.children.entries()) {
      for (const [field, reference] of Object.entries(child)) {
        addTenantReferenceIssue(context, operation.tenantId, reference, [
          "children",
          index,
          field
        ]);
      }
      const dispatchId = String(child.dispatch.id);
      if (dispatchIds.has(dispatchId)) {
        addIssue(
          context,
          ["children", index, "dispatch"],
          "Explicit multi-send children require distinct dispatches."
        );
      }
      dispatchIds.add(dispatchId);

      const routeId = String(child.route.id);
      if (routeIds.has(routeId)) {
        addIssue(
          context,
          ["children", index, "route"],
          "Explicit multi-send children require distinct immutable routes."
        );
      }
      routeIds.add(routeId);

      const targetKey = `${child.externalThread.id}\u0000${child.binding.id}`;
      if (targetKeys.has(targetKey)) {
        addIssue(
          context,
          ["children", index, "binding"],
          "Explicit multi-send cannot repeat one exact thread binding."
        );
      }
      targetKeys.add(targetKey);
    }
    if (operation.revision !== "1") {
      addIssue(
        context,
        ["revision"],
        "Immutable explicit multi-send operation remains at revision 1."
      );
    }
  });

export const inboxV2OutboundDispatchEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
    INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
    inboxV2OutboundDispatchSchema
  );
export const inboxV2OutboundDispatchAttemptEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_OUTBOUND_DISPATCH_ATTEMPT_SCHEMA_ID,
    INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
    inboxV2OutboundDispatchAttemptSchema
  );
export const inboxV2OutboundDispatchAttemptCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_OUTBOUND_DISPATCH_ATTEMPT_COMMIT_SCHEMA_ID,
    INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
    inboxV2OutboundDispatchAttemptCommitSchema
  );
export const inboxV2OutboundDispatchReconciliationDecisionEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_OUTBOUND_DISPATCH_RECONCILIATION_DECISION_SCHEMA_ID,
    INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
    inboxV2OutboundDispatchReconciliationDecisionSchema
  );
export const inboxV2OutboundDispatchReconciliationCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_OUTBOUND_DISPATCH_RECONCILIATION_COMMIT_SCHEMA_ID,
    INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
    inboxV2OutboundDispatchReconciliationCommitSchema
  );
export const inboxV2OutboundDispatchRouteFailureCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_OUTBOUND_DISPATCH_ROUTE_FAILURE_COMMIT_SCHEMA_ID,
    INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
    inboxV2OutboundDispatchRouteFailureCommitSchema
  );
export const inboxV2OutboundDispatchRerouteCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_ID,
    INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_VERSION,
    inboxV2OutboundDispatchRerouteCommitSchema
  );
export const inboxV2OutboundDispatchArtifactEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_OUTBOUND_DISPATCH_ARTIFACT_SCHEMA_ID,
    INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
    inboxV2OutboundDispatchArtifactSchema
  );
export const inboxV2OutboundDispatchArtifactReferenceLinkEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_OUTBOUND_DISPATCH_ARTIFACT_REFERENCE_LINK_SCHEMA_ID,
    INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
    inboxV2OutboundDispatchArtifactReferenceLinkSchema
  );
export const inboxV2OutboundDispatchArtifactAssociationCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_OUTBOUND_DISPATCH_ARTIFACT_ASSOCIATION_COMMIT_SCHEMA_ID,
    INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
    inboxV2OutboundDispatchArtifactAssociationCommitSchema
  );
export const inboxV2OutboundMultiSendOperationEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_OUTBOUND_MULTI_SEND_OPERATION_SCHEMA_ID,
    INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
    inboxV2OutboundMultiSendOperationSchema
  );

export type InboxV2OutboundDispatch = z.infer<
  typeof inboxV2OutboundDispatchSchema
>;
export type InboxV2OutboundDispatchAttempt = z.infer<
  typeof inboxV2OutboundDispatchAttemptSchema
>;
export type InboxV2OutboundDispatchAttemptCommit = z.infer<
  typeof inboxV2OutboundDispatchAttemptCommitSchema
>;
export type InboxV2OutboundDispatchReconciliationDecision = z.infer<
  typeof inboxV2OutboundDispatchReconciliationDecisionSchema
>;
export type InboxV2OutboundDispatchReconciliationCommit = z.infer<
  typeof inboxV2OutboundDispatchReconciliationCommitSchema
>;
export type InboxV2OutboundDispatchRouteFailureCommit = z.infer<
  typeof inboxV2OutboundDispatchRouteFailureCommitSchema
>;
export type InboxV2OutboundDispatchRerouteCommit = z.infer<
  typeof inboxV2OutboundDispatchRerouteCommitSchema
>;
export type InboxV2OutboundDispatchArtifact = z.infer<
  typeof inboxV2OutboundDispatchArtifactSchema
>;
export type InboxV2OutboundDispatchArtifactReferenceLink = z.infer<
  typeof inboxV2OutboundDispatchArtifactReferenceLinkSchema
>;
export type InboxV2OutboundDispatchArtifactAssociationCommit = z.infer<
  typeof inboxV2OutboundDispatchArtifactAssociationCommitSchema
>;
export type InboxV2OutboundMultiSendOperation = z.infer<
  typeof inboxV2OutboundMultiSendOperationSchema
>;

function dispatchStateForOutcome(
  kind: z.infer<typeof inboxV2OutboundDispatchAttemptOutcomeSchema>["kind"]
): z.infer<typeof inboxV2OutboundDispatchStateSchema> | null {
  return kind === "pending" ? null : kind;
}

function addOpenDispatchAttemptCommitIssues(
  commit: z.infer<typeof inboxV2OpenDispatchAttemptCommitSchema>,
  context: z.RefinementCtx
): void {
  if (
    commit.routeSnapshot.tenantId !== commit.tenantId ||
    commit.bindingHeadSnapshot.tenantId !== commit.tenantId ||
    commit.dispatchBefore.tenantId !== commit.tenantId ||
    commit.attempt.tenantId !== commit.tenantId ||
    commit.dispatchAfter.tenantId !== commit.tenantId ||
    (commit.priorAttempt !== null &&
      commit.priorAttempt.tenantId !== commit.tenantId) ||
    (commit.retryAuthorizationDecision !== null &&
      commit.retryAuthorizationDecision.tenantId !== commit.tenantId)
  ) {
    addIssue(
      context,
      ["tenantId"],
      "Opening a dispatch attempt must contain one tenant."
    );
  }
  const attemptReference = attemptReferenceOf(commit.attempt);
  if (
    commit.attempt.outcome.kind !== "pending" ||
    commit.attempt.completionSource !== null ||
    commit.attempt.revision !== "1" ||
    (commit.dispatchBefore.state !== "queued" &&
      commit.dispatchBefore.state !== "retryable_failure") ||
    !sameReference(
      commit.attempt.dispatch,
      dispatchReferenceOf(commit.dispatchBefore)
    ) ||
    !sameReference(commit.attempt.route, commit.dispatchBefore.route) ||
    !sameReference(
      commit.dispatchBefore.route,
      routeReferenceOf(commit.routeSnapshot)
    ) ||
    !sameReference(
      commit.bindingHeadSnapshot.binding,
      commit.routeSnapshot.sourceThreadBinding
    ) ||
    !sameReference(
      commit.bindingHeadSnapshot.externalThread,
      commit.routeSnapshot.externalThread
    ) ||
    !sameReference(
      commit.bindingHeadSnapshot.sourceAccount,
      commit.routeSnapshot.sourceAccount
    ) ||
    !sameReference(
      commit.bindingHeadSnapshot.sourceConnection,
      commit.routeSnapshot.sourceConnection
    ) ||
    !sameValue(
      commit.bindingHeadSnapshot.fence,
      commit.routeSnapshot.bindingFence
    ) ||
    commit.bindingHeadSnapshot.remoteAccess.state !== "active" ||
    commit.bindingHeadSnapshot.administrative.state !== "enabled" ||
    Date.parse(commit.bindingHeadSnapshot.updatedAt) >
      Date.parse(commit.attempt.openedAt) ||
    !sameAdapterContract(
      commit.attempt.retrySafety.adapterContract,
      commit.routeSnapshot.adapterContract
    ) ||
    Date.parse(commit.attempt.retrySafety.declaredAt) >
      Date.parse(commit.attempt.openedAt) ||
    commit.attempt.attemptNumber !== commit.dispatchBefore.attemptCount + 1 ||
    Date.parse(commit.attempt.openedAt) <
      Date.parse(commit.dispatchBefore.updatedAt) ||
    !sameDispatchIdentity(commit.dispatchBefore, commit.dispatchAfter) ||
    commit.dispatchAfter.state !== "attempting" ||
    commit.dispatchAfter.attemptCount !== commit.attempt.attemptNumber ||
    !sameNullableReference(
      commit.dispatchAfter.activeAttempt,
      attemptReference
    ) ||
    !sameNullableReference(
      commit.dispatchAfter.lastAttempt,
      attemptReference
    ) ||
    commit.dispatchAfter.retryAuthorization !== null ||
    BigInt(commit.dispatchAfter.revision) !==
      BigInt(commit.dispatchBefore.revision) + 1n ||
    commit.dispatchAfter.updatedAt !== commit.attempt.openedAt
  ) {
    addIssue(
      context,
      ["dispatchAfter"],
      "Provider I/O must atomically open one new claimed attempt on the immutable route."
    );
  }
  if (commit.dispatchBefore.state === "queued") {
    if (
      commit.dispatchBefore.attemptCount !== 0 ||
      commit.dispatchBefore.lastAttempt !== null ||
      commit.dispatchBefore.retryAuthorization !== null ||
      commit.priorAttempt !== null ||
      commit.retryAuthorizationDecision !== null
    ) {
      addIssue(
        context,
        ["priorAttempt"],
        "The first queued attempt has no prior attempt or retry authorization."
      );
    }
    return;
  }
  const prior = commit.priorAttempt;
  if (
    prior === null ||
    !sameReference(
      prior.dispatch,
      dispatchReferenceOf(commit.dispatchBefore)
    ) ||
    !sameReference(prior.route, commit.dispatchBefore.route) ||
    prior.attemptNumber !== commit.dispatchBefore.attemptCount ||
    prior.revision !== "2" ||
    prior.outcome.kind === "pending" ||
    prior.completionSource === null ||
    !sameNullableReference(
      commit.dispatchBefore.lastAttempt,
      attemptReferenceOf(prior)
    )
  ) {
    addIssue(
      context,
      ["priorAttempt"],
      "Retry open requires the exact closed last attempt and attempt count."
    );
    return;
  }
  if (prior.outcome.kind === "retryable_failure") {
    if (
      commit.dispatchBefore.retryAuthorization !== null ||
      commit.retryAuthorizationDecision !== null ||
      Date.parse(commit.attempt.openedAt) < Date.parse(prior.outcome.retryAt)
    ) {
      addIssue(
        context,
        ["attempt", "openedAt"],
        "Known retryable failure can reopen only at its exact retry boundary and needs no reconciliation decision."
      );
    }
    return;
  }
  if (prior.outcome.kind !== "outcome_unknown") {
    addIssue(
      context,
      ["priorAttempt", "outcome", "kind"],
      "Accepted or terminal attempts cannot reopen."
    );
    return;
  }
  const decision = commit.retryAuthorizationDecision;
  if (
    decision === null ||
    decision.result.state !== "retryable_failure" ||
    commit.dispatchBefore.retryAuthorization === null ||
    !sameReference(
      commit.dispatchBefore.retryAuthorization,
      reconciliationDecisionReferenceOf(decision)
    ) ||
    !sameValue(decision.unknownAttempt, prior) ||
    !sameReference(
      decision.dispatch,
      dispatchReferenceOf(commit.dispatchBefore)
    ) ||
    !sameReference(decision.route, commit.dispatchBefore.route) ||
    !sameValue(decision.routeSnapshot, commit.routeSnapshot) ||
    Date.parse(commit.attempt.openedAt) < Date.parse(decision.result.retryAt) ||
    Date.parse(commit.attempt.openedAt) < Date.parse(decision.decidedAt)
  ) {
    addIssue(
      context,
      ["retryAuthorizationDecision"],
      "Retry after outcome_unknown requires the exact retry-authorizing append-only decision."
    );
  }
  if (
    decision?.result.state === "retryable_failure" &&
    decision.result.authorization.kind === "automatic" &&
    (prior.retrySafety.providerCorrelationToken === null ||
      commit.attempt.retrySafety.providerCorrelationToken !==
        prior.retrySafety.providerCorrelationToken ||
      commit.attempt.retrySafety.mechanism !== prior.retrySafety.mechanism ||
      !commit.attempt.retrySafety.automaticRetryAllowed)
  ) {
    addIssue(
      context,
      ["attempt", "retrySafety"],
      "Automatic retry after outcome_unknown must reuse the exact proven mechanism and non-null provider correlation token."
    );
  }
}

function addCompleteDispatchAttemptCommitIssues(
  commit: z.infer<typeof inboxV2CompleteDispatchAttemptCommitSchema>,
  context: z.RefinementCtx
): void {
  if (
    commit.dispatchBefore.tenantId !== commit.tenantId ||
    commit.attemptBefore.tenantId !== commit.tenantId ||
    commit.attemptAfter.tenantId !== commit.tenantId ||
    commit.dispatchAfter.tenantId !== commit.tenantId
  ) {
    addIssue(
      context,
      ["tenantId"],
      "Dispatch attempt completion must contain one tenant."
    );
  }
  const attemptReference = attemptReferenceOf(commit.attemptBefore);
  const completedAt =
    commit.attemptAfter.outcome.kind === "pending"
      ? null
      : commit.attemptAfter.outcome.completedAt;
  const nextState = dispatchStateForOutcome(commit.attemptAfter.outcome.kind);
  if (
    commit.attemptBefore.outcome.kind !== "pending" ||
    commit.attemptBefore.completionSource !== null ||
    commit.attemptBefore.revision !== "1" ||
    commit.attemptAfter.outcome.kind === "pending" ||
    commit.attemptAfter.completionSource !== commit.completionSource ||
    commit.attemptAfter.revision !== "2" ||
    !sameAttemptIdentity(commit.attemptBefore, commit.attemptAfter) ||
    completedAt === null ||
    nextState === null ||
    commit.dispatchBefore.state !== "attempting" ||
    commit.dispatchBefore.attemptCount !== commit.attemptBefore.attemptNumber ||
    commit.dispatchBefore.updatedAt !== commit.attemptBefore.openedAt ||
    !sameNullableReference(
      commit.dispatchBefore.activeAttempt,
      attemptReference
    ) ||
    !sameNullableReference(
      commit.dispatchBefore.lastAttempt,
      attemptReference
    ) ||
    !sameReference(
      commit.attemptBefore.dispatch,
      dispatchReferenceOf(commit.dispatchBefore)
    ) ||
    !sameReference(commit.attemptBefore.route, commit.dispatchBefore.route) ||
    !sameReference(
      commit.attemptAfter.dispatch,
      dispatchReferenceOf(commit.dispatchBefore)
    ) ||
    !sameReference(commit.attemptAfter.route, commit.dispatchBefore.route) ||
    !sameDispatchIdentity(commit.dispatchBefore, commit.dispatchAfter) ||
    commit.dispatchAfter.state !== nextState ||
    commit.dispatchAfter.attemptCount !== commit.dispatchBefore.attemptCount ||
    commit.dispatchAfter.activeAttempt !== null ||
    !sameNullableReference(
      commit.dispatchAfter.lastAttempt,
      attemptReference
    ) ||
    commit.dispatchAfter.retryAuthorization !== null ||
    BigInt(commit.dispatchAfter.revision) !==
      BigInt(commit.dispatchBefore.revision) + 1n ||
    commit.dispatchAfter.updatedAt !== completedAt
  ) {
    addIssue(
      context,
      ["dispatchAfter"],
      "Completion CAS must close the exact claim, route and attempt number once."
    );
  }
  if (
    commit.completedByTrustedServiceId !==
    commit.attemptBefore.retrySafety.adapterContract.loadedByTrustedServiceId
  ) {
    addIssue(
      context,
      ["completedByTrustedServiceId"],
      "Every provider, sweeper or preflight completion requires the pinned adapter/runtime authority."
    );
  }
}

function addReconciliationCommitIssues(
  commit: z.infer<typeof inboxV2OutboundDispatchReconciliationCommitSchema>,
  context: z.RefinementCtx
): void {
  const attempt = commit.decision.unknownAttempt;
  const attemptReference = attemptReferenceOf(attempt);
  const decisionReference = reconciliationDecisionReferenceOf(commit.decision);
  const expectedState = commit.decision.result.state;
  if (
    commit.dispatchBefore.tenantId !== commit.tenantId ||
    commit.dispatchAfter.tenantId !== commit.tenantId ||
    commit.decision.tenantId !== commit.tenantId ||
    commit.dispatchBefore.state !== "outcome_unknown" ||
    commit.dispatchBefore.activeAttempt !== null ||
    commit.dispatchBefore.retryAuthorization !== null ||
    commit.dispatchBefore.attemptCount !== attempt.attemptNumber ||
    !sameNullableReference(
      commit.dispatchBefore.lastAttempt,
      attemptReference
    ) ||
    !sameReference(
      commit.decision.dispatch,
      dispatchReferenceOf(commit.dispatchBefore)
    ) ||
    !sameReference(commit.decision.route, commit.dispatchBefore.route) ||
    !sameReference(
      attempt.dispatch,
      dispatchReferenceOf(commit.dispatchBefore)
    ) ||
    !sameReference(attempt.route, commit.dispatchBefore.route) ||
    attempt.outcome.kind !== "outcome_unknown" ||
    commit.dispatchBefore.updatedAt !== attempt.outcome.completedAt ||
    Date.parse(commit.decision.decidedAt) <
      Date.parse(commit.dispatchBefore.updatedAt) ||
    !sameDispatchIdentity(commit.dispatchBefore, commit.dispatchAfter) ||
    commit.dispatchAfter.state !== expectedState ||
    commit.dispatchAfter.attemptCount !== commit.dispatchBefore.attemptCount ||
    commit.dispatchAfter.activeAttempt !== null ||
    !sameNullableReference(
      commit.dispatchAfter.lastAttempt,
      attemptReference
    ) ||
    BigInt(commit.dispatchAfter.revision) !==
      BigInt(commit.dispatchBefore.revision) + 1n ||
    commit.dispatchAfter.updatedAt !== commit.decision.decidedAt ||
    (expectedState === "retryable_failure"
      ? !sameNullableReference(
          commit.dispatchAfter.retryAuthorization,
          decisionReference
        )
      : commit.dispatchAfter.retryAuthorization !== null)
  ) {
    addIssue(
      context,
      ["dispatchAfter"],
      "Reconciliation CAS must resolve the exact unknown attempt without mutating it or its route."
    );
  }
}

function addRerouteCommitIssues(
  commit: z.infer<typeof inboxV2OutboundDispatchRerouteCommitSchema>,
  context: z.RefinementCtx
): void {
  const before = commit.original.dispatchBefore;
  const after = commit.original.dispatchAfter;
  const replacement = commit.replacement;
  const oneTenant =
    before.tenantId === commit.tenantId &&
    after.tenantId === commit.tenantId &&
    replacement.message.tenantId === commit.tenantId &&
    replacement.route.tenantId === commit.tenantId &&
    replacement.dispatch.tenantId === commit.tenantId;
  if (!oneTenant) {
    addIssue(
      context,
      ["tenantId"],
      "Reroute cancellation and replacement identities must belong to one tenant."
    );
  }

  const exactCancellation =
    sameDispatchIdentity(before, after) &&
    before.state === "queued" &&
    before.revision === "1" &&
    after.state === "cancelled" &&
    after.revision === "2" &&
    after.attemptCount === before.attemptCount &&
    after.activeAttempt === null &&
    after.lastAttempt === null &&
    after.retryAuthorization === null &&
    after.updatedAt === commit.changedAt &&
    Date.parse(commit.changedAt) >= Date.parse(before.updatedAt);
  if (!exactCancellation) {
    addIssue(
      context,
      ["original", "dispatchAfter"],
      "Reroute must CAS the exact untouched queued revision 1 dispatch to cancelled revision 2 at changedAt."
    );
  }

  if (
    sameReference(before.message, replacement.message) ||
    sameReference(before.route, replacement.route) ||
    sameReference(dispatchReferenceOf(before), replacement.dispatch) ||
    commit.original.outboxIntentId === replacement.outboxIntentId
  ) {
    addIssue(
      context,
      ["replacement"],
      "Reroute replacement Message, route, dispatch and outbox intent identities must be distinct from the original send."
    );
  }
}

function addRouteFailureCommitIssues(
  commit: z.infer<typeof inboxV2OutboundDispatchRouteFailureCommitSchema>,
  context: z.RefinementCtx
): void {
  const { routeSnapshot: route, bindingHeadSnapshot: head } = commit;
  const fenceChanged = !sameValue(head.fence, route.bindingFence);
  const inactive =
    head.remoteAccess.state !== "active" ||
    head.administrative.state !== "enabled";
  const runtimeUnavailable =
    head.runtimeHealth.state !== "ready" &&
    head.runtimeHealth.state !== "degraded";
  const expectedError = fenceChanged
    ? "route.binding_changed"
    : inactive
      ? "route.inactive"
      : runtimeUnavailable
        ? "route.runtime_unavailable"
        : null;
  const runtimeRetry = expectedError === "route.runtime_unavailable";
  const validDispatchEffect = runtimeRetry
    ? sameValue(commit.dispatchBefore, commit.dispatchAfter)
    : sameDispatchIdentity(commit.dispatchBefore, commit.dispatchAfter) &&
      commit.dispatchAfter.state === "terminal_failure" &&
      commit.dispatchAfter.attemptCount ===
        commit.dispatchBefore.attemptCount &&
      commit.dispatchAfter.activeAttempt === null &&
      sameNullableReference(
        commit.dispatchAfter.lastAttempt,
        commit.dispatchBefore.lastAttempt
      ) &&
      commit.dispatchAfter.retryAuthorization === null &&
      BigInt(commit.dispatchAfter.revision) ===
        BigInt(commit.dispatchBefore.revision) + 1n &&
      commit.dispatchAfter.updatedAt === commit.failedAt;
  if (
    route.tenantId !== commit.tenantId ||
    head.tenantId !== commit.tenantId ||
    commit.dispatchBefore.tenantId !== commit.tenantId ||
    commit.dispatchAfter.tenantId !== commit.tenantId ||
    !sameReference(head.binding, route.sourceThreadBinding) ||
    !sameReference(head.externalThread, route.externalThread) ||
    !sameReference(head.sourceAccount, route.sourceAccount) ||
    !sameReference(head.sourceConnection, route.sourceConnection) ||
    !sameReference(commit.dispatchBefore.route, routeReferenceOf(route)) ||
    (commit.dispatchBefore.state !== "queued" &&
      commit.dispatchBefore.state !== "retryable_failure") ||
    commit.dispatchBefore.activeAttempt !== null ||
    expectedError === null ||
    commit.error.code !== expectedError ||
    commit.failedByTrustedServiceId !==
      route.adapterContract.loadedByTrustedServiceId ||
    Date.parse(commit.failedAt) < Date.parse(head.updatedAt) ||
    Date.parse(commit.failedAt) < Date.parse(commit.dispatchBefore.updatedAt) ||
    !validDispatchEffect
  ) {
    addIssue(
      context,
      ["dispatchAfter"],
      "Structural route failure must terminally CAS the exact dispatch; runtime unavailability must leave its pinned route and dispatch head unchanged."
    );
  }
}

function addArtifactAssociationCommitIssues(
  commit: {
    artifact: InboxV2OutboundDispatchArtifact;
    dispatch: InboxV2OutboundDispatch;
    attempt: InboxV2OutboundDispatchAttempt;
    route: InboxV2OutboundRoute;
    occurrenceResolution: InboxV2SourceOccurrenceResolutionCommit;
    link: InboxV2OutboundDispatchArtifactReferenceLink;
  },
  context: z.RefinementCtx
): void {
  const { artifact, dispatch, attempt, route, occurrenceResolution, link } =
    commit;
  const occurrence = occurrenceResolution.after;
  const reference = occurrenceResolution.resolvedReference;
  if (reference === null || occurrence.resolution.state !== "resolved") {
    addIssue(
      context,
      ["occurrenceResolution"],
      "Artifact association requires one exactly resolved SourceOccurrence."
    );
    return;
  }
  const artifactReference = artifactReferenceOf(artifact);
  const dispatchReference = dispatchReferenceOf(dispatch);
  const attemptReference = attemptReferenceOf(attempt);
  const occurrenceReference = sourceOccurrenceReferenceOf(occurrence);
  const sameRouteBinding =
    sameReference(
      occurrence.bindingContext.sourceThreadBinding,
      route.sourceThreadBinding
    ) &&
    sameReference(occurrence.bindingContext.sourceAccount, route.sourceAccount);
  const authoritativeProviderWideEcho =
    occurrence.origin.kind === "provider_echo" &&
    occurrence.messageKey.scope.kind === "provider_thread" &&
    occurrence.messageIdentityDeclaration.scopeKind === "provider_thread" &&
    occurrence.messageIdentityDeclaration.decisionStrength ===
      "authoritative" &&
    occurrence.referencePortability.kind === "external_thread" &&
    occurrence.referencePortability.decisionStrength === "authoritative";
  if (
    artifact.state !== "accepted" ||
    artifact.diagnostic !== null ||
    artifact.tenantId !== dispatch.tenantId ||
    artifact.tenantId !== attempt.tenantId ||
    artifact.tenantId !== route.tenantId ||
    artifact.tenantId !== occurrenceResolution.tenantId ||
    artifact.tenantId !== link.tenantId ||
    !sameReference(artifact.dispatch, dispatchReference) ||
    !sameReference(artifact.route, routeReferenceOf(route)) ||
    !sameReference(artifact.attempt, attemptReference) ||
    !sameReference(attempt.dispatch, dispatchReference) ||
    !sameReference(attempt.route, routeReferenceOf(route)) ||
    !sameReference(dispatch.route, routeReferenceOf(route)) ||
    attempt.attemptNumber > dispatch.attemptCount ||
    !sameAdapterContract(
      attempt.retrySafety.adapterContract,
      route.adapterContract
    ) ||
    !sameReference(link.artifact, artifactReference) ||
    !sameReference(link.dispatch, dispatchReference) ||
    !sameReference(link.route, routeReferenceOf(route)) ||
    !sameReference(link.attempt, attemptReference) ||
    !sameReference(link.externalThread, route.externalThread) ||
    !sameReference(link.externalMessageReference, {
      tenantId: reference.tenantId,
      id: reference.id
    }) ||
    !sameReference(link.sourceOccurrence, occurrenceReference) ||
    link.linkedByTrustedServiceId !==
      occurrenceResolution.resolver.trustedServiceId ||
    !sameReference(reference.externalThread, route.externalThread) ||
    !sameReference(
      occurrence.bindingContext.externalThread,
      route.externalThread
    ) ||
    (!sameRouteBinding && !authoritativeProviderWideEcho) ||
    occurrence.direction !== "outbound" ||
    !sameSourceSurface(
      occurrence.descriptor.adapterContract,
      route.adapterContract
    ) ||
    Date.parse(artifact.createdAt) < Date.parse(attempt.openedAt) ||
    Date.parse(link.linkedAt) < Date.parse(artifact.createdAt) ||
    Date.parse(link.linkedAt) < Date.parse(occurrence.updatedAt) ||
    Date.parse(link.linkedAt) < Date.parse(reference.createdAt)
  ) {
    addIssue(
      context,
      ["link"],
      "Artifact link must preserve the exact tenant, route, attempt, thread, reference and occurrence."
    );
  }
  const hasExactOriginEvidence =
    occurrence.origin.kind === "provider_response"
      ? link.associationEvidence.kind === "provider_response_attempt" &&
        sameReference(
          occurrence.origin.outboundDispatchAttempt,
          attemptReference
        )
      : occurrence.origin.kind === "provider_echo" &&
          link.associationEvidence.kind === "provider_echo_correlation"
        ? attempt.retrySafety.providerCorrelationToken !== null &&
          attempt.retrySafety.providerCorrelationToken ===
            link.associationEvidence.correlationToken &&
          occurrence.descriptor.providerReferences.some(
            (providerReference) =>
              String(providerReference.kindId) ===
                String(
                  link.associationEvidence.kind === "provider_echo_correlation"
                    ? link.associationEvidence.providerReferenceKindId
                    : ""
                ) &&
              providerReference.subject ===
                attempt.retrySafety.providerCorrelationToken
          )
        : false;
  if (!hasExactOriginEvidence) {
    addIssue(
      context,
      ["occurrenceResolution", "after", "origin"],
      "Artifact association accepts only the exact provider response attempt or its outbound provider echo."
    );
  }
}

function sameDispatchIdentity(
  left: InboxV2OutboundDispatch,
  right: InboxV2OutboundDispatch
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.id === right.id &&
    sameReference(left.message, right.message) &&
    sameReference(left.route, right.route) &&
    sameNullableReference(left.multiSendOperation, right.multiSendOperation) &&
    left.createdAt === right.createdAt
  );
}

function sameAttemptIdentity(
  left: InboxV2OutboundDispatchAttempt,
  right: InboxV2OutboundDispatchAttempt
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.id === right.id &&
    sameReference(left.dispatch, right.dispatch) &&
    sameReference(left.route, right.route) &&
    left.attemptNumber === right.attemptNumber &&
    left.claimToken === right.claimToken &&
    sameValue(left.retrySafety, right.retrySafety) &&
    left.leaseExpiresAt === right.leaseExpiresAt &&
    left.openedAt === right.openedAt
  );
}

function dispatchReferenceOf(dispatch: InboxV2OutboundDispatch) {
  return inboxV2OutboundDispatchReferenceSchema.parse({
    tenantId: dispatch.tenantId,
    kind: "outbound_dispatch",
    id: dispatch.id
  });
}

function attemptReferenceOf(attempt: InboxV2OutboundDispatchAttempt) {
  return inboxV2OutboundDispatchAttemptReferenceSchema.parse({
    tenantId: attempt.tenantId,
    kind: "outbound_dispatch_attempt",
    id: attempt.id
  });
}

function reconciliationDecisionReferenceOf(
  decision: InboxV2OutboundDispatchReconciliationDecision
) {
  return inboxV2OutboundDispatchReconciliationDecisionReferenceSchema.parse({
    tenantId: decision.tenantId,
    kind: "outbound_dispatch_reconciliation_decision",
    id: decision.id
  });
}

function artifactReferenceOf(artifact: InboxV2OutboundDispatchArtifact) {
  return inboxV2OutboundDispatchArtifactReferenceSchema.parse({
    tenantId: artifact.tenantId,
    kind: "outbound_dispatch_artifact",
    id: artifact.id
  });
}

function routeReferenceOf(route: InboxV2OutboundRoute) {
  return inboxV2OutboundRouteReferenceSchema.parse({
    tenantId: route.tenantId,
    kind: "outbound_route",
    id: route.id
  });
}

function sourceOccurrenceReferenceOf(
  occurrence: InboxV2SourceOccurrenceResolutionCommit["after"]
) {
  return inboxV2SourceOccurrenceReferenceSchema.parse({
    tenantId: occurrence.tenantId,
    kind: "source_occurrence",
    id: occurrence.id
  });
}

function sameAdapterContract(
  left: InboxV2OutboundDispatchAttempt["retrySafety"]["adapterContract"],
  right: InboxV2OutboundRoute["adapterContract"]
): boolean {
  return sameValue(left, right);
}

function sameSourceSurface(
  left: InboxV2OutboundDispatchAttempt["retrySafety"]["adapterContract"],
  right: InboxV2OutboundRoute["adapterContract"]
): boolean {
  return (
    left.contractId === right.contractId &&
    left.contractVersion === right.contractVersion &&
    left.surfaceId === right.surfaceId
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameReference(
  left: { tenantId: string; id: string },
  right: { tenantId: string; id: string }
): boolean {
  return left.tenantId === right.tenantId && left.id === right.id;
}

function sameNullableReference(
  left: { tenantId: string; id: string } | null,
  right: { tenantId: string; id: string } | null
): boolean {
  return left === null || right === null
    ? left === right
    : sameReference(left, right);
}

function addTenantReferenceIssue(
  context: z.RefinementCtx,
  tenantId: string,
  reference: { tenantId: string },
  path: PropertyKey[]
): void {
  if (reference.tenantId !== tenantId) {
    addIssue(
      context,
      path,
      "Inbox V2 nested reference must use the entity tenant."
    );
  }
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
