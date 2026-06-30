import type { TenantId } from "@hulee/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  return {
    completePasswordReset: vi.fn(),
    createSqlAuthEmailTokenRepository: vi.fn(),
    getWebDatabase: vi.fn(),
    hashAuthEmailToken: vi.fn((token: string) => `hash:${token}`)
  };
});

vi.mock("@hulee/db", () => ({
  createSqlAuthEmailTokenRepository: mocks.createSqlAuthEmailTokenRepository,
  hashAuthEmailToken: mocks.hashAuthEmailToken
}));

vi.mock("@hulee/modules", () => ({
  hashLocalPassword: vi.fn()
}));

vi.mock("./email", () => ({
  resolvePublicBaseUrl: vi.fn(() => "https://chat.example.test"),
  sendEmailVerificationEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn()
}));

vi.mock("./session", () => ({
  getWebDatabase: mocks.getWebDatabase
}));

const tenantId = "tenant-test" as TenantId;

describe("auth email flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWebDatabase.mockReturnValue({ kind: "database" });
    mocks.createSqlAuthEmailTokenRepository.mockReturnValue({
      completePasswordReset: mocks.completePasswordReset,
      findValidToken: vi.fn().mockResolvedValue({
        token: {
          id: "token-1",
          tenantId,
          accountId: "account-1",
          email: "admin@example.test",
          purpose: "password_reset",
          tokenHash: "hash:reset-token",
          expiresAt: "2026-06-30T13:15:50.013Z",
          createdAt: "2026-06-30T12:15:50.013Z"
        },
        tenantSlug: "tenant-test",
        tenantDisplayName: "Tenant Test",
        productName: "Hulee",
        displayName: "Admin"
      })
    });
  });

  it("keeps reset links valid when the submitted password is weak", async () => {
    const { resetPasswordWithToken } = await import("./auth-email");

    await expect(
      resetPasswordWithToken({
        token: "reset-token",
        password: "short"
      })
    ).resolves.toBe("weak_password");
    expect(mocks.completePasswordReset).not.toHaveBeenCalled();
  });
});
