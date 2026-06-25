import type { EmployeeId, TenantId } from "@hulee/contracts";
import type { DirectPermissionGrant, Permission } from "@hulee/core";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const redirect = vi.fn((destination: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { destination });
  });

  return {
    appendDomainEvent: vi.fn(),
    assertCurrentWebEffectiveTenantPermission: vi.fn(),
    assertWebActionRequest: vi.fn(),
    createDirectGrant: vi.fn(),
    createRoleBinding: vi.fn(),
    createRoleWithPermissions: vi.fn(),
    createSqlDomainEventRepository: vi.fn(),
    createSqlEmployeeDirectoryRepository: vi.fn(),
    createSqlOrgStructureRepository: vi.fn(),
    createSqlSecurityAuditRepository: vi.fn(),
    createSqlTenantRbacRepository: vi.fn(),
    findEmployee: vi.fn(),
    getWebDatabase: vi.fn(),
    isEmailNotVerifiedError: vi.fn(),
    listDirectGrants: vi.fn(),
    listDirectGrantsForEmployee: vi.fn(),
    listOrgUnits: vi.fn(),
    listRoleBindings: vi.fn(),
    listRoleDefinitions: vi.fn(),
    listTeams: vi.fn(),
    listWorkQueues: vi.fn(),
    recordSecurityAudit: vi.fn(),
    redirect,
    revalidatePath: vi.fn(),
    resolveWebConfig: vi.fn(),
    revokeDirectGrant: vi.fn()
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
  isEmailNotVerifiedError: mocks.isEmailNotVerifiedError,
  resolveWebConfig: mocks.resolveWebConfig
}));

vi.mock("@hulee/db", () => ({
  createSqlDomainEventRepository: mocks.createSqlDomainEventRepository,
  createSqlEmployeeDirectoryRepository:
    mocks.createSqlEmployeeDirectoryRepository,
  createSqlOrgStructureRepository: mocks.createSqlOrgStructureRepository,
  createSqlSecurityAuditRepository: mocks.createSqlSecurityAuditRepository,
  createSqlTenantRbacRepository: mocks.createSqlTenantRbacRepository
}));

const tenantId = "tenant-test" as TenantId;
const adminEmployeeId = "employee-admin" as EmployeeId;
const targetEmployeeId = "employee-agent" as EmployeeId;

describe("role management actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.redirect.mockImplementation((destination: string) => {
      throw Object.assign(new Error("NEXT_REDIRECT"), { destination });
    });
    mocks.assertWebActionRequest.mockResolvedValue(undefined);
    mocks.assertCurrentWebEffectiveTenantPermission.mockResolvedValue({
      tenantId,
      tenantSlug: "local",
      employeeId: adminEmployeeId,
      sessionCreatedAt: new Date().toISOString(),
      tenantRoles: ["tenant_admin"],
      permissions: ["roles.manage"],
      platformRoles: []
    });
    mocks.getWebDatabase.mockReturnValue({ kind: "database" });
    mocks.resolveWebConfig.mockReturnValue({
      rbacResolutionMode: "dual"
    });
    mocks.isEmailNotVerifiedError.mockReturnValue(false);
    mocks.createSqlTenantRbacRepository.mockReturnValue(rbacRepository());
    mocks.createSqlEmployeeDirectoryRepository.mockReturnValue(
      employeeRepository()
    );
    mocks.createSqlOrgStructureRepository.mockReturnValue(
      orgStructureRepository()
    );
    mocks.createSqlSecurityAuditRepository.mockReturnValue({
      record: mocks.recordSecurityAudit
    });
    mocks.createSqlDomainEventRepository.mockReturnValue({
      append: mocks.appendDomainEvent
    });
    mocks.createRoleWithPermissions.mockResolvedValue(undefined);
    mocks.createRoleBinding.mockResolvedValue(undefined);
    mocks.createDirectGrant.mockResolvedValue(undefined);
    mocks.revokeDirectGrant.mockResolvedValue(undefined);
    mocks.listRoleDefinitions.mockResolvedValue([salesRole()]);
    mocks.listRoleBindings.mockResolvedValue([]);
    mocks.listDirectGrants.mockResolvedValue([clientDirectGrant()]);
    mocks.listDirectGrantsForEmployee.mockResolvedValue([]);
    mocks.findEmployee.mockImplementation(
      async (input: { employeeId: EmployeeId }) => employee(input.employeeId)
    );
    mocks.listOrgUnits.mockResolvedValue([]);
    mocks.listTeams.mockResolvedValue([]);
    mocks.listWorkQueues.mockResolvedValue([]);
    mocks.recordSecurityAudit.mockResolvedValue(undefined);
    mocks.appendDomainEvent.mockResolvedValue(undefined);
  });

  it("creates a custom role from permission catalog form fields", async () => {
    const { createCustomTenantRoleAction } = await import("./role-actions");

    await expectRedirect(
      createCustomTenantRoleAction(
        formData({
          name: "Sales custom",
          description: "Sales scoped permissions",
          permissions: ["client.view", "message.reply"]
        })
      ),
      "/admin/roles?roleActionStatus=created"
    );

    expect(mocks.createRoleWithPermissions).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        name: "Sales custom",
        description: "Sales scoped permissions",
        isSystem: false,
        createdByEmployeeId: adminEmployeeId,
        permissions: ["client.view", "message.reply"]
      })
    );
    expect(mocks.recordSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        actorEmployeeId: adminEmployeeId,
        action: "role.created",
        entityType: "role"
      })
    );
    expect(mocks.appendDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        events: [
          expect.objectContaining({
            type: "role.created",
            tenantId
          })
        ]
      })
    );
  });

  it("assigns an active role to an employee with tenant scope", async () => {
    const { assignTenantRoleAction } = await import("./role-actions");

    await expectRedirect(
      assignTenantRoleAction(
        formData({
          employeeId: targetEmployeeId,
          roleId: "role-sales",
          scopeType: "tenant"
        })
      ),
      "/admin/roles?roleActionStatus=assigned"
    );

    expect(mocks.createRoleBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        roleId: "role-sales",
        subject: {
          type: "employee",
          id: targetEmployeeId
        },
        scope: {
          type: "tenant"
        },
        createdByEmployeeId: adminEmployeeId
      })
    );
    expect(mocks.recordSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        action: "role_binding.created",
        entityType: "role_binding",
        metadata: expect.objectContaining({
          roleId: "role-sales",
          targetEmployeeId
        })
      })
    );
  });

  it("adds a direct grant with a reason and optional expiry", async () => {
    const { createDirectPermissionGrantAction } =
      await import("./role-actions");

    await expectRedirect(
      createDirectPermissionGrantAction(
        formData({
          employeeId: targetEmployeeId,
          permission: "client.view",
          scopeType: "tenant",
          reason: "Temporary sales handoff",
          expiresAt: "2999-01-01T00:00"
        })
      ),
      "/admin/roles?roleActionStatus=direct_grant_created"
    );

    expect(mocks.createDirectGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        employeeId: targetEmployeeId,
        permission: "client.view",
        scope: {
          type: "tenant"
        },
        reason: "Temporary sales handoff",
        createdByEmployeeId: adminEmployeeId
      })
    );
    expect(mocks.recordSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        action: "direct_grant.created",
        entityType: "direct_grant",
        metadata: expect.objectContaining({
          targetEmployeeId,
          permission: "client.view",
          reason: "Temporary sales handoff"
        })
      })
    );
  });

  it("revokes an existing direct grant", async () => {
    const { revokeDirectPermissionGrantAction } =
      await import("./role-actions");

    await expectRedirect(
      revokeDirectPermissionGrantAction(
        formData({
          grantId: "grant-client"
        })
      ),
      "/admin/roles?roleActionStatus=direct_grant_revoked"
    );

    expect(mocks.revokeDirectGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        grantId: "grant-client"
      })
    );
    expect(mocks.recordSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        action: "direct_grant.revoked",
        entityType: "direct_grant",
        entityId: "grant-client",
        metadata: expect.objectContaining({
          targetEmployeeId,
          permission: "client.view"
        })
      })
    );
  });
});

function rbacRepository(): unknown {
  return {
    createDirectGrant: mocks.createDirectGrant,
    createRoleBinding: mocks.createRoleBinding,
    createRoleWithPermissions: mocks.createRoleWithPermissions,
    listDirectGrants: mocks.listDirectGrants,
    listDirectGrantsForEmployee: mocks.listDirectGrantsForEmployee,
    listRoleBindings: mocks.listRoleBindings,
    listRoleDefinitions: mocks.listRoleDefinitions,
    revokeDirectGrant: mocks.revokeDirectGrant
  };
}

function employeeRepository(): unknown {
  return {
    findEmployee: mocks.findEmployee
  };
}

function orgStructureRepository(): unknown {
  return {
    listOrgUnits: mocks.listOrgUnits,
    listTeams: mocks.listTeams,
    listWorkQueues: mocks.listWorkQueues
  };
}

function salesRole(): {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly status: "active";
  readonly name: string;
  readonly description: null;
  readonly isSystem: boolean;
  readonly createdByEmployeeId: null;
  readonly permissions: readonly Permission[];
} {
  return {
    id: "role-sales",
    tenantId,
    status: "active",
    name: "Sales",
    description: null,
    isSystem: false,
    createdByEmployeeId: null,
    permissions: ["client.view", "message.reply"]
  };
}

function clientDirectGrant(): DirectPermissionGrant {
  return {
    id: "grant-client",
    tenantId,
    employeeId: targetEmployeeId,
    permission: "client.view",
    scope: {
      type: "tenant"
    },
    reason: "Temporary sales handoff"
  };
}

function employee(employeeId: EmployeeId): {
  readonly tenantId: TenantId;
  readonly employeeId: EmployeeId;
  readonly email: string;
  readonly displayName: string;
  readonly roles: readonly ["tenant_admin"] | readonly [];
  readonly orgUnitIds: readonly string[];
  readonly teamIds: readonly string[];
  readonly queueIds: readonly string[];
  readonly deactivatedAt: null;
} {
  return {
    tenantId,
    employeeId,
    email: `${employeeId}@example.test`,
    displayName: String(employeeId),
    roles: employeeId === adminEmployeeId ? ["tenant_admin"] : [],
    orgUnitIds: [],
    teamIds: [],
    queueIds: [],
    deactivatedAt: null
  };
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
