import type { EmployeeId, EventId, TenantId } from "@hulee/contracts";
import { describe, expect, it } from "vitest";

import { createRbacEvent } from "./rbac-events";

const tenantId = "tenant_rbac_events" as TenantId;
const actorEmployeeId = "employee_admin" as EmployeeId;
const now = "2026-06-24T10:00:00.000Z";

describe("RBAC events", () => {
  it("creates tenant-scoped role mutation events", () => {
    const event = createRbacEvent({
      id: "event_role_created" as EventId,
      tenantId,
      type: "role.created",
      occurredAt: now,
      payload: {
        roleId: "role-sales",
        actorEmployeeId,
        name: "Sales",
        description: "Sales access",
        permissions: ["client.view", "message.reply"],
        permissionCount: 2,
        isSystem: false
      }
    });

    expect(event).toMatchObject({
      id: "event_role_created",
      tenantId,
      type: "role.created",
      version: "v1",
      occurredAt: now,
      payload: {
        roleId: "role-sales",
        actorEmployeeId,
        permissionCount: 2
      }
    });
  });

  it("creates scoped role binding and direct grant events", () => {
    const bindingEvent = createRbacEvent({
      id: "event_binding_created" as EventId,
      tenantId,
      type: "role_binding.created",
      occurredAt: now,
      payload: {
        bindingId: "binding-sales",
        roleId: "role-sales",
        actorEmployeeId,
        subject: {
          type: "employee",
          id: "employee-agent"
        },
        targetEmployeeId: "employee-agent" as EmployeeId,
        scope: {
          type: "queue",
          id: "queue-sales"
        }
      }
    });
    const grantEvent = createRbacEvent({
      id: "event_grant_created" as EventId,
      tenantId,
      type: "direct_grant.created",
      occurredAt: now,
      payload: {
        grantId: "grant-sales",
        actorEmployeeId,
        targetEmployeeId: "employee-agent" as EmployeeId,
        permission: "message.reply",
        reason: "temporary coverage",
        scope: {
          type: "assigned"
        }
      }
    });

    expect(bindingEvent.payload).toMatchObject({
      subject: {
        type: "employee",
        id: "employee-agent"
      },
      scope: {
        type: "queue",
        id: "queue-sales"
      }
    });
    expect(grantEvent.payload).toMatchObject({
      permission: "message.reply",
      reason: "temporary coverage",
      scope: {
        type: "assigned"
      }
    });
  });
});
