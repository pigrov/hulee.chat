import type {
  InboxV2SourceMessageAdapterReconciliationDescriptor,
  InboxV2SourceMessageReconciliationPlan,
  InboxV2SourceMessageReconciliationRequest
} from "./source-message-reconciliation";

declare const request: InboxV2SourceMessageReconciliationRequest;
declare const descriptor: InboxV2SourceMessageAdapterReconciliationDescriptor;
declare const plan: InboxV2SourceMessageReconciliationPlan;

const _requestContextOutcome: "resolved" = request.context.outcome;
const _candidateReference: string = plan.candidateExternalMessageReferenceId;
const _occurrenceId: string = plan.sourceOccurrence.id;

if (plan.messageKey.scope.kind === "source_account") {
  const _accountKind: "source_account" = plan.messageKey.scope.owner.kind;
}

if (plan.intent.kind === "message_create") {
  const _messageId: string = plan.intent.candidateMessageId;
  const _timelineItemId: string = plan.intent.candidateTimelineItemId;

  // @ts-expect-error Message-create intent never carries a deferred action.
  const _deferred = plan.intent.deferredAction;
}

if (plan.intent.kind === "source_action") {
  const _pendingState: string = plan.intent.deferredAction.state.state;

  // @ts-expect-error Source action cannot select a transport-link target.
  const _link = plan.intent.candidateTransportLinkId;
}

if (plan.intent.kind === "echo_handoff") {
  const _echoRole: "provider_echo" = plan.intent.transportRole;

  // @ts-expect-error Echo handoff never selects a canonical Message.
  const _message = plan.intent.candidateMessageId;
}

const _invalidDescriptorKey: InboxV2SourceMessageAdapterReconciliationDescriptor =
  {
    ...descriptor,
    // @ts-expect-error Core derives the exact key and scope owner server-side.
    externalMessageKey: plan.messageKey
  };

const _invalidWeakTarget: InboxV2SourceMessageAdapterReconciliationDescriptor =
  {
    ...descriptor,
    weakCorrelationEvidence: [
      {
        codeId: descriptor.weakCorrelationEvidence[0]!.codeId,
        evidenceHmacSha256: `hmac-sha256:${"a".repeat(64)}`,
        expiresAt: "2026-07-17T09:00:00.000Z",
        // @ts-expect-error Weak evidence is safe diagnostic data, never a target.
        messageId: "message:latest"
      }
    ]
  };

const _invalidRequestSelector: InboxV2SourceMessageReconciliationRequest = {
  ...request,
  // @ts-expect-error Client identity cannot select or merge a provider Message.
  clientId: "client:client-1"
};

void _requestContextOutcome;
void _candidateReference;
void _occurrenceId;
void _invalidDescriptorKey;
void _invalidWeakTarget;
void _invalidRequestSelector;
