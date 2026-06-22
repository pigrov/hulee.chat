import type { EmployeeId, TenantId } from "@hulee/contracts";

import { CoreError } from "./errors";

export type EmployeeRole = "tenant_admin" | "supervisor" | "agent";

export type Permission =
  | "tenant.manage"
  | "employees.manage"
  | "modules.manage"
  | "inbox.read"
  | "message.reply";

const employeeRoles = ["tenant_admin", "supervisor", "agent"] as const;
const permissions = [
  "tenant.manage",
  "employees.manage",
  "modules.manage",
  "inbox.read",
  "message.reply"
] as const satisfies readonly Permission[];

const rolePermissions: Record<EmployeeRole, readonly Permission[]> = {
  tenant_admin: [
    "tenant.manage",
    "employees.manage",
    "modules.manage",
    "inbox.read",
    "message.reply"
  ],
  supervisor: ["inbox.read", "message.reply"],
  agent: ["inbox.read", "message.reply"]
};

export type Employee = {
  id: EmployeeId;
  tenantId: TenantId;
  email: string;
  displayName: string;
  roles: readonly EmployeeRole[];
  createdAt: string;
};

export function isEmployeeRole(value: string): value is EmployeeRole {
  return employeeRoles.includes(value as EmployeeRole);
}

export function isPermission(value: string): value is Permission {
  return permissions.includes(value as Permission);
}

export function permissionsForRoles(
  roles: readonly EmployeeRole[]
): readonly Permission[] {
  const result = new Set<Permission>();

  for (const role of roles) {
    for (const permission of rolePermissions[role]) {
      result.add(permission);
    }
  }

  return [...result];
}

export function hasPermission(
  employee: Employee,
  permission: Permission
): boolean {
  return employee.roles.some((role) =>
    rolePermissions[role].includes(permission)
  );
}

export function assertEmployeeCan(
  employee: Employee,
  permission: Permission
): void {
  if (!hasPermission(employee, permission)) {
    throw new CoreError("permission.denied");
  }
}
