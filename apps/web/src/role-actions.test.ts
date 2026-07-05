import type { EmployeeId, TenantId } from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  initialRoleActionState,
  type RoleActionState
} from "./role-action-state";

const mocks = vi.hoisted(() => ({
  archiveRbacRole: vi.fn(),
  assertWebActionRequest: vi.fn(),
  assertWebDbBackedAdminCommandBoundary: vi.fn(),
  createRbacDirectGrant: vi.fn(),
  createRbacRole: vi.fn(),
  createRbacRoleBinding: vi.fn(),
  isEmailNotVerifiedError: vi.fn(),
  isPrivilegedActionReauthRequiredError: vi.fn(),
  loadRbacRoles: vi.fn(),
  restoreRbacRole: vi.fn(),
  revalidatePath: vi.fn(),
  revokeRbacDirectGrant: vi.fn(),
  revokeRbacRoleBinding: vi.fn(),
  updateRbacRole: vi.fn()
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath
}));

vi.mock("./action-security", () => ({
  assertWebActionRequest: mocks.assertWebActionRequest
}));

vi.mock("./inbox-api-client", () => ({
  archiveRbacRole: mocks.archiveRbacRole,
  createRbacDirectGrant: mocks.createRbacDirectGrant,
  createRbacRole: mocks.createRbacRole,
  createRbacRoleBinding: mocks.createRbacRoleBinding,
  loadRbacRoles: mocks.loadRbacRoles,
  restoreRbacRole: mocks.restoreRbacRole,
  revokeRbacDirectGrant: mocks.revokeRbacDirectGrant,
  revokeRbacRoleBinding: mocks.revokeRbacRoleBinding,
  updateRbacRole: mocks.updateRbacRole
}));

vi.mock("./privileged-action-policy", () => ({
  isPrivilegedActionReauthRequiredError:
    mocks.isPrivilegedActionReauthRequiredError
}));

vi.mock("./session", () => ({
  isEmailNotVerifiedError: mocks.isEmailNotVerifiedError
}));

vi.mock("./web-admin-command-boundary", () => ({
  assertWebDbBackedAdminCommandBoundary:
    mocks.assertWebDbBackedAdminCommandBoundary,
  webDbBackedAdminCommandBoundaries: {
    roleAccess: {
      permission: "roles.manage",
      requireVerifiedEmail: true,
      requireRecentSession: true
    }
  }
}));

const tenantId = "tenant-test" as TenantId;
const adminEmployeeId = "employee-admin" as EmployeeId;
const targetEmployeeId = "employee-agent" as EmployeeId;
const rolesManageOptions = {
  effectivePermissionOverride: "roles.manage"
};

describe("role management actions", () => {
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
    mocks.isEmailNotVerifiedError.mockReturnValue(false);
    mocks.isPrivilegedActionReauthRequiredError.mockReturnValue(false);
    mocks.loadRbacRoles.mockResolvedValue({
      roles: [roleResponse({ id: "role-sales", name: "Sales" })]
    });
    mocks.createRbacRole.mockResolvedValue({
      role: roleResponse({ id: "role-custom", name: "Custom role" })
    });
    mocks.updateRbacRole.mockResolvedValue({
      role: roleResponse({ id: "role-sales", name: "Sales custom" })
    });
    mocks.archiveRbacRole.mockResolvedValue({
      role: roleResponse({
        id: "role-sales",
        name: "Sales",
        status: "archived"
      })
    });
    mocks.restoreRbacRole.mockResolvedValue({
      role: roleResponse({ id: "role-sales", name: "Sales" })
    });
    mocks.createRbacRoleBinding.mockResolvedValue({
      roleBinding: roleBindingResponse()
    });
    mocks.revokeRbacRoleBinding.mockResolvedValue({ revoked: true });
    mocks.createRbacDirectGrant.mockResolvedValue({
      directGrant: directGrantResponse()
    });
    mocks.revokeRbacDirectGrant.mockResolvedValue({ revoked: true });
  });

  it("creates a custom role through the internal RBAC API", async () => {
    const { createCustomTenantRoleAction } = await import("./role-actions");

    await expectRoleActionState(
      createCustomTenantRoleAction(
        initialRoleActionState,
        formData({
          name: "Sales custom",
          description: "Sales scoped permissions",
          permissions: ["client.view", "message.reply"]
        })
      ),
      { code: "created", status: "success" }
    );

    expect(mocks.assertWebDbBackedAdminCommandBoundary).toHaveBeenCalledWith({
      permission: "roles.manage",
      requireVerifiedEmail: true,
      requireRecentSession: true
    });
    expect(mocks.createRbacRole).toHaveBeenCalledWith(
      {
        name: "Sales custom",
        description: "Sales scoped permissions",
        permissions: ["client.view", "message.reply"]
      },
      rolesManageOptions
    );
    expectRoleAdminRevalidation();
  });

  it("creates a role from a system template through the internal RBAC API", async () => {
    const { createRoleFromTemplateAction } = await import("./role-actions");

    await expectRoleActionState(
      createRoleFromTemplateAction(
        initialRoleActionState,
        formData({
          templateId: "sales_representative",
          locale: "en"
        })
      ),
      { code: "template_created", status: "success" }
    );

    expect(mocks.loadRbacRoles).toHaveBeenCalledWith(rolesManageOptions);
    expect(mocks.createRbacRole).toHaveBeenCalledWith(
      expect.objectContaining({
        permissions: expect.arrayContaining(["client.view", "message.reply"])
      }),
      rolesManageOptions
    );
  });

  it("updates and archives custom roles through the internal RBAC API", async () => {
    const { archiveCustomTenantRoleAction, updateCustomTenantRoleAction } =
      await import("./role-actions");

    await expectRoleActionState(
      updateCustomTenantRoleAction(
        initialRoleActionState,
        formData({
          roleId: "role-sales",
          name: "Sales custom",
          permissions: ["client.view"]
        })
      ),
      { code: "updated", status: "success" }
    );
    await expectRoleActionState(
      archiveCustomTenantRoleAction(
        initialRoleActionState,
        formData({ roleId: "role-sales" })
      ),
      { code: "archived", status: "success" }
    );

    expect(mocks.updateRbacRole).toHaveBeenCalledWith(
      "role-sales",
      {
        name: "Sales custom",
        description: undefined,
        permissions: ["client.view"]
      },
      rolesManageOptions
    );
    expect(mocks.archiveRbacRole).toHaveBeenCalledWith(
      "role-sales",
      rolesManageOptions
    );
  });

  it("restores custom roles through the internal RBAC API", async () => {
    const { restoreCustomTenantRoleAction } = await import("./role-actions");

    await expectRoleActionState(
      restoreCustomTenantRoleAction(
        initialRoleActionState,
        formData({ roleId: "role-sales" })
      ),
      { code: "restored", status: "success" }
    );

    expect(mocks.restoreRbacRole).toHaveBeenCalledWith(
      "role-sales",
      rolesManageOptions
    );
  });

  it("assigns active roles through the internal RBAC API", async () => {
    const { assignTenantRoleAction } = await import("./role-actions");

    await expectRoleActionState(
      assignTenantRoleAction(
        initialRoleActionState,
        formData({
          employeeId: targetEmployeeId,
          roleId: "role-sales",
          scopeType: "tenant"
        })
      ),
      { code: "assigned", status: "success" }
    );

    expect(mocks.createRbacRoleBinding).toHaveBeenCalledWith(
      {
        roleId: "role-sales",
        subject: {
          type: "employee",
          id: targetEmployeeId
        },
        scope: {
          type: "tenant"
        }
      },
      rolesManageOptions
    );
  });

  it("revokes role bindings through the internal RBAC API", async () => {
    const { revokeTenantRoleBindingAction } = await import("./role-actions");

    await expectRoleActionState(
      revokeTenantRoleBindingAction(
        initialRoleActionState,
        formData({ bindingId: "binding-sales" })
      ),
      { code: "revoked", status: "success" }
    );

    expect(mocks.revokeRbacRoleBinding).toHaveBeenCalledWith(
      "binding-sales",
      rolesManageOptions
    );
  });

  it("adds a direct grant through the internal RBAC API", async () => {
    const { createDirectPermissionGrantAction } =
      await import("./role-actions");

    await expectRoleActionState(
      createDirectPermissionGrantAction(
        initialRoleActionState,
        formData({
          employeeId: targetEmployeeId,
          permission: "client.view",
          scopeType: "tenant",
          reason: "Temporary sales handoff",
          expiresAt: "2999-01-01T00:00"
        })
      ),
      { code: "direct_grant_created", status: "success" }
    );

    expect(mocks.createRbacDirectGrant).toHaveBeenCalledWith(
      {
        employeeId: targetEmployeeId,
        permission: "client.view",
        scope: {
          type: "tenant"
        },
        reason: "Temporary sales handoff",
        expiresAt: expect.any(String)
      },
      rolesManageOptions
    );
  });

  it("revokes direct grants through the internal RBAC API", async () => {
    const { revokeDirectPermissionGrantAction } =
      await import("./role-actions");

    await expectRoleActionState(
      revokeDirectPermissionGrantAction(
        initialRoleActionState,
        formData({ grantId: "grant-client" })
      ),
      { code: "direct_grant_revoked", status: "success" }
    );

    expect(mocks.revokeRbacDirectGrant).toHaveBeenCalledWith(
      "grant-client",
      rolesManageOptions
    );
  });

  it("maps internal RBAC permission denials to role action state", async () => {
    const { createCustomTenantRoleAction } = await import("./role-actions");

    mocks.createRbacRole.mockRejectedValueOnce(
      new CoreError("permission.denied")
    );

    await expectRoleActionState(
      createCustomTenantRoleAction(
        initialRoleActionState,
        formData({
          name: "Sales custom",
          permissions: ["client.view"]
        })
      ),
      { code: "permission_denied", status: "error" }
    );
  });

  it("maps email verification errors to role action state", async () => {
    const { assignTenantRoleAction } = await import("./role-actions");
    const error = new Error("Email verification required.");

    mocks.assertWebDbBackedAdminCommandBoundary.mockRejectedValueOnce(error);
    mocks.isEmailNotVerifiedError.mockReturnValueOnce(true);

    await expectRoleActionState(
      assignTenantRoleAction(
        initialRoleActionState,
        formData({
          employeeId: targetEmployeeId,
          roleId: "role-sales",
          scopeType: "tenant"
        })
      ),
      { code: "email_verification_required", status: "error" }
    );
    expect(mocks.createRbacRoleBinding).not.toHaveBeenCalled();
  });
});

function roleResponse(input: {
  readonly id: string;
  readonly name: string;
  readonly status?: "active" | "archived";
}): unknown {
  return {
    id: input.id,
    name: input.name,
    description: null,
    status: input.status ?? "active",
    isSystem: false,
    permissions: ["client.view"],
    createdByEmployeeId: adminEmployeeId
  };
}

function roleBindingResponse(): unknown {
  return {
    id: "binding-sales",
    roleId: "role-sales",
    subject: {
      type: "employee",
      id: targetEmployeeId
    },
    scope: {
      type: "tenant"
    }
  };
}

function directGrantResponse(): unknown {
  return {
    id: "grant-client",
    employeeId: targetEmployeeId,
    permission: "client.view",
    scope: {
      type: "tenant"
    },
    reason: "Temporary sales handoff"
  };
}

async function expectRoleActionState(
  promise: Promise<RoleActionState>,
  expected: Pick<RoleActionState, "status"> & {
    readonly code: Exclude<
      RoleActionState,
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

function expectRoleAdminRevalidation(): void {
  expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/roles");
  expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/employees");
  expect(mocks.revalidatePath).toHaveBeenCalledWith(
    "/admin/employees/[employeeId]/access",
    "page"
  );
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
