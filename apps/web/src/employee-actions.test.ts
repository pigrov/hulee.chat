import type { EmployeeId, TenantId } from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  initialEmployeeAdminActionState,
  type EmployeeAdminActionState
} from "./employee-admin-action-state";

const mocks = vi.hoisted(() => ({
  assertWebActionRequest: vi.fn(),
  assertWebDbBackedAdminCommandBoundary: vi.fn(),
  createInvitation: vi.fn(),
  createSqlAuthEmailTokenRepository: vi.fn(),
  createSqlEmployeeDirectoryRepository: vi.fn(),
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
  requestEmailChangeVerificationForAccount: vi.fn(),
  sendEmployeeInvitationEmail: vi.fn()
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
    deactivateEmployee: vi.fn(),
    resendEmployeeInvitation: vi.fn(),
    revokeEmployeeInvitation: vi.fn()
  };
});

vi.mock("@hulee/contact-identity", () => ({
  normalizeEmailAddress: vi.fn((value: string) => value.trim().toLowerCase())
}));

vi.mock("./action-security", () => ({
  assertWebActionRequest: mocks.assertWebActionRequest
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
      permission: "employees.manage",
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
      findEmployee: mocks.findEmployee,
      findInvitationByTokenHash: mocks.findInvitationByTokenHash
    });
    mocks.createSqlAuthEmailTokenRepository.mockReturnValue({
      findAccountEmailOwner: mocks.findAccountEmailOwner
    });
    mocks.findEmployee.mockResolvedValue({
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
      deactivatedAt: null
    });
    mocks.findInvitationByTokenHash.mockResolvedValue({
      productName: "Hulee",
      tenantDisplayName: "Test tenant"
    });
    mocks.findAccountEmailOwner.mockResolvedValue(null);
    mocks.getWebDatabase.mockReturnValue({ kind: "database" });
    mocks.isEmailNotVerifiedError.mockReturnValue(false);
    mocks.requestEmailChangeVerificationForAccount.mockResolvedValue({
      sent: true
    });
    mocks.sendEmployeeInvitationEmail.mockResolvedValue({ sent: true });
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

    mocks.assertWebDbBackedAdminCommandBoundary.mockRejectedValueOnce(
      new CoreError("permission.denied")
    );

    await expectEmployeeAdminActionState(
      inviteEmployeeAction(
        initialEmployeeAdminActionState,
        formData({
          email: "agent@customer.com"
        })
      ),
      { code: "permission_denied", status: "error" }
    );
    expect(mocks.createSqlEmployeeDirectoryRepository).not.toHaveBeenCalled();
    expect(mocks.createInvitation).not.toHaveBeenCalled();
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
  });

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
      { code: "email_change_duplicate", status: "error" }
    );
    expect(
      mocks.requestEmailChangeVerificationForAccount
    ).not.toHaveBeenCalled();
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
