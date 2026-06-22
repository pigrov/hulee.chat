import { describe, expect, it } from "vitest";

import {
  assertWebPlatformAdmin,
  assertWebTenantPermission,
  canPlatformAdmin,
  navigationAccessFromSession,
  resolveWebAccessSession
} from "./access";

describe("web access guards", () => {
  it("defaults local development to tenant and platform admin", () => {
    const session = resolveWebAccessSession({
      NODE_ENV: "development"
    });

    expect(session.tenantRoles).toEqual(["tenant_admin"]);
    expect(session.permissions).toContain("modules.manage");
    expect(canPlatformAdmin(session)).toBe(true);
    expect(navigationAccessFromSession(session)).toEqual({
      tenantAdmin: true,
      platformAdmin: true
    });
  });

  it("defaults production to agent without platform admin", () => {
    const session = resolveWebAccessSession({
      NODE_ENV: "production"
    });

    expect(session.tenantRoles).toEqual(["agent"]);
    expect(session.permissions).not.toContain("modules.manage");
    expect(canPlatformAdmin(session)).toBe(false);
  });

  it("accepts configured tenant and platform roles", () => {
    const session = resolveWebAccessSession({
      NODE_ENV: "production",
      HULEE_WEB_TENANT_ROLES: "supervisor,tenant_admin,unknown",
      HULEE_WEB_PLATFORM_ADMIN: "1"
    });

    expect(session.tenantRoles).toEqual(["supervisor", "tenant_admin"]);
    expect(session.permissions).toContain("modules.manage");
    expect(canPlatformAdmin(session)).toBe(true);
  });

  it("throws when required access is missing", () => {
    const session = resolveWebAccessSession({
      NODE_ENV: "production"
    });

    expect(() => assertWebTenantPermission("modules.manage", session)).toThrow(
      /permission.denied/
    );
    expect(() => assertWebPlatformAdmin(session)).toThrow(/permission.denied/);
  });
});
