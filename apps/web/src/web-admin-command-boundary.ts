import { assertWebTenantEmailVerified, type WebAccessSession } from "./access";
import { assertRecentPrivilegedActionSession } from "./privileged-action-policy";
import { requireCurrentWebAccessSession } from "./session";

export type WebDbBackedAdminCommandBoundary = {
  readonly requireVerifiedEmail: boolean;
  readonly requireRecentSession: boolean;
};

export const webDbBackedAdminCommandBoundaries = {
  employeeLifecycle: {
    requireVerifiedEmail: true,
    requireRecentSession: false
  },
  employeeMembership: {
    requireVerifiedEmail: true,
    requireRecentSession: true
  },
  orgStructure: {
    requireVerifiedEmail: true,
    requireRecentSession: false
  },
  roleAccess: {
    requireVerifiedEmail: true,
    requireRecentSession: true
  }
} satisfies Record<string, WebDbBackedAdminCommandBoundary>;

export async function assertWebDbBackedAdminCommandBoundary(
  boundary: WebDbBackedAdminCommandBoundary
): Promise<WebAccessSession> {
  const session = await requireCurrentWebAccessSession();

  if (boundary.requireVerifiedEmail) {
    assertWebTenantEmailVerified(session);
  }

  if (boundary.requireRecentSession) {
    assertRecentPrivilegedActionSession(session);
  }

  return session;
}
