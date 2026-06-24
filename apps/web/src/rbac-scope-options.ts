import type { OrgUnitRecord, TeamRecord, WorkQueueRecord } from "@hulee/db";

import type { ScopeReferenceOptions } from "./rbac-scope-picker-state";

export function buildScopeReferenceOptions(input: {
  readonly orgUnits: readonly OrgUnitRecord[];
  readonly teams: readonly TeamRecord[];
  readonly workQueues: readonly WorkQueueRecord[];
}): ScopeReferenceOptions {
  return {
    org_unit: input.orgUnits.map((orgUnit) => ({
      value: orgUnit.id,
      label: orgUnit.name
    })),
    team: input.teams.map((team) => ({
      value: team.id,
      label: team.name
    })),
    queue: input.workQueues.map((workQueue) => ({
      value: workQueue.id,
      label: workQueue.name
    }))
  };
}
