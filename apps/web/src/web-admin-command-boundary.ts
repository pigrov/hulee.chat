import type { Permission } from "@hulee/core";

import type { WebAccessSession } from "./access";
import { assertRecentPrivilegedActionSession } from "./privileged-action-policy";
import { assertCurrentWebEffectiveTenantPermission } from "./session";

export type WebDbBackedAdminCommandBoundary = {
  readonly permission: Permission;
  readonly requireVerifiedEmail: boolean;
  readonly requireRecentSession: boolean;
};

export const webDbBackedAdminCommandBoundaries = {
  employeeLifecycle: {
    permission: "employees.manage",
    requireVerifiedEmail: true,
    requireRecentSession: false
  },
  employeeMembership: {
    permission: "roles.manage",
    requireVerifiedEmail: true,
    requireRecentSession: true
  },
  orgStructure: {
    permission: "employees.manage",
    requireVerifiedEmail: true,
    requireRecentSession: false
  },
  roleAccess: {
    permission: "roles.manage",
    requireVerifiedEmail: true,
    requireRecentSession: true
  }
} satisfies Record<string, WebDbBackedAdminCommandBoundary>;

export async function assertWebDbBackedAdminCommandBoundary(
  boundary: WebDbBackedAdminCommandBoundary
): Promise<WebAccessSession> {
  const session = await assertCurrentWebEffectiveTenantPermission(
    boundary.permission,
    {
      requireVerifiedEmail: boundary.requireVerifiedEmail
    }
  );

  if (boundary.requireRecentSession) {
    assertRecentPrivilegedActionSession(session);
  }

  return session;
}
