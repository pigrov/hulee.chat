import type { EmployeeId, TenantId } from "@hulee/contracts";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { PrivilegedActionReauthRequiredError } from "./privileged-action-policy";

const mocks = vi.hoisted(() => ({
  assertCurrentWebEffectiveTenantPermission: vi.fn()
}));

vi.mock("./session", () => ({
  assertCurrentWebEffectiveTenantPermission:
    mocks.assertCurrentWebEffectiveTenantPermission
}));

import {
  assertWebDbBackedAdminCommandBoundary,
  webDbBackedAdminCommandBoundaries
} from "./web-admin-command-boundary";

const tenantId = "tenant-1" as TenantId;
const employeeId = "employee-1" as EmployeeId;

describe("web admin command boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertCurrentWebEffectiveTenantPermission.mockResolvedValue({
      tenantId,
      employeeId,
      sessionCreatedAt: new Date().toISOString(),
      systemRoleTemplateIds: [],
      permissions: [],
      platformRoles: []
    });
  });

  it("keeps DB-backed admin command families explicit", () => {
    expect(webDbBackedAdminCommandBoundaries).toMatchObject({
      employeeLifecycle: {
        permission: "employees.manage",
        requireVerifiedEmail: true,
        requireRecentSession: false
      },
      employeeMembership: {
        permission: "roles.manage",
        requireVerifiedEmail: true,
        requireRecentSession: true
      },
      orgStructure: {
        permission: "employees.manage",
        requireVerifiedEmail: true,
        requireRecentSession: false
      },
      roleAccess: {
        permission: "roles.manage",
        requireVerifiedEmail: true,
        requireRecentSession: true
      }
    });
  });

  it("checks effective RBAC through the shared session guard", async () => {
    await expect(
      assertWebDbBackedAdminCommandBoundary(
        webDbBackedAdminCommandBoundaries.orgStructure
      )
    ).resolves.toMatchObject({
      tenantId,
      employeeId
    });
    expect(
      mocks.assertCurrentWebEffectiveTenantPermission
    ).toHaveBeenCalledWith("employees.manage", {
      requireVerifiedEmail: true
    });
  });

  it("requires a recent session for role and membership mutations", async () => {
    mocks.assertCurrentWebEffectiveTenantPermission.mockResolvedValueOnce({
      tenantId,
      employeeId,
      sessionCreatedAt: "2020-01-01T00:00:00.000Z",
      systemRoleTemplateIds: [],
      permissions: [],
      platformRoles: []
    });

    await expect(
      assertWebDbBackedAdminCommandBoundary(
        webDbBackedAdminCommandBoundaries.roleAccess
      )
    ).rejects.toBeInstanceOf(PrivilegedActionReauthRequiredError);
  });
});
