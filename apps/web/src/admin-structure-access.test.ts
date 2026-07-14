import type { EmployeeId, TenantId } from "@hulee/contracts";
import {
  CoreError,
  type EffectivePermissionGrant,
  type PermissionRoleBinding
} from "@hulee/core";
import type {
  OrgUnitRecord,
  TeamRecord,
  TenantEmployeeRecord,
  WorkQueueRecord
} from "@hulee/db";
import { describe, expect, it, vi } from "vitest";

import {
  assertCanManageOrgAnchor,
  assertCanManageOrgUnit,
  assertCanManageTeam,
  assertCanManageTenantStructure,
  assertCanManageWorkQueue,
  canManageTenantStructure,
  filterAdminStructureRows,
  requireAdminStructureAccess
} from "./admin-structure-access";
import type { WebEffectiveAccessSnapshot } from "./rbac-effective-access";

const tenantId = "tenant-1" as TenantId;
const employeeId = "employee-admin" as EmployeeId;
const now = new Date("2026-07-13T10:00:00.000Z");
const rootOrgUnit = orgUnit("org-root", null);
const salesOrgUnit = orgUnit("org-sales", "org-root");
const claimsOrgUnit = orgUnit("org-claims", "org-root");
const salesQueue = workQueue("queue-sales", "org-sales");
const claimsQueue = workQueue("queue-claims", "org-claims");
const unownedQueue = workQueue("queue-unowned", null);
const salesTeam = team("team-sales");
const claimsTeam = team("team-claims");

describe("admin structure access", () => {
  it("loads the active actor and effective grants from repositories", async () => {
    const roleBinding: PermissionRoleBinding = {
      id: "binding-manager",
      tenantId,
      roleId: "role-manager",
      subject: { type: "employee", id: employeeId },
      scope: { type: "tenant" }
    };
    const access = await requireAdminStructureAccess({
      tenantId,
      employeeId,
      employeeRepository: {
        findEmployee: vi.fn(async () => employee())
      },
      rbacRepository: {
        listEffectiveAccessSources: vi.fn(async () => ({
          roles: [
            {
              id: "role-manager",
              tenantId,
              permissions: ["employees.manage"] as const,
              status: "active" as const
            }
          ],
          roleBindings: [roleBinding],
          directGrants: []
        }))
      },
      at: now
    });

    expect(canManageTenantStructure(access)).toBe(true);
  });

  it("returns every row for a tenant-scoped manager", () => {
    const rows = filterAdminStructureRows({
      access: accessSnapshot(grant({ type: "tenant" })),
      orgUnits: [rootOrgUnit, salesOrgUnit, claimsOrgUnit],
      teams: [salesTeam, claimsTeam],
      workQueues: [salesQueue, claimsQueue, unownedQueue]
    });

    expect(rows).toEqual({
      orgUnits: [rootOrgUnit, salesOrgUnit, claimsOrgUnit],
      teams: [salesTeam, claimsTeam],
      workQueues: [salesQueue, claimsQueue, unownedQueue]
    });
  });

  it("filters an org-scoped view and redacts an inaccessible parent id", () => {
    const rows = filterAdminStructureRows({
      access: accessSnapshot(grant({ type: "org_unit", id: "org-sales" })),
      orgUnits: [rootOrgUnit, salesOrgUnit, claimsOrgUnit],
      teams: [salesTeam, claimsTeam],
      workQueues: [salesQueue, claimsQueue, unownedQueue]
    });

    expect(rows).toEqual({
      orgUnits: [{ ...salesOrgUnit, parentOrgUnitId: null }],
      teams: [],
      workQueues: [salesQueue]
    });
    expect(JSON.stringify(rows)).not.toContain("org-root");
    expect(JSON.stringify(rows)).not.toContain("org-claims");
  });

  it("exposes only an exact team to a team-scoped manager", () => {
    const rows = filterAdminStructureRows({
      access: accessSnapshot(grant({ type: "team", id: "team-sales" })),
      orgUnits: [salesOrgUnit],
      teams: [salesTeam, claimsTeam],
      workQueues: [salesQueue]
    });

    expect(rows).toEqual({
      orgUnits: [],
      teams: [salesTeam],
      workQueues: []
    });
  });

  it("enforces exact targets and tenant-only root or unowned anchors", () => {
    const orgAccess = accessSnapshot(
      grant({ type: "org_unit", id: "org-sales" })
    );

    expect(() =>
      assertCanManageOrgUnit({ access: orgAccess, orgUnit: salesOrgUnit })
    ).not.toThrow();
    expect(() =>
      assertCanManageWorkQueue({ access: orgAccess, workQueue: salesQueue })
    ).not.toThrow();
    expect(() =>
      assertCanManageOrgAnchor({
        access: orgAccess,
        tenantId,
        orgUnit: salesOrgUnit
      })
    ).not.toThrow();

    for (const denied of [
      () =>
        assertCanManageOrgUnit({
          access: orgAccess,
          orgUnit: claimsOrgUnit
        }),
      () =>
        assertCanManageWorkQueue({
          access: orgAccess,
          workQueue: claimsQueue
        }),
      () =>
        assertCanManageWorkQueue({
          access: orgAccess,
          workQueue: unownedQueue
        }),
      () =>
        assertCanManageOrgAnchor({
          access: orgAccess,
          tenantId,
          orgUnit: null
        }),
      () => assertCanManageTenantStructure(orgAccess)
    ]) {
      expect(denied).toThrow(new CoreError("permission.denied"));
    }
  });

  it("allows an exact team update without allowing tenant creation", () => {
    const teamAccess = accessSnapshot(
      grant({ type: "team", id: "team-sales" })
    );

    expect(() =>
      assertCanManageTeam({ access: teamAccess, team: salesTeam })
    ).not.toThrow();
    expect(() =>
      assertCanManageTeam({ access: teamAccess, team: claimsTeam })
    ).toThrow(new CoreError("permission.denied"));
    expect(() => assertCanManageTenantStructure(teamAccess)).toThrow(
      new CoreError("permission.denied")
    );
  });

  it("rejects a deactivated actor before resolving grants", async () => {
    const listEffectiveAccessSources = vi.fn();

    await expect(
      requireAdminStructureAccess({
        tenantId,
        employeeId,
        employeeRepository: {
          findEmployee: vi.fn(async () => employee({ deactivatedAt: now }))
        },
        rbacRepository: { listEffectiveAccessSources },
        at: now
      })
    ).rejects.toEqual(new CoreError("permission.denied"));
    expect(listEffectiveAccessSources).not.toHaveBeenCalled();
  });
});

function accessSnapshot(
  ...effectiveGrants: readonly EffectivePermissionGrant[]
): WebEffectiveAccessSnapshot {
  return {
    actor: {
      tenantId,
      employeeId,
      orgUnitIds: [],
      queueIds: [],
      teamIds: []
    },
    effectiveGrants
  };
}

function grant(
  scope: EffectivePermissionGrant["scope"]
): EffectivePermissionGrant {
  return {
    tenantId,
    employeeId,
    permission: "employees.manage",
    scope,
    sources: [{ type: "direct_grant", reason: "test" }]
  };
}

function employee(input?: {
  deactivatedAt?: Date | null;
}): TenantEmployeeRecord {
  return {
    tenantId,
    employeeId,
    accountId: null,
    email: "employee@example.test",
    displayName: "Employee",
    phoneNumber: null,
    avatarUrl: null,
    avatar: null,
    systemRoleTemplateIds: [],
    teamIds: [],
    orgUnitIds: [],
    queueIds: [],
    createdAt: now,
    deactivatedAt: input?.deactivatedAt ?? null
  };
}

function orgUnit(id: string, parentOrgUnitId: string | null): OrgUnitRecord {
  return {
    id,
    tenantId,
    parentOrgUnitId,
    name: id,
    kind: "department",
    status: "active"
  };
}

function team(id: string): TeamRecord {
  return {
    id,
    tenantId,
    name: id
  };
}

function workQueue(
  id: string,
  owningOrgUnitId: string | null
): WorkQueueRecord {
  return {
    id,
    tenantId,
    name: id,
    kind: "custom",
    owningOrgUnitId,
    status: "active",
    routingConfig: {}
  };
}
