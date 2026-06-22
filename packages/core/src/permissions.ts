import type { EmployeeId, TenantId } from "@hulee/contracts";

import { CoreError } from "./errors";

export type EmployeeRole = "tenant_admin" | "supervisor" | "agent";

export type Permission =
  | "tenant.manage"
  | "employees.manage"
  | "modules.manage"
  | "inbox.read"
  | "message.reply";

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
