import type { EmployeeId, TenantId } from "@hulee/contracts";
import type { AuthSessionPrincipal } from "@hulee/db";
import { describe, expect, it } from "vitest";

import { navigationAccessFromSession } from "./access";
import { webAccessSessionFromPrincipal } from "./session";

const createdAt = new Date("2026-06-25T10:00:00.000Z");
const expiresAt = new Date("2026-06-26T10:00:00.000Z");

describe("web session principal mapping", () => {
  it("does not grant tenant permissions to platform-only sessions", () => {
    const session = webAccessSessionFromPrincipal({
      sessionId: "session-1",
      createdAt,
      expiresAt,
      platformAdmin: {
        id: "platform-admin-1",
        email: "platform@example.test",
        displayName: "Platform Admin"
      }
    });

    expect(session).toMatchObject({
      tenantId: "tenant:platform-admin",
      employeeId: "employee:platform:platform-admin-1",
      email: "platform@example.test",
      systemRoleTemplateIds: [],
      permissions: [],
      platformRoles: ["platform_admin"]
    });
    expect(navigationAccessFromSession(session)).toEqual({
      tenantAdmin: false,
      platformAdmin: true
    });
  });

  it("keeps tenant permissions when a session has a tenant account", () => {
    const principal: AuthSessionPrincipal = {
      sessionId: "session-2",
      createdAt,
      expiresAt,
      tenantAccount: {
        tenantId: "tenant-1" as TenantId,
        tenantSlug: "tenant-1",
        tenantDisplayName: "Tenant 1",
        accountId: "account-1",
        employeeId: "employee-1" as EmployeeId,
        email: "admin@example.test",
        emailVerifiedAt: null,
        displayName: "Admin",
        passwordHash: null,
        systemRoleTemplateIds: ["tenant_admin"],
        permissions: ["tenant.manage", "roles.manage"]
      },
      platformAdmin: {
        id: "platform-admin-1",
        email: "platform@example.test",
        displayName: "Platform Admin"
      }
    };

    const session = webAccessSessionFromPrincipal(principal);

    expect(session).toMatchObject({
      tenantId: "tenant-1",
      employeeId: "employee-1",
      email: "admin@example.test",
      systemRoleTemplateIds: ["tenant_admin"],
      permissions: ["tenant.manage", "roles.manage"],
      platformRoles: ["platform_admin"]
    });
    expect(navigationAccessFromSession(session)).toEqual({
      tenantAdmin: true,
      platformAdmin: true
    });
  });
});
