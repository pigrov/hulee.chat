import type {
  ConversationId,
  EmployeeId,
  EventEnvelope,
  TenantId
} from "@hulee/contracts";

import { createDomainEvent } from "./domain-events";
import { CoreError } from "./errors";
import type { IdFactory } from "./ids";
import type { Conversation } from "./vertical-slice";

export type AssignConversationRoutingInput = {
  readonly now: string;
  readonly idFactory: IdFactory;
  readonly tenantId: TenantId;
  readonly actorEmployeeId: EmployeeId;
  readonly conversation: Conversation;
  readonly currentQueueId?: string | null;
  readonly assignedEmployeeId?: EmployeeId | null;
  readonly assignedTeamId?: string | null;
};

export type AssignConversationRoutingResult = {
  readonly conversation: Conversation;
  readonly events: readonly EventEnvelope<
    "conversation.assigned",
    {
      conversationId: ConversationId;
      actorEmployeeId: EmployeeId;
      currentQueueId: string | null;
      assignedEmployeeId: EmployeeId | null;
      assignedTeamId: string | null;
    }
  >[];
};

export function assignConversationRouting(
  input: AssignConversationRoutingInput
): AssignConversationRoutingResult {
  assertSameTenant(input.tenantId, input.conversation.tenantId);

  const conversation: Conversation = {
    ...input.conversation,
    currentQueueId:
      input.currentQueueId === undefined
        ? input.conversation.currentQueueId
        : (input.currentQueueId ?? undefined),
    assignedEmployeeId:
      input.assignedEmployeeId === undefined
        ? input.conversation.assignedEmployeeId
        : (input.assignedEmployeeId ?? undefined),
    assignedTeamId:
      input.assignedTeamId === undefined
        ? input.conversation.assignedTeamId
        : (input.assignedTeamId ?? undefined)
  };

  return {
    conversation,
    events: [
      createDomainEvent({
        id: input.idFactory.eventId("conversation.assigned"),
        type: "conversation.assigned",
        tenantId: input.tenantId,
        occurredAt: input.now,
        payload: {
          conversationId: conversation.id,
          actorEmployeeId: input.actorEmployeeId,
          currentQueueId: conversation.currentQueueId ?? null,
          assignedEmployeeId: conversation.assignedEmployeeId ?? null,
          assignedTeamId: conversation.assignedTeamId ?? null
        }
      })
    ]
  };
}

function assertSameTenant(left: TenantId, right: TenantId): void {
  if (left !== right) {
    throw new CoreError("tenant.boundary_violation");
  }
}
