import type { EmployeeId, TenantId } from "@hulee/contracts";
import { CoreError, type EffectivePermissionGrant } from "@hulee/core";
import { describe, expect, it } from "vitest";

import { assertCanUpdateEmployeeMemberships } from "./employee-membership-access";

const tenantId = "tenant-1" as TenantId;
const employeeId = "employee-admin" as EmployeeId;
const actor = {
  tenantId,
  employeeId
};

describe("employee membership access", () => {
  it("allows tenant role managers to change any membership", () => {
    expect(() =>
      assertCanUpdateEmployeeMemberships({
        actor,
        effectiveGrants: [grant({ type: "tenant" })],
        previousIds: [],
        nextIds: ["org-sales"],
        resources: [
          {
            id: "org-sales",
            resource: {
              tenantId,
              orgUnitId: "org-sales"
            }
          }
        ]
      })
    ).not.toThrow();
  });

  it("allows scoped role managers to change memberships inside their scope", () => {
    expect(() =>
      assertCanUpdateEmployeeMemberships({
        actor,
        effectiveGrants: [grant({ type: "org_unit", id: "org-sales" })],
        previousIds: ["org-claims"],
        nextIds: ["org-claims", "org-sales"],
        resources: [
          {
            id: "org-claims",
            resource: {
              tenantId,
              orgUnitId: "org-claims"
            }
          },
          {
            id: "org-sales",
            resource: {
              tenantId,
              orgUnitId: "org-sales"
            }
          }
        ]
      })
    ).not.toThrow();
  });

  it("rejects changed memberships outside the actor scope", () => {
    expect(() =>
      assertCanUpdateEmployeeMemberships({
        actor,
        effectiveGrants: [grant({ type: "org_unit", id: "org-sales" })],
        previousIds: [],
        nextIds: ["org-claims"],
        resources: [
          {
            id: "org-claims",
            resource: {
              tenantId,
              orgUnitId: "org-claims"
            }
          }
        ]
      })
    ).toThrow(new CoreError("permission.denied"));
  });

  it("does not require access to unchanged memberships", () => {
    expect(() =>
      assertCanUpdateEmployeeMemberships({
        actor,
        effectiveGrants: [grant({ type: "org_unit", id: "org-sales" })],
        previousIds: ["org-claims"],
        nextIds: ["org-claims"],
        resources: []
      })
    ).not.toThrow();
  });
});

function grant(
  scope: EffectivePermissionGrant["scope"]
): EffectivePermissionGrant {
  return {
    tenantId,
    employeeId,
    permission: "roles.manage",
    scope,
    sources: []
  };
}
