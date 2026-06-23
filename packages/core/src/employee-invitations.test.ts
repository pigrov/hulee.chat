import type { TenantId } from "@hulee/contracts";
import { describe, expect, it } from "vitest";

import {
  acceptEmployeeInvitation,
  CoreError,
  createEmployeeInvitation,
  createSequentialIdFactory,
  type Employee
} from "./index";

const tenantId = "tenant_invites" as TenantId;
const now = "2026-06-23T10:00:00.000Z";
const tokenHash =
  "sha256:1111111111111111111111111111111111111111111111111111111111111111";

const tenantAdmin: Employee = {
  id: "employee_admin" as Employee["id"],
  tenantId,
  email: "admin@example.test",
  displayName: "Admin",
  roles: ["tenant_admin"],
  createdAt: now
};

describe("employee invitations", () => {
  it("creates a tenant-scoped invitation and emits an event", () => {
    const result = createEmployeeInvitation({
      now,
      tenantId,
      actor: tenantAdmin,
      email: " AGENT@EXAMPLE.TEST ",
      displayName: "Agent",
      role: "agent",
      tokenHash,
      expiresAt: "2026-06-30T10:00:00.000Z",
      idFactory: createSequentialIdFactory("invite")
    });

    expect(result.invitation).toMatchObject({
      tenantId,
      email: "agent@example.test",
      displayName: "Agent",
      role: "agent",
      invitedByEmployeeId: tenantAdmin.id
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      tenantId,
      type: "employee.invited",
      payload: {
        invitationId: result.invitation.id,
        email: "agent@example.test",
        role: "agent"
      }
    });
  });

  it("requires employees.manage permission", () => {
    expect(() => {
      createEmployeeInvitation({
        now,
        tenantId,
        actor: {
          ...tenantAdmin,
          roles: ["agent"]
        },
        email: "agent@example.test",
        role: "agent",
        tokenHash,
        expiresAt: "2026-06-30T10:00:00.000Z"
      });
    }).toThrow(new CoreError("permission.denied"));
  });

  it("protects tenant boundary before creating invitations", () => {
    expect(() => {
      createEmployeeInvitation({
        now,
        tenantId: "tenant_other" as TenantId,
        actor: tenantAdmin,
        email: "agent@example.test",
        role: "agent",
        tokenHash,
        expiresAt: "2026-06-30T10:00:00.000Z"
      });
    }).toThrow(new CoreError("tenant.boundary_violation"));
  });

  it("accepts a pending invitation into an employee", () => {
    const invitation = createEmployeeInvitation({
      now,
      tenantId,
      actor: tenantAdmin,
      email: "agent@example.test",
      role: "supervisor",
      tokenHash,
      expiresAt: "2026-06-30T10:00:00.000Z",
      idFactory: createSequentialIdFactory("invite-accept-source")
    }).invitation;
    const result = acceptEmployeeInvitation({
      now: "2026-06-24T10:00:00.000Z",
      invitation,
      displayName: "Accepted Agent",
      idFactory: createSequentialIdFactory("invite-accept")
    });

    expect(result.employee).toMatchObject({
      tenantId,
      email: "agent@example.test",
      displayName: "Accepted Agent",
      roles: ["supervisor"]
    });
    expect(result.events.map((event) => event.type)).toEqual([
      "employee.created",
      "employee.invitation_accepted"
    ]);
  });

  it("rejects expired or already closed invitations", () => {
    const invitation = createEmployeeInvitation({
      now,
      tenantId,
      actor: tenantAdmin,
      email: "agent@example.test",
      role: "agent",
      tokenHash,
      expiresAt: "2026-06-30T10:00:00.000Z"
    }).invitation;

    expect(() => {
      acceptEmployeeInvitation({
        now: "2026-07-01T10:00:00.000Z",
        invitation
      });
    }).toThrow(new CoreError("validation.failed"));

    expect(() => {
      acceptEmployeeInvitation({
        now: "2026-06-24T10:00:00.000Z",
        invitation: {
          ...invitation,
          acceptedAt: "2026-06-24T09:00:00.000Z"
        }
      });
    }).toThrow(new CoreError("validation.failed"));
  });
});
