import {
  canAccess,
  type EffectivePermissionGrant,
  type PermissionActor,
  type PermissionResourceContext
} from "@hulee/core";
import type { WorkQueueRecord } from "@hulee/db";

export function buildReadableInboxQueueOptions(input: {
  readonly actor: PermissionActor;
  readonly effectiveGrants: readonly EffectivePermissionGrant[];
  readonly workQueues: readonly WorkQueueRecord[];
}): readonly WorkQueueRecord[] {
  return input.workQueues.filter(
    (workQueue) =>
      canAccess({
        actor: input.actor,
        effectiveGrants: input.effectiveGrants,
        permission: "inbox.read",
        resource: workQueueResourceContext(workQueue)
      }).allowed
  );
}

export function resolveReadableInboxQueueFilter(input: {
  readonly queueId: string | undefined;
  readonly workQueues: readonly WorkQueueRecord[];
}): string | undefined {
  if (input.queueId === undefined) {
    return undefined;
  }

  return input.workQueues.some((workQueue) => workQueue.id === input.queueId)
    ? input.queueId
    : undefined;
}

function workQueueResourceContext(
  workQueue: WorkQueueRecord
): PermissionResourceContext {
  return {
    tenantId: workQueue.tenantId,
    orgUnitId: workQueue.owningOrgUnitId ?? undefined,
    queueId: workQueue.id
  };
}
