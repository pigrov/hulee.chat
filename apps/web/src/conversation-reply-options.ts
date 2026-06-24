import type {
  EmployeeId,
  InternalInboxConversation,
  TenantId
} from "@hulee/contracts";
import {
  canAccess,
  type EffectivePermissionGrant,
  type PermissionActor,
  type PermissionResourceContext
} from "@hulee/core";

export function canReplyToConversation(input: {
  readonly tenantId: TenantId;
  readonly actor: PermissionActor;
  readonly effectiveGrants: readonly EffectivePermissionGrant[];
  readonly conversation: InternalInboxConversation;
}): boolean {
  return canAccess({
    actor: input.actor,
    effectiveGrants: input.effectiveGrants,
    permission: "message.reply",
    resource: conversationResourceContext(input.tenantId, input.conversation)
  }).allowed;
}

function conversationResourceContext(
  tenantId: TenantId,
  conversation: InternalInboxConversation
): PermissionResourceContext {
  return {
    tenantId,
    clientId: conversation.clientId as PermissionResourceContext["clientId"],
    conversationId:
      conversation.id as PermissionResourceContext["conversationId"],
    orgUnitId: conversation.currentQueueOwningOrgUnitId,
    teamId: conversation.assignedTeamId,
    teamIds:
      conversation.assignedTeamId === undefined
        ? undefined
        : [conversation.assignedTeamId],
    queueId: conversation.currentQueueId,
    assignedEmployeeId: conversation.assignedEmployeeId as
      | EmployeeId
      | undefined,
    assignedTeamIds:
      conversation.assignedTeamId === undefined
        ? undefined
        : [conversation.assignedTeamId]
  };
}
