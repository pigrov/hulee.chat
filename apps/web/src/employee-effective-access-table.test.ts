import type { EmployeeId, TenantId } from "@hulee/contracts";
import type { PermissionRoleBinding } from "@hulee/core";
import type { TenantEmployeeRecord, TenantRoleRecord } from "@hulee/db";
import { describe, expect, it } from "vitest";

import { buildEmployeeEffectiveAccessPreview } from "./employee-effective-access-model";

const tenantId = "tenant_test" as TenantId;
const employeeId = "employee_test" as EmployeeId;

describe("employee effective access table model", () => {
  it("builds effective access for the selected employee", () => {
    const employee = {
      tenantId,
      employeeId,
      accountId: null,
      email: "employee@example.test",
      displayName: "Employee",
      phoneNumber: null,
      avatarUrl: null,
      avatar: null,
      systemRoleTemplateIds: [],
      teamIds: ["team-1"],
      orgUnitIds: [],
      queueIds: [],
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      deactivatedAt: null
    } satisfies TenantEmployeeRecord;

    const roles = [
      {
        id: "role-agent",
        tenantId,
        name: "Agent",
        description: null,
        isSystem: false,
        createdByEmployeeId: employeeId,
        permissions: ["message.reply"],
        status: "active"
      }
    ] satisfies readonly TenantRoleRecord[];

    const roleBindings = [
      {
        id: "binding-1",
        tenantId,
        roleId: "role-agent",
        subject: {
          type: "employee",
          id: employeeId
        },
        scope: {
          type: "tenant"
        }
      }
    ] satisfies readonly PermissionRoleBinding[];

    const grants = buildEmployeeEffectiveAccessPreview({
      at: new Date("2026-01-02T00:00:00.000Z"),
      directGrants: [
        {
          id: "grant-1",
          tenantId,
          employeeId,
          permission: "files.view",
          reason: "coverage",
          scope: {
            type: "team",
            id: "team-1"
          }
        }
      ],
      employee,
      roleBindings,
      roles,
      tenantId
    });

    expect(grants.map((grant) => grant.permission)).toEqual([
      "message.reply",
      "files.view"
    ]);
  });
});
