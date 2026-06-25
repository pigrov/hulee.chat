import type { EmployeeId, TenantId } from "@hulee/contracts";
import { CoreError, type PermissionActor } from "@hulee/core";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";
import {
  createSqlTenantRbacRepository,
  type CreateDirectPermissionGrantInput,
  type CreateTenantRoleBindingInput
} from "./sql-rbac-repository";

const tenantId = "tenant_rbac_1" as TenantId;
const otherTenantId = "tenant_rbac_2" as TenantId;
const employeeId = "employee_rbac_1" as EmployeeId;
const adminEmployeeId = "employee_admin" as EmployeeId;
const now = new Date("2026-06-23T10:00:00.000Z");
const actor: PermissionActor = {
  tenantId,
  employeeId,
  teamIds: ["team-sales"],
  orgUnitIds: ["org-sales"],
  queueIds: ["queue-sales"]
};

describe("SQL RBAC repository", () => {
  it("writes role, permission, binding and direct grant commands", async () => {
    const executor = new RecordingSqlExecutor([]);
    const repository = createSqlTenantRbacRepository(executor);

    await repository.createRole({
      id: "role-sales",
      tenantId,
      name: "Sales",
      description: "Sales access",
      isSystem: false,
      createdByEmployeeId: adminEmployeeId,
      createdAt: now
    });
    await repository.addRolePermission({
      tenantId,
      roleId: "role-sales",
      permission: "message.reply",
      createdAt: now
    });
    await repository.createRoleBinding(roleBinding());
    await repository.createDirectGrant(directGrant());

    expect(executor.queries).toHaveLength(4);

    const createRoleQuery = renderQuery(executor.queries[0]);
    const bindingQuery = renderQuery(executor.queries[2]);
    const grantQuery = renderQuery(executor.queries[3]);

    expect(createRoleQuery.sql).toContain("insert into tenant_roles");
    expect(createRoleQuery.params).toContain(tenantId);
    expect(bindingQuery.sql).toContain("insert into tenant_role_bindings");
    expect(bindingQuery.sql).toContain("from work_queues subject_work_queue");
    expect(bindingQuery.sql).toContain("subject_work_queue.status = 'active'");
    expect(bindingQuery.params).toContain("queue-sales");
    expect(grantQuery.sql).toContain("insert into direct_permission_grants");
    expect(grantQuery.params).toContain("temporary coverage");
  });

  it("creates custom roles with permissions in one command", async () => {
    const executor = new RecordingSqlExecutor([]);
    const repository = createSqlTenantRbacRepository(executor);

    await repository.createRoleWithPermissions({
      id: "role-custom-sales",
      tenantId,
      name: "Custom sales",
      description: "Custom role",
      isSystem: false,
      createdByEmployeeId: adminEmployeeId,
      createdAt: now,
      permissions: ["client.view", "message.reply"]
    });

    const query = renderQuery(executor.queries[0]);

    expect(query.sql).toContain("insert into tenant_roles");
    expect(query.sql).toContain("insert into tenant_role_permissions");
    expect(query.sql).toContain("permission_rows(permission)");
    expect(query.params).toEqual(
      expect.arrayContaining([
        "role-custom-sales",
        tenantId,
        "Custom sales",
        adminEmployeeId,
        "client.view",
        "message.reply"
      ])
    );
  });

  it("updates and archives custom roles with tenant-scoped custom-only predicates", async () => {
    const executor = new RecordingSqlExecutor([]);
    const repository = createSqlTenantRbacRepository(executor);

    await repository.updateCustomRoleWithPermissions({
      tenantId,
      roleId: "role-custom-sales",
      name: "Updated sales",
      description: "Updated role",
      permissions: ["client.view", "message.reply"],
      updatedAt: now
    });
    await repository.setCustomRoleStatus({
      tenantId,
      roleId: "role-custom-sales",
      status: "archived",
      updatedAt: now
    });

    const updateQuery = renderQuery(executor.queries[0]);
    const statusQuery = renderQuery(executor.queries[1]);

    expect(updateQuery.sql).toContain("update tenant_roles");
    expect(updateQuery.sql).toContain("delete from tenant_role_permissions");
    expect(updateQuery.sql).toContain("insert into tenant_role_permissions");
    expect(updateQuery.sql).toContain("is_system = false");
    expect(updateQuery.params).toEqual(
      expect.arrayContaining([
        tenantId,
        "role-custom-sales",
        "Updated sales",
        "client.view",
        "message.reply"
      ])
    );
    expect(statusQuery.sql).toContain("update tenant_roles");
    expect(statusQuery.sql).toContain("archived_at = case");
    expect(statusQuery.sql).toContain("is_system = false");
    expect(statusQuery.params).toEqual(
      expect.arrayContaining([tenantId, "role-custom-sales", "archived", now])
    );
  });

  it("rejects invalid permissions and permission-scope pairs before SQL", async () => {
    const executor = new RecordingSqlExecutor([]);
    const repository = createSqlTenantRbacRepository(executor);

    await expect(
      repository.addRolePermission({
        tenantId,
        roleId: "role-sales",
        permission: "unknown.permission" as never,
        createdAt: now
      })
    ).rejects.toThrow(new CoreError("validation.failed"));

    await expect(
      repository.createDirectGrant(
        directGrant({
          permission: "roles.manage",
          scope: {
            type: "assigned"
          }
        })
      )
    ).rejects.toThrow(new CoreError("validation.failed"));

    await expect(
      repository.createRoleWithPermissions({
        id: "role-empty",
        tenantId,
        name: "Empty",
        createdAt: now,
        permissions: []
      })
    ).rejects.toThrow(new CoreError("validation.failed"));

    await expect(
      repository.updateCustomRoleWithPermissions({
        tenantId,
        roleId: "role-empty",
        name: "Empty",
        updatedAt: now,
        permissions: []
      })
    ).rejects.toThrow(new CoreError("validation.failed"));

    await expect(
      repository.setCustomRoleStatus({
        tenantId,
        roleId: "role-invalid-status",
        status: "deleted" as never,
        updatedAt: now
      })
    ).rejects.toThrow(new CoreError("validation.failed"));

    expect(executor.queries).toHaveLength(0);
  });

  it("lists effective access source rows for the core evaluator", async () => {
    const executor = new RecordingSqlExecutor([
      [
        {
          id: "role-sales",
          tenant_id: tenantId,
          name: "Sales",
          description: "Sales role",
          status: "active",
          is_system: false,
          created_by_employee_id: adminEmployeeId,
          archived_at: null,
          permissions: ["client.view", "message.reply"]
        }
      ],
      [
        {
          id: "binding-sales",
          tenant_id: tenantId,
          role_id: "role-sales",
          subject_type: "queue",
          subject_id: "queue-sales",
          scope_type: "queue",
          scope_id: "queue-sales",
          starts_at: null,
          expires_at: null,
          revoked_at: null
        }
      ],
      [
        {
          id: "grant-client",
          tenant_id: tenantId,
          employee_id: employeeId,
          permission: "client.view",
          scope_type: "client",
          scope_id: "client-1",
          reason: "temporary coverage",
          starts_at: null,
          expires_at: null,
          revoked_at: null
        }
      ]
    ]);
    const repository = createSqlTenantRbacRepository(executor);

    await expect(
      repository.listEffectiveAccessSources({
        actor,
        at: now
      })
    ).resolves.toMatchObject({
      roles: [
        {
          id: "role-sales",
          tenantId,
          permissions: ["client.view", "message.reply"]
        }
      ],
      roleBindings: [
        {
          id: "binding-sales",
          tenantId,
          roleId: "role-sales",
          subject: {
            type: "queue",
            id: "queue-sales"
          },
          scope: {
            type: "queue",
            id: "queue-sales"
          }
        }
      ],
      directGrants: [
        {
          id: "grant-client",
          tenantId,
          employeeId,
          permission: "client.view",
          scope: {
            type: "client",
            id: "client-1"
          }
        }
      ]
    });

    expect(executor.queries).toHaveLength(3);
    const bindingQuery = renderQuery(executor.queries[1]);

    expect(bindingQuery.sql).toContain("where tenant_id = $1");
    expect(bindingQuery.sql).toContain("subject_type = 'employee'");
    expect(bindingQuery.sql).toContain("subject_type = 'team'");
    expect(bindingQuery.sql).toContain("subject_type = 'org_unit'");
    expect(bindingQuery.sql).toContain("subject_type = 'queue'");
    expect(bindingQuery.params).toEqual(
      expect.arrayContaining([
        tenantId,
        employeeId,
        "team-sales",
        "org-sales",
        "queue-sales"
      ])
    );
  });

  it("lists active tenant role bindings for administration", async () => {
    const executor = new RecordingSqlExecutor([
      [
        {
          id: "binding-sales",
          tenant_id: tenantId,
          role_id: "role-sales",
          subject_type: "employee",
          subject_id: employeeId,
          scope_type: "tenant",
          scope_id: null,
          starts_at: null,
          expires_at: null,
          revoked_at: null
        }
      ]
    ]);
    const repository = createSqlTenantRbacRepository(executor);

    await expect(
      repository.listRoleBindings({
        tenantId,
        at: now
      })
    ).resolves.toEqual([
      {
        id: "binding-sales",
        tenantId,
        roleId: "role-sales",
        subject: {
          type: "employee",
          id: employeeId
        },
        scope: {
          type: "tenant"
        }
      }
    ]);

    const query = renderQuery(executor.queries[0]);

    expect(query.sql).toContain("from tenant_role_bindings");
    expect(query.sql).toContain("where tenant_id = $1");
    expect(query.sql).toContain("revoked_at is null");
    expect(query.params).toEqual(expect.arrayContaining([tenantId, now]));
  });

  it("lists expired tenant role bindings for administration", async () => {
    const executor = new RecordingSqlExecutor([
      [
        {
          id: "binding-expired",
          tenant_id: tenantId,
          role_id: "role-sales",
          subject_type: "employee",
          subject_id: employeeId,
          scope_type: "tenant",
          scope_id: null,
          starts_at: null,
          expires_at: "2026-06-21T10:00:00.000Z",
          revoked_at: null
        }
      ]
    ]);
    const repository = createSqlTenantRbacRepository(executor);

    await expect(
      repository.listExpiredRoleBindings({
        tenantId,
        at: now,
        limit: 25
      })
    ).resolves.toEqual([
      {
        id: "binding-expired",
        tenantId,
        roleId: "role-sales",
        subject: {
          type: "employee",
          id: employeeId
        },
        scope: {
          type: "tenant"
        },
        expiresAt: "2026-06-21T10:00:00.000Z"
      }
    ]);

    const query = renderQuery(executor.queries[0]);

    expect(query.sql).toContain("from tenant_role_bindings");
    expect(query.sql).toContain("expires_at is not null");
    expect(query.sql).toContain("expires_at <= $2");
    expect(query.sql).toContain("limit $3");
    expect(query.params).toEqual([tenantId, now, 25]);
  });

  it("lists active direct grants for administration", async () => {
    const executor = new RecordingSqlExecutor([
      [
        {
          id: "grant-client",
          tenant_id: tenantId,
          employee_id: employeeId,
          permission: "client.view",
          scope_type: "client",
          scope_id: "client-1",
          reason: "temporary coverage",
          starts_at: null,
          expires_at: null,
          revoked_at: null
        }
      ]
    ]);
    const repository = createSqlTenantRbacRepository(executor);

    await expect(
      repository.listDirectGrants({
        tenantId,
        at: now
      })
    ).resolves.toEqual([
      {
        id: "grant-client",
        tenantId,
        employeeId,
        permission: "client.view",
        scope: {
          type: "client",
          id: "client-1"
        },
        reason: "temporary coverage"
      }
    ]);

    const query = renderQuery(executor.queries[0]);

    expect(query.sql).toContain("from direct_permission_grants");
    expect(query.sql).toContain("where tenant_id = $1");
    expect(query.sql).toContain("revoked_at is null");
    expect(query.params).toEqual(expect.arrayContaining([tenantId, now]));
  });

  it("lists expired direct grants for administration", async () => {
    const executor = new RecordingSqlExecutor([
      [
        {
          id: "grant-expired",
          tenant_id: tenantId,
          employee_id: employeeId,
          permission: "client.view",
          scope_type: "client",
          scope_id: "client-1",
          reason: "temporary coverage",
          starts_at: null,
          expires_at: "2026-06-21T10:00:00.000Z",
          revoked_at: null
        }
      ]
    ]);
    const repository = createSqlTenantRbacRepository(executor);

    await expect(
      repository.listExpiredDirectGrants({
        tenantId,
        at: now,
        limit: 25
      })
    ).resolves.toEqual([
      {
        id: "grant-expired",
        tenantId,
        employeeId,
        permission: "client.view",
        scope: {
          type: "client",
          id: "client-1"
        },
        reason: "temporary coverage",
        expiresAt: "2026-06-21T10:00:00.000Z"
      }
    ]);

    const query = renderQuery(executor.queries[0]);

    expect(query.sql).toContain("from direct_permission_grants");
    expect(query.sql).toContain("expires_at is not null");
    expect(query.sql).toContain("expires_at <= $2");
    expect(query.sql).toContain("limit $3");
    expect(query.params).toEqual([tenantId, now, 25]);
  });

  it("rejects cross-tenant rows returned from role reads", async () => {
    const repository = createSqlTenantRbacRepository(
      new RecordingSqlExecutor([
        [
          {
            id: "role-cross-tenant",
            tenant_id: otherTenantId,
            name: "Cross tenant",
            description: null,
            status: "active",
            is_system: false,
            created_by_employee_id: null,
            archived_at: null,
            permissions: []
          }
        ]
      ])
    );

    await expect(
      repository.listRoleDefinitions({
        tenantId
      })
    ).rejects.toThrow(new CoreError("tenant.boundary_violation"));
  });

  it("rejects cross-tenant rows returned from tenant binding reads", async () => {
    const repository = createSqlTenantRbacRepository(
      new RecordingSqlExecutor([
        [
          {
            id: "binding-cross-tenant",
            tenant_id: otherTenantId,
            role_id: "role-sales",
            subject_type: "employee",
            subject_id: employeeId,
            scope_type: "tenant",
            scope_id: null,
            starts_at: null,
            expires_at: null,
            revoked_at: null
          }
        ]
      ])
    );

    await expect(
      repository.listRoleBindings({
        tenantId,
        at: now
      })
    ).rejects.toThrow(new CoreError("tenant.boundary_violation"));
  });

  it("rejects cross-tenant rows returned from binding reads", async () => {
    const repository = createSqlTenantRbacRepository(
      new RecordingSqlExecutor([
        [
          {
            id: "binding-cross-tenant",
            tenant_id: otherTenantId,
            role_id: "role-sales",
            subject_type: "employee",
            subject_id: employeeId,
            scope_type: "tenant",
            scope_id: null,
            starts_at: null,
            expires_at: null,
            revoked_at: null
          }
        ]
      ])
    );

    await expect(
      repository.listRoleBindingsForActor({
        actor,
        at: now
      })
    ).rejects.toThrow(new CoreError("tenant.boundary_violation"));
  });

  it("rejects cross-tenant rows returned from direct grant reads", async () => {
    const repository = createSqlTenantRbacRepository(
      new RecordingSqlExecutor([
        [
          {
            id: "grant-cross-tenant",
            tenant_id: otherTenantId,
            employee_id: employeeId,
            permission: "client.view",
            scope_type: "client",
            scope_id: "client-1",
            reason: "temporary coverage",
            starts_at: null,
            expires_at: null,
            revoked_at: null
          }
        ]
      ])
    );

    await expect(
      repository.listDirectGrantsForEmployee({
        tenantId,
        employeeId,
        at: now
      })
    ).rejects.toThrow(new CoreError("tenant.boundary_violation"));
  });

  it("revokes bindings and grants with tenant-scoped predicates", async () => {
    const executor = new RecordingSqlExecutor([]);
    const repository = createSqlTenantRbacRepository(executor);

    await repository.revokeRoleBinding({
      tenantId,
      bindingId: "binding-sales",
      revokedAt: now
    });
    await repository.revokeDirectGrant({
      tenantId,
      grantId: "grant-client",
      revokedAt: now
    });

    expect(renderQuery(executor.queries[0]).sql).toContain(
      "where tenant_id = $3"
    );
    expect(renderQuery(executor.queries[1]).sql).toContain(
      "where tenant_id = $3"
    );
  });
});

class RecordingSqlExecutor implements RawSqlExecutor {
  readonly queries: SQL[] = [];
  private nextResultIndex = 0;

  constructor(
    private readonly resultSets: readonly (readonly Record<string, unknown>[])[]
  ) {}

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(query);
    const rows = this.resultSets[this.nextResultIndex] ?? [];
    this.nextResultIndex += 1;

    return {
      rows: rows as readonly Row[]
    };
  }
}

function roleBinding(
  overrides: Partial<CreateTenantRoleBindingInput> = {}
): CreateTenantRoleBindingInput {
  return {
    id: "binding-sales",
    tenantId,
    roleId: "role-sales",
    subject: {
      type: "team",
      id: "team-sales"
    },
    scope: {
      type: "queue",
      id: "queue-sales"
    },
    createdByEmployeeId: adminEmployeeId,
    createdAt: now,
    ...overrides
  };
}

function directGrant(
  overrides: Partial<CreateDirectPermissionGrantInput> = {}
): CreateDirectPermissionGrantInput {
  return {
    id: "grant-client",
    tenantId,
    employeeId,
    permission: "client.view",
    scope: {
      type: "client",
      id: "client-1"
    },
    reason: "temporary coverage",
    createdByEmployeeId: adminEmployeeId,
    createdAt: now,
    ...overrides
  };
}

function renderQuery(query: SQL | undefined): {
  sql: string;
  params: unknown[];
} {
  if (query === undefined) {
    throw new Error("Expected a recorded SQL query.");
  }

  return new PgDialect().sqlToQuery(query);
}
