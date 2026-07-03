import type { EmployeeId, TenantId } from "@hulee/contracts";
import type {
  DirectPermissionGrant,
  Permission,
  PermissionRoleBinding
} from "@hulee/core";
import type {
  DomainEventRepository,
  SecurityAuditRepository,
  TenantEmployeeRecord,
  TenantRbacRepository,
  TenantRoleRecord
} from "@hulee/db";
import { describe, expect, it, vi } from "vitest";

import { createInternalRbacService } from "./internal-rbac-service";

const tenantId = "tenant-1" as TenantId;
const adminEmployeeId = "employee-admin" as EmployeeId;
const targetEmployeeId = "employee-target" as EmployeeId;
const now = new Date("2026-06-24T10:00:00.000Z");

describe("internal RBAC service", () => {
  it("creates custom roles with tenant-level role management and records audit/events", async () => {
    const state = rbacState({
      roles: [role("role-admin", ["roles.manage"])],
      roleBindings: [
        binding({
          id: "binding-admin",
          roleId: "role-admin",
          employeeId: adminEmployeeId,
          scope: {
            type: "tenant"
          }
        })
      ]
    });
    const audit: Pick<SecurityAuditRepository, "record"> = {
      record: vi.fn(async () => undefined)
    };
    const events: Pick<DomainEventRepository, "append"> = {
      append: vi.fn(async () => undefined)
    };
    const service = createInternalRbacService(
      testOptions({
        state,
        audit,
        events
      })
    );

    const response = await service.createRole(context(), {
      name: " Sales ",
      description: " Sales role ",
      permissions: ["conversation.read", "message.reply"]
    });

    expect(response.role).toMatchObject({
      id: "role:tenant-1:custom:id-1",
      name: "Sales",
      description: "Sales role",
      permissions: ["conversation.read", "message.reply"]
    });
    expect(state.repository.createRoleWithPermissions).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "role:tenant-1:custom:id-1",
        tenantId,
        createdByEmployeeId: adminEmployeeId,
        isSystem: false,
        permissions: ["conversation.read", "message.reply"]
      })
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        actorEmployeeId: adminEmployeeId,
        action: "role.created",
        entityType: "role",
        entityId: "role:tenant-1:custom:id-1"
      })
    );
    expect(events.append).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        events: [
          expect.objectContaining({
            type: "role.created",
            tenantId
          })
        ]
      })
    );
  });

  it("requires tenant-level role management for full role lists", async () => {
    const state = rbacState({
      roles: [role("role-admin", ["roles.manage"])],
      roleBindings: [
        binding({
          id: "binding-admin",
          roleId: "role-admin",
          employeeId: adminEmployeeId,
          scope: {
            type: "queue",
            id: "queue-sales"
          }
        })
      ]
    });
    const service = createInternalRbacService(testOptions({ state }));

    await expect(service.listRoles(context())).rejects.toMatchObject({
      code: "permission.denied"
    });
  });

  it("creates scoped role bindings only when the actor can manage and grant that scope", async () => {
    const state = rbacState({
      roles: [
        role("role-admin", ["roles.manage", "conversation.read"]),
        role("role-agent", ["conversation.read"])
      ],
      roleBindings: [
        binding({
          id: "binding-admin",
          roleId: "role-admin",
          employeeId: adminEmployeeId,
          scope: {
            type: "queue",
            id: "queue-sales"
          }
        })
      ]
    });
    const service = createInternalRbacService(testOptions({ state }));

    await expect(
      service.createRoleBinding(context(), {
        roleId: "role-agent",
        subject: {
          type: "employee",
          id: targetEmployeeId
        },
        scope: {
          type: "queue",
          id: "queue-sales"
        }
      })
    ).resolves.toMatchObject({
      roleBinding: {
        roleId: "role-agent",
        subject: {
          id: targetEmployeeId
        },
        scope: {
          type: "queue",
          id: "queue-sales"
        }
      }
    });

    await expect(
      service.createRoleBinding(context(), {
        roleId: "role-agent",
        subject: {
          type: "employee",
          id: targetEmployeeId
        },
        scope: {
          type: "queue",
          id: "queue-claims"
        }
      })
    ).rejects.toMatchObject({
      code: "permission.denied"
    });
  });

  it("creates direct grants with validated scope, target employee, audit and event", async () => {
    const state = rbacState({
      roles: [role("role-admin", ["roles.manage"])],
      roleBindings: [
        binding({
          id: "binding-admin",
          roleId: "role-admin",
          employeeId: adminEmployeeId,
          scope: {
            type: "tenant"
          }
        })
      ]
    });
    const audit: Pick<SecurityAuditRepository, "record"> = {
      record: vi.fn(async () => undefined)
    };
    const events: Pick<DomainEventRepository, "append"> = {
      append: vi.fn(async () => undefined)
    };
    const service = createInternalRbacService(
      testOptions({
        state,
        audit,
        events
      })
    );

    const response = await service.createDirectGrant(context(), {
      employeeId: targetEmployeeId,
      permission: "conversation.assign",
      scope: {
        type: "queue",
        id: "queue-sales"
      },
      reason: " temporary coverage ",
      expiresAt: "2026-06-25T10:00:00.000Z"
    });

    expect(response.directGrant).toMatchObject({
      id: "direct_grant:tenant-1:employee-target:id-1",
      employeeId: targetEmployeeId,
      permission: "conversation.assign",
      reason: "temporary coverage",
      expiresAt: "2026-06-25T10:00:00.000Z"
    });
    expect(state.repository.createDirectGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        employeeId: targetEmployeeId,
        createdByEmployeeId: adminEmployeeId,
        permission: "conversation.assign"
      })
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "direct_grant.created",
        entityType: "direct_grant"
      })
    );
    expect(events.append).toHaveBeenCalledWith(
      expect.objectContaining({
        events: [
          expect.objectContaining({
            type: "direct_grant.created"
          })
        ]
      })
    );
  });

  it("prevents removing the current employee's own role management permission", async () => {
    const state = rbacState({
      roles: [role("role-admin", ["roles.manage"])],
      roleBindings: [
        binding({
          id: "binding-admin",
          roleId: "role-admin",
          employeeId: adminEmployeeId,
          scope: {
            type: "tenant"
          }
        })
      ]
    });
    const service = createInternalRbacService(testOptions({ state }));

    await expect(
      service.updateRole(context(), {
        roleId: "role-admin",
        request: {
          name: "Admin",
          permissions: ["conversation.read"]
        }
      })
    ).rejects.toMatchObject({
      code: "permission.denied"
    });
    expect(
      state.repository.updateCustomRoleWithPermissions
    ).not.toHaveBeenCalled();
  });
});

function testOptions(input: {
  state: ReturnType<typeof rbacState>;
  audit?: Pick<SecurityAuditRepository, "record">;
  events?: Pick<DomainEventRepository, "append">;
}) {
  const employees = new Map(
    [
      employee(adminEmployeeId),
      employee(targetEmployeeId, {
        queueIds: ["queue-sales"]
      })
    ].map((record) => [record.employeeId, record])
  );
  let nextId = 1;

  return {
    rbacRepository: input.state.repository,
    employeeRepository: {
      findEmployee: vi.fn(
        async (findInput: { tenantId: TenantId; employeeId: EmployeeId }) => {
          const found = employees.get(findInput.employeeId);

          return found?.tenantId === findInput.tenantId ? found : null;
        }
      )
    },
    orgStructureRepository: {
      listOrgUnits: vi.fn(async () => [
        {
          id: "org-sales",
          tenantId,
          parentOrgUnitId: null,
          name: "Sales",
          kind: "department" as const,
          status: "active" as const
        }
      ]),
      listTeams: vi.fn(async () => [
        {
          id: "team-sales",
          tenantId,
          name: "Sales"
        }
      ]),
      listWorkQueues: vi.fn(async () => [
        {
          id: "queue-sales",
          tenantId,
          name: "Sales",
          kind: "sales" as const,
          owningOrgUnitId: "org-sales",
          status: "active" as const,
          routingConfig: {}
        },
        {
          id: "queue-claims",
          tenantId,
          name: "Claims",
          kind: "claims" as const,
          owningOrgUnitId: "org-sales",
          status: "active" as const,
          routingConfig: {}
        }
      ])
    },
    audit: input.audit,
    events: input.events,
    now: () => now,
    idFactory: () => `id-${nextId++}`
  };
}

function context() {
  return {
    requestId: "request-1",
    tenantId,
    employeeId: adminEmployeeId
  };
}

function rbacState(input: {
  roles?: readonly TenantRoleRecord[];
  roleBindings?: readonly PermissionRoleBinding[];
  directGrants?: readonly DirectPermissionGrant[];
}) {
  const roles = [...(input.roles ?? [])];
  const roleBindings = [...(input.roleBindings ?? [])];
  const directGrants = [...(input.directGrants ?? [])];
  const repository: Pick<
    TenantRbacRepository,
    | "createRoleWithPermissions"
    | "updateCustomRoleWithPermissions"
    | "setCustomRoleStatus"
    | "createRoleBinding"
    | "revokeRoleBinding"
    | "createDirectGrant"
    | "revokeDirectGrant"
    | "listRoleDefinitions"
    | "listRoleBindings"
    | "listDirectGrants"
    | "listDirectGrantsForEmployee"
  > = {
    createRoleWithPermissions: vi.fn(async (createInput) => {
      roles.push({
        id: createInput.id,
        tenantId: createInput.tenantId,
        name: createInput.name,
        description: createInput.description ?? null,
        status: createInput.status ?? "active",
        isSystem: createInput.isSystem ?? false,
        createdByEmployeeId: createInput.createdByEmployeeId ?? null,
        permissions: createInput.permissions
      });
    }),
    updateCustomRoleWithPermissions: vi.fn(async (updateInput) => {
      const index = roles.findIndex((candidate) => {
        return (
          candidate.tenantId === updateInput.tenantId &&
          candidate.id === updateInput.roleId
        );
      });

      if (index >= 0) {
        roles[index] = {
          ...roles[index],
          name: updateInput.name,
          description: updateInput.description ?? null,
          permissions: updateInput.permissions
        };
      }
    }),
    setCustomRoleStatus: vi.fn(async (statusInput) => {
      const index = roles.findIndex((candidate) => {
        return (
          candidate.tenantId === statusInput.tenantId &&
          candidate.id === statusInput.roleId
        );
      });

      if (index >= 0) {
        roles[index] = {
          ...roles[index],
          status: statusInput.status,
          archivedAt:
            statusInput.status === "archived"
              ? statusInput.updatedAt.toISOString()
              : undefined
        };
      }
    }),
    createRoleBinding: vi.fn(async (createInput) => {
      roleBindings.push({
        id: createInput.id,
        tenantId: createInput.tenantId,
        roleId: createInput.roleId,
        subject: createInput.subject,
        scope: createInput.scope,
        startsAt: createInput.startsAt,
        expiresAt: createInput.expiresAt,
        revokedAt: createInput.revokedAt
      });
    }),
    revokeRoleBinding: vi.fn(async (revokeInput) => {
      const index = roleBindings.findIndex((candidate) => {
        return (
          candidate.tenantId === revokeInput.tenantId &&
          candidate.id === revokeInput.bindingId
        );
      });

      if (index >= 0) {
        roleBindings[index] = {
          ...roleBindings[index],
          revokedAt: revokeInput.revokedAt.toISOString()
        };
      }
    }),
    createDirectGrant: vi.fn(async (createInput) => {
      directGrants.push({
        id: createInput.id,
        tenantId: createInput.tenantId,
        employeeId: createInput.employeeId,
        permission: createInput.permission,
        scope: createInput.scope,
        reason: createInput.reason,
        startsAt: createInput.startsAt,
        expiresAt: createInput.expiresAt,
        revokedAt: createInput.revokedAt
      });
    }),
    revokeDirectGrant: vi.fn(async (revokeInput) => {
      const index = directGrants.findIndex((candidate) => {
        return (
          candidate.tenantId === revokeInput.tenantId &&
          candidate.id === revokeInput.grantId
        );
      });

      if (index >= 0) {
        directGrants[index] = {
          ...directGrants[index],
          revokedAt: revokeInput.revokedAt.toISOString()
        };
      }
    }),
    listRoleDefinitions: vi.fn(async (listInput) =>
      roles.filter((candidate) => candidate.tenantId === listInput.tenantId)
    ),
    listRoleBindings: vi.fn(async (listInput) =>
      roleBindings.filter((candidate) => {
        return (
          candidate.tenantId === listInput.tenantId &&
          isTemporalAccessActive(candidate, listInput.at)
        );
      })
    ),
    listDirectGrants: vi.fn(async (listInput) =>
      directGrants.filter((candidate) => {
        return (
          candidate.tenantId === listInput.tenantId &&
          isTemporalAccessActive(candidate, listInput.at)
        );
      })
    ),
    listDirectGrantsForEmployee: vi.fn(async (listInput) =>
      directGrants.filter((candidate) => {
        return (
          candidate.tenantId === listInput.tenantId &&
          candidate.employeeId === listInput.employeeId &&
          isTemporalAccessActive(candidate, listInput.at)
        );
      })
    )
  };

  return {
    repository,
    roles,
    roleBindings,
    directGrants
  };
}

function role(
  id: string,
  permissions: readonly Permission[],
  input?: Partial<TenantRoleRecord>
): TenantRoleRecord {
  return {
    id,
    tenantId,
    name: id,
    description: null,
    status: "active",
    isSystem: false,
    createdByEmployeeId: adminEmployeeId,
    permissions,
    ...input
  };
}

function binding(input: {
  id: string;
  roleId: string;
  employeeId: EmployeeId;
  scope: PermissionRoleBinding["scope"];
}): PermissionRoleBinding {
  return {
    id: input.id,
    tenantId,
    roleId: input.roleId,
    subject: {
      type: "employee",
      id: input.employeeId
    },
    scope: input.scope
  };
}

function employee(
  employeeId: EmployeeId,
  input?: {
    teamIds?: readonly string[];
    orgUnitIds?: readonly string[];
    queueIds?: readonly string[];
    deactivatedAt?: Date | null;
  }
): TenantEmployeeRecord {
  return {
    tenantId,
    employeeId,
    accountId: null,
    email: `${employeeId}@example.test`,
    displayName: String(employeeId),
    phoneNumber: null,
    avatarUrl: null,
    avatar: null,
    systemRoleTemplateIds: [],
    teamIds: input?.teamIds ?? [],
    orgUnitIds: input?.orgUnitIds ?? [],
    queueIds: input?.queueIds ?? [],
    createdAt: now,
    deactivatedAt: input?.deactivatedAt ?? null
  };
}

function isTemporalAccessActive(
  input: { startsAt?: string; expiresAt?: string; revokedAt?: string },
  at: Date
): boolean {
  if (input.revokedAt) {
    return false;
  }

  if (input.startsAt && Date.parse(input.startsAt) > at.getTime()) {
    return false;
  }

  return !(input.expiresAt && Date.parse(input.expiresAt) <= at.getTime());
}
