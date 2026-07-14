import { z } from "zod";

import type {
  InboxV2OutboundDispatch,
  InboxV2OutboundDispatchArtifactReferenceLink,
  InboxV2OutboundDispatchAttempt,
  InboxV2OutboundDispatchReconciliationDecision,
  InboxV2OutboundMultiSendOperation
} from "./outbound-dispatch";
import {
  inboxV2OutboundDispatchAttemptSchema,
  inboxV2OutboundDispatchArtifactReferenceLinkSchema,
  inboxV2OutboundDispatchOperatorRetryAuthorizationDecisionSchema,
  inboxV2OutboundDispatchSchema,
  inboxV2OutboundMultiSendOperationSchema
} from "./outbound-dispatch";

declare const dispatch: InboxV2OutboundDispatch;
declare const attempt: InboxV2OutboundDispatchAttempt;
declare const artifactLink: InboxV2OutboundDispatchArtifactReferenceLink;
declare const reconciliationDecision: InboxV2OutboundDispatchReconciliationDecision;
declare const multiSend: InboxV2OutboundMultiSendOperation;

const _dispatchInput: z.input<typeof inboxV2OutboundDispatchSchema> = {
  tenantId: "tenant:tenant-1",
  id: "outbound_dispatch:dispatch-1",
  message: {
    tenantId: "tenant:tenant-1",
    kind: "message",
    id: "message:message-1"
  },
  route: {
    tenantId: "tenant:tenant-1",
    kind: "outbound_route",
    id: "outbound_route:route-1"
  },
  multiSendOperation: null,
  state: "queued",
  attemptCount: 0,
  activeAttempt: null,
  lastAttempt: null,
  retryAuthorization: null,
  revision: "1",
  createdAt: "2026-07-11T09:00:00.000Z",
  updatedAt: "2026-07-11T09:00:00.000Z"
};

const _attemptInput: z.input<typeof inboxV2OutboundDispatchAttemptSchema> = {
  tenantId: "tenant:tenant-1",
  id: "outbound_dispatch_attempt:attempt-1",
  dispatch: {
    tenantId: "tenant:tenant-1",
    kind: "outbound_dispatch",
    id: "outbound_dispatch:dispatch-1"
  },
  route: {
    tenantId: "tenant:tenant-1",
    kind: "outbound_route",
    id: "outbound_route:route-1"
  },
  attemptNumber: 1,
  claimToken: "claim:attempt-0001",
  retrySafety: {
    adapterContract: {
      contractId: "module:synthetic-source:direct-contract",
      contractVersion: "v1",
      declarationRevision: "1",
      surfaceId: "module:synthetic-source:direct-surface",
      loadedByTrustedServiceId: "core:source-runtime",
      loadedAt: "2026-07-11T09:00:00.000Z"
    },
    declaredByTrustedServiceId: "core:source-runtime",
    declarationToken: "declaration:retry-safety-0001",
    declaredAt: "2026-07-11T09:00:00.000Z",
    mechanism: "provider_idempotency_key",
    providerCorrelationToken: "provider:idempotency-0001",
    automaticRetryAllowed: true
  },
  leaseExpiresAt: "2026-07-11T09:01:00.000Z",
  openedAt: "2026-07-11T09:00:00.000Z",
  outcome: { kind: "pending" },
  completionSource: null,
  revision: "1"
};

const _unknownAttemptInput: z.input<
  typeof inboxV2OutboundDispatchAttemptSchema
> = {
  ..._attemptInput,
  outcome: {
    kind: "outcome_unknown",
    completedAt: "2026-07-11T09:01:00.000Z",
    diagnostic: {
      codeId: "core:provider-outcome-unknown",
      retryable: false,
      correlationToken: "diagnostic:unknown-0001",
      safeOperatorHintId: null
    },
    requiredAction: "automated_reconciliation_required"
  },
  completionSource: "lease_expired",
  revision: "2"
};

const _postHocSafetyInput: z.input<
  typeof inboxV2OutboundDispatchAttemptSchema
> = {
  ..._unknownAttemptInput,
  outcome: {
    ..._unknownAttemptInput.outcome,
    // @ts-expect-error Retry safety is pinned on Attempt before I/O, never added to outcome_unknown.
    retrySafety: _attemptInput.retrySafety
  }
};

const _operatorAuthorizationInput: z.input<
  typeof inboxV2OutboundDispatchOperatorRetryAuthorizationDecisionSchema
> = {
  tenantId: "tenant:tenant-1",
  employee: {
    tenantId: "tenant:tenant-1",
    kind: "employee",
    id: "employee:employee-1"
  },
  dispatch: {
    tenantId: "tenant:tenant-1",
    kind: "outbound_dispatch",
    id: "outbound_dispatch:dispatch-1"
  },
  route: {
    tenantId: "tenant:tenant-1",
    kind: "outbound_route",
    id: "outbound_route:route-1"
  },
  unknownAttempt: {
    tenantId: "tenant:tenant-1",
    kind: "outbound_dispatch_attempt",
    id: "outbound_dispatch_attempt:attempt-1"
  },
  requiredPermissionId: "core:outbound_dispatch.duplicate-risk-retry",
  authorizationEpoch: "authorization:unsafe-retry-0001",
  effect: "allow",
  matchedPermissionIds: ["core:outbound_dispatch.duplicate-risk-retry"],
  decisionToken: "decision:unsafe-retry-0001",
  decisionRevision: "1",
  loadedByTrustedServiceId: "core:authorization-service",
  decidedAt: "2026-07-11T09:02:00.000Z",
  notAfter: "2026-07-11T10:00:00.000Z"
};

const _wrongOperatorPermissionInput: z.input<
  typeof inboxV2OutboundDispatchOperatorRetryAuthorizationDecisionSchema
> = {
  ..._operatorAuthorizationInput,
  // @ts-expect-error Duplicate-risk retry authority has one exact permission purpose.
  requiredPermissionId: "core:inbox.read"
};

const _artifactLinkInput: z.input<
  typeof inboxV2OutboundDispatchArtifactReferenceLinkSchema
> = {
  tenantId: "tenant:tenant-1",
  id: "outbound_dispatch_artifact_reference_link:link-1",
  artifact: {
    tenantId: "tenant:tenant-1",
    kind: "outbound_dispatch_artifact",
    id: "outbound_dispatch_artifact:artifact-1"
  },
  dispatch: _operatorAuthorizationInput.dispatch,
  route: _operatorAuthorizationInput.route,
  attempt: _operatorAuthorizationInput.unknownAttempt,
  externalThread: {
    tenantId: "tenant:tenant-1",
    kind: "external_thread",
    id: "external_thread:thread-1"
  },
  externalMessageReference: {
    tenantId: "tenant:tenant-1",
    kind: "external_message_reference",
    id: "external_message_reference:reference-1"
  },
  sourceOccurrence: {
    tenantId: "tenant:tenant-1",
    kind: "source_occurrence",
    id: "source_occurrence:occurrence-1"
  },
  associationEvidence: { kind: "provider_response_attempt" },
  linkedByTrustedServiceId: "core:source-runtime",
  linkedAt: "2026-07-11T09:03:00.000Z",
  revision: "1"
};

const _multiSendInput: z.input<typeof inboxV2OutboundMultiSendOperationSchema> =
  {
    tenantId: "tenant:tenant-1",
    id: "outbound_multi_send_operation:operation-1",
    actor: {
      kind: "trusted_service",
      trustedServiceId: "core:multi-send"
    },
    mutationToken: "mutation:multi-send-1",
    idempotencyToken: "idempotency:multi-send-1",
    correlationToken: "correlation:multi-send-1",
    children: [
      {
        conversation: {
          tenantId: "tenant:tenant-1",
          kind: "conversation",
          id: "conversation:conversation-1"
        },
        externalThread: {
          tenantId: "tenant:tenant-1",
          kind: "external_thread",
          id: "external_thread:thread-1"
        },
        binding: {
          tenantId: "tenant:tenant-1",
          kind: "source_thread_binding",
          id: "source_thread_binding:binding-1"
        },
        sourceAccount: {
          tenantId: "tenant:tenant-1",
          kind: "source_account",
          id: "source_account:account-1"
        },
        route: {
          tenantId: "tenant:tenant-1",
          kind: "outbound_route",
          id: "outbound_route:route-1"
        },
        dispatch: {
          tenantId: "tenant:tenant-1",
          kind: "outbound_dispatch",
          id: "outbound_dispatch:dispatch-1"
        }
      },
      {
        conversation: {
          tenantId: "tenant:tenant-1",
          kind: "conversation",
          id: "conversation:conversation-2"
        },
        externalThread: {
          tenantId: "tenant:tenant-1",
          kind: "external_thread",
          id: "external_thread:thread-2"
        },
        binding: {
          tenantId: "tenant:tenant-1",
          kind: "source_thread_binding",
          id: "source_thread_binding:binding-2"
        },
        sourceAccount: {
          tenantId: "tenant:tenant-1",
          kind: "source_account",
          id: "source_account:account-2"
        },
        route: {
          tenantId: "tenant:tenant-1",
          kind: "outbound_route",
          id: "outbound_route:route-2"
        },
        dispatch: {
          tenantId: "tenant:tenant-1",
          kind: "outbound_dispatch",
          id: "outbound_dispatch:dispatch-2"
        }
      }
    ],
    createdAt: "2026-07-11T09:00:00.000Z",
    revision: "1"
  };

const _invalidDispatchInput: z.input<typeof inboxV2OutboundDispatchSchema> = {
  ..._dispatchInput,
  // @ts-expect-error A normal dispatch has one immutable route, never a route array.
  route: [_dispatchInput.route]
};

const _invalidAttemptInput: z.input<
  typeof inboxV2OutboundDispatchAttemptSchema
> = {
  ..._attemptInput,
  // @ts-expect-error Provider receipts are represented by typed outcomes/artifacts.
  providerReceipt: "sent"
};

// @ts-expect-error A dispatch is not a provider-call attempt.
const _attemptFromDispatch: InboxV2OutboundDispatchAttempt = dispatch;

// @ts-expect-error Explicit multi-send cannot substitute for one normal dispatch.
const _dispatchFromMultiSend: InboxV2OutboundDispatch = multiSend;

// @ts-expect-error An artifact-reference link is not a provider attempt.
const _attemptFromArtifactLink: InboxV2OutboundDispatchAttempt = artifactLink;

// @ts-expect-error A reconciliation decision is not an immutable artifact link.
const _linkFromReconciliation: InboxV2OutboundDispatchArtifactReferenceLink =
  reconciliationDecision;

void attempt;
void reconciliationDecision;
