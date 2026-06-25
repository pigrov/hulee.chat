import type { EmployeeId, TenantId } from "@hulee/contracts";
import type { DirectPermissionGrant } from "@hulee/core";
import type { TenantEmployeeRecord, TenantRbacRepository } from "@hulee/db";
import { describe, expect, it } from "vitest";

import {
  hasEffectivePermission,
  permissionActorFromTenantEmployee,
  resolveEmployeeEffectiveAccess,
  type WebEffectiveAccessSnapshot
} from "./rbac-effective-access";

const tenantId = "tenant-1" as TenantId;
const otherTenantId = "tenant-2" as TenantId;
const employeeId = "employee-1" as EmployeeId;

describe("RBAC effective web access", () => {
  it("maps tenant employee records into permission actors", () => {
    expect(
      permissionActorFromTenantEmployee(
        employee({
          roles: ["agent"],
          orgUnitIds: ["org-sales"],
          queueIds: ["queue-sales"],
          teamIds: ["team-a"]
        })
      )
    ).toEqual({
      tenantId,
      employeeId,
      roles: ["agent"],
      orgUnitIds: ["org-sales"],
      queueIds: ["queue-sales"],
      teamIds: ["team-a"]
    });
  });

  it("resolves effective grants for an active tenant employee", async () => {
    const grant: DirectPermissionGrant = {
      tenantId,
      employeeId,
      permission: "roles.manage",
      scope: { type: "org_unit", id: "org-sales" },
      reason: "Scoped admin"
    };

    const snapshot = await resolveEmployeeEffectiveAccess({
      tenantId,
      employeeId,
      at: new Date("2026-01-01T00:00:00.000Z"),
      employeeRepository: {
        async findEmployee() {
          return employee({ orgUnitIds: ["org-sales"] });
        }
      },
      rbacRepository: {
        async listEffectiveAccessSources(input) {
          expect(input.actor.orgUnitIds).toEqual(["org-sales"]);

          return {
            roles: [],
            roleBindings: [],
            directGrants: [grant]
          };
        }
      }
    });

    expect(snapshot?.actor.employeeId).toBe(employeeId);
    expect(hasEffectivePermission(snapshot, "roles.manage")).toBe(true);
    expect(snapshot?.effectiveGrants).toEqual([
      {
        tenantId,
        employeeId,
        permission: "roles.manage",
        scope: { type: "org_unit", id: "org-sales" },
        sources: [
          {
            type: "direct_grant",
            grantId: undefined,
            reason: "Scoped admin"
          }
        ]
      }
    ]);
  });

  it("honors scoped-only rollout mode for legacy employee roles", async () => {
    const snapshot = await resolveEmployeeEffectiveAccess({
      tenantId,
      employeeId,
      at: new Date("2026-01-01T00:00:00.000Z"),
      permissionResolverMode: "scoped",
      employeeRepository: {
        async findEmployee() {
          return employee({ roles: ["agent"] });
        }
      },
      rbacRepository: {
        async listEffectiveAccessSources() {
          return {
            roles: [],
            roleBindings: [],
            directGrants: [
              {
                tenantId,
                employeeId,
                permission: "roles.manage",
                scope: { type: "tenant" },
                reason: "Scoped rollout"
              }
            ]
          };
        }
      }
    });

    expect(hasEffectivePermission(snapshot, "message.reply")).toBe(false);
    expect(hasEffectivePermission(snapshot, "roles.manage")).toBe(true);
  });

  it("does not resolve access for missing or inactive employees", async () => {
    const inactiveSnapshot = await resolveEmployeeEffectiveAccess({
      tenantId,
      employeeId,
      employeeRepository: {
        async findEmployee() {
          return employee({ deactivatedAt: new Date("2026-01-02T00:00:00Z") });
        }
      },
      rbacRepository: throwingRbacRepository()
    });

    const missingSnapshot = await resolveEmployeeEffectiveAccess({
      tenantId,
      employeeId,
      employeeRepository: {
        async findEmployee() {
          return null;
        }
      },
      rbacRepository: throwingRbacRepository()
    });

    expect(inactiveSnapshot).toBeUndefined();
    expect(missingSnapshot).toBeUndefined();
  });

  it("checks permission against the snapshot actor boundary", () => {
    const snapshot: WebEffectiveAccessSnapshot = {
      actor: {
        tenantId,
        employeeId
      },
      effectiveGrants: [
        {
          tenantId: otherTenantId,
          employeeId,
          permission: "roles.manage",
          scope: { type: "tenant" },
          sources: []
        },
        {
          tenantId,
          employeeId: "employee-2" as EmployeeId,
          permission: "roles.manage",
          scope: { type: "tenant" },
          sources: []
        }
      ]
    };

    expect(hasEffectivePermission(undefined, "roles.manage")).toBe(false);
    expect(hasEffectivePermission(snapshot, "roles.manage")).toBe(false);
  });
});

function employee(
  overrides: Partial<TenantEmployeeRecord> = {}
): TenantEmployeeRecord {
  return {
    tenantId,
    employeeId,
    accountId: "account-1",
    email: "employee@example.com",
    displayName: "Employee",
    roles: [],
    teamIds: [],
    orgUnitIds: [],
    queueIds: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    deactivatedAt: null,
    ...overrides
  };
}

function throwingRbacRepository(): Pick<
  TenantRbacRepository,
  "listEffectiveAccessSources"
> {
  return {
    async listEffectiveAccessSources() {
      throw new Error("RBAC repository should not be called.");
    }
  };
}
