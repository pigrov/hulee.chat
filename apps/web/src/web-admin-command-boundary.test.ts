import type { EmployeeId, TenantId } from "@hulee/contracts";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { PrivilegedActionReauthRequiredError } from "./privileged-action-policy";

const mocks = vi.hoisted(() => ({
  assertWebTenantEmailVerified: vi.fn(),
  requireCurrentWebAccessSession: vi.fn()
}));

vi.mock("./access", () => ({
  assertWebTenantEmailVerified: mocks.assertWebTenantEmailVerified
}));

vi.mock("./session", () => ({
  requireCurrentWebAccessSession: mocks.requireCurrentWebAccessSession
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
    mocks.requireCurrentWebAccessSession.mockResolvedValue({
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
        requireVerifiedEmail: true,
        requireRecentSession: false
      },
      employeeMembership: {
        requireVerifiedEmail: true,
        requireRecentSession: true
      },
      orgStructure: {
        requireVerifiedEmail: true,
        requireRecentSession: false
      },
      roleAccess: {
        requireVerifiedEmail: true,
        requireRecentSession: true
      }
    });
  });

  it("checks authentication and email verification without a coarse permission", async () => {
    await expect(
      assertWebDbBackedAdminCommandBoundary(
        webDbBackedAdminCommandBoundaries.orgStructure
      )
    ).resolves.toMatchObject({
      tenantId,
      employeeId
    });
    expect(mocks.requireCurrentWebAccessSession).toHaveBeenCalledOnce();
    expect(mocks.assertWebTenantEmailVerified).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, employeeId })
    );
  });

  it("requires a recent session for role and membership mutations", async () => {
    mocks.requireCurrentWebAccessSession.mockResolvedValueOnce({
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
