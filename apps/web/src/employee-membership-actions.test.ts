import type { EmployeeId, TenantId } from "@hulee/contracts";
import { CoreError, type DirectPermissionGrant } from "@hulee/core";
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
  findEmployee: vi.fn(),
  getWebDatabase: vi.fn(),
  isEmailNotVerifiedError: vi.fn(),
  isPrivilegedActionReauthRequiredError: vi.fn(),
  listCurrentAndScheduledRoleBindings: vi.fn(),
  listEffectiveAccessSources: vi.fn(),
  listOrgUnits: vi.fn(),
  listRoleDefinitions: vi.fn(),
  listTeams: vi.fn(),
  listWorkQueues: vi.fn(),
  recordAudit: vi.fn(),
  revalidatePath: vi.fn(),
  setEmployeeOrgUnitMemberships: vi.fn(),
  setEmployeeTeamMemberships: vi.fn(),
  setEmployeeWorkQueueMemberships: vi.fn()
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
    mocks.createSqlEmployeeDirectoryRepository.mockReturnValue({
      findEmployee: mocks.findEmployee
    });
    mocks.createSqlOrgStructureRepository.mockReturnValue({
      listOrgUnits: mocks.listOrgUnits,
      listTeams: mocks.listTeams,
      listWorkQueues: mocks.listWorkQueues,
      setEmployeeOrgUnitMemberships: mocks.setEmployeeOrgUnitMemberships,
      setEmployeeTeamMemberships: mocks.setEmployeeTeamMemberships,
      setEmployeeWorkQueueMemberships: mocks.setEmployeeWorkQueueMemberships
    });
    mocks.createSqlTenantRbacRepository.mockReturnValue({
      listCurrentAndScheduledRoleBindings:
        mocks.listCurrentAndScheduledRoleBindings,
      listEffectiveAccessSources: mocks.listEffectiveAccessSources,
      listRoleDefinitions: mocks.listRoleDefinitions
    });
    mocks.createSqlSecurityAuditRepository.mockReturnValue({
      record: mocks.recordAudit
    });
    mocks.findEmployee.mockImplementation(
      async (input: { readonly employeeId: EmployeeId }) =>
        input.employeeId === adminEmployeeId
          ? employee(adminEmployeeId)
          : employee(targetEmployeeId)
    );
    mocks.listEffectiveAccessSources.mockResolvedValue({
      roles: [],
      roleBindings: [],
      directGrants: []
    });
    mocks.listCurrentAndScheduledRoleBindings.mockResolvedValue([]);
    mocks.listOrgUnits.mockResolvedValue([]);
    mocks.listRoleDefinitions.mockResolvedValue([]);
    mocks.listTeams.mockResolvedValue([]);
    mocks.listWorkQueues.mockResolvedValue([]);
    mocks.recordAudit.mockResolvedValue(undefined);
  });

  it("returns boundary errors before touching membership repositories", async () => {
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

  it("denies an unchanged membership command without target access", async () => {
    const { setEmployeeTeamMembershipsAction } =
      await import("./employee-membership-actions");

    await expectEmployeeMembershipActionState(
      setEmployeeTeamMembershipsAction(
        initialEmployeeMembershipActionState,
        formData({ employeeId: targetEmployeeId })
      ),
      { code: "permission_denied", status: "error" }
    );

    expect(mocks.setEmployeeTeamMemberships).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps an authorized unchanged membership command side-effect-free", async () => {
    mocks.listEffectiveAccessSources.mockResolvedValue({
      roles: [],
      roleBindings: [],
      directGrants: [rolesManageGrant({ type: "tenant" })]
    });
    const { setEmployeeTeamMembershipsAction } =
      await import("./employee-membership-actions");

    await expectEmployeeMembershipActionState(
      setEmployeeTeamMembershipsAction(
        initialEmployeeMembershipActionState,
        formData({ employeeId: targetEmployeeId })
      ),
      { code: "memberships_updated", status: "success" }
    );

    expect(mocks.setEmployeeTeamMemberships).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each(["org_unit", "queue", "team"] as const)(
    "denies self %s membership commands before writes or audit",
    async (membershipType) => {
      mocks.listEffectiveAccessSources.mockResolvedValue({
        roles: [],
        roleBindings: [],
        directGrants: [rolesManageGrant({ type: "tenant" })]
      });
      const actions = await import("./employee-membership-actions");
      const action =
        membershipType === "org_unit"
          ? actions.setEmployeeOrgUnitMembershipsAction
          : membershipType === "queue"
            ? actions.setEmployeeWorkQueueMembershipsAction
            : actions.setEmployeeTeamMembershipsAction;

      await expectEmployeeMembershipActionState(
        action(
          initialEmployeeMembershipActionState,
          formData({ employeeId: adminEmployeeId })
        ),
        { code: "permission_denied", status: "error" }
      );

      expect(mocks.setEmployeeOrgUnitMemberships).not.toHaveBeenCalled();
      expect(mocks.setEmployeeWorkQueueMemberships).not.toHaveBeenCalled();
      expect(mocks.setEmployeeTeamMemberships).not.toHaveBeenCalled();
      expect(mocks.recordAudit).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    }
  );

  it("returns the same denial for missing, deactivated and hidden targets", async () => {
    mocks.findEmployee.mockImplementation(
      async (input: { readonly employeeId: EmployeeId }) => {
        if (input.employeeId === adminEmployeeId) {
          return employee(adminEmployeeId);
        }

        if (input.employeeId === "employee-missing") {
          return null;
        }

        if (input.employeeId === "employee-deactivated") {
          return employee("employee-deactivated" as EmployeeId, {
            deactivatedAt: new Date("2026-07-13T09:00:00.000Z")
          });
        }

        return employee("employee-hidden" as EmployeeId, {
          orgUnitIds: ["org-claims"]
        });
      }
    );
    mocks.listEffectiveAccessSources.mockResolvedValue({
      roles: [],
      roleBindings: [],
      directGrants: [rolesManageGrant({ type: "org_unit", id: "org-sales" })]
    });
    const { setEmployeeTeamMembershipsAction } =
      await import("./employee-membership-actions");

    for (const employeeId of [
      "employee-missing",
      "employee-deactivated",
      "employee-hidden"
    ]) {
      await expectEmployeeMembershipActionState(
        setEmployeeTeamMembershipsAction(
          initialEmployeeMembershipActionState,
          formData({ employeeId })
        ),
        { code: "permission_denied", status: "error" }
      );
    }

    expect(mocks.setEmployeeTeamMemberships).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.listEffectiveAccessSources).toHaveBeenCalledTimes(3);
  });

  it.each(["org_unit", "queue", "team"] as const)(
    "returns the same denial for unknown and hidden %s membership IDs",
    async (membershipType) => {
      mocks.findEmployee.mockImplementation(
        async (input: { readonly employeeId: EmployeeId }) =>
          input.employeeId === adminEmployeeId
            ? employee(adminEmployeeId, { orgUnitIds: ["org-sales"] })
            : employee(targetEmployeeId, { orgUnitIds: ["org-sales"] })
      );
      mocks.listEffectiveAccessSources.mockResolvedValue({
        roles: [],
        roleBindings: [],
        directGrants: [rolesManageGrant({ type: "org_unit", id: "org-sales" })]
      });
      const actions = await import("./employee-membership-actions");
      const action =
        membershipType === "org_unit"
          ? actions.setEmployeeOrgUnitMembershipsAction
          : membershipType === "queue"
            ? actions.setEmployeeWorkQueueMembershipsAction
            : actions.setEmployeeTeamMembershipsAction;
      const fieldName =
        membershipType === "org_unit"
          ? "orgUnitId"
          : membershipType === "queue"
            ? "workQueueId"
            : "teamId";
      const hiddenId = `${membershipType}-hidden`;

      if (membershipType === "org_unit") {
        mocks.listOrgUnits.mockResolvedValue([
          {
            id: "org-sales",
            tenantId,
            name: "Sales",
            status: "active"
          },
          {
            id: hiddenId,
            tenantId,
            name: "Hidden",
            status: "active"
          }
        ]);
      } else if (membershipType === "queue") {
        mocks.listWorkQueues.mockResolvedValue([
          {
            id: hiddenId,
            tenantId,
            name: "Hidden",
            status: "active",
            owningOrgUnitId: "org-hidden"
          }
        ]);
      } else {
        mocks.listTeams.mockResolvedValue([
          { id: hiddenId, tenantId, name: "Hidden" }
        ]);
      }

      for (const selectedId of [`${membershipType}-unknown`, hiddenId]) {
        await expectEmployeeMembershipActionState(
          action(
            initialEmployeeMembershipActionState,
            formData({
              employeeId: targetEmployeeId,
              [fieldName]: [selectedId]
            })
          ),
          { code: "permission_denied", status: "error" }
        );
      }

      expect(mocks.setEmployeeOrgUnitMemberships).not.toHaveBeenCalled();
      expect(mocks.setEmployeeWorkQueueMemberships).not.toHaveBeenCalled();
      expect(mocks.setEmployeeTeamMemberships).not.toHaveBeenCalled();
      expect(mocks.recordAudit).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    }
  );

  it("denies an unrelated scoped membership change before write and audit", async () => {
    mocks.listTeams.mockResolvedValue([
      { id: "team-sales", tenantId, name: "Sales" }
    ]);
    const { setEmployeeTeamMembershipsAction } =
      await import("./employee-membership-actions");

    await expectEmployeeMembershipActionState(
      setEmployeeTeamMembershipsAction(
        initialEmployeeMembershipActionState,
        formData({
          employeeId: targetEmployeeId,
          teamId: ["team-sales"]
        })
      ),
      { code: "permission_denied", status: "error" }
    );

    expect(mocks.setEmployeeTeamMemberships).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    { kind: "active", startsAt: undefined },
    { kind: "scheduled", startsAt: "2026-07-14T10:00:00.000Z" }
  ])(
    "denies a team addition carrying a $kind cross-queue binding above the grant ceiling",
    async ({ startsAt }) => {
      configureTeamBindingScenario({ startsAt });
      const { setEmployeeTeamMembershipsAction } =
        await import("./employee-membership-actions");

      await expectEmployeeMembershipActionState(
        setEmployeeTeamMembershipsAction(
          initialEmployeeMembershipActionState,
          formData({
            employeeId: targetEmployeeId,
            teamId: ["team-sales"]
          })
        ),
        { code: "permission_denied", status: "error" }
      );

      expect(mocks.listRoleDefinitions).toHaveBeenCalledWith({ tenantId });
      expect(mocks.listCurrentAndScheduledRoleBindings).toHaveBeenCalledWith({
        tenantId,
        at: expect.any(Date)
      });
      expect(mocks.setEmployeeTeamMemberships).not.toHaveBeenCalled();
      expect(mocks.recordAudit).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    }
  );

  it("allows a bound team addition only with scope management and every delegated permission", async () => {
    configureTeamBindingScenario({
      includeDelegatedPermission: true,
      targetQueueIds: ["queue-existing"]
    });
    const { setEmployeeTeamMembershipsAction } =
      await import("./employee-membership-actions");

    await expectEmployeeMembershipActionState(
      setEmployeeTeamMembershipsAction(
        initialEmployeeMembershipActionState,
        formData({
          employeeId: targetEmployeeId,
          teamId: ["team-sales"]
        })
      ),
      { code: "memberships_updated", status: "success" }
    );

    expect(mocks.setEmployeeTeamMemberships).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        employeeId: targetEmployeeId,
        teamIds: ["team-sales"]
      })
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          employeeId: targetEmployeeId,
          teamIds: ["team-sales"],
          authorizationScopes: [
            { type: "org_unit", id: "org-claims" },
            { type: "org_unit", id: "org-sales" },
            { type: "team", id: "team-sales" },
            { type: "queue", id: "queue-claims" },
            { type: "queue", id: "queue-existing" }
          ]
        }
      })
    );
  });

  it("denies membership removal when a group binding target scope is unmanaged", async () => {
    configureTeamBindingScenario({
      manageBindingScope: false,
      targetTeamIds: ["team-sales"]
    });
    const { setEmployeeTeamMembershipsAction } =
      await import("./employee-membership-actions");

    await expectEmployeeMembershipActionState(
      setEmployeeTeamMembershipsAction(
        initialEmployeeMembershipActionState,
        formData({ employeeId: targetEmployeeId })
      ),
      { code: "permission_denied", status: "error" }
    );

    expect(mocks.setEmployeeTeamMemberships).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("allows membership removal with managed binding scope without requiring the delegated permission", async () => {
    configureTeamBindingScenario({
      targetTeamIds: ["team-sales"]
    });
    const { setEmployeeTeamMembershipsAction } =
      await import("./employee-membership-actions");

    await expectEmployeeMembershipActionState(
      setEmployeeTeamMembershipsAction(
        initialEmployeeMembershipActionState,
        formData({ employeeId: targetEmployeeId })
      ),
      { code: "memberships_updated", status: "success" }
    );

    expect(mocks.setEmployeeTeamMemberships).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        employeeId: targetEmployeeId,
        teamIds: []
      })
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          employeeId: targetEmployeeId,
          teamIds: [],
          authorizationScopes: [
            { type: "org_unit", id: "org-claims" },
            { type: "org_unit", id: "org-sales" },
            { type: "team", id: "team-sales" },
            { type: "queue", id: "queue-claims" }
          ]
        }
      })
    );
  });

  it("writes and audits only the exact authorized membership scope", async () => {
    mocks.listOrgUnits.mockResolvedValue([
      {
        id: "org-sales",
        tenantId,
        name: "Sales",
        status: "active"
      }
    ]);
    mocks.listTeams.mockResolvedValue([
      { id: "team-sales", tenantId, name: "Sales" }
    ]);
    mocks.findEmployee.mockImplementation(
      async (input: { readonly employeeId: EmployeeId }) =>
        input.employeeId === adminEmployeeId
          ? employee(adminEmployeeId)
          : employee(targetEmployeeId, { orgUnitIds: ["org-sales"] })
    );
    mocks.listEffectiveAccessSources.mockResolvedValue({
      roles: [],
      roleBindings: [],
      directGrants: [
        rolesManageGrant({ type: "org_unit", id: "org-sales" }),
        rolesManageGrant({ type: "team", id: "team-sales" })
      ]
    });
    const { setEmployeeTeamMembershipsAction } =
      await import("./employee-membership-actions");

    await expectEmployeeMembershipActionState(
      setEmployeeTeamMembershipsAction(
        initialEmployeeMembershipActionState,
        formData({
          employeeId: targetEmployeeId,
          teamId: ["team-sales"]
        })
      ),
      { code: "memberships_updated", status: "success" }
    );

    expect(mocks.setEmployeeTeamMemberships).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        employeeId: targetEmployeeId,
        teamIds: ["team-sales"]
      })
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          employeeId: targetEmployeeId,
          teamIds: ["team-sales"],
          authorizationScopes: [
            { type: "org_unit", id: "org-sales" },
            { type: "team", id: "team-sales" }
          ]
        }
      })
    );
  });
});

function configureTeamBindingScenario(
  input: {
    readonly startsAt?: string;
    readonly includeDelegatedPermission?: boolean;
    readonly manageBindingScope?: boolean;
    readonly targetQueueIds?: readonly string[];
    readonly targetTeamIds?: readonly string[];
  } = {}
): void {
  mocks.listOrgUnits.mockResolvedValue([
    {
      id: "org-sales",
      tenantId,
      name: "Sales",
      status: "active"
    },
    {
      id: "org-claims",
      tenantId,
      name: "Claims",
      status: "active"
    }
  ]);
  mocks.listTeams.mockResolvedValue([
    { id: "team-sales", tenantId, name: "Sales" }
  ]);
  mocks.listWorkQueues.mockResolvedValue([
    {
      id: "queue-claims",
      tenantId,
      name: "Claims",
      status: "active",
      owningOrgUnitId: "org-claims"
    },
    {
      id: "queue-existing",
      tenantId,
      name: "Existing",
      status: "active",
      owningOrgUnitId: "org-sales"
    }
  ]);
  mocks.findEmployee.mockImplementation(
    async (findInput: { readonly employeeId: EmployeeId }) =>
      findInput.employeeId === adminEmployeeId
        ? employee(adminEmployeeId)
        : employee(targetEmployeeId, {
            orgUnitIds: ["org-sales"],
            queueIds: input.targetQueueIds ?? [],
            teamIds: input.targetTeamIds ?? []
          })
  );
  mocks.listEffectiveAccessSources.mockResolvedValue({
    roles: [],
    roleBindings: [],
    directGrants: [
      rolesManageGrant({ type: "org_unit", id: "org-sales" }),
      rolesManageGrant({ type: "team", id: "team-sales" }),
      ...(input.manageBindingScope === false
        ? []
        : [rolesManageGrant({ type: "queue", id: "queue-claims" })]),
      ...(input.includeDelegatedPermission === true
        ? [
            permissionGrant("message.reply", {
              type: "queue",
              id: "queue-claims"
            })
          ]
        : [])
    ]
  });
  mocks.listRoleDefinitions.mockResolvedValue([
    {
      id: "role-agent",
      tenantId,
      permissions: ["message.reply"],
      status: "active"
    }
  ]);
  mocks.listCurrentAndScheduledRoleBindings.mockResolvedValue([
    {
      id: "binding-team-sales",
      tenantId,
      roleId: "role-agent",
      subject: { type: "team", id: "team-sales" },
      scope: { type: "queue", id: "queue-claims" },
      startsAt: input.startsAt
    }
  ]);
}

function employee(
  employeeId: EmployeeId,
  input: {
    readonly deactivatedAt?: Date | null;
    readonly orgUnitIds?: readonly string[];
    readonly queueIds?: readonly string[];
    readonly teamIds?: readonly string[];
  } = {}
) {
  return {
    tenantId,
    employeeId,
    accountId: null,
    email: `${employeeId}@example.test`,
    displayName: employeeId,
    phoneNumber: null,
    avatarUrl: null,
    avatar: null,
    systemRoleTemplateIds: [],
    teamIds: input.teamIds ?? [],
    orgUnitIds: input.orgUnitIds ?? [],
    queueIds: input.queueIds ?? [],
    createdAt: new Date("2026-07-13T10:00:00.000Z"),
    deactivatedAt: input.deactivatedAt ?? null
  };
}

function rolesManageGrant(
  scope: DirectPermissionGrant["scope"]
): DirectPermissionGrant {
  return permissionGrant("roles.manage", scope);
}

function permissionGrant(
  permission: DirectPermissionGrant["permission"],
  scope: DirectPermissionGrant["scope"]
): DirectPermissionGrant {
  return {
    tenantId,
    employeeId: adminEmployeeId,
    permission,
    scope,
    reason: "test"
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
