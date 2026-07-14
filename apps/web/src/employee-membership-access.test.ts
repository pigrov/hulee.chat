import type { EmployeeId, TenantId } from "@hulee/contracts";
import {
  CoreError,
  type EffectivePermissionGrant,
  type Permission,
  type PermissionRoleBinding,
  type PermissionRoleDefinition,
  type PermissionScope
} from "@hulee/core";
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
        target: membershipTarget(),
        membershipType: "org_unit",
        previousIds: [],
        nextIds: ["org-sales"],
        resources: [
          {
            type: "org_unit",
            id: "org-sales",
            resource: {
              tenantId,
              orgUnitId: "org-sales"
            }
          }
        ],
        roleBindings: [],
        roles: []
      })
    ).not.toThrow();
  });

  it("allows scoped role managers to change memberships inside their scope", () => {
    expect(() =>
      assertCanUpdateEmployeeMemberships({
        actor,
        effectiveGrants: [grant({ type: "org_unit", id: "org-sales" })],
        target: membershipTarget({ orgUnitIds: ["org-sales"] }),
        membershipType: "org_unit",
        previousIds: ["org-sales"],
        nextIds: [],
        resources: [
          {
            type: "org_unit",
            id: "org-sales",
            resource: {
              tenantId,
              orgUnitId: "org-sales"
            }
          }
        ],
        roleBindings: [],
        roles: []
      })
    ).not.toThrow();
  });

  it("rejects changed memberships outside the actor scope", () => {
    expect(() =>
      assertCanUpdateEmployeeMemberships({
        actor,
        effectiveGrants: [grant({ type: "org_unit", id: "org-sales" })],
        target: membershipTarget({ orgUnitIds: ["org-sales"] }),
        membershipType: "org_unit",
        previousIds: [],
        nextIds: ["org-claims"],
        resources: [
          {
            type: "org_unit",
            id: "org-claims",
            resource: {
              tenantId,
              orgUnitId: "org-claims"
            }
          }
        ],
        roleBindings: [],
        roles: []
      })
    ).toThrow(new CoreError("permission.denied"));
  });

  it("requires access to unchanged memberships too", () => {
    expect(() =>
      assertCanUpdateEmployeeMemberships({
        actor,
        effectiveGrants: [grant({ type: "org_unit", id: "org-sales" })],
        target: membershipTarget({
          orgUnitIds: ["org-sales", "org-claims"]
        }),
        membershipType: "org_unit",
        previousIds: ["org-claims"],
        nextIds: ["org-claims"],
        resources: [
          {
            type: "org_unit",
            id: "org-claims",
            resource: {
              tenantId,
              orgUnitId: "org-claims"
            }
          }
        ],
        roleBindings: [],
        roles: []
      })
    ).toThrow(new CoreError("permission.denied"));
  });

  it("requires target access even for an empty no-op", () => {
    expect(() =>
      assertCanUpdateEmployeeMemberships({
        actor,
        effectiveGrants: [],
        target: membershipTarget({ orgUnitIds: ["org-sales"] }),
        membershipType: "org_unit",
        previousIds: [],
        nextIds: [],
        resources: [],
        roleBindings: [],
        roles: []
      })
    ).toThrow(new CoreError("permission.denied"));
  });

  it("denies adding a membership with a scheduled cross-scope binding above the actor grant ceiling", () => {
    expect(() =>
      assertCanUpdateEmployeeMemberships({
        actor,
        effectiveGrants: [
          permissionGrant("roles.manage", {
            type: "org_unit",
            id: "org-sales"
          }),
          permissionGrant("roles.manage", {
            type: "team",
            id: "team-sales"
          }),
          permissionGrant("roles.manage", {
            type: "queue",
            id: "queue-claims"
          })
        ],
        target: membershipTarget({ orgUnitIds: ["org-sales"] }),
        membershipType: "team",
        previousIds: [],
        nextIds: ["team-sales"],
        resources: structuralResources(),
        roleBindings: [
          roleBinding({
            subjectType: "team",
            subjectId: "team-sales",
            scope: { type: "queue", id: "queue-claims" },
            startsAt: "2026-07-14T10:00:00.000Z"
          })
        ],
        roles: [role("role-agent", ["message.reply"])]
      })
    ).toThrow(new CoreError("permission.denied"));
  });

  it("allows an addition only with subject, binding-scope and permission ceiling access", () => {
    expect(
      assertCanUpdateEmployeeMemberships({
        actor,
        effectiveGrants: [
          permissionGrant("roles.manage", {
            type: "org_unit",
            id: "org-sales"
          }),
          permissionGrant("roles.manage", {
            type: "team",
            id: "team-sales"
          }),
          permissionGrant("roles.manage", {
            type: "queue",
            id: "queue-claims"
          }),
          permissionGrant("message.reply", {
            type: "queue",
            id: "queue-claims"
          })
        ],
        target: membershipTarget({
          orgUnitIds: ["org-sales"],
          queueIds: ["queue-existing"]
        }),
        membershipType: "team",
        previousIds: [],
        nextIds: ["team-sales"],
        resources: structuralResources(),
        roleBindings: [
          roleBinding({
            subjectType: "team",
            subjectId: "team-sales",
            scope: { type: "queue", id: "queue-claims" }
          })
        ],
        roles: [role("role-agent", ["message.reply"])]
      })
    ).toEqual([
      { type: "org_unit", id: "org-claims" },
      { type: "org_unit", id: "org-sales" },
      { type: "team", id: "team-sales" },
      { type: "queue", id: "queue-claims" },
      { type: "queue", id: "queue-existing" }
    ]);
  });

  it("denies removing a group membership when the binding target scope is unmanaged", () => {
    expect(() =>
      assertCanUpdateEmployeeMemberships({
        actor,
        effectiveGrants: [
          permissionGrant("roles.manage", {
            type: "org_unit",
            id: "org-sales"
          }),
          permissionGrant("roles.manage", {
            type: "team",
            id: "team-sales"
          })
        ],
        target: membershipTarget({
          orgUnitIds: ["org-sales"],
          teamIds: ["team-sales"]
        }),
        membershipType: "team",
        previousIds: ["team-sales"],
        nextIds: [],
        resources: structuralResources(),
        roleBindings: [
          roleBinding({
            subjectType: "team",
            subjectId: "team-sales",
            scope: { type: "queue", id: "queue-claims" }
          })
        ],
        roles: [role("role-agent", ["message.reply"])]
      })
    ).toThrow(new CoreError("permission.denied"));
  });

  it("retains tenant and assigned binding literals and rejects unresolved exact scopes", () => {
    const baseInput = {
      actor,
      effectiveGrants: [
        permissionGrant("roles.manage", { type: "tenant" }),
        permissionGrant("message.reply", { type: "tenant" })
      ],
      target: membershipTarget(),
      membershipType: "team" as const,
      previousIds: [],
      nextIds: ["team-sales"],
      resources: structuralResources(),
      roles: [role("role-agent", ["message.reply"])]
    };

    expect(
      assertCanUpdateEmployeeMemberships({
        ...baseInput,
        roleBindings: [
          roleBinding({
            subjectType: "team",
            subjectId: "team-sales",
            scope: { type: "tenant" }
          }),
          roleBinding({
            subjectType: "team",
            subjectId: "team-sales",
            scope: { type: "assigned" }
          })
        ]
      })
    ).toEqual([
      { type: "tenant" },
      { type: "team", id: "team-sales" },
      { type: "assigned" }
    ]);
    expect(() =>
      assertCanUpdateEmployeeMemberships({
        ...baseInput,
        roleBindings: [
          roleBinding({
            subjectType: "team",
            subjectId: "team-sales",
            scope: { type: "conversation", id: "conversation-hidden" }
          })
        ]
      })
    ).toThrow(new CoreError("permission.denied"));
  });

  it("denies self membership changes before group bindings can escalate the actor", () => {
    expect(() =>
      assertCanUpdateEmployeeMemberships({
        actor,
        effectiveGrants: [grant({ type: "tenant" })],
        target: membershipTarget({ employeeId }),
        membershipType: "org_unit",
        previousIds: [],
        nextIds: [],
        resources: [],
        roleBindings: [],
        roles: []
      })
    ).toThrow(new CoreError("permission.denied"));
  });
});

function membershipTarget(
  input: {
    readonly employeeId?: EmployeeId;
    readonly orgUnitIds?: readonly string[];
    readonly queueIds?: readonly string[];
    readonly teamIds?: readonly string[];
  } = {}
) {
  return {
    tenantId,
    employeeId: input.employeeId ?? ("employee-target" as EmployeeId),
    orgUnitIds: input.orgUnitIds ?? [],
    queueIds: input.queueIds ?? [],
    teamIds: input.teamIds ?? []
  };
}

function grant(
  scope: EffectivePermissionGrant["scope"]
): EffectivePermissionGrant {
  return permissionGrant("roles.manage", scope);
}

function permissionGrant(
  permission: Permission,
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

function role(
  id: string,
  permissions: readonly Permission[]
): PermissionRoleDefinition {
  return {
    id,
    tenantId,
    permissions,
    status: "active"
  };
}

function roleBinding(input: {
  readonly subjectType: "org_unit" | "team" | "queue";
  readonly subjectId: string;
  readonly scope: PermissionScope;
  readonly startsAt?: string;
}): PermissionRoleBinding {
  return {
    id: `binding:${input.subjectType}:${input.subjectId}`,
    tenantId,
    roleId: "role-agent",
    subject: {
      type: input.subjectType,
      id: input.subjectId
    },
    scope: input.scope,
    startsAt: input.startsAt
  };
}

function structuralResources() {
  return [
    {
      type: "org_unit" as const,
      id: "org-sales",
      resource: {
        tenantId,
        orgUnitId: "org-sales",
        orgUnitIds: ["org-sales"]
      }
    },
    {
      type: "org_unit" as const,
      id: "org-claims",
      resource: {
        tenantId,
        orgUnitId: "org-claims",
        orgUnitIds: ["org-claims"]
      }
    },
    {
      type: "team" as const,
      id: "team-sales",
      resource: {
        tenantId,
        teamId: "team-sales",
        teamIds: ["team-sales"]
      }
    },
    {
      type: "queue" as const,
      id: "queue-claims",
      resource: {
        tenantId,
        orgUnitId: "org-claims",
        queueId: "queue-claims"
      }
    },
    {
      type: "queue" as const,
      id: "queue-existing",
      resource: {
        tenantId,
        orgUnitId: "org-sales",
        queueId: "queue-existing"
      }
    }
  ];
}
