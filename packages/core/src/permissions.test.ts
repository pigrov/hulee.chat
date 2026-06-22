import { describe, expect, it } from "vitest";

import { CoreError } from "./errors";
import {
  assertEmployeeCan,
  hasPermission,
  isEmployeeRole,
  isPermission,
  permissionsForRoles,
  type Employee
} from "./permissions";

const employee: Employee = {
  id: "employee-1" as never,
  tenantId: "tenant-1" as never,
  email: "agent@example.test",
  displayName: "Agent",
  roles: ["agent"],
  createdAt: "2026-06-22T10:00:00.000Z"
};

describe("permissions", () => {
  it("maps tenant admin roles to tenant management permissions", () => {
    expect(permissionsForRoles(["tenant_admin"])).toEqual([
      "tenant.manage",
      "employees.manage",
      "modules.manage",
      "inbox.read",
      "message.reply"
    ]);
  });

  it("deduplicates permissions from multiple roles", () => {
    expect(permissionsForRoles(["tenant_admin", "agent"])).toEqual([
      "tenant.manage",
      "employees.manage",
      "modules.manage",
      "inbox.read",
      "message.reply"
    ]);
  });

  it("checks employee permissions through roles", () => {
    expect(hasPermission(employee, "inbox.read")).toBe(true);
    expect(hasPermission(employee, "modules.manage")).toBe(false);
    expect(() => assertEmployeeCan(employee, "modules.manage")).toThrow(
      new CoreError("permission.denied")
    );
  });

  it("validates known role and permission values", () => {
    expect(isEmployeeRole("tenant_admin")).toBe(true);
    expect(isEmployeeRole("platform_admin")).toBe(false);
    expect(isPermission("modules.manage")).toBe(true);
    expect(isPermission("platform.admin")).toBe(false);
  });
});
