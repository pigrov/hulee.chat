import type { z } from "zod";

import type { InboxV2DataSubjectReference } from "./data-subject-discovery";
import {
  type InboxV2PrivacyRequest,
  type InboxV2PrivacyRequestReference,
  inboxV2PrivacyRequestSchema
} from "./privacy-request";

declare const request: InboxV2PrivacyRequest;
declare const requestInput: z.input<typeof inboxV2PrivacyRequestSchema>;

const _parsedRequest: InboxV2PrivacyRequest =
  inboxV2PrivacyRequestSchema.parse(requestInput);
const _requestReference: InboxV2PrivacyRequestReference = {
  tenantId: request.tenantId,
  requestId: request.id,
  revision: request.revision
};
const _requesterSubject: InboxV2DataSubjectReference = request.requesterSubject;

if (request.workflow.state === "completed") {
  const _completedAt: string = request.workflow.completedAt;
  const _handlerStatus:
    | "pending"
    | "succeeded_verified"
    | "failed_retryable"
    | "failed_terminal"
    | "unverified" = request.workflow.execution.handlerExecutions[0]!.status;
  const _handlerRootRecordId: string =
    request.workflow.execution.handlerExecutions[0]!.root.recordId;
  const _handlerDisposition:
    | "include_normalized"
    | "include_portable"
    | "correct"
    | "erase"
    | "restrict_processing"
    | "stop_objected_processing" =
    request.workflow.execution.handlerExecutions[0]!.disposition;
  const _externalRootRecordId: string | undefined =
    request.workflow.execution.externalResiduals[0]?.root.recordId;
  const _externalDisposition: "external_action_required" | undefined =
    request.workflow.execution.externalResiduals[0]?.disposition;
}

if (request.workflow.state === "received") {
  // @ts-expect-error The received state cannot expose an unverified decision.
  const _receivedDecision = request.workflow.decision;
}

const _unbrandedReference: InboxV2PrivacyRequestReference = {
  tenantId: request.tenantId,
  // @ts-expect-error A generic string cannot bypass the branded request ID.
  requestId: "privacy_request:request-1",
  revision: request.revision
};
