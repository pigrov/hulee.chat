import type { EmployeeId, TenantId } from "@hulee/contracts";
import type {
  DirectPermissionGrant,
  Permission,
  PermissionActor,
  PermissionRoleBinding,
  PermissionRoleDefinition,
  SystemRoleTemplateId
} from "@hulee/core";
import type { TenantEmployeeRecord } from "@hulee/db";
import { describe, expect, it, vi } from "vitest";

import { createInternalAccessDecisionService } from "./internal-access-decision-service";

const tenantId = "tenant-1" as TenantId;
const adminEmployeeId = "employee-admin" as EmployeeId;
const targetEmployeeId = "employee-target" as EmployeeId;
const now = new Date("2026-06-24T10:00:00.000Z");

describe("internal access decision service", () => {
  it("allows an admin to inspect an allowed target decision", async () => {
    const service = createInternalAccessDecisionService(
      testOptions({
        employees: [
          employee({ employeeId: adminEmployeeId }),
          employee({ employeeId: targetEmployeeId })
        ],
        sourcesByEmployeeId: {
          [adminEmployeeId]: sources({
            roles: [role("role-admin", ["roles.manage"])],
            roleBindings: [
              binding({
                id: "binding-admin",
                roleId: "role-admin",
                employeeId: adminEmployeeId,
                scope: { type: "tenant" }
              })
            ]
          }),
          [targetEmployeeId]: sources({
            roles: [role("role-agent", ["conversation.read"])],
            roleBindings: [
              binding({
                id: "binding-agent",
                roleId: "role-agent",
                employeeId: targetEmployeeId,
                scope: { type: "assigned" }
              })
            ]
          })
        }
      })
    );

    await expect(
      service.inspectAccessDecision(context(), {
        employeeId: targetEmployeeId,
        permission: "conversation.read",
        resource: {
          assignedEmployeeId: targetEmployeeId,
          queueId: "queue-sales"
        }
      })
    ).resolves.toEqual({
      employeeId: targetEmployeeId,
      permission: "conversation.read",
      resource: {
        assignedEmployeeId: targetEmployeeId,
        queueId: "queue-sales"
      },
      evaluatedAt: "2026-06-24T10:00:00.000Z",
      decision: {
        allowed: true,
        reason: "allowed",
        matchedGrant: {
          permission: "conversation.read",
          scope: {
            type: "assigned"
          },
          sources: [
            {
              type: "role_binding",
              roleId: "role-agent",
              bindingId: "binding-agent"
            }
          ]
        }
      },
      candidateGrants: [
        {
          permission: "conversation.read",
          scope: {
            type: "assigned"
          },
          sources: [
            {
              type: "role_binding",
              roleId: "role-agent",
              bindingId: "binding-agent"
            }
          ]
        }
      ],
      effectiveGrantCount: 1
    });
  });

  it("reports scope mismatch with same-permission candidate grants", async () => {
    const service = createInternalAccessDecisionService(
      testOptions({
        employees: [
          employee({ employeeId: adminEmployeeId }),
          employee({ employeeId: targetEmployeeId })
        ],
        sourcesByEmployeeId: {
          [adminEmployeeId]: sources({
            roles: [role("role-admin", ["roles.manage"])],
            roleBindings: [
              binding({
                id: "binding-admin",
                roleId: "role-admin",
                employeeId: adminEmployeeId,
                scope: { type: "tenant" }
              })
            ]
          }),
          [targetEmployeeId]: sources({
            roles: [role("role-claims", ["conversation.read"])],
            roleBindings: [
              binding({
                id: "binding-claims",
                roleId: "role-claims",
                employeeId: targetEmployeeId,
                scope: {
                  type: "queue",
                  id: "queue-claims"
                }
              })
            ]
          })
        }
      })
    );
    const response = await service.inspectAccessDecision(context(), {
      employeeId: targetEmployeeId,
      permission: "conversation.read",
      resource: {
        queueId: "queue-sales"
      }
    });

    expect(response.decision).toEqual({
      allowed: false,
      reason: "scope_mismatch",
      matchedGrant: undefined
    });
    expect(response.candidateGrants).toEqual([
      {
        permission: "conversation.read",
        scope: {
          type: "queue",
          id: "queue-claims"
        },
        sources: [
          {
            type: "role_binding",
            roleId: "role-claims",
            bindingId: "binding-claims"
          }
        ]
      }
    ]);
    expect(response.effectiveGrantCount).toBe(1);
  });

  it("filters scoped diagnostics to grants relevant to the authorized resource", async () => {
    const service = createInternalAccessDecisionService(
      testOptions({
        employees: [
          employee({
            employeeId: adminEmployeeId,
            queueIds: ["queue-sales"]
          }),
          employee({
            employeeId: targetEmployeeId,
            queueIds: ["queue-sales", "queue-claims"]
          })
        ],
        sourcesByEmployeeId: {
          [adminEmployeeId]: sources({
            roles: [role("role-manager", ["roles.manage"])],
            roleBindings: [
              binding({
                id: "binding-manager",
                roleId: "role-manager",
                employeeId: adminEmployeeId,
                scope: { type: "queue", id: "queue-sales" }
              })
            ]
          }),
          [targetEmployeeId]: sources({
            roles: [role("role-reader", ["conversation.read"])],
            roleBindings: [
              binding({
                id: "binding-sales",
                roleId: "role-reader",
                employeeId: targetEmployeeId,
                scope: { type: "queue", id: "queue-sales" }
              }),
              binding({
                id: "binding-claims",
                roleId: "role-reader",
                employeeId: targetEmployeeId,
                scope: { type: "queue", id: "queue-claims" }
              })
            ]
          })
        }
      })
    );

    const response = await service.inspectAccessDecision(context(), {
      employeeId: targetEmployeeId,
      permission: "conversation.read",
      resource: { queueId: "queue-sales" }
    });

    expect(response.decision.allowed).toBe(true);
    expect(response.candidateGrants).toEqual([
      {
        permission: "conversation.read",
        scope: { type: "queue", id: "queue-sales" },
        sources: [
          {
            type: "role_binding",
            roleId: "role-reader",
            bindingId: "binding-sales"
          }
        ]
      }
    ]);
    expect(response.effectiveGrantCount).toBe(1);
  });

  it.each([
    {
      label: "a mixed structural resource",
      resource: { queueId: "queue-sales", orgUnitId: "org-claims" }
    },
    {
      label: "a structural anchor combined with an exact conversation",
      resource: {
        queueId: "queue-sales",
        conversationId: "conversation-secret"
      }
    },
    {
      label: "a structural anchor combined with dynamic assignment",
      resource: {
        queueId: "queue-sales",
        assignedEmployeeId: targetEmployeeId
      }
    },
    {
      label: "multiple IDs in one structural dimension",
      resource: { queueId: "queue-sales", teamIds: ["team-secret"] }
    }
  ])("fails closed for scoped inspection of $label", async ({ resource }) => {
    const listEffectiveAccessSources = vi.fn(
      async (input: { actor: PermissionActor }) =>
        input.actor.employeeId === adminEmployeeId
          ? sources({
              roles: [role("role-manager", ["roles.manage"])],
              roleBindings: [
                binding({
                  id: "binding-manager",
                  roleId: "role-manager",
                  employeeId: adminEmployeeId,
                  scope: { type: "queue", id: "queue-sales" }
                })
              ]
            })
          : sources({
              roles: [role("role-reader", ["conversation.read"])],
              roleBindings: [
                binding({
                  id: "binding-secret",
                  roleId: "role-reader",
                  employeeId: targetEmployeeId,
                  scope: {
                    type: "conversation",
                    id: "conversation-secret"
                  }
                })
              ]
            })
    );
    const service = createInternalAccessDecisionService({
      employeeRepository: {
        async findEmployee(input) {
          return input.employeeId === adminEmployeeId
            ? employee({
                employeeId: adminEmployeeId,
                queueIds: ["queue-sales"]
              })
            : employee({
                employeeId: targetEmployeeId,
                queueIds: ["queue-sales"]
              });
        }
      },
      rbacRepository: { listEffectiveAccessSources },
      now: () => now
    });

    await expect(
      service.inspectAccessDecision(context(), {
        employeeId: targetEmployeeId,
        permission: "conversation.read",
        resource
      })
    ).rejects.toMatchObject({ code: "permission.denied" });
    expect(listEffectiveAccessSources).toHaveBeenCalledTimes(1);
  });

  it("denies a scoped requester before loading grants for an unrelated target", async () => {
    const listEffectiveAccessSources = vi.fn(
      async (input: { actor: PermissionActor }) =>
        input.actor.employeeId === adminEmployeeId
          ? sources({
              roles: [role("role-manager", ["roles.manage"])],
              roleBindings: [
                binding({
                  id: "binding-manager",
                  roleId: "role-manager",
                  employeeId: adminEmployeeId,
                  scope: { type: "queue", id: "queue-sales" }
                })
              ]
            })
          : sources({
              roles: [role("role-reader", ["conversation.read"])],
              roleBindings: [
                binding({
                  id: "binding-reader",
                  roleId: "role-reader",
                  employeeId: targetEmployeeId,
                  scope: { type: "queue", id: "queue-claims" }
                })
              ]
            })
    );
    const service = createInternalAccessDecisionService({
      employeeRepository: {
        async findEmployee(input) {
          return input.employeeId === adminEmployeeId
            ? employee({
                employeeId: adminEmployeeId,
                queueIds: ["queue-sales"]
              })
            : employee({
                employeeId: targetEmployeeId,
                queueIds: ["queue-claims"]
              });
        }
      },
      rbacRepository: { listEffectiveAccessSources },
      now: () => now
    });

    await expect(
      service.inspectAccessDecision(context(), {
        employeeId: targetEmployeeId,
        permission: "conversation.read",
        resource: { queueId: "queue-sales" }
      })
    ).rejects.toMatchObject({ code: "permission.denied" });
    expect(listEffectiveAccessSources).toHaveBeenCalledTimes(1);
    expect(listEffectiveAccessSources).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({ employeeId: adminEmployeeId })
      })
    );
  });

  it("never revives expired requester authority for a historical target evaluation", async () => {
    const listEffectiveAccessSources = vi.fn(
      async (input: { actor: PermissionActor }) =>
        input.actor.employeeId === adminEmployeeId
          ? sources({
              roles: [role("role-expired-manager", ["roles.manage"])],
              roleBindings: [
                {
                  ...binding({
                    id: "binding-expired-manager",
                    roleId: "role-expired-manager",
                    employeeId: adminEmployeeId,
                    scope: { type: "tenant" }
                  }),
                  expiresAt: "2026-06-24T09:00:00.000Z"
                }
              ]
            })
          : sources({
              roles: [role("role-reader", ["conversation.read"])],
              roleBindings: [
                binding({
                  id: "binding-reader",
                  roleId: "role-reader",
                  employeeId: targetEmployeeId,
                  scope: { type: "tenant" }
                })
              ]
            })
    );
    const service = createInternalAccessDecisionService({
      employeeRepository: {
        async findEmployee(input) {
          return input.employeeId === adminEmployeeId
            ? employee({ employeeId: adminEmployeeId })
            : employee({ employeeId: targetEmployeeId });
        }
      },
      rbacRepository: { listEffectiveAccessSources },
      now: () => now
    });

    await expect(
      service.inspectAccessDecision(context(), {
        employeeId: targetEmployeeId,
        permission: "conversation.read",
        resource: {},
        at: "2026-06-24T08:00:00.000Z"
      })
    ).rejects.toMatchObject({ code: "permission.denied" });
    expect(listEffectiveAccessSources).toHaveBeenCalledTimes(1);
    expect(listEffectiveAccessSources).toHaveBeenCalledWith(
      expect.objectContaining({ at: now })
    );
  });

  it("returns the same denial for missing and deactivated targets", async () => {
    const deactivatedEmployeeId = "employee-deactivated" as EmployeeId;
    const service = createInternalAccessDecisionService(
      testOptions({
        employees: [
          employee({ employeeId: adminEmployeeId }),
          employee({
            employeeId: deactivatedEmployeeId,
            deactivatedAt: new Date("2026-06-24T09:00:00.000Z")
          })
        ],
        sourcesByEmployeeId: {
          [adminEmployeeId]: sources({
            roles: [role("role-admin", ["roles.manage"])],
            roleBindings: [
              binding({
                id: "binding-admin",
                roleId: "role-admin",
                employeeId: adminEmployeeId,
                scope: { type: "tenant" }
              })
            ]
          })
        }
      })
    );

    for (const employeeId of [
      "employee-missing" as EmployeeId,
      deactivatedEmployeeId
    ]) {
      await expect(
        service.inspectAccessDecision(context(), {
          employeeId,
          permission: "conversation.read",
          resource: { queueId: "queue-sales" }
        })
      ).rejects.toMatchObject({ code: "permission.denied" });
    }
  });

  it("denies inspection before loading the target employee when admin scope does not cover the resource", async () => {
    const employeeRepository = {
      findEmployee: vi.fn(
        async (input: { tenantId: TenantId; employeeId: EmployeeId }) => {
          return input.employeeId === adminEmployeeId
            ? employee({ employeeId: adminEmployeeId })
            : employee({ employeeId: targetEmployeeId });
        }
      )
    };
    const service = createInternalAccessDecisionService({
      employeeRepository,
      rbacRepository: {
        async listEffectiveAccessSources(input: { actor: PermissionActor }) {
          return input.actor.employeeId === adminEmployeeId
            ? sources({
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
              })
            : sources();
        }
      },
      now: () => now
    });

    await expect(
      service.inspectAccessDecision(context(), {
        employeeId: targetEmployeeId,
        permission: "conversation.read",
        resource: {
          queueId: "queue-claims"
        }
      })
    ).rejects.toMatchObject({
      code: "permission.denied"
    });
    expect(employeeRepository.findEmployee).toHaveBeenCalledTimes(1);
    expect(employeeRepository.findEmployee).toHaveBeenCalledWith({
      tenantId,
      employeeId: adminEmployeeId
    });
  });

  it("rejects unknown permissions before repository access", async () => {
    const employeeRepository = {
      findEmployee: vi.fn()
    };
    const service = createInternalAccessDecisionService({
      employeeRepository,
      rbacRepository: {
        listEffectiveAccessSources: vi.fn()
      },
      now: () => now
    });

    await expect(
      service.inspectAccessDecision(context(), {
        employeeId: targetEmployeeId,
        permission: "unknown.permission",
        resource: {}
      })
    ).rejects.toMatchObject({
      code: "validation.failed"
    });
    expect(employeeRepository.findEmployee).not.toHaveBeenCalled();
  });

  it("does not authorize access decisions from requester system templates", async () => {
    const service = createInternalAccessDecisionService(
      testOptions({
        employees: [
          employee({
            employeeId: adminEmployeeId,
            systemRoleTemplateIds: ["tenant_admin"]
          }),
          employee({ employeeId: targetEmployeeId })
        ],
        sourcesByEmployeeId: {}
      })
    );

    await expect(
      service.inspectAccessDecision(context(), {
        employeeId: targetEmployeeId,
        permission: "conversation.read",
        resource: {}
      })
    ).rejects.toMatchObject({
      code: "permission.denied"
    });
  });

  it("returns missing permission without exposing unrelated target grants", async () => {
    const service = createInternalAccessDecisionService(
      testOptions({
        employees: [
          employee({ employeeId: adminEmployeeId }),
          employee({ employeeId: targetEmployeeId })
        ],
        sourcesByEmployeeId: {
          [adminEmployeeId]: sources({
            roles: [role("role-admin", ["roles.manage"])],
            roleBindings: [
              binding({
                id: "binding-admin",
                roleId: "role-admin",
                employeeId: adminEmployeeId,
                scope: { type: "tenant" }
              })
            ]
          }),
          [targetEmployeeId]: sources({
            roles: [role("role-reply", ["message.reply"])],
            roleBindings: [
              binding({
                id: "binding-reply",
                roleId: "role-reply",
                employeeId: targetEmployeeId,
                scope: { type: "tenant" }
              })
            ]
          })
        }
      })
    );
    const response = await service.inspectAccessDecision(context(), {
      employeeId: targetEmployeeId,
      permission: "conversation.read",
      resource: {
        conversationId: "conversation-1"
      }
    });

    expect(response.decision).toEqual({
      allowed: false,
      reason: "missing_permission",
      matchedGrant: undefined
    });
    expect(response.candidateGrants).toEqual([]);
    expect(response.effectiveGrantCount).toBe(1);
  });
});

function testOptions(input: {
  employees: readonly TenantEmployeeRecord[];
  sourcesByEmployeeId: Record<string, ReturnType<typeof sources>>;
}) {
  const employeesById = new Map(
    input.employees.map((record) => [record.employeeId, record])
  );

  return {
    employeeRepository: {
      async findEmployee(findInput: {
        tenantId: TenantId;
        employeeId: EmployeeId;
      }) {
        const employee = employeesById.get(findInput.employeeId);

        return employee?.tenantId === findInput.tenantId ? employee : null;
      }
    },
    rbacRepository: {
      async listEffectiveAccessSources(listInput: { actor: PermissionActor }) {
        return (
          input.sourcesByEmployeeId[listInput.actor.employeeId] ?? sources()
        );
      }
    },
    now: () => now
  };
}

function context() {
  return {
    requestId: "request-1",
    tenantId,
    employeeId: adminEmployeeId
  };
}

function employee(input: {
  employeeId: EmployeeId;
  systemRoleTemplateIds?: readonly SystemRoleTemplateId[];
  teamIds?: readonly string[];
  orgUnitIds?: readonly string[];
  queueIds?: readonly string[];
  deactivatedAt?: Date | null;
}): TenantEmployeeRecord {
  return {
    tenantId,
    employeeId: input.employeeId,
    accountId: null,
    email: `${input.employeeId}@example.test`,
    displayName: String(input.employeeId),
    phoneNumber: null,
    avatarUrl: null,
    avatar: null,
    systemRoleTemplateIds: input.systemRoleTemplateIds ?? [],
    teamIds: input.teamIds ?? [],
    orgUnitIds: input.orgUnitIds ?? [],
    queueIds: input.queueIds ?? [],
    createdAt: now,
    deactivatedAt: input.deactivatedAt ?? null
  };
}

function sources(input?: {
  roles?: readonly PermissionRoleDefinition[];
  roleBindings?: readonly PermissionRoleBinding[];
  directGrants?: readonly DirectPermissionGrant[];
}) {
  return {
    roles: input?.roles ?? [],
    roleBindings: input?.roleBindings ?? [],
    directGrants: input?.directGrants ?? []
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
