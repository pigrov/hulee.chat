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
        entityId: "role:tenant-1:custom:id-1",
        metadata: expect.objectContaining({
          authorizationScopes: [{ type: "tenant" }]
        })
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
    const audit: Pick<SecurityAuditRepository, "record"> = {
      record: vi.fn(async () => undefined)
    };
    const service = createInternalRbacService(testOptions({ state, audit }));

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
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "role_binding.created",
        metadata: expect.objectContaining({
          authorizationScopes: [
            { type: "org_unit", id: "org-sales" },
            { type: "queue", id: "queue-sales" }
          ]
        })
      })
    );

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

  it("audits the union of cross-scope binding subject and destination resources", async () => {
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
          scope: { type: "tenant" }
        })
      ]
    });
    const audit = auditSpy();
    const service = createInternalRbacService(testOptions({ state, audit }));

    await service.createRoleBinding(context(), {
      roleId: "role-agent",
      subject: { type: "team", id: "team-sales" },
      scope: { type: "queue", id: "queue-claims" }
    });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "role_binding.created",
        metadata: expect.objectContaining({
          subjectType: "team",
          subjectId: "team-sales",
          scopeType: "queue",
          scopeId: "queue-claims",
          authorizationScopes: [
            { type: "org_unit", id: "org-sales" },
            { type: "team", id: "team-sales" },
            { type: "queue", id: "queue-claims" }
          ]
        })
      })
    );
  });

  it("creates direct grants with validated scope, target employee, audit and event", async () => {
    const state = rbacState({
      roles: [role("role-admin", ["roles.manage", "conversation.assign"])],
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
        entityType: "direct_grant",
        metadata: expect.objectContaining({
          authorizationScopes: [
            { type: "org_unit", id: "org-sales" },
            { type: "queue", id: "queue-sales" }
          ]
        })
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

  it("deduplicates future direct grants without exposing them in the active administration list", async () => {
    const futureGrant: DirectPermissionGrant = {
      id: "grant-future",
      tenantId,
      employeeId: targetEmployeeId,
      permission: "conversation.assign",
      scope: { type: "queue", id: "queue-sales" },
      reason: "scheduled coverage",
      startsAt: "2026-07-01T10:00:00.000Z"
    };
    const state = rbacState({
      roles: [role("role-admin", ["roles.manage", "conversation.assign"])],
      roleBindings: [
        binding({
          id: "binding-admin",
          roleId: "role-admin",
          employeeId: adminEmployeeId,
          scope: { type: "tenant" }
        })
      ],
      directGrants: [futureGrant]
    });
    const audit = auditSpy();
    const events = eventSpy();
    const service = createInternalRbacService(
      testOptions({ state, audit, events })
    );

    await expect(service.listDirectGrants(context())).resolves.toEqual({
      directGrants: []
    });
    await expect(
      service.createDirectGrant(context(), {
        employeeId: targetEmployeeId,
        permission: "conversation.assign",
        scope: { type: "queue", id: "queue-sales" },
        reason: "duplicate scheduled coverage"
      })
    ).resolves.toEqual({
      directGrant: expect.objectContaining({
        id: "grant-future",
        startsAt: "2026-07-01T10:00:00.000Z"
      })
    });

    expect(state.directGrants).toEqual([futureGrant]);
    expect(state.repository.createDirectGrant).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(events.append).not.toHaveBeenCalled();
  });

  it("revokes future direct grants through the same authorized target and scope checks", async () => {
    const state = rbacState({
      roles: [role("role-admin", ["roles.manage"])],
      roleBindings: [
        binding({
          id: "binding-admin",
          roleId: "role-admin",
          employeeId: adminEmployeeId,
          scope: { type: "tenant" }
        })
      ],
      directGrants: [
        {
          id: "grant-future",
          tenantId,
          employeeId: targetEmployeeId,
          permission: "conversation.assign",
          scope: { type: "queue", id: "queue-sales" },
          reason: "scheduled coverage",
          startsAt: "2026-07-01T10:00:00.000Z"
        }
      ]
    });
    const audit = auditSpy();
    const events = eventSpy();
    const service = createInternalRbacService(
      testOptions({ state, audit, events })
    );

    await expect(
      service.revokeDirectGrant(context(), { grantId: "grant-future" })
    ).resolves.toEqual({ revoked: true });

    expect(state.repository.revokeDirectGrant).toHaveBeenCalledWith({
      tenantId,
      grantId: "grant-future",
      revokedAt: now
    });
    expect(state.directGrants[0]?.revokedAt).toBe(now.toISOString());
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(events.append).toHaveBeenCalledTimes(1);
  });

  it("denies delegated permissions above tenant role-management authority without side effects", async () => {
    const state = rbacState({
      roles: [role("role-admin", ["roles.manage"])],
      roleBindings: [
        binding({
          id: "binding-admin",
          roleId: "role-admin",
          employeeId: adminEmployeeId,
          scope: { type: "tenant" }
        })
      ]
    });
    const audit = auditSpy();
    const events = eventSpy();
    const service = createInternalRbacService(
      testOptions({ state, audit, events })
    );

    await expect(
      service.createDirectGrant(context(), {
        employeeId: targetEmployeeId,
        permission: "conversation.assign",
        scope: { type: "queue", id: "queue-sales" },
        reason: "temporary coverage"
      })
    ).rejects.toMatchObject({ code: "permission.denied" });

    expect(state.repository.createDirectGrant).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(events.append).not.toHaveBeenCalled();
  });

  it("denies direct self-grants even when the actor already owns the delegated authority", async () => {
    const state = rbacState({
      roles: [role("role-admin", ["roles.manage", "conversation.assign"])],
      roleBindings: [
        binding({
          id: "binding-admin",
          roleId: "role-admin",
          employeeId: adminEmployeeId,
          scope: { type: "tenant" }
        })
      ]
    });
    const audit = auditSpy();
    const events = eventSpy();
    const service = createInternalRbacService(
      testOptions({ state, audit, events })
    );

    await expect(
      service.createDirectGrant(context(), {
        employeeId: adminEmployeeId,
        permission: "conversation.assign",
        scope: { type: "tenant" },
        reason: "self escalation"
      })
    ).rejects.toMatchObject({ code: "permission.denied" });

    expect(state.repository.createDirectGrant).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(events.append).not.toHaveBeenCalled();
  });

  it("denies direct and structurally self-applying role bindings without side effects", async () => {
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
          scope: { type: "tenant" }
        })
      ]
    });
    const audit = auditSpy();
    const events = eventSpy();
    const service = createInternalRbacService(
      testOptions({
        state,
        audit,
        events,
        employees: [
          employee(adminEmployeeId, { teamIds: ["team-sales"] }),
          employee(targetEmployeeId, { queueIds: ["queue-sales"] })
        ]
      })
    );

    for (const subject of [
      { type: "employee" as const, id: adminEmployeeId },
      { type: "team" as const, id: "team-sales" }
    ]) {
      await expect(
        service.createRoleBinding(context(), {
          roleId: "role-agent",
          subject,
          scope:
            subject.type === "team"
              ? { type: "team", id: "team-sales" }
              : { type: "tenant" }
        })
      ).rejects.toMatchObject({ code: "permission.denied" });
    }

    expect(state.repository.createRoleBinding).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(events.append).not.toHaveBeenCalled();
  });

  it("denies a visible binding scope when the server-loaded Employee target is outside actor scope", async () => {
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
          scope: { type: "queue", id: "queue-sales" }
        })
      ]
    });
    const audit = auditSpy();
    const events = eventSpy();
    const service = createInternalRbacService(
      testOptions({
        state,
        audit,
        events,
        employees: [
          employee(adminEmployeeId),
          employee(targetEmployeeId, { queueIds: ["queue-claims"] })
        ]
      })
    );

    await expect(
      service.createRoleBinding(context(), {
        roleId: "role-agent",
        subject: { type: "employee", id: targetEmployeeId },
        scope: { type: "queue", id: "queue-sales" }
      })
    ).rejects.toMatchObject({ code: "permission.denied" });

    expect(state.repository.createRoleBinding).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(events.append).not.toHaveBeenCalled();
  });

  it("denies revoking a binding whose server-loaded subject is outside actor scope", async () => {
    const state = rbacState({
      roles: [
        role("role-admin", ["roles.manage"]),
        role("role-agent", ["conversation.read"])
      ],
      roleBindings: [
        binding({
          id: "binding-admin",
          roleId: "role-admin",
          employeeId: adminEmployeeId,
          scope: { type: "queue", id: "queue-sales" }
        }),
        binding({
          id: "binding-hidden-target",
          roleId: "role-agent",
          employeeId: targetEmployeeId,
          scope: { type: "queue", id: "queue-sales" }
        })
      ]
    });
    const audit = auditSpy();
    const events = eventSpy();
    const service = createInternalRbacService(
      testOptions({
        state,
        audit,
        events,
        employees: [
          employee(adminEmployeeId),
          employee(targetEmployeeId, { queueIds: ["queue-claims"] })
        ]
      })
    );

    for (const bindingId of ["binding-hidden-target", "binding-missing"]) {
      await expect(
        service.revokeRoleBinding(context(), { bindingId })
      ).rejects.toMatchObject({ code: "permission.denied" });
    }

    expect(state.repository.revokeRoleBinding).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(events.append).not.toHaveBeenCalled();
  });

  it("returns the same denial for hidden and unknown direct grants without side effects", async () => {
    const state = rbacState({
      roles: [role("role-admin", ["roles.manage"])],
      roleBindings: [
        binding({
          id: "binding-admin",
          roleId: "role-admin",
          employeeId: adminEmployeeId,
          scope: { type: "queue", id: "queue-sales" }
        })
      ],
      directGrants: [
        {
          id: "grant-hidden-target",
          tenantId,
          employeeId: targetEmployeeId,
          permission: "conversation.read",
          scope: { type: "queue", id: "queue-sales" },
          reason: "coverage"
        }
      ]
    });
    const audit = auditSpy();
    const events = eventSpy();
    const service = createInternalRbacService(
      testOptions({
        state,
        audit,
        events,
        employees: [
          employee(adminEmployeeId),
          employee(targetEmployeeId, { queueIds: ["queue-claims"] })
        ]
      })
    );

    for (const grantId of ["grant-hidden-target", "grant-missing"]) {
      await expect(
        service.revokeDirectGrant(context(), { grantId })
      ).rejects.toMatchObject({ code: "permission.denied" });
    }

    expect(state.repository.revokeDirectGrant).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(events.append).not.toHaveBeenCalled();
  });

  it("denies role permission additions above the actor ceiling for every active binding", async () => {
    const state = rbacState({
      roles: [
        role("role-admin", ["roles.manage"]),
        role("role-agent", ["conversation.read"])
      ],
      roleBindings: [
        binding({
          id: "binding-admin",
          roleId: "role-admin",
          employeeId: adminEmployeeId,
          scope: { type: "tenant" }
        }),
        binding({
          id: "binding-agent",
          roleId: "role-agent",
          employeeId: targetEmployeeId,
          scope: { type: "tenant" }
        })
      ]
    });
    const audit = auditSpy();
    const events = eventSpy();
    const service = createInternalRbacService(
      testOptions({ state, audit, events })
    );

    await expect(
      service.updateRole(context(), {
        roleId: "role-agent",
        request: {
          name: "Agent",
          permissions: ["conversation.read", "tenant.manage"]
        }
      })
    ).rejects.toMatchObject({ code: "permission.denied" });

    expect(
      state.repository.updateCustomRoleWithPermissions
    ).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(events.append).not.toHaveBeenCalled();
  });

  it("rejects a role update that would make a future binding scope illegal", async () => {
    const state = rbacState({
      roles: [
        role("role-admin", ["roles.manage", "tenant.manage"]),
        role("role-agent", ["conversation.read"])
      ],
      roleBindings: [
        binding({
          id: "binding-admin",
          roleId: "role-admin",
          employeeId: adminEmployeeId,
          scope: { type: "tenant" }
        }),
        binding({
          id: "binding-agent-future",
          roleId: "role-agent",
          employeeId: targetEmployeeId,
          scope: { type: "queue", id: "queue-sales" },
          startsAt: "2026-07-01T10:00:00.000Z"
        })
      ]
    });
    const audit = auditSpy();
    const events = eventSpy();
    const service = createInternalRbacService(
      testOptions({ state, audit, events })
    );

    await expect(
      service.updateRole(context(), {
        roleId: "role-agent",
        request: {
          name: "Agent",
          permissions: ["tenant.manage"]
        }
      })
    ).rejects.toMatchObject({ code: "validation.failed" });

    expect(
      state.repository.updateCustomRoleWithPermissions
    ).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(events.append).not.toHaveBeenCalled();
  });

  it("allows a tenant role manager to add only authority the actor already owns", async () => {
    const state = rbacState({
      roles: [
        role("role-admin", ["roles.manage", "conversation.assign"]),
        role("role-agent", ["conversation.read"])
      ],
      roleBindings: [
        binding({
          id: "binding-admin",
          roleId: "role-admin",
          employeeId: adminEmployeeId,
          scope: { type: "tenant" }
        }),
        binding({
          id: "binding-agent",
          roleId: "role-agent",
          employeeId: targetEmployeeId,
          scope: { type: "queue", id: "queue-sales" }
        })
      ]
    });
    const audit = auditSpy();
    const events = eventSpy();
    const service = createInternalRbacService(
      testOptions({ state, audit, events })
    );

    await expect(
      service.updateRole(context(), {
        roleId: "role-agent",
        request: {
          name: "Agent",
          permissions: ["conversation.read", "conversation.assign"]
        }
      })
    ).resolves.toMatchObject({
      role: {
        id: "role-agent",
        permissions: ["conversation.read", "conversation.assign"]
      }
    });

    expect(
      state.repository.updateCustomRoleWithPermissions
    ).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "role.updated",
        metadata: expect.objectContaining({
          authorizationScopes: [
            { type: "tenant" },
            { type: "org_unit", id: "org-sales" },
            { type: "queue", id: "queue-sales" }
          ]
        })
      })
    );
    expect(events.append).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a role update would affect an unresolved client binding", async () => {
    const state = rbacState({
      roles: [
        role("role-admin", ["roles.manage", "client.view", "client.edit"]),
        role("role-client", ["client.view"])
      ],
      roleBindings: [
        binding({
          id: "binding-admin",
          roleId: "role-admin",
          employeeId: adminEmployeeId,
          scope: { type: "tenant" }
        }),
        binding({
          id: "binding-client",
          roleId: "role-client",
          employeeId: targetEmployeeId,
          scope: { type: "client", id: "client-unresolved" }
        })
      ]
    });
    const audit = auditSpy();
    const events = eventSpy();
    const service = createInternalRbacService(
      testOptions({ state, audit, events })
    );

    await expect(
      service.updateRole(context(), {
        roleId: "role-client",
        request: {
          name: "Client",
          permissions: ["client.view", "client.edit"]
        }
      })
    ).rejects.toMatchObject({ code: "permission.denied" });

    expect(
      state.repository.updateCustomRoleWithPermissions
    ).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(events.append).not.toHaveBeenCalled();
  });

  it("fails closed for new client scopes but allows tenant-only cleanup of an existing grant", async () => {
    const existingGrant: DirectPermissionGrant = {
      id: "grant-client",
      tenantId,
      employeeId: targetEmployeeId,
      permission: "client.view",
      scope: { type: "client", id: "client-unresolved" },
      reason: "legacy exact grant"
    };
    const state = rbacState({
      roles: [
        role("role-admin", ["roles.manage", "client.view", "conversation.read"])
      ],
      roleBindings: [
        binding({
          id: "binding-admin",
          roleId: "role-admin",
          employeeId: adminEmployeeId,
          scope: { type: "tenant" }
        })
      ],
      directGrants: [existingGrant]
    });
    const audit = auditSpy();
    const events = eventSpy();
    const service = createInternalRbacService(
      testOptions({ state, audit, events })
    );

    for (const request of [
      {
        permission: "client.view" as const,
        scope: { type: "client" as const, id: "client-unresolved" }
      },
      {
        permission: "conversation.read" as const,
        scope: {
          type: "conversation" as const,
          id: "conversation-unresolved"
        }
      }
    ]) {
      await expect(
        service.createDirectGrant(context(), {
          employeeId: targetEmployeeId,
          ...request,
          reason: "must resolve canonically"
        })
      ).rejects.toMatchObject({ code: "permission.denied" });
    }
    expect(state.repository.createDirectGrant).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(events.append).not.toHaveBeenCalled();

    await expect(
      service.revokeDirectGrant(context(), { grantId: "grant-client" })
    ).resolves.toEqual({ revoked: true });
    expect(state.repository.revokeDirectGrant).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "direct_grant.revoked",
        metadata: expect.objectContaining({
          scopeType: "client",
          scopeId: "client-unresolved",
          authorizationScopes: [
            { type: "queue", id: "queue-sales" },
            { type: "client", id: "client-unresolved" }
          ]
        })
      })
    );
    expect(events.append).toHaveBeenCalledTimes(1);
  });

  it("fails closed for new client and conversation role bindings without canonical loaders", async () => {
    const state = rbacState({
      roles: [
        role("role-admin", [
          "roles.manage",
          "client.view",
          "conversation.read"
        ]),
        role("role-client", ["client.view"]),
        role("role-conversation", ["conversation.read"])
      ],
      roleBindings: [
        binding({
          id: "binding-admin",
          roleId: "role-admin",
          employeeId: adminEmployeeId,
          scope: { type: "tenant" }
        })
      ]
    });
    const audit = auditSpy();
    const events = eventSpy();
    const service = createInternalRbacService(
      testOptions({ state, audit, events })
    );

    for (const request of [
      {
        roleId: "role-client",
        scope: { type: "client" as const, id: "client-unresolved" }
      },
      {
        roleId: "role-conversation",
        scope: {
          type: "conversation" as const,
          id: "conversation-unresolved"
        }
      }
    ]) {
      await expect(
        service.createRoleBinding(context(), {
          roleId: request.roleId,
          subject: { type: "employee", id: targetEmployeeId },
          scope: request.scope
        })
      ).rejects.toMatchObject({ code: "permission.denied" });
    }

    expect(state.repository.createRoleBinding).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(events.append).not.toHaveBeenCalled();
  });

  it("preserves tenant role management received through an actor team binding", async () => {
    const state = rbacState({
      roles: [role("role-admin", ["roles.manage"])],
      roleBindings: [
        binding({
          id: "binding-admin-team",
          roleId: "role-admin",
          subject: { type: "team", id: "team-sales" },
          scope: { type: "tenant" }
        })
      ]
    });
    const audit = auditSpy();
    const events = eventSpy();
    const service = createInternalRbacService(
      testOptions({
        state,
        audit,
        events,
        employees: [
          employee(adminEmployeeId, { teamIds: ["team-sales"] }),
          employee(targetEmployeeId, { queueIds: ["queue-sales"] })
        ]
      })
    );

    await expect(
      service.updateRole(context(), {
        roleId: "role-admin",
        request: {
          name: "Admin",
          permissions: ["conversation.read"]
        }
      })
    ).rejects.toMatchObject({ code: "permission.denied" });

    expect(
      state.repository.updateCustomRoleWithPermissions
    ).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(events.append).not.toHaveBeenCalled();
  });

  it("audits future binding facets when archiving a role", async () => {
    const state = rbacState({
      roles: [
        role("role-admin", ["roles.manage"]),
        role("role-agent", ["conversation.read"])
      ],
      roleBindings: [
        binding({
          id: "binding-admin",
          roleId: "role-admin",
          employeeId: adminEmployeeId,
          scope: { type: "tenant" }
        }),
        binding({
          id: "binding-agent-future",
          roleId: "role-agent",
          employeeId: targetEmployeeId,
          scope: { type: "queue", id: "queue-sales" },
          startsAt: "2026-07-01T10:00:00.000Z"
        })
      ]
    });
    const audit = auditSpy();
    const service = createInternalRbacService(testOptions({ state, audit }));

    await expect(
      service.archiveRole(context(), { roleId: "role-agent" })
    ).resolves.toMatchObject({
      role: { id: "role-agent", status: "archived" }
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "role.archived",
        metadata: expect.objectContaining({
          authorizationScopes: [
            { type: "tenant" },
            { type: "org_unit", id: "org-sales" },
            { type: "queue", id: "queue-sales" }
          ]
        })
      })
    );
  });

  it("restores an archived role only when every future binding stays within the actor ceiling", async () => {
    const state = rbacState({
      roles: [
        role("role-admin", ["roles.manage", "conversation.assign"]),
        role("role-agent", ["conversation.assign"], {
          status: "archived",
          archivedAt: "2026-06-23T10:00:00.000Z"
        })
      ],
      roleBindings: [
        binding({
          id: "binding-admin",
          roleId: "role-admin",
          employeeId: adminEmployeeId,
          scope: { type: "tenant" }
        }),
        binding({
          id: "binding-agent-future",
          roleId: "role-agent",
          employeeId: targetEmployeeId,
          scope: { type: "queue", id: "queue-sales" },
          startsAt: "2026-07-01T10:00:00.000Z"
        })
      ]
    });
    const audit = auditSpy();
    const events = eventSpy();
    const service = createInternalRbacService(
      testOptions({ state, audit, events })
    );

    await expect(
      service.restoreRole(context(), { roleId: "role-agent" })
    ).resolves.toMatchObject({
      role: { id: "role-agent", status: "active" }
    });
    expect(state.repository.setCustomRoleStatus).toHaveBeenCalledOnce();
    expect(audit.record).toHaveBeenCalledOnce();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "role.restored",
        metadata: expect.objectContaining({
          authorizationScopes: [
            { type: "tenant" },
            { type: "org_unit", id: "org-sales" },
            { type: "queue", id: "queue-sales" }
          ]
        })
      })
    );
    expect(events.append).toHaveBeenCalledOnce();
  });

  it("denies restoring authority above the actor ceiling through a future binding", async () => {
    const state = rbacState({
      roles: [
        role("role-admin", ["roles.manage"]),
        role("role-agent", ["conversation.assign"], {
          status: "archived",
          archivedAt: "2026-06-23T10:00:00.000Z"
        })
      ],
      roleBindings: [
        binding({
          id: "binding-admin",
          roleId: "role-admin",
          employeeId: adminEmployeeId,
          scope: { type: "tenant" }
        }),
        binding({
          id: "binding-agent-future",
          roleId: "role-agent",
          employeeId: targetEmployeeId,
          scope: { type: "queue", id: "queue-sales" },
          startsAt: "2026-07-01T10:00:00.000Z"
        })
      ]
    });
    const audit = auditSpy();
    const events = eventSpy();
    const service = createInternalRbacService(
      testOptions({ state, audit, events })
    );

    await expect(
      service.restoreRole(context(), { roleId: "role-agent" })
    ).rejects.toMatchObject({ code: "permission.denied" });
    expect(state.repository.setCustomRoleStatus).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(events.append).not.toHaveBeenCalled();
  });

  it("denies restoring a role through a group binding that applies to the actor", async () => {
    const state = rbacState({
      roles: [
        role("role-admin", ["roles.manage", "conversation.assign"]),
        role("role-agent", ["conversation.assign"], {
          status: "archived",
          archivedAt: "2026-06-23T10:00:00.000Z"
        })
      ],
      roleBindings: [
        binding({
          id: "binding-admin",
          roleId: "role-admin",
          employeeId: adminEmployeeId,
          scope: { type: "tenant" }
        }),
        binding({
          id: "binding-agent-team",
          roleId: "role-agent",
          subject: { type: "team", id: "team-sales" },
          scope: { type: "queue", id: "queue-sales" }
        })
      ]
    });
    const audit = auditSpy();
    const events = eventSpy();
    const service = createInternalRbacService(
      testOptions({
        state,
        audit,
        events,
        employees: [
          employee(adminEmployeeId, { teamIds: ["team-sales"] }),
          employee(targetEmployeeId)
        ]
      })
    );

    await expect(
      service.restoreRole(context(), { roleId: "role-agent" })
    ).rejects.toMatchObject({ code: "permission.denied" });
    expect(state.repository.setCustomRoleStatus).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(events.append).not.toHaveBeenCalled();
  });

  it.each(["employee", "team"] as const)(
    "denies extending temporary authority through a self-applying %s binding",
    async (subjectType) => {
      const state = rbacState({
        roles: [
          role("role-admin", ["roles.manage"]),
          role("role-agent", ["conversation.read"])
        ],
        roleBindings: [
          binding({
            id: "binding-admin",
            roleId: "role-admin",
            employeeId: adminEmployeeId,
            scope: { type: "tenant" }
          }),
          binding({
            id: "binding-agent-self",
            roleId: "role-agent",
            subject:
              subjectType === "employee"
                ? { type: "employee", id: adminEmployeeId }
                : { type: "team", id: "team-sales" },
            scope: { type: "queue", id: "queue-sales" }
          })
        ],
        directGrants: [
          {
            id: "grant-temporary",
            tenantId,
            employeeId: adminEmployeeId,
            permission: "conversation.assign",
            scope: { type: "tenant" },
            reason: "temporary authority",
            expiresAt: "2026-06-25T10:00:00.000Z"
          }
        ]
      });
      const audit = auditSpy();
      const events = eventSpy();
      const service = createInternalRbacService(
        testOptions({
          state,
          audit,
          events,
          employees: [
            employee(adminEmployeeId, {
              teamIds: subjectType === "team" ? ["team-sales"] : []
            }),
            employee(targetEmployeeId)
          ]
        })
      );

      await expect(
        service.updateRole(context(), {
          roleId: "role-agent",
          request: {
            name: "Agent",
            permissions: ["conversation.read", "conversation.assign"]
          }
        })
      ).rejects.toMatchObject({ code: "permission.denied" });
      expect(
        state.repository.updateCustomRoleWithPermissions
      ).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(events.append).not.toHaveBeenCalled();
    }
  );

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
  employees?: readonly TenantEmployeeRecord[];
}) {
  const employees = new Map(
    (
      input.employees ?? [
        employee(adminEmployeeId),
        employee(targetEmployeeId, {
          queueIds: ["queue-sales"]
        })
      ]
    ).map((record) => [record.employeeId, record])
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
    | "listCurrentAndScheduledRoleBindings"
    | "listDirectGrants"
    | "listCurrentAndScheduledDirectGrants"
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
    listCurrentAndScheduledRoleBindings: vi.fn(async (listInput) =>
      roleBindings.filter((candidate) => {
        return (
          candidate.tenantId === listInput.tenantId &&
          candidate.revokedAt === undefined &&
          (candidate.expiresAt === undefined ||
            Date.parse(candidate.expiresAt) > listInput.at.getTime())
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
    listCurrentAndScheduledDirectGrants: vi.fn(async (listInput) =>
      directGrants.filter((candidate) => {
        return (
          candidate.tenantId === listInput.tenantId &&
          candidate.revokedAt === undefined &&
          (candidate.expiresAt === undefined ||
            Date.parse(candidate.expiresAt) > listInput.at.getTime())
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
  employeeId?: EmployeeId;
  subject?: PermissionRoleBinding["subject"];
  scope: PermissionRoleBinding["scope"];
  startsAt?: string;
  expiresAt?: string;
  revokedAt?: string;
}): PermissionRoleBinding {
  const subject =
    input.subject ??
    (input.employeeId === undefined
      ? undefined
      : { type: "employee" as const, id: input.employeeId });

  if (subject === undefined) {
    throw new Error("Binding fixture requires a subject.");
  }

  return {
    id: input.id,
    tenantId,
    roleId: input.roleId,
    subject,
    scope: input.scope,
    startsAt: input.startsAt,
    expiresAt: input.expiresAt,
    revokedAt: input.revokedAt
  };
}

function auditSpy(): Pick<SecurityAuditRepository, "record"> {
  return {
    record: vi.fn(async () => undefined)
  };
}

function eventSpy(): Pick<DomainEventRepository, "append"> {
  return {
    append: vi.fn(async () => undefined)
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
