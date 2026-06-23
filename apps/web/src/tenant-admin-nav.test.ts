import type { EmployeeId, TenantId } from "@hulee/contracts";
import type { EmployeeRole, Permission } from "@hulee/core";
import { describe, expect, it } from "vitest";

import type { PlatformRole, WebAccessSession } from "./access";
import { getVisibleTenantAdminSections } from "./tenant-admin-nav";

describe("tenant admin navigation", () => {
  it("shows every tenant admin section for tenant admins", () => {
    expect(
      getVisibleTenantAdminSections(
        session([
          "tenant.manage",
          "employees.manage",
          "roles.manage",
          "modules.manage"
        ])
      ).map((section) => section.id)
    ).toEqual(["employees", "roles", "integrations", "branding"]);
  });

  it("filters navigation sections by permissions", () => {
    expect(
      getVisibleTenantAdminSections(
        session(["roles.manage", "modules.manage"])
      ).map((section) => section.id)
    ).toEqual(["roles", "integrations"]);
  });

  it("hides tenant admin navigation for regular agents", () => {
    expect(getVisibleTenantAdminSections(session([]))).toEqual([]);
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
