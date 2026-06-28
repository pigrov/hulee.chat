import type { EmployeeId, TenantId } from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const redirect = vi.fn((destination: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { destination });
  });

  return {
    assertCurrentWebEffectiveTenantPermission: vi.fn(),
    assertWebActionRequest: vi.fn(),
    createSqlEmployeeDirectoryRepository: vi.fn(),
    createSqlOrgStructureRepository: vi.fn(),
    createSqlSecurityAuditRepository: vi.fn(),
    createSqlTenantRbacRepository: vi.fn(),
    getWebDatabase: vi.fn(),
    isEmailNotVerifiedError: vi.fn(),
    redirect,
    revalidatePath: vi.fn()
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect
}));

vi.mock("./action-security", () => ({
  assertWebActionRequest: mocks.assertWebActionRequest
}));

vi.mock("./session", () => ({
  assertCurrentWebEffectiveTenantPermission:
    mocks.assertCurrentWebEffectiveTenantPermission,
  getWebDatabase: mocks.getWebDatabase,
  isEmailNotVerifiedError: mocks.isEmailNotVerifiedError
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

    mocks.redirect.mockImplementation((destination: string) => {
      throw Object.assign(new Error("NEXT_REDIRECT"), { destination });
    });
    mocks.assertWebActionRequest.mockResolvedValue(undefined);
    mocks.getWebDatabase.mockReturnValue({ kind: "database" });
    mocks.isEmailNotVerifiedError.mockReturnValue(false);
  });

  it("requires effective roles.manage before touching membership repositories", async () => {
    const permissionError = new CoreError("permission.denied");

    mocks.assertCurrentWebEffectiveTenantPermission.mockRejectedValueOnce(
      permissionError
    );
    const { setEmployeeTeamMembershipsAction } =
      await import("./employee-membership-actions");

    await expect(
      setEmployeeTeamMembershipsAction(
        formData({
          employeeId: targetEmployeeId,
          returnTo: employeeAccessPath(targetEmployeeId)
        })
      )
    ).rejects.toBe(permissionError);
    expect(
      mocks.assertCurrentWebEffectiveTenantPermission
    ).toHaveBeenCalledWith("roles.manage", {
      requireVerifiedEmail: true
    });
    expect(mocks.createSqlOrgStructureRepository).not.toHaveBeenCalled();
    expect(mocks.createSqlEmployeeDirectoryRepository).not.toHaveBeenCalled();
    expect(mocks.createSqlSecurityAuditRepository).not.toHaveBeenCalled();
  });

  it("redirects stale privileged sessions before membership repository access", async () => {
    mocks.assertCurrentWebEffectiveTenantPermission.mockResolvedValueOnce({
      tenantId,
      employeeId: adminEmployeeId,
      sessionCreatedAt: "2020-01-01T00:00:00.000Z",
      systemRoleTemplateIds: [],
      permissions: ["roles.manage"],
      platformRoles: []
    });
    const { setEmployeeOrgUnitMembershipsAction } =
      await import("./employee-membership-actions");

    await expectRedirect(
      setEmployeeOrgUnitMembershipsAction(
        formData({
          employeeId: targetEmployeeId,
          returnTo: employeeAccessPath(targetEmployeeId)
        })
      ),
      `${employeeAccessPath(targetEmployeeId)}?roleActionStatus=reauth_required`
    );
    expect(mocks.createSqlOrgStructureRepository).not.toHaveBeenCalled();
    expect(mocks.createSqlEmployeeDirectoryRepository).not.toHaveBeenCalled();
  });

  it("preserves selected employee access section on privileged reauth redirect", async () => {
    mocks.assertCurrentWebEffectiveTenantPermission.mockResolvedValueOnce({
      tenantId,
      employeeId: adminEmployeeId,
      sessionCreatedAt: "2020-01-01T00:00:00.000Z",
      systemRoleTemplateIds: [],
      permissions: ["roles.manage"],
      platformRoles: []
    });
    const { setEmployeeOrgUnitMembershipsAction } =
      await import("./employee-membership-actions");

    await expectRedirect(
      setEmployeeOrgUnitMembershipsAction(
        formData({
          employeeAccessSection: "memberships",
          employeeId: targetEmployeeId,
          returnTo: employeeAccessPath(targetEmployeeId)
        })
      ),
      `${employeeAccessPath(
        targetEmployeeId
      )}?roleActionStatus=reauth_required&section=memberships`
    );
  });

  it("redirects unverified tenant accounts before membership repository access", async () => {
    const emailError = new CoreError("auth.email_not_verified");

    mocks.assertCurrentWebEffectiveTenantPermission.mockRejectedValueOnce(
      emailError
    );
    mocks.isEmailNotVerifiedError.mockReturnValueOnce(true);
    const { setEmployeeWorkQueueMembershipsAction } =
      await import("./employee-membership-actions");

    await expectRedirect(
      setEmployeeWorkQueueMembershipsAction(
        formData({
          employeeId: targetEmployeeId,
          returnTo: employeeAccessPath(targetEmployeeId)
        })
      ),
      `${employeeAccessPath(
        targetEmployeeId
      )}?roleActionStatus=email_verification_required`
    );
    expect(mocks.createSqlOrgStructureRepository).not.toHaveBeenCalled();
    expect(mocks.createSqlEmployeeDirectoryRepository).not.toHaveBeenCalled();
  });
});

function employeeAccessPath(employeeId: EmployeeId): string {
  return `/admin/employees/${encodeURIComponent(employeeId)}/access`;
}

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

async function expectRedirect(
  promise: Promise<void>,
  destination: string
): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    message: "NEXT_REDIRECT",
    destination
  });
}
