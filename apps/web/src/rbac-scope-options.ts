import type { OrgUnitRecord, WorkQueueRecord } from "@hulee/db";

import type { ScopeReferenceOptions } from "./rbac-scope-picker";

export function buildScopeReferenceOptions(input: {
  readonly orgUnits: readonly OrgUnitRecord[];
  readonly workQueues: readonly WorkQueueRecord[];
}): ScopeReferenceOptions {
  return {
    org_unit: input.orgUnits.map((orgUnit) => ({
      value: orgUnit.id,
      label: orgUnit.name
    })),
    queue: input.workQueues.map((workQueue) => ({
      value: workQueue.id,
      label: workQueue.name
    }))
  };
}
