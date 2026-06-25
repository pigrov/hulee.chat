import type {
  EmployeeId,
  InternalInboxConversation,
  TenantId
} from "@hulee/contracts";
import type { EffectivePermissionGrant, PermissionActor } from "@hulee/core";
import type {
  TeamRecord,
  TenantEmployeeRecord,
  WorkQueueRecord
} from "@hulee/db";
import { describe, expect, it } from "vitest";

import { buildConversationRoutingOptions } from "./conversation-routing-options";

const tenantId = "tenant-1" as TenantId;
const employeeId = "employee-1" as EmployeeId;
const actor: PermissionActor = {
  tenantId,
  employeeId,
  queueIds: ["queue-sales"],
  teamIds: ["team-sales"],
  orgUnitIds: ["org-sales"]
};
const conversation: InternalInboxConversation = {
  id: "conversation-1",
  clientId: "client-1",
  clientDisplayName: "Client",
  status: "open",
  source: "telegram",
  currentQueueId: "queue-sales",
  currentQueueOwningOrgUnitId: "org-sales",
  messageCount: 1,
  queuedCount: 0
};
const employees: readonly TenantEmployeeRecord[] = [
  employee("employee-1" as EmployeeId),
  employee("employee-2" as EmployeeId),
  {
    ...employee("employee-deactivated" as EmployeeId),
    deactivatedAt: new Date("2026-06-22T10:00:00.000Z")
  }
];
const teams: readonly TeamRecord[] = [team("team-sales"), team("team-claims")];
const workQueues: readonly WorkQueueRecord[] = [
  workQueue("queue-sales", "org-sales"),
  workQueue("queue-claims", "org-claims")
];

describe("conversation routing options", () => {
  it("limits queue-scoped routing targets to the actor queue scope", () => {
    const options = buildConversationRoutingOptions({
      tenantId,
      actor,
      effectiveGrants: [grant("queue", "queue-sales")],
      conversation,
      employees,
      teams,
      workQueues
    });

    expect(options.canRouteConversation).toBe(true);
    expect(options.workQueues.map((queue) => queue.id)).toEqual([
      "queue-sales"
    ]);
    expect(options.employees.map((employee) => employee.employeeId)).toEqual([
      "employee-1",
      "employee-2"
    ]);
    expect(options.canClearQueue).toBe(false);
    expect(options.canAssignToCurrentEmployee).toBe(true);
  });

  it("allows team-scoped routing targets when the target team matches", () => {
    const options = buildConversationRoutingOptions({
      tenantId,
      actor,
      effectiveGrants: [grant("team", "team-sales")],
      conversation: {
        ...conversation,
        currentQueueId: "queue-claims",
        currentQueueOwningOrgUnitId: "org-claims",
        assignedTeamId: "team-sales"
      },
      employees,
      teams,
      workQueues
    });

    expect(options.canRouteConversation).toBe(true);
    expect(options.teams.map((teamOption) => teamOption.id)).toEqual([
      "team-sales"
    ]);
    expect(options.canClearTeam).toBe(false);
  });

  it("limits org-scoped routing targets to queues owned by the org", () => {
    const options = buildConversationRoutingOptions({
      tenantId,
      actor,
      effectiveGrants: [grant("org_unit", "org-sales")],
      conversation,
      employees,
      teams,
      workQueues
    });

    expect(options.canRouteConversation).toBe(true);
    expect(options.workQueues.map((queue) => queue.id)).toEqual([
      "queue-sales"
    ]);
    expect(options.canClearQueue).toBe(false);
  });

  it("returns no routing options when the current conversation is outside scope", () => {
    const options = buildConversationRoutingOptions({
      tenantId,
      actor,
      effectiveGrants: [grant("queue", "queue-sales")],
      conversation: {
        ...conversation,
        currentQueueId: "queue-claims",
        currentQueueOwningOrgUnitId: "org-claims"
      },
      employees,
      teams,
      workQueues
    });

    expect(options).toMatchObject({
      canRouteConversation: false,
      employees: [],
      teams: [],
      workQueues: []
    });
  });
});

function employee(employeeIdValue: EmployeeId): TenantEmployeeRecord {
  return {
    tenantId,
    employeeId: employeeIdValue,
    accountId: `account:${employeeIdValue}`,
    email: `${employeeIdValue}@example.test`,
    displayName: employeeIdValue,
    systemRoleTemplateIds: [],
    orgUnitIds: ["org-sales"],
    queueIds: ["queue-sales"],
    teamIds: ["team-sales"],
    createdAt: new Date("2026-06-22T10:00:00.000Z"),
    deactivatedAt: null
  };
}

function team(id: string): TeamRecord {
  return {
    id,
    tenantId,
    name: id
  };
}

function workQueue(id: string, owningOrgUnitId: string): WorkQueueRecord {
  return {
    id,
    tenantId,
    name: id,
    kind: "sales",
    owningOrgUnitId,
    status: "active",
    routingConfig: {}
  };
}

function grant(
  scopeType: "queue" | "team" | "org_unit",
  id: string
): EffectivePermissionGrant {
  return {
    tenantId,
    employeeId,
    permission: "conversation.assign",
    scope: {
      type: scopeType,
      id
    },
    sources: []
  };
}
