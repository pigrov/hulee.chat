import type { EmployeeId, TenantId } from "@hulee/contracts";
import { CoreError, type EffectivePermissionGrant } from "@hulee/core";
import type { TenantEmployeeRecord } from "@hulee/db";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  assertCanAccessEmployeeResource,
  assertCanAccessTenantResource,
  canAccessEmployeeResource,
  canAccessTenantResource,
  filterEmployeesByResourceAccess,
  loadEmployeeDirectoryForAccess,
  resolveEmployeeDirectoryReadScope
} from "./admin-resource-access";
import type { WebEffectiveAccessSnapshot } from "./rbac-effective-access";

const tenantId = "tenant-1" as TenantId;
const otherTenantId = "tenant-other" as TenantId;
const actorEmployeeId = "employee-admin" as EmployeeId;
const otherEmployeeId = "employee-other" as EmployeeId;

describe("admin resource access", () => {
  it("derives a deterministic employee directory scope from DB-backed grants", () => {
    expect(
      resolveEmployeeDirectoryReadScope(
        accessSnapshot(
          grant("employees.manage", { type: "team", id: "team-z" }),
          grant("employees.manage", {
            type: "org_unit",
            id: "org-sales"
          }),
          grant("employees.manage", { type: "team", id: "team-a" }),
          grant("employees.manage", { type: "team", id: "team-z" }),
          grant("roles.manage", { type: "org_unit", id: "org-hidden" })
        )
      )
    ).toEqual({
      mode: "scoped",
      orgUnitIds: ["org-sales"],
      teamIds: ["team-a", "team-z"]
    });
    expect(resolveEmployeeDirectoryReadScope(undefined)).toEqual({
      mode: "denied"
    });
  });

  it("uses exact canAccess decisions instead of permission presence for structural candidates", () => {
    const rolesOnlyCandidate = accessSnapshot(
      grant("roles.manage", { type: "team", id: "team-blue" })
    );
    const employeesManageCandidate = accessSnapshot(
      grant("roles.manage", { type: "team", id: "team-blue" }),
      grant("employees.manage", { type: "team", id: "team-blue" })
    );

    expect(resolveEmployeeDirectoryReadScope(rolesOnlyCandidate)).toEqual({
      mode: "denied"
    });
    expect(resolveEmployeeDirectoryReadScope(employeesManageCandidate)).toEqual(
      {
        mode: "scoped",
        orgUnitIds: [],
        teamIds: ["team-blue"]
      }
    );
  });

  it("ignores foreign and invalid actor-bound grant candidates", () => {
    const foreignTenantGrant = {
      ...grant("employees.manage", { type: "tenant" }),
      tenantId: otherTenantId
    };
    const foreignEmployeeGrant = {
      ...grant("employees.manage", {
        type: "org_unit",
        id: "org-injected"
      }),
      employeeId: otherEmployeeId
    };
    const invalidPermissionScopeGrant = grant("employees.manage", {
      type: "queue",
      id: "queue-injected"
    });

    expect(
      resolveEmployeeDirectoryReadScope(
        accessSnapshot(
          foreignTenantGrant,
          foreignEmployeeGrant,
          invalidPermissionScopeGrant
        )
      )
    ).toEqual({ mode: "denied" });
    expect(
      resolveEmployeeDirectoryReadScope(
        accessSnapshot(
          foreignTenantGrant,
          invalidPermissionScopeGrant,
          grant("employees.manage", {
            type: "org_unit",
            id: "org-sales"
          })
        )
      )
    ).toEqual({
      mode: "scoped",
      orgUnitIds: ["org-sales"],
      teamIds: []
    });
  });

  it("keeps the intended full directory query for tenant employees.manage", async () => {
    const visible = employee({ orgUnitIds: ["org-any"] });
    const listEmployees = vi.fn().mockResolvedValue([visible]);
    const listEmployeesByMembershipScopes = vi.fn();

    await expect(
      loadEmployeeDirectoryForAccess({
        access: accessSnapshot(grant("employees.manage", { type: "tenant" })),
        repository: {
          listEmployees,
          listEmployeesByMembershipScopes
        }
      })
    ).resolves.toEqual([visible]);
    expect(listEmployees).toHaveBeenCalledWith({ tenantId });
    expect(listEmployeesByMembershipScopes).not.toHaveBeenCalled();
  });

  it("queries exact scoped memberships before applying defense-in-depth filtering", async () => {
    const visibleByOrg = employee({
      employeeId: "employee-org" as EmployeeId,
      email: "org@example.com",
      orgUnitIds: ["org-sales"]
    });
    const visibleByTeam = employee({
      employeeId: "employee-team" as EmployeeId,
      email: "team@example.com",
      teamIds: ["team-blue"]
    });
    const hidden = employee({
      employeeId: "employee-hidden" as EmployeeId,
      email: "hidden@example.com",
      orgUnitIds: ["org-support"]
    });
    const unassigned = employee({
      employeeId: "employee-unassigned" as EmployeeId,
      email: "unassigned@example.com"
    });
    const listEmployees = vi.fn();
    const listEmployeesByMembershipScopes = vi
      .fn()
      .mockResolvedValue([visibleByOrg, visibleByTeam, hidden, unassigned]);

    await expect(
      loadEmployeeDirectoryForAccess({
        access: accessSnapshot(
          {
            ...grant("employees.manage", { type: "tenant" }),
            tenantId: otherTenantId
          },
          grant("employees.manage", {
            type: "queue",
            id: "queue-invalid"
          }),
          grant("employees.manage", { type: "team", id: "team-blue" }),
          grant("employees.manage", {
            type: "org_unit",
            id: "org-sales"
          })
        ),
        repository: {
          listEmployees,
          listEmployeesByMembershipScopes
        }
      })
    ).resolves.toEqual([visibleByOrg, visibleByTeam]);
    expect(listEmployees).not.toHaveBeenCalled();
    expect(listEmployeesByMembershipScopes).toHaveBeenCalledWith({
      tenantId,
      orgUnitIds: ["org-sales"],
      teamIds: ["team-blue"]
    });
  });

  it("does not query any employee rows without an employees.manage scope", async () => {
    const listEmployees = vi.fn();
    const listEmployeesByMembershipScopes = vi.fn();

    await expect(
      loadEmployeeDirectoryForAccess({
        access: accessSnapshot(
          grant("roles.manage", { type: "org_unit", id: "org-sales" })
        ),
        repository: {
          listEmployees,
          listEmployeesByMembershipScopes
        }
      })
    ).resolves.toEqual([]);
    expect(listEmployees).not.toHaveBeenCalled();
    expect(listEmployeesByMembershipScopes).not.toHaveBeenCalled();
  });

  it("keeps the employee page off the tenant-wide repository method", () => {
    const page = readFileSync(
      join(
        process.cwd(),
        "apps",
        "web",
        "app",
        "admin",
        "employees",
        "page.tsx"
      ),
      "utf8"
    );

    expect(page).toContain("loadEmployeeDirectoryForAccess");
    expect(page).not.toContain("repository.listEmployees(");
  });

  it("filters employee rows using the exact org-unit scope", () => {
    const access = accessSnapshot(
      grant("employees.manage", { type: "org_unit", id: "org-sales" })
    );
    const visible = employee({
      employeeId: "employee-visible" as EmployeeId,
      email: "visible@example.com",
      orgUnitIds: ["org-sales"]
    });
    const hidden = employee({
      employeeId: "employee-hidden" as EmployeeId,
      email: "hidden@example.com",
      orgUnitIds: ["org-support"]
    });

    expect(
      filterEmployeesByResourceAccess({
        access,
        employees: [visible, hidden],
        permission: "employees.manage"
      })
    ).toEqual([visible]);
    expect(
      canAccessEmployeeResource({
        access,
        employee: hidden,
        permission: "employees.manage"
      })
    ).toBe(false);
  });

  it("supports team and queue scoped employee resources", () => {
    const target = employee({
      teamIds: ["team-blue"],
      queueIds: ["queue-priority"]
    });

    expect(
      canAccessEmployeeResource({
        access: accessSnapshot(
          grant("employees.manage", { type: "team", id: "team-blue" })
        ),
        employee: target,
        permission: "employees.manage"
      })
    ).toBe(true);
    expect(
      canAccessEmployeeResource({
        access: accessSnapshot(
          grant("roles.manage", { type: "queue", id: "queue-priority" })
        ),
        employee: target,
        permission: "roles.manage"
      })
    ).toBe(true);
  });

  it("allows every employee and tenant-only commands for a tenant grant", () => {
    const access = accessSnapshot(
      grant("employees.manage", { type: "tenant" })
    );
    const target = employee({ orgUnitIds: ["org-other"] });

    expect(
      canAccessEmployeeResource({
        access,
        employee: target,
        permission: "employees.manage"
      })
    ).toBe(true);
    expect(
      canAccessTenantResource({ access, permission: "employees.manage" })
    ).toBe(true);
    expect(() =>
      assertCanAccessTenantResource({
        access,
        permission: "employees.manage"
      })
    ).not.toThrow();
  });

  it("rejects tenant-only commands and unrelated employee targets for scoped grants", () => {
    const access = accessSnapshot(
      grant("employees.manage", { type: "org_unit", id: "org-sales" })
    );
    const target = employee({ orgUnitIds: ["org-support"] });

    expect(
      canAccessTenantResource({ access, permission: "employees.manage" })
    ).toBe(false);
    expect(() =>
      assertCanAccessTenantResource({
        access,
        permission: "employees.manage"
      })
    ).toThrow(new CoreError("permission.denied"));
    expect(() =>
      assertCanAccessEmployeeResource({
        access,
        employee: target,
        permission: "employees.manage"
      })
    ).toThrow(new CoreError("permission.denied"));
  });
});

function accessSnapshot(
  ...effectiveGrants: readonly EffectivePermissionGrant[]
): WebEffectiveAccessSnapshot {
  return {
    actor: {
      tenantId,
      employeeId: actorEmployeeId,
      orgUnitIds: [],
      queueIds: [],
      teamIds: []
    },
    effectiveGrants
  };
}

function grant(
  permission: EffectivePermissionGrant["permission"],
  scope: EffectivePermissionGrant["scope"]
): EffectivePermissionGrant {
  return {
    tenantId,
    employeeId: actorEmployeeId,
    permission,
    scope,
    sources: [
      {
        type: "direct_grant",
        reason: "test"
      }
    ]
  };
}

function employee(
  overrides: Partial<TenantEmployeeRecord> = {}
): TenantEmployeeRecord {
  return {
    tenantId,
    employeeId: "employee-target" as EmployeeId,
    accountId: "account-target",
    email: "target@example.com",
    displayName: "Target employee",
    phoneNumber: null,
    avatarUrl: null,
    avatar: null,
    systemRoleTemplateIds: [],
    teamIds: [],
    orgUnitIds: [],
    queueIds: [],
    createdAt: new Date("2026-07-13T10:00:00.000Z"),
    deactivatedAt: null,
    ...overrides
  };
}
