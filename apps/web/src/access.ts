import type { EmployeeId, TenantId } from "@hulee/contracts";
import {
  CoreError,
  isEmployeeRole,
  permissionsForRoles,
  type EmployeeRole,
  type Permission
} from "@hulee/core";

import type { NavigationAccess } from "./app-chrome";

export type PlatformRole = "platform_admin";

export type WebAccessSession = {
  tenantId: TenantId;
  employeeId: EmployeeId;
  tenantRoles: readonly EmployeeRole[];
  permissions: readonly Permission[];
  platformRoles: readonly PlatformRole[];
};

const defaultTenantId = "tenant_local_1" as TenantId;
const defaultEmployeeId = "employee:local-dev" as EmployeeId;

export function resolveWebAccessSession(
  env: NodeJS.ProcessEnv = process.env
): WebAccessSession {
  const tenantRoles = resolveTenantRoles(env);
  const platformRoles = resolvePlatformRoles(env);

  return {
    tenantId: (env.HULEE_WEB_TENANT_ID ?? defaultTenantId) as TenantId,
    employeeId: (env.HULEE_WEB_EMPLOYEE_ID ?? defaultEmployeeId) as EmployeeId,
    tenantRoles,
    permissions: permissionsForRoles(tenantRoles),
    platformRoles
  };
}

export function canTenantPermission(
  session: WebAccessSession,
  permission: Permission
): boolean {
  return session.permissions.includes(permission);
}

export function canPlatformAdmin(session: WebAccessSession): boolean {
  return session.platformRoles.includes("platform_admin");
}

export function assertWebTenantPermission(
  permission: Permission,
  session = resolveWebAccessSession()
): WebAccessSession {
  if (!canTenantPermission(session, permission)) {
    throw new CoreError("permission.denied");
  }

  return session;
}

export function assertWebPlatformAdmin(
  session = resolveWebAccessSession()
): WebAccessSession {
  if (!canPlatformAdmin(session)) {
    throw new CoreError("permission.denied");
  }

  return session;
}

export function navigationAccessFromSession(
  session: WebAccessSession
): NavigationAccess {
  return {
    tenantAdmin: canTenantPermission(session, "modules.manage"),
    platformAdmin: canPlatformAdmin(session)
  };
}

export function buildInternalApiHeaders(
  session = resolveWebAccessSession()
): Record<string, string> {
  return {
    "x-hulee-tenant-id": session.tenantId,
    "x-hulee-employee-id": session.employeeId,
    "x-hulee-permissions": session.permissions.join(",")
  };
}

function resolveTenantRoles(env: NodeJS.ProcessEnv): readonly EmployeeRole[] {
  const configured = parseCsv(env.HULEE_WEB_TENANT_ROLES).filter(
    isEmployeeRole
  );

  if (configured.length > 0) {
    return configured;
  }

  return env.NODE_ENV === "production" ? ["agent"] : ["tenant_admin"];
}

function resolvePlatformRoles(env: NodeJS.ProcessEnv): readonly PlatformRole[] {
  if (isEnabled(env.HULEE_WEB_PLATFORM_ADMIN)) {
    return ["platform_admin"];
  }

  if (parseCsv(env.HULEE_WEB_PLATFORM_ROLES).includes("platform_admin")) {
    return ["platform_admin"];
  }

  return env.NODE_ENV === "production" ? [] : ["platform_admin"];
}

function parseCsv(value: string | undefined): string[] {
  if (value === undefined) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function isEnabled(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}
