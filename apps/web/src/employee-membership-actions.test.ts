import type { EmployeeId, TenantId } from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  initialEmployeeMembershipActionState,
  type EmployeeMembershipActionState
} from "./employee-membership-action-state";

const mocks = vi.hoisted(() => ({
  assertWebActionRequest: vi.fn(),
  assertWebDbBackedAdminCommandBoundary: vi.fn(),
  createSqlEmployeeDirectoryRepository: vi.fn(),
  createSqlOrgStructureRepository: vi.fn(),
  createSqlSecurityAuditRepository: vi.fn(),
  createSqlTenantRbacRepository: vi.fn(),
  getWebDatabase: vi.fn(),
  isEmailNotVerifiedError: vi.fn(),
  isPrivilegedActionReauthRequiredError: vi.fn(),
  revalidatePath: vi.fn()
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath
}));

vi.mock("./action-security", () => ({
  assertWebActionRequest: mocks.assertWebActionRequest
}));

vi.mock("./privileged-action-policy", () => ({
  isPrivilegedActionReauthRequiredError:
    mocks.isPrivilegedActionReauthRequiredError
}));

vi.mock("./session", () => ({
  getWebDatabase: mocks.getWebDatabase,
  isEmailNotVerifiedError: mocks.isEmailNotVerifiedError
}));

vi.mock("./web-admin-command-boundary", () => ({
  assertWebDbBackedAdminCommandBoundary:
    mocks.assertWebDbBackedAdminCommandBoundary,
  webDbBackedAdminCommandBoundaries: {
    employeeMembership: {
      permission: "roles.manage",
      requireVerifiedEmail: true,
      requireRecentSession: true
    }
  }
}));

vi.mock("@hulee/db", () => ({
  createSqlEmployeeDirectoryRepository:
    mocks.createSqlEmployeeDirectoryRepository,
  createSqlOrgStructureRepository: mocks.createSqlOrgStructureRepository,
  createSqlSecurityAuditRepository: mocks.createSqlSecurityAuditRepository,
  createSqlTenantRbacRepository: mocks.createSqlTenantRbacRepository
}));

const tenantId = "tenant-test" as TenantId;
const adminEmployeeId = "employee-admin" as EmployeeId;
const targetEmployeeId = "employee-agent" as EmployeeId;

describe("employee membership actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.assertWebActionRequest.mockResolvedValue(undefined);
    mocks.assertWebDbBackedAdminCommandBoundary.mockResolvedValue({
      tenantId,
      tenantSlug: "local",
      employeeId: adminEmployeeId,
      sessionCreatedAt: new Date().toISOString(),
      systemRoleTemplateIds: ["tenant_admin"],
      permissions: ["roles.manage"],
      platformRoles: []
    });
    mocks.getWebDatabase.mockReturnValue({ kind: "database" });
    mocks.isEmailNotVerifiedError.mockReturnValue(false);
    mocks.isPrivilegedActionReauthRequiredError.mockReturnValue(false);
  });

  it("returns permission_denied before touching membership repositories", async () => {
    const permissionError = new CoreError("permission.denied");

    mocks.assertWebDbBackedAdminCommandBoundary.mockRejectedValueOnce(
      permissionError
    );
    const { setEmployeeTeamMembershipsAction } =
      await import("./employee-membership-actions");

    await expectEmployeeMembershipActionState(
      setEmployeeTeamMembershipsAction(
        initialEmployeeMembershipActionState,
        formData({
          employeeId: targetEmployeeId
        })
      ),
      { code: "permission_denied", status: "error" }
    );
    expect(mocks.assertWebDbBackedAdminCommandBoundary).toHaveBeenCalledWith({
      permission: "roles.manage",
      requireVerifiedEmail: true,
      requireRecentSession: true
    });
    expect(mocks.createSqlOrgStructureRepository).not.toHaveBeenCalled();
    expect(mocks.createSqlEmployeeDirectoryRepository).not.toHaveBeenCalled();
    expect(mocks.createSqlSecurityAuditRepository).not.toHaveBeenCalled();
  });

  it("returns reauth_required for stale privileged sessions", async () => {
    const reauthError = new Error("Recent session required.");

    mocks.assertWebDbBackedAdminCommandBoundary.mockRejectedValueOnce(
      reauthError
    );
    mocks.isPrivilegedActionReauthRequiredError.mockReturnValueOnce(true);
    const { setEmployeeOrgUnitMembershipsAction } =
      await import("./employee-membership-actions");

    await expectEmployeeMembershipActionState(
      setEmployeeOrgUnitMembershipsAction(
        initialEmployeeMembershipActionState,
        formData({
          employeeId: targetEmployeeId
        })
      ),
      { code: "reauth_required", status: "error" }
    );
    expect(mocks.createSqlOrgStructureRepository).not.toHaveBeenCalled();
    expect(mocks.createSqlEmployeeDirectoryRepository).not.toHaveBeenCalled();
  });

  it("returns email_verification_required before membership repository access", async () => {
    const emailError = new CoreError("auth.email_not_verified");

    mocks.assertWebDbBackedAdminCommandBoundary.mockRejectedValueOnce(
      emailError
    );
    mocks.isEmailNotVerifiedError.mockReturnValueOnce(true);
    const { setEmployeeWorkQueueMembershipsAction } =
      await import("./employee-membership-actions");

    await expectEmployeeMembershipActionState(
      setEmployeeWorkQueueMembershipsAction(
        initialEmployeeMembershipActionState,
        formData({
          employeeId: targetEmployeeId
        })
      ),
      { code: "email_verification_required", status: "error" }
    );
    expect(mocks.createSqlOrgStructureRepository).not.toHaveBeenCalled();
    expect(mocks.createSqlEmployeeDirectoryRepository).not.toHaveBeenCalled();
  });
});

function formData(
  fields: Record<string, string | readonly string[]>
): FormData {
  const data = new FormData();

  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string") {
      data.set(key, value);
      continue;
    }

    for (const item of value) {
      data.append(key, item);
    }
  }

  return data;
}

async function expectEmployeeMembershipActionState(
  promise: Promise<EmployeeMembershipActionState>,
  expected: Pick<EmployeeMembershipActionState, "status"> & {
    readonly code: Exclude<
      EmployeeMembershipActionState,
      { readonly status: "idle" }
    >["code"];
  }
): Promise<void> {
  await expect(promise).resolves.toEqual(
    expect.objectContaining({
      code: expected.code,
      status: expected.status,
      submittedAt: expect.any(String)
    })
  );
}
