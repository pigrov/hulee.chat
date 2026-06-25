import { describe, expect, it } from "vitest";

import {
  assertWebTenantEmailVerified,
  assertWebPlatformAdmin,
  canPlatformAdmin,
  hasSessionPermissionCapability,
  isTenantEmailVerificationRequired,
  navigationAccessFromSession,
  resolveWebAccessSession
} from "./access";

describe("web access guards", () => {
  it("defaults local development to tenant and platform admin", () => {
    const session = resolveWebAccessSession({
      NODE_ENV: "development"
    });

    expect(session.systemRoleTemplateIds).toEqual(["tenant_admin"]);
    expect(session.permissions).toContain("modules.manage");
    expect(canPlatformAdmin(session)).toBe(true);
    expect(navigationAccessFromSession(session)).toEqual({
      tenantAdmin: false,
      platformAdmin: true
    });
  });

  it("defaults production to agent without platform admin", () => {
    const session = resolveWebAccessSession({
      NODE_ENV: "production"
    });

    expect(session.systemRoleTemplateIds).toEqual(["agent"]);
    expect(session.permissions).not.toContain("modules.manage");
    expect(canPlatformAdmin(session)).toBe(false);
  });

  it("accepts configured system templates and platform roles", () => {
    const session = resolveWebAccessSession({
      NODE_ENV: "production",
      HULEE_WEB_SYSTEM_ROLE_TEMPLATES: "supervisor,tenant_admin,unknown",
      HULEE_WEB_PLATFORM_ADMIN: "1"
    });

    expect(session.systemRoleTemplateIds).toEqual([
      "supervisor",
      "tenant_admin"
    ]);
    expect(session.permissions).toContain("modules.manage");
    expect(canPlatformAdmin(session)).toBe(true);
  });

  it("does not derive tenant admin navigation from coarse session permissions", () => {
    const session = {
      ...resolveWebAccessSession({
        NODE_ENV: "production"
      }),
      permissions: ["roles.manage" as const]
    };

    expect(navigationAccessFromSession(session).tenantAdmin).toBe(false);
  });

  it("keeps session capabilities separate from platform guards", () => {
    const session = resolveWebAccessSession({
      NODE_ENV: "production"
    });

    expect(hasSessionPermissionCapability(session, "modules.manage")).toBe(
      false
    );
    expect(() => assertWebPlatformAdmin(session)).toThrow(/permission.denied/);
  });

  it("requires verified email only for real tenant accounts", () => {
    const fallbackSession = resolveWebAccessSession({
      NODE_ENV: "development"
    });
    const unverifiedSession = {
      ...fallbackSession,
      accountId: "account:test",
      emailVerifiedAt: null
    };
    const verifiedSession = {
      ...fallbackSession,
      accountId: "account:test",
      emailVerifiedAt: "2026-06-23T10:00:00.000Z"
    };

    expect(isTenantEmailVerificationRequired(fallbackSession)).toBe(false);
    expect(isTenantEmailVerificationRequired(unverifiedSession)).toBe(true);
    expect(() => assertWebTenantEmailVerified(unverifiedSession)).toThrow(
      /auth.email_not_verified/
    );
    expect(assertWebTenantEmailVerified(verifiedSession)).toBe(verifiedSession);
  });
});
