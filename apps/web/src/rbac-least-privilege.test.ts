import type { EmployeeId, TenantId } from "@hulee/contracts";
import { CoreError, type EffectivePermissionGrant } from "@hulee/core";
import { describe, expect, it } from "vitest";

import {
  assertCanGrantScopedPermissions,
  assertCanManageScopedAccess
} from "./rbac-least-privilege";

const tenantId = "tenant-1" as TenantId;
const employeeId = "employee-admin" as EmployeeId;
const actor = {
  tenantId,
  employeeId
};

describe("RBAC least privilege", () => {
  it("allows tenant role managers to grant any scoped permission", () => {
    expect(() =>
      assertCanGrantScopedPermissions({
        actor,
        effectiveGrants: [
          grant("roles.manage", { type: "tenant" }),
          grant("message.reply", { type: "org_unit", id: "org-sales" })
        ],
        target: {
          permissions: ["message.reply"],
          resource: {
            tenantId,
            queueId: "queue-claims"
          }
        }
      })
    ).not.toThrow();
  });

  it("allows scoped role managers to grant permissions they already hold in the target scope", () => {
    expect(() =>
      assertCanGrantScopedPermissions({
        actor,
        effectiveGrants: [
          grant("roles.manage", { type: "org_unit", id: "org-sales" }),
          grant("message.reply", { type: "org_unit", id: "org-sales" }),
          grant("client.view", { type: "org_unit", id: "org-sales" })
        ],
        target: {
          permissions: ["message.reply", "client.view"],
          resource: {
            tenantId,
            orgUnitId: "org-sales",
            queueId: "queue-sales"
          }
        }
      })
    ).not.toThrow();
  });

  it("rejects granting a scope outside the actor role-management scope", () => {
    expect(() =>
      assertCanGrantScopedPermissions({
        actor,
        effectiveGrants: [
          grant("roles.manage", { type: "org_unit", id: "org-sales" }),
          grant("message.reply", { type: "org_unit", id: "org-sales" })
        ],
        target: {
          permissions: ["message.reply"],
          resource: {
            tenantId,
            orgUnitId: "org-claims",
            queueId: "queue-claims"
          }
        }
      })
    ).toThrow(new CoreError("permission.denied"));
  });

  it("rejects granting permissions the actor does not already hold", () => {
    expect(() =>
      assertCanGrantScopedPermissions({
        actor,
        effectiveGrants: [
          grant("roles.manage", { type: "org_unit", id: "org-sales" }),
          grant("message.reply", { type: "org_unit", id: "org-sales" })
        ],
        target: {
          permissions: ["integrations.manage"],
          resource: {
            tenantId,
            orgUnitId: "org-sales"
          }
        }
      })
    ).toThrow(new CoreError("permission.denied"));
  });

  it("allows scoped role managers to revoke access in their managed scope", () => {
    expect(() =>
      assertCanManageScopedAccess({
        actor,
        effectiveGrants: [
          grant("roles.manage", { type: "org_unit", id: "org-sales" })
        ],
        target: {
          resource: {
            tenantId,
            orgUnitId: "org-sales",
            queueId: "queue-sales"
          }
        }
      })
    ).not.toThrow();
  });

  it("rejects scoped role managers revoking tenant-wide access", () => {
    expect(() =>
      assertCanManageScopedAccess({
        actor,
        effectiveGrants: [
          grant("roles.manage", { type: "org_unit", id: "org-sales" })
        ],
        target: {
          resource: {
            tenantId
          }
        }
      })
    ).toThrow(new CoreError("permission.denied"));
  });
});

function grant(
  permission: EffectivePermissionGrant["permission"],
  scope: EffectivePermissionGrant["scope"]
): EffectivePermissionGrant {
  return {
    tenantId,
    employeeId,
    permission,
    scope,
    sources: []
  };
}
