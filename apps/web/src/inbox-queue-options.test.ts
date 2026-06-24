import type { EmployeeId, TenantId } from "@hulee/contracts";
import type { EffectivePermissionGrant, PermissionActor } from "@hulee/core";
import type { WorkQueueRecord } from "@hulee/db";
import { describe, expect, it } from "vitest";

import {
  buildReadableInboxQueueOptions,
  resolveReadableInboxQueueFilter
} from "./inbox-queue-options";

const tenantId = "tenant-1" as TenantId;
const employeeId = "employee-1" as EmployeeId;
const actor: PermissionActor = {
  tenantId,
  employeeId,
  orgUnitIds: ["org-sales"],
  queueIds: ["queue-sales"]
};
const workQueues: readonly WorkQueueRecord[] = [
  workQueue("queue-sales", "org-sales"),
  workQueue("queue-claims", "org-claims"),
  workQueue("queue-unowned", null)
];

describe("inbox queue options", () => {
  it("shows every active queue for tenant-wide inbox readers", () => {
    const options = buildReadableInboxQueueOptions({
      actor,
      effectiveGrants: [grant({ type: "tenant" })],
      workQueues
    });

    expect(options.map((workQueueOption) => workQueueOption.id)).toEqual([
      "queue-sales",
      "queue-claims",
      "queue-unowned"
    ]);
  });

  it("limits queue options by org and queue scopes", () => {
    expect(
      buildReadableInboxQueueOptions({
        actor,
        effectiveGrants: [grant({ type: "org_unit", id: "org-sales" })],
        workQueues
      }).map((workQueueOption) => workQueueOption.id)
    ).toEqual(["queue-sales"]);

    expect(
      buildReadableInboxQueueOptions({
        actor,
        effectiveGrants: [grant({ type: "queue", id: "queue-claims" })],
        workQueues
      }).map((workQueueOption) => workQueueOption.id)
    ).toEqual(["queue-claims"]);
  });

  it("does not expose queue filters for personal or entity scopes", () => {
    const options = buildReadableInboxQueueOptions({
      actor,
      effectiveGrants: [
        grant({ type: "assigned" }),
        grant({ type: "client", id: "client-1" }),
        grant({ type: "conversation", id: "conversation-1" })
      ],
      workQueues
    });

    expect(options).toEqual([]);
  });

  it("drops an active queue filter when the queue is not readable", () => {
    expect(
      resolveReadableInboxQueueFilter({
        queueId: "queue-claims",
        workQueues: [workQueue("queue-sales", "org-sales")]
      })
    ).toBeUndefined();

    expect(
      resolveReadableInboxQueueFilter({
        queueId: "queue-sales",
        workQueues: [workQueue("queue-sales", "org-sales")]
      })
    ).toBe("queue-sales");
  });
});

function grant(
  scope: EffectivePermissionGrant["scope"]
): EffectivePermissionGrant {
  return {
    tenantId,
    employeeId,
    permission: "inbox.read",
    scope,
    sources: []
  };
}

function workQueue(
  id: string,
  owningOrgUnitId: string | null
): WorkQueueRecord {
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
