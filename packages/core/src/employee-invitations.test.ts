import type { TenantId } from "@hulee/contracts";
import { describe, expect, it } from "vitest";

import {
  acceptEmployeeInvitation,
  changeEmployeeRole,
  CoreError,
  createEmployeeInvitation,
  createSequentialIdFactory,
  deactivateEmployee,
  resendEmployeeInvitation,
  revokeEmployeeInvitation,
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

  it("revokes and resends pending invitations", () => {
    const invitation = createEmployeeInvitation({
      now,
      tenantId,
      actor: tenantAdmin,
      email: "agent@example.test",
      role: "agent",
      tokenHash,
      expiresAt: "2026-06-30T10:00:00.000Z",
      idFactory: createSequentialIdFactory("invite-admin")
    }).invitation;
    const revoked = revokeEmployeeInvitation({
      now: "2026-06-24T10:00:00.000Z",
      tenantId,
      actor: tenantAdmin,
      invitation,
      idFactory: createSequentialIdFactory("invite-revoke")
    });
    const resent = resendEmployeeInvitation({
      now: "2026-06-25T10:00:00.000Z",
      tenantId,
      actor: tenantAdmin,
      invitation: revoked.invitation,
      tokenHash:
        "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      expiresAt: "2026-07-02T10:00:00.000Z",
      idFactory: createSequentialIdFactory("invite-resend")
    });

    expect(revoked.invitation.revokedAt).toBe("2026-06-24T10:00:00.000Z");
    expect(revoked.events[0]?.type).toBe("employee.invitation_revoked");
    expect(resent.invitation.revokedAt).toBeUndefined();
    expect(resent.invitation.expiresAt).toBe("2026-07-02T10:00:00.000Z");
    expect(resent.events[0]?.type).toBe("employee.invitation_resent");
  });

  it("changes another employee role and rejects self role changes", () => {
    const agent: Employee = {
      id: "employee_agent" as Employee["id"],
      tenantId,
      email: "agent@example.test",
      displayName: "Agent",
      roles: ["agent"],
      createdAt: now
    };
    const changed = changeEmployeeRole({
      now: "2026-06-24T10:00:00.000Z",
      tenantId,
      actor: tenantAdmin,
      employee: agent,
      role: "supervisor",
      idFactory: createSequentialIdFactory("role-change")
    });

    expect(changed.employee.roles).toEqual(["supervisor"]);
    expect(changed.events[0]).toMatchObject({
      type: "employee.role_changed",
      payload: {
        employeeId: agent.id,
        role: "supervisor"
      }
    });

    expect(() => {
      changeEmployeeRole({
        now: "2026-06-24T10:00:00.000Z",
        tenantId,
        actor: tenantAdmin,
        employee: tenantAdmin,
        role: "agent"
      });
    }).toThrow(new CoreError("validation.failed"));
  });

  it("deactivates another employee and rejects self deactivation", () => {
    const agent: Employee = {
      id: "employee_agent" as Employee["id"],
      tenantId,
      email: "agent@example.test",
      displayName: "Agent",
      roles: ["agent"],
      createdAt: now
    };
    const deactivated = deactivateEmployee({
      now: "2026-06-24T10:00:00.000Z",
      tenantId,
      actor: tenantAdmin,
      employee: agent,
      idFactory: createSequentialIdFactory("deactivate")
    });

    expect(deactivated.employee.deactivatedAt).toBe("2026-06-24T10:00:00.000Z");
    expect(deactivated.events[0]?.type).toBe("employee.deactivated");

    expect(() => {
      deactivateEmployee({
        now: "2026-06-24T10:00:00.000Z",
        tenantId,
        actor: tenantAdmin,
        employee: tenantAdmin
      });
    }).toThrow(new CoreError("validation.failed"));
  });
});
