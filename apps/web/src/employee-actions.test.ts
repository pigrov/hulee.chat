import type { EmployeeId, TenantId } from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  initialEmployeeAdminActionState,
  type EmployeeAdminActionState
} from "./employee-admin-action-state";

const mocks = vi.hoisted(() => ({
  assertCanAccessEmployeeResource: vi.fn(),
  assertCanAccessTenantResource: vi.fn(),
  assertWebActionRequest: vi.fn(),
  assertWebDbBackedAdminCommandBoundary: vi.fn(),
  createInvitation: vi.fn(),
  createSqlAuthEmailTokenRepository: vi.fn(),
  createSqlEmployeeDirectoryRepository: vi.fn(),
  createSqlTenantRbacRepository: vi.fn(),
  deactivateEmployeeDomain: vi.fn(),
  deactivateEmployeePersistence: vi.fn(),
  findAccountEmailOwner: vi.fn(),
  findEmployee: vi.fn(),
  findInvitationByTokenHash: vi.fn(),
  getWebDatabase: vi.fn(),
  hashEmployeeInvitationToken: vi.fn((token: string) => `hash:${token}`),
  isEmailNotVerifiedError: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { destination });
  }),
  revalidatePath: vi.fn(),
  requireAdminResourceAccess: vi.fn(),
  requestEmailChangeVerificationForAccount: vi.fn(),
  sendEmployeeInvitationEmail: vi.fn(),
  updateEmployeeProfile: vi.fn()
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect
}));

vi.mock("@hulee/db", () => ({
  createSqlAuthEmailTokenRepository: mocks.createSqlAuthEmailTokenRepository,
  createSqlEmployeeDirectoryRepository:
    mocks.createSqlEmployeeDirectoryRepository,
  createSqlTenantRbacRepository: mocks.createSqlTenantRbacRepository,
  hashEmployeeInvitationToken: mocks.hashEmployeeInvitationToken
}));

vi.mock("@hulee/core", () => {
  class CoreError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }

  return {
    acceptEmployeeInvitation: vi.fn(),
    CoreError,
    createAccountEmailVerifiedEvent: vi.fn(),
    createEmployeeInvitation: vi.fn((input) => ({
      events: [],
      invitation: {
        id: "invite-1",
        tenantId: input.tenantId,
        email: input.email,
        displayName: input.displayName ?? null,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt
      }
    })),
    createSequentialIdFactory: vi.fn(() => vi.fn(() => "id-1")),
    deactivateEmployee: mocks.deactivateEmployeeDomain,
    resendEmployeeInvitation: vi.fn(),
    revokeEmployeeInvitation: vi.fn()
  };
});

vi.mock("@hulee/contact-identity", () => ({
  normalizeEmailAddress: vi.fn((value: string) => value.trim().toLowerCase()),
  normalizeOptionalPhoneNumber: vi.fn(
    (value: string | null | undefined) => value?.trim() || null
  )
}));

vi.mock("./action-security", () => ({
  assertWebActionRequest: mocks.assertWebActionRequest
}));

vi.mock("./admin-resource-access", () => ({
  assertCanAccessEmployeeResource: mocks.assertCanAccessEmployeeResource,
  assertCanAccessTenantResource: mocks.assertCanAccessTenantResource,
  requireAdminResourceAccess: mocks.requireAdminResourceAccess
}));

vi.mock("./auth-email", () => ({
  requestEmailChangeVerificationForAccount:
    mocks.requestEmailChangeVerificationForAccount
}));

vi.mock("./email", () => ({
  resolvePublicBaseUrl: vi.fn(() => "https://chat.example.test"),
  sendEmployeeInvitationEmail: mocks.sendEmployeeInvitationEmail
}));

vi.mock("./session", () => ({
  createTenantWebSession: vi.fn(),
  getWebDatabase: mocks.getWebDatabase,
  isEmailNotVerifiedError: mocks.isEmailNotVerifiedError,
  resolveWebConfig: vi.fn(() => ({
    nodeEnv: "test"
  }))
}));

vi.mock("./web-admin-command-boundary", () => ({
  assertWebDbBackedAdminCommandBoundary:
    mocks.assertWebDbBackedAdminCommandBoundary,
  webDbBackedAdminCommandBoundaries: {
    employeeLifecycle: {
      requireVerifiedEmail: true,
      requireRecentSession: false
    }
  }
}));

const tenantId = "tenant-test" as TenantId;
const adminEmployeeId = "employee-admin" as EmployeeId;

describe("employee admin actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.assertWebActionRequest.mockResolvedValue(undefined);
    mocks.requireAdminResourceAccess.mockResolvedValue({
      actor: {
        tenantId,
        employeeId: adminEmployeeId,
        orgUnitIds: [],
        queueIds: [],
        teamIds: []
      },
      effectiveGrants: []
    });
    mocks.assertWebDbBackedAdminCommandBoundary.mockResolvedValue({
      tenantId,
      tenantSlug: "local",
      employeeId: adminEmployeeId,
      sessionCreatedAt: new Date().toISOString(),
      systemRoleTemplateIds: ["tenant_admin"],
      permissions: ["employees.manage"],
      platformRoles: []
    });
    mocks.createSqlEmployeeDirectoryRepository.mockReturnValue({
      createInvitation: mocks.createInvitation,
      deactivateEmployee: mocks.deactivateEmployeePersistence,
      findEmployee: mocks.findEmployee,
      findInvitationByTokenHash: mocks.findInvitationByTokenHash,
      updateEmployeeProfile: mocks.updateEmployeeProfile
    });
    mocks.createSqlAuthEmailTokenRepository.mockReturnValue({
      findAccountEmailOwner: mocks.findAccountEmailOwner
    });
    mocks.createSqlTenantRbacRepository.mockReturnValue({
      listEffectiveAccessSources: vi.fn()
    });
    mocks.findEmployee.mockResolvedValue(targetEmployee());
    mocks.findInvitationByTokenHash.mockResolvedValue({
      productName: "Hulee",
      tenantDisplayName: "Test tenant"
    });
    mocks.findAccountEmailOwner.mockResolvedValue(null);
    mocks.deactivateEmployeeDomain.mockReturnValue({
      employee: { id: "employee-target" },
      events: []
    });
    mocks.deactivateEmployeePersistence.mockResolvedValue(undefined);
    mocks.getWebDatabase.mockReturnValue({ kind: "database" });
    mocks.isEmailNotVerifiedError.mockReturnValue(false);
    mocks.requestEmailChangeVerificationForAccount.mockResolvedValue({
      sent: true
    });
    mocks.sendEmployeeInvitationEmail.mockResolvedValue({ sent: true });
    mocks.updateEmployeeProfile.mockResolvedValue(undefined);
  });

  it("returns a sent action state and manual invite URL after creating an invitation", async () => {
    const { inviteEmployeeAction } = await import("./employee-actions");

    const state = await inviteEmployeeAction(
      initialEmployeeAdminActionState,
      formData({
        displayName: "Agent",
        email: "agent@customer.com"
      })
    );

    expect(state).toEqual(
      expect.objectContaining({
        code: "sent",
        status: "success",
        submittedAt: expect.any(String)
      })
    );
    expect(
      "manualInviteUrl" in state ? state.manualInviteUrl : undefined
    ).toMatch(/^https:\/\/chat\.example\.test\/invite\/.+/);
    expect(mocks.createInvitation).toHaveBeenCalledOnce();
    expect(mocks.assertCanAccessTenantResource).toHaveBeenCalledWith(
      expect.objectContaining({ permission: "employees.manage" })
    );
    expect(mocks.sendEmployeeInvitationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        inviteUrl: expect.stringMatching(
          /^https:\/\/chat\.example\.test\/invite\/.+/
        ),
        to: "agent@customer.com"
      })
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/employees");
  }, 15_000);

  it("returns permission_denied before creating an invitation", async () => {
    const { inviteEmployeeAction } = await import("./employee-actions");

    mocks.assertCanAccessTenantResource.mockImplementationOnce(() => {
      throw new CoreError("permission.denied");
    });

    await expectEmployeeAdminActionState(
      inviteEmployeeAction(
        initialEmployeeAdminActionState,
        formData({
          email: "agent@customer.com"
        })
      ),
      { code: "permission_denied", status: "error" }
    );
    expect(mocks.requireAdminResourceAccess).toHaveBeenCalledOnce();
    expect(mocks.createInvitation).not.toHaveBeenCalled();
  });

  it("lets a tenant employee admin deactivate another employee", async () => {
    const { deactivateEmployeeAction } = await import("./employee-actions");

    await expectEmployeeAdminActionState(
      deactivateEmployeeAction(
        initialEmployeeAdminActionState,
        formData({ employeeId: "employee-target" })
      ),
      { code: "deactivated", status: "success" }
    );

    expect(mocks.assertCanAccessTenantResource).toHaveBeenCalledWith(
      expect.objectContaining({ permission: "employees.manage" })
    );
    expect(mocks.deactivateEmployeeDomain).toHaveBeenCalledOnce();
    expect(mocks.deactivateEmployeePersistence).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        employeeId: "employee-target",
        events: []
      })
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/employees");
  });

  it("denies tenant-wide deactivation to a scoped employee manager", async () => {
    mocks.requireAdminResourceAccess.mockResolvedValueOnce({
      actor: {
        tenantId,
        employeeId: adminEmployeeId,
        orgUnitIds: ["org-sales"],
        queueIds: [],
        teamIds: []
      },
      effectiveGrants: [
        {
          tenantId,
          employeeId: adminEmployeeId,
          permission: "employees.manage",
          scope: { type: "org_unit", id: "org-sales" },
          sources: []
        }
      ]
    });
    mocks.assertCanAccessTenantResource.mockImplementationOnce(() => {
      throw new CoreError("permission.denied");
    });
    const { deactivateEmployeeAction } = await import("./employee-actions");

    await expectEmployeeAdminActionState(
      deactivateEmployeeAction(
        initialEmployeeAdminActionState,
        formData({ employeeId: "employee-target" })
      ),
      { code: "permission_denied", status: "error" }
    );

    expect(mocks.findEmployee).not.toHaveBeenCalled();
    expect(mocks.deactivateEmployeeDomain).not.toHaveBeenCalled();
    expect(mocks.deactivateEmployeePersistence).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("requests an email change confirmation for an employee account", async () => {
    const { requestEmployeeEmailChangeAction } =
      await import("./employee-actions");

    await expectEmployeeEmailChangeActionState(
      requestEmployeeEmailChangeAction(
        { status: "idle" },
        formData({
          employeeId: "employee-target",
          email: " New.Agent@Example.com "
        })
      ),
      { code: "email_change_sent", status: "success" }
    );
    expect(mocks.findAccountEmailOwner).toHaveBeenCalledWith({
      tenantId,
      email: "new.agent@example.com"
    });
    expect(mocks.requestEmailChangeVerificationForAccount).toHaveBeenCalledWith(
      {
        tenantId,
        accountId: "account-target",
        newEmail: "new.agent@example.com"
      }
    );
    expect(mocks.assertCanAccessEmployeeResource).toHaveBeenCalledWith(
      expect.objectContaining({ permission: "employees.manage" })
    );
  });

  it.each([
    { caseName: "missing", target: null, hidden: false },
    {
      caseName: "deactivated",
      target: targetEmployee({
        deactivatedAt: new Date("2026-06-22T11:00:00.000Z")
      }),
      hidden: false
    },
    { caseName: "hidden", target: targetEmployee(), hidden: true }
  ])(
    "returns permission_denied for a $caseName email target",
    async ({ target, hidden }) => {
      const { requestEmployeeEmailChangeAction } =
        await import("./employee-actions");

      mocks.findEmployee.mockResolvedValueOnce(target);
      if (hidden) {
        mocks.assertCanAccessEmployeeResource.mockImplementationOnce(() => {
          throw new CoreError("permission.denied");
        });
      }

      await expectEmployeeEmailChangeActionState(
        requestEmployeeEmailChangeAction(
          { status: "idle" },
          formData({
            employeeId: "employee-target",
            email: "other@example.com"
          })
        ),
        { code: "permission_denied", status: "error" }
      );
      expect(mocks.findAccountEmailOwner).not.toHaveBeenCalled();
      expect(
        mocks.requestEmailChangeVerificationForAccount
      ).not.toHaveBeenCalled();
      expect(mocks.requireAdminResourceAccess).toHaveBeenCalledOnce();
    }
  );

  it("updates an active authorized employee profile", async () => {
    const { updateEmployeeProfileAction } = await import("./employee-actions");

    await expectEmployeeProfileActionState(
      updateEmployeeProfileAction(
        { status: "idle" },
        formData({
          employeeId: "employee-target",
          displayName: "Updated Agent",
          phoneNumber: "+1 555 0100"
        })
      ),
      { code: "profile_updated", status: "success" }
    );

    expect(mocks.assertCanAccessEmployeeResource).toHaveBeenCalledWith(
      expect.objectContaining({ permission: "employees.manage" })
    );
    expect(mocks.updateEmployeeProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        employeeId: "employee-target",
        displayName: "Updated Agent"
      })
    );
  });

  it.each([
    { caseName: "missing", target: null, hidden: false },
    {
      caseName: "deactivated",
      target: targetEmployee({
        deactivatedAt: new Date("2026-06-22T11:00:00.000Z")
      }),
      hidden: false
    },
    { caseName: "hidden", target: targetEmployee(), hidden: true }
  ])(
    "returns permission_denied for a $caseName profile target",
    async ({ target, hidden }) => {
      const { updateEmployeeProfileAction } =
        await import("./employee-actions");

      mocks.findEmployee.mockResolvedValueOnce(target);
      if (hidden) {
        mocks.assertCanAccessEmployeeResource.mockImplementationOnce(() => {
          throw new CoreError("permission.denied");
        });
      }

      await expectEmployeeProfileActionState(
        updateEmployeeProfileAction(
          { status: "idle" },
          formData({
            employeeId: "employee-target",
            displayName: "Updated Agent"
          })
        ),
        { code: "permission_denied", status: "error" }
      );
      expect(mocks.updateEmployeeProfile).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
      expect(mocks.requireAdminResourceAccess).toHaveBeenCalledOnce();
    }
  );

  it("rejects email changes to an address used by another employee", async () => {
    const { requestEmployeeEmailChangeAction } =
      await import("./employee-actions");

    mocks.findAccountEmailOwner.mockResolvedValueOnce({
      accountId: "account-other"
    });

    await expectEmployeeEmailChangeActionState(
      requestEmployeeEmailChangeAction(
        { status: "idle" },
        formData({
          employeeId: "employee-target",
          email: "other@example.com"
        })
      ),
      { code: "email_change_unavailable", status: "error" }
    );
    expect(
      mocks.requestEmailChangeVerificationForAccount
    ).not.toHaveBeenCalled();
  });
});

function targetEmployee(input: { readonly deactivatedAt?: Date | null } = {}) {
  return {
    tenantId,
    employeeId: "employee-target",
    accountId: "account-target",
    email: "old@example.com",
    displayName: "Agent",
    phoneNumber: null,
    avatarUrl: null,
    avatar: null,
    systemRoleTemplateIds: [],
    teamIds: [],
    orgUnitIds: [],
    queueIds: [],
    createdAt: new Date("2026-06-22T10:00:00.000Z"),
    deactivatedAt: input.deactivatedAt ?? null
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

async function expectEmployeeAdminActionState(
  promise: Promise<EmployeeAdminActionState>,
  expected: Pick<EmployeeAdminActionState, "status"> & {
    readonly code: Exclude<
      EmployeeAdminActionState,
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

async function expectEmployeeEmailChangeActionState(
  promise: Promise<{
    readonly status: "idle" | "success" | "error";
    readonly code?: string;
    readonly submittedAt?: string;
  }>,
  expected: {
    readonly status: "success" | "error";
    readonly code: string;
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

async function expectEmployeeProfileActionState(
  promise: Promise<{
    readonly status: "idle" | "success" | "error";
    readonly code?: string;
    readonly submittedAt?: string;
  }>,
  expected: {
    readonly status: "success" | "error";
    readonly code: string;
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
