import type { EmployeeId, TenantId } from "@hulee/contracts";
import type {
  EffectivePermissionGrant,
  EmployeeRole,
  Permission
} from "@hulee/core";
import { describe, expect, it } from "vitest";

import type { PlatformRole, WebAccessSession } from "./access";
import {
  getVisibleTenantAdminSections,
  navigationAccessFromTenantAdminAccess
} from "./tenant-admin-nav";

describe("tenant admin navigation", () => {
  it("shows every tenant admin section for tenant admins", () => {
    expect(
      getVisibleTenantAdminSections(
        session([
          "tenant.manage",
          "employees.manage",
          "roles.manage",
          "audit.view",
          "modules.manage"
        ])
      ).map((section) => section.id)
    ).toEqual([
      "employees",
      "orgStructure",
      "roles",
      "audit",
      "integrations",
      "branding"
    ]);
  });

  it("filters navigation sections by permissions", () => {
    expect(
      getVisibleTenantAdminSections(
        session(["roles.manage", "audit.view", "modules.manage"])
      ).map((section) => section.id)
    ).toEqual(["roles", "audit", "integrations"]);
  });

  it("hides tenant admin navigation for regular agents", () => {
    expect(getVisibleTenantAdminSections(session([]))).toEqual([]);
  });

  it("shows navigation sections from effective access grants", () => {
    const access = session([]);

    expect(
      getVisibleTenantAdminSections({
        session: access,
        effectiveAccess: {
          actor: {
            tenantId: access.tenantId,
            employeeId: access.employeeId
          },
          effectiveGrants: [
            grant(access, "roles.manage"),
            grant(access, "audit.view")
          ]
        }
      }).map((section) => section.id)
    ).toEqual(["roles", "audit"]);
  });

  it("uses explicit effective access for top-level navigation", () => {
    const access = session(["roles.manage"]);

    expect(
      navigationAccessFromTenantAdminAccess({
        session: access,
        effectiveAccess: undefined
      }).tenantAdmin
    ).toBe(false);

    expect(
      navigationAccessFromTenantAdminAccess({
        session: access,
        effectiveAccess: {
          actor: {
            tenantId: access.tenantId,
            employeeId: access.employeeId
          },
          effectiveGrants: [grant(access, "roles.manage")]
        }
      }).tenantAdmin
    ).toBe(true);
  });
});

function session(permissions: readonly Permission[]): WebAccessSession {
  return {
    tenantId: "tenant:test" as TenantId,
    employeeId: "employee:test" as EmployeeId,
    tenantRoles: ["agent"] satisfies readonly EmployeeRole[],
    permissions,
    platformRoles: [] satisfies readonly PlatformRole[]
  };
}

function grant(
  session: WebAccessSession,
  permission: Permission
): EffectivePermissionGrant {
  return {
    tenantId: session.tenantId,
    employeeId: session.employeeId,
    permission,
    scope: { type: "tenant" },
    sources: []
  };
}
