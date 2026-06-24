import type {
  ClientId,
  ConversationId,
  EmployeeId,
  TenantId
} from "@hulee/contracts";
import { describe, expect, it } from "vitest";

import {
  assertCanAccess,
  can,
  canAccess,
  resolveEffectivePermissionGrants,
  type DirectPermissionGrant,
  type EffectivePermissionGrant,
  type PermissionActor,
  type PermissionResourceContext,
  type PermissionRoleBinding,
  type PermissionRoleDefinition
} from "./access-control";
import { CoreError } from "./errors";
import type { Permission, PermissionScope } from "./permissions";

const tenantId = "tenant-1" as TenantId;
const otherTenantId = "tenant-2" as TenantId;
const employeeId = "employee-1" as EmployeeId;
const otherEmployeeId = "employee-2" as EmployeeId;

const actor: PermissionActor = {
  tenantId,
  employeeId,
  roles: [],
  orgUnitIds: ["org-sales"],
  queueIds: ["queue-sales"],
  teamIds: ["team-sales"]
};

describe("access-control", () => {
  it("resolves fixed role permissions as tenant-scoped grants", () => {
    const grants = resolveEffectivePermissionGrants({
      actor: {
        ...actor,
        roles: ["agent"]
      }
    });

    expect(
      grants.some(
        (grant) =>
          grant.permission === "message.reply" && grant.scope.type === "tenant"
      )
    ).toBe(true);
  });

  it("resolves queue role bindings through actor queue membership", () => {
    const role: PermissionRoleDefinition = {
      id: "role-queue-sales",
      tenantId,
      permissions: ["inbox.read"]
    };

    const grants = resolveEffectivePermissionGrants({
      actor,
      roles: [role],
      roleBindings: [
        {
          tenantId,
          roleId: role.id,
          subject: {
            type: "queue",
            id: "queue-sales"
          },
          scope: {
            type: "queue",
            id: "queue-sales"
          }
        },
        {
          tenantId,
          roleId: role.id,
          subject: {
            type: "queue",
            id: "queue-claims"
          },
          scope: {
            type: "queue",
            id: "queue-claims"
          }
        }
      ]
    });

    expect(grants).toHaveLength(1);
    expect(grants[0]?.scope).toEqual({
      type: "queue",
      id: "queue-sales"
    });
  });

  it("deduplicates role binding and direct grants with the same scope", () => {
    const role: PermissionRoleDefinition = {
      id: "role-sales",
      tenantId,
      permissions: ["conversation.read"]
    };
    const binding: PermissionRoleBinding = {
      id: "binding-1",
      tenantId,
      roleId: role.id,
      subject: {
        type: "employee",
        id: employeeId
      },
      scope: {
        type: "queue",
        id: "queue-sales"
      }
    };
    const directGrant: DirectPermissionGrant = {
      id: "grant-1",
      tenantId,
      employeeId,
      permission: "conversation.read",
      scope: {
        type: "queue",
        id: "queue-sales"
      },
      reason: "temporary coverage"
    };

    const grants = resolveEffectivePermissionGrants({
      actor,
      roles: [role],
      roleBindings: [binding],
      directGrants: [directGrant]
    });

    expect(grants).toHaveLength(1);
    expect(grants[0]?.sources).toEqual([
      {
        type: "role_binding",
        roleId: "role-sales",
        bindingId: "binding-1"
      },
      {
        type: "direct_grant",
        grantId: "grant-1",
        reason: "temporary coverage"
      }
    ]);
  });

  it("ignores expired, future, revoked and archived access sources", () => {
    const role: PermissionRoleDefinition = {
      id: "role-archived",
      tenantId,
      permissions: ["message.reply"],
      status: "archived"
    };
    const directGrants: readonly DirectPermissionGrant[] = [
      directGrant({
        id: "expired",
        scope: {
          type: "client",
          id: "client-expired"
        },
        expiresAt: "2026-06-23T09:00:00.000Z"
      }),
      directGrant({
        id: "future",
        scope: {
          type: "client",
          id: "client-future"
        },
        startsAt: "2026-06-23T11:00:00.000Z"
      }),
      directGrant({
        id: "revoked",
        scope: {
          type: "client",
          id: "client-revoked"
        },
        revokedAt: "2026-06-23T09:30:00.000Z"
      }),
      directGrant({
        id: "active",
        scope: {
          type: "client",
          id: "client-active"
        }
      })
    ];

    const grants = resolveEffectivePermissionGrants({
      actor,
      roles: [role],
      roleBindings: [
        {
          tenantId,
          roleId: role.id,
          subject: {
            type: "employee",
            id: employeeId
          },
          scope: {
            type: "tenant"
          }
        }
      ],
      directGrants,
      at: "2026-06-23T10:00:00.000Z"
    });

    expect(grants).toHaveLength(1);
    expect(grants[0]?.scope).toEqual({
      type: "client",
      id: "client-active"
    });
  });

  it("rejects cross-tenant and invalid scoped grant data", () => {
    expect(() =>
      resolveEffectivePermissionGrants({
        actor,
        directGrants: [
          directGrant({
            tenantId: otherTenantId
          })
        ]
      })
    ).toThrow(new CoreError("tenant.boundary_violation"));

    expect(() =>
      resolveEffectivePermissionGrants({
        actor,
        directGrants: [
          directGrant({
            permission: "roles.manage",
            scope: {
              type: "queue",
              id: "queue-sales"
            }
          })
        ]
      })
    ).toThrow(new CoreError("validation.failed"));
  });

  it("allows access for every supported scope type", () => {
    const cases: readonly ScopeCase[] = [
      {
        name: "tenant",
        permission: "tenant.manage",
        scope: {
          type: "tenant"
        },
        resource: {}
      },
      {
        name: "org_unit",
        permission: "employees.manage",
        scope: {
          type: "org_unit",
          id: "org-sales"
        },
        resource: {
          orgUnitIds: ["org-sales"]
        }
      },
      {
        name: "team",
        permission: "employees.manage",
        scope: {
          type: "team",
          id: "team-sales"
        },
        resource: {
          teamId: "team-sales"
        }
      },
      {
        name: "queue",
        permission: "inbox.read",
        scope: {
          type: "queue",
          id: "queue-sales"
        },
        resource: {
          queueId: "queue-sales"
        }
      },
      {
        name: "assigned",
        permission: "message.reply",
        scope: {
          type: "assigned"
        },
        resource: {
          assignedEmployeeId: employeeId
        }
      },
      {
        name: "own",
        permission: "client.view",
        scope: {
          type: "own"
        },
        resource: {
          ownerEmployeeId: employeeId
        }
      },
      {
        name: "client",
        permission: "client.view",
        scope: {
          type: "client",
          id: "client-1"
        },
        resource: {
          clientId: "client-1" as ClientId
        }
      },
      {
        name: "conversation",
        permission: "conversation.read",
        scope: {
          type: "conversation",
          id: "conversation-1"
        },
        resource: {
          conversationId: "conversation-1" as ConversationId
        }
      }
    ];

    for (const scopeCase of cases) {
      expect(
        canAccess({
          actor,
          permission: scopeCase.permission,
          resource: resource(scopeCase.resource),
          effectiveGrants: [
            effectiveGrant(scopeCase.permission, scopeCase.scope)
          ]
        }),
        scopeCase.name
      ).toMatchObject({
        allowed: true,
        reason: "allowed"
      });
    }
  });

  it("allows assigned scope through team assignment", () => {
    expect(
      canAccess({
        actor,
        permission: "message.reply",
        resource: resource({
          assignedTeamIds: ["team-sales"]
        }),
        effectiveGrants: [
          effectiveGrant("message.reply", {
            type: "assigned"
          })
        ]
      }).allowed
    ).toBe(true);
  });

  it("returns safe denial reasons for missing permission and scope mismatch", () => {
    expect(
      can({
        actor,
        permission: "message.reply",
        resource: resource({
          queueId: "queue-sales"
        }),
        effectiveGrants: []
      })
    ).toMatchObject({
      allowed: false,
      reason: "missing_permission"
    });

    expect(
      canAccess({
        actor,
        permission: "message.reply",
        resource: resource({
          queueId: "queue-claims"
        }),
        effectiveGrants: [
          effectiveGrant("message.reply", {
            type: "queue",
            id: "queue-sales"
          })
        ]
      })
    ).toMatchObject({
      allowed: false,
      reason: "scope_mismatch"
    });
  });

  it("requires tenant context and protects tenant boundary", () => {
    expect(() =>
      canAccess({
        actor,
        permission: "message.reply",
        resource: {} as PermissionResourceContext,
        effectiveGrants: []
      })
    ).toThrow(new CoreError("validation.failed"));

    expect(() =>
      canAccess({
        actor,
        permission: "message.reply",
        resource: {
          tenantId: otherTenantId
        },
        effectiveGrants: []
      })
    ).toThrow(new CoreError("tenant.boundary_violation"));
  });

  it("throws permission denied from assertCanAccess", () => {
    expect(() =>
      assertCanAccess({
        actor,
        permission: "message.reply",
        resource: resource({
          assignedEmployeeId: otherEmployeeId
        }),
        effectiveGrants: [
          effectiveGrant("message.reply", {
            type: "assigned"
          })
        ]
      })
    ).toThrow(new CoreError("permission.denied"));
  });
});

type ScopeCase = {
  readonly name: string;
  readonly permission: Permission;
  readonly scope: PermissionScope;
  readonly resource: Partial<PermissionResourceContext>;
};

function directGrant(
  overrides: Partial<DirectPermissionGrant> = {}
): DirectPermissionGrant {
  return {
    tenantId,
    employeeId,
    permission: "client.view",
    scope: {
      type: "client",
      id: "client-1"
    },
    reason: "test grant",
    ...overrides
  };
}

function effectiveGrant(
  permission: Permission,
  scope: PermissionScope
): EffectivePermissionGrant {
  return {
    tenantId,
    employeeId,
    permission,
    scope,
    sources: [
      {
        type: "direct_grant",
        grantId: "grant-1",
        reason: "test grant"
      }
    ]
  };
}

function resource(
  overrides: Partial<PermissionResourceContext> = {}
): PermissionResourceContext {
  return {
    tenantId,
    ...overrides
  };
}
