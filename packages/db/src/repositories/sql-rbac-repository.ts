import type { EmployeeId, TenantId } from "@hulee/contracts";
import {
  CoreError,
  assertPermissionScopeAllowed,
  isPermission,
  isPermissionScope,
  isPermissionScopeType,
  permissionsForRoles,
  type DirectPermissionGrant,
  type EmployeeRole,
  type Permission,
  type PermissionActor,
  type PermissionRoleBinding,
  type PermissionRoleBindingSubject,
  type PermissionRoleDefinition,
  type PermissionScope
} from "@hulee/core";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";
import { mapOptionalSqlTimestamp, type SqlTimestamp } from "./sql-timestamp";
import { assertTenantScopedRows } from "./tenant-scope";

export type TenantRoleStatus = "active" | "archived";

export type TenantRoleRecord = PermissionRoleDefinition & {
  readonly name: string;
  readonly description: string | null;
  readonly isSystem: boolean;
  readonly createdByEmployeeId: EmployeeId | null;
};

export type CreateTenantRoleInput = {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly description?: string | null;
  readonly status?: TenantRoleStatus;
  readonly isSystem?: boolean;
  readonly createdByEmployeeId?: EmployeeId | null;
  readonly createdAt: Date;
};

export type AddTenantRolePermissionInput = {
  readonly tenantId: TenantId;
  readonly roleId: string;
  readonly permission: Permission;
  readonly createdAt: Date;
};

export type CreateTenantRoleWithPermissionsInput = CreateTenantRoleInput & {
  readonly permissions: readonly Permission[];
};

export type UpdateCustomTenantRoleWithPermissionsInput = {
  readonly tenantId: TenantId;
  readonly roleId: string;
  readonly name: string;
  readonly description?: string | null;
  readonly permissions: readonly Permission[];
  readonly updatedAt: Date;
};

export type SetCustomTenantRoleStatusInput = {
  readonly tenantId: TenantId;
  readonly roleId: string;
  readonly status: TenantRoleStatus;
  readonly updatedAt: Date;
};

export type CreateTenantRoleBindingInput = PermissionRoleBinding & {
  readonly createdByEmployeeId?: EmployeeId | null;
  readonly createdAt: Date;
};

export type CreateDirectPermissionGrantInput = DirectPermissionGrant & {
  readonly createdByEmployeeId?: EmployeeId | null;
  readonly createdAt: Date;
};

export type RevokeTenantRoleBindingInput = {
  readonly tenantId: TenantId;
  readonly bindingId: string;
  readonly revokedAt: Date;
};

export type RevokeDirectPermissionGrantInput = {
  readonly tenantId: TenantId;
  readonly grantId: string;
  readonly revokedAt: Date;
};

export type BackfillFixedEmployeeRolesInput = {
  readonly tenantId?: TenantId;
  readonly backfilledAt: Date;
};

export type ListTenantRoleDefinitionsInput = {
  readonly tenantId: TenantId;
};

export type ListTenantRoleBindingsInput = {
  readonly tenantId: TenantId;
  readonly at: Date;
};

export type ListActorRoleBindingsInput = {
  readonly actor: PermissionActor;
  readonly at: Date;
};

export type ListActorDirectPermissionGrantsInput = {
  readonly tenantId: TenantId;
  readonly employeeId: EmployeeId;
  readonly at: Date;
};

export type ListTenantDirectPermissionGrantsInput = {
  readonly tenantId: TenantId;
  readonly at: Date;
};

export type ListEffectiveAccessSourcesInput = {
  readonly actor: PermissionActor;
  readonly at?: Date;
};

export type EffectiveAccessSources = {
  readonly roles: readonly PermissionRoleDefinition[];
  readonly roleBindings: readonly PermissionRoleBinding[];
  readonly directGrants: readonly DirectPermissionGrant[];
};

export type TenantRbacRepository = {
  createRole(input: CreateTenantRoleInput): Promise<void>;
  createRoleWithPermissions(
    input: CreateTenantRoleWithPermissionsInput
  ): Promise<void>;
  updateCustomRoleWithPermissions(
    input: UpdateCustomTenantRoleWithPermissionsInput
  ): Promise<void>;
  setCustomRoleStatus(input: SetCustomTenantRoleStatusInput): Promise<void>;
  addRolePermission(input: AddTenantRolePermissionInput): Promise<void>;
  createRoleBinding(input: CreateTenantRoleBindingInput): Promise<void>;
  createDirectGrant(input: CreateDirectPermissionGrantInput): Promise<void>;
  backfillFixedEmployeeRoles(
    input: BackfillFixedEmployeeRolesInput
  ): Promise<void>;
  revokeRoleBinding(input: RevokeTenantRoleBindingInput): Promise<void>;
  revokeDirectGrant(input: RevokeDirectPermissionGrantInput): Promise<void>;
  listRoleDefinitions(
    input: ListTenantRoleDefinitionsInput
  ): Promise<readonly TenantRoleRecord[]>;
  listRoleBindings(
    input: ListTenantRoleBindingsInput
  ): Promise<readonly PermissionRoleBinding[]>;
  listRoleBindingsForActor(
    input: ListActorRoleBindingsInput
  ): Promise<readonly PermissionRoleBinding[]>;
  listDirectGrantsForEmployee(
    input: ListActorDirectPermissionGrantsInput
  ): Promise<readonly DirectPermissionGrant[]>;
  listDirectGrants(
    input: ListTenantDirectPermissionGrantsInput
  ): Promise<readonly DirectPermissionGrant[]>;
  listEffectiveAccessSources(
    input: ListEffectiveAccessSourcesInput
  ): Promise<EffectiveAccessSources>;
};

type TenantRoleRow = {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  status: string;
  is_system: boolean;
  created_by_employee_id: string | null;
  archived_at: SqlTimestamp | null;
  permissions: unknown;
};

type TenantRoleBindingRow = {
  id: string;
  tenant_id: string;
  role_id: string;
  subject_type: string;
  subject_id: string;
  scope_type: string;
  scope_id: string | null;
  starts_at: SqlTimestamp | null;
  expires_at: SqlTimestamp | null;
  revoked_at: SqlTimestamp | null;
};

type DirectPermissionGrantRow = {
  id: string;
  tenant_id: string;
  employee_id: string;
  permission: string;
  scope_type: string;
  scope_id: string | null;
  reason: string;
  starts_at: SqlTimestamp | null;
  expires_at: SqlTimestamp | null;
  revoked_at: SqlTimestamp | null;
};

export function createSqlTenantRbacRepository(
  executor: RawSqlExecutor | HuleeDatabase
): TenantRbacRepository {
  const rawExecutor = executor as RawSqlExecutor;

  return {
    async createRole(input) {
      await rawExecutor.execute(buildCreateTenantRoleSql(input));
    },

    async createRoleWithPermissions(input) {
      await rawExecutor.execute(buildCreateTenantRoleWithPermissionsSql(input));
    },

    async updateCustomRoleWithPermissions(input) {
      await rawExecutor.execute(
        buildUpdateCustomTenantRoleWithPermissionsSql(input)
      );
    },

    async setCustomRoleStatus(input) {
      await rawExecutor.execute(buildSetCustomTenantRoleStatusSql(input));
    },

    async addRolePermission(input) {
      await rawExecutor.execute(buildAddTenantRolePermissionSql(input));
    },

    async createRoleBinding(input) {
      await rawExecutor.execute(buildCreateTenantRoleBindingSql(input));
    },

    async createDirectGrant(input) {
      await rawExecutor.execute(buildCreateDirectPermissionGrantSql(input));
    },

    async backfillFixedEmployeeRoles(input) {
      await rawExecutor.execute(buildBackfillFixedEmployeeRolesSql(input));
    },

    async revokeRoleBinding(input) {
      await rawExecutor.execute(buildRevokeTenantRoleBindingSql(input));
    },

    async revokeDirectGrant(input) {
      await rawExecutor.execute(buildRevokeDirectPermissionGrantSql(input));
    },

    async listRoleDefinitions(input) {
      const result = await rawExecutor.execute<TenantRoleRow>(
        buildListTenantRoleDefinitionsSql(input)
      );
      const roles = result.rows.map(mapTenantRoleRow);

      assertTenantScopedRows(input.tenantId, roles);

      return roles;
    },

    async listRoleBindings(input) {
      const result = await rawExecutor.execute<TenantRoleBindingRow>(
        buildListTenantRoleBindingsSql(input)
      );
      const bindings = result.rows.map(mapTenantRoleBindingRow);

      assertTenantScopedRows(input.tenantId, bindings);

      return bindings;
    },

    async listRoleBindingsForActor(input) {
      const result = await rawExecutor.execute<TenantRoleBindingRow>(
        buildListActorRoleBindingsSql(input)
      );
      const bindings = result.rows.map(mapTenantRoleBindingRow);

      assertTenantScopedRows(input.actor.tenantId, bindings);

      return bindings;
    },

    async listDirectGrantsForEmployee(input) {
      const result = await rawExecutor.execute<DirectPermissionGrantRow>(
        buildListActorDirectPermissionGrantsSql(input)
      );
      const grants = result.rows.map(mapDirectPermissionGrantRow);

      assertTenantScopedRows(input.tenantId, grants);

      return grants;
    },

    async listDirectGrants(input) {
      const result = await rawExecutor.execute<DirectPermissionGrantRow>(
        buildListTenantDirectPermissionGrantsSql(input)
      );
      const grants = result.rows.map(mapDirectPermissionGrantRow);

      assertTenantScopedRows(input.tenantId, grants);

      return grants;
    },

    async listEffectiveAccessSources(input) {
      const at = input.at ?? new Date();
      const [roles, roleBindings, directGrants] = await Promise.all([
        this.listRoleDefinitions({
          tenantId: input.actor.tenantId
        }),
        this.listRoleBindingsForActor({
          actor: input.actor,
          at
        }),
        this.listDirectGrantsForEmployee({
          tenantId: input.actor.tenantId,
          employeeId: input.actor.employeeId,
          at
        })
      ]);

      return {
        roles,
        roleBindings,
        directGrants
      };
    }
  };
}

export function buildCreateTenantRoleSql(input: CreateTenantRoleInput): SQL {
  assertNonEmpty(input.id);
  assertNonEmpty(input.tenantId);
  assertNonEmpty(input.name);
  assertRoleStatus(input.status ?? "active");
  const createdByEmployeeId = input.createdByEmployeeId ?? null;

  return sql`
    insert into tenant_roles (
      id,
      tenant_id,
      name,
      description,
      status,
      is_system,
      created_by_employee_id,
      created_at,
      updated_at
    )
    select
      ${input.id},
      ${input.tenantId},
      ${input.name.trim()},
      ${input.description ?? null},
      ${input.status ?? "active"},
      ${input.isSystem ?? false},
      ${createdByEmployeeId},
      ${input.createdAt},
      ${input.createdAt}
    where ${createdByEmployeeId} is null
       or exists (
        select 1
        from employees
        where tenant_id = ${input.tenantId}
          and id = ${createdByEmployeeId}
      )
    on conflict (id) do nothing
  `;
}

export function buildCreateTenantRoleWithPermissionsSql(
  input: CreateTenantRoleWithPermissionsInput
): SQL {
  assertNonEmpty(input.id);
  assertNonEmpty(input.tenantId);
  assertNonEmpty(input.name);
  assertRoleStatus(input.status ?? "active");
  assertPermissions(input.permissions);
  const createdByEmployeeId = input.createdByEmployeeId ?? null;

  return sql`
    with inserted_role as (
      insert into tenant_roles (
        id,
        tenant_id,
        name,
        description,
        status,
        is_system,
        created_by_employee_id,
        created_at,
        updated_at
      )
      select
        ${input.id},
        ${input.tenantId},
        ${input.name.trim()},
        ${input.description ?? null},
        ${input.status ?? "active"},
        ${input.isSystem ?? false},
        ${createdByEmployeeId},
        ${input.createdAt},
        ${input.createdAt}
      where ${createdByEmployeeId} is null
         or exists (
          select 1
          from employees
          where tenant_id = ${input.tenantId}
            and id = ${createdByEmployeeId}
        )
      on conflict (id) do nothing
      returning id,
                tenant_id
    ),
    role_scope as (
      select id,
             tenant_id
      from inserted_role
      union all
      select id,
             tenant_id
      from tenant_roles
      where tenant_id = ${input.tenantId}
        and id = ${input.id}
    ),
    permission_rows(permission) as (
      values ${sql.join(
        input.permissions.map((permission) => sql`(${permission})`),
        sql`, `
      )}
    ),
    inserted_permissions as (
      insert into tenant_role_permissions (
        tenant_id,
        role_id,
        permission,
        created_at,
        updated_at
      )
      select role_scope.tenant_id,
             role_scope.id,
             permission_rows.permission,
             ${input.createdAt},
             ${input.createdAt}
      from role_scope
      cross join permission_rows
      on conflict (tenant_id, role_id, permission) do nothing
      returning permission
    )
    select count(*) as inserted_permission_count
    from inserted_permissions
  `;
}

export function buildUpdateCustomTenantRoleWithPermissionsSql(
  input: UpdateCustomTenantRoleWithPermissionsInput
): SQL {
  assertNonEmpty(input.tenantId);
  assertNonEmpty(input.roleId);
  assertNonEmpty(input.name);
  assertPermissions(input.permissions);

  return sql`
    with updated_role as (
      update tenant_roles
      set name = ${input.name.trim()},
          description = ${input.description ?? null},
          updated_at = ${input.updatedAt}
      where tenant_id = ${input.tenantId}
        and id = ${input.roleId}
        and is_system = false
      returning id,
                tenant_id
    ),
    deleted_permissions as (
      delete from tenant_role_permissions rp
      using updated_role
      where rp.tenant_id = updated_role.tenant_id
        and rp.role_id = updated_role.id
      returning rp.permission
    ),
    permission_rows(permission) as (
      values ${sql.join(
        input.permissions.map((permission) => sql`(${permission})`),
        sql`, `
      )}
    ),
    inserted_permissions as (
      insert into tenant_role_permissions (
        tenant_id,
        role_id,
        permission,
        created_at,
        updated_at
      )
      select updated_role.tenant_id,
             updated_role.id,
             permission_rows.permission,
             ${input.updatedAt},
             ${input.updatedAt}
      from updated_role
      cross join permission_rows
      on conflict (tenant_id, role_id, permission) do nothing
      returning permission
    )
    select (select count(*) from updated_role) as updated_role_count,
           (select count(*) from deleted_permissions) as deleted_permission_count,
           (select count(*) from inserted_permissions) as inserted_permission_count
  `;
}

export function buildSetCustomTenantRoleStatusSql(
  input: SetCustomTenantRoleStatusInput
): SQL {
  assertNonEmpty(input.tenantId);
  assertNonEmpty(input.roleId);
  assertRoleStatus(input.status);

  return sql`
    update tenant_roles
    set status = ${input.status},
        archived_at = case
          when ${input.status} = 'archived' then ${input.updatedAt}
          else null
        end,
        updated_at = ${input.updatedAt}
    where tenant_id = ${input.tenantId}
      and id = ${input.roleId}
      and is_system = false
  `;
}

export function buildAddTenantRolePermissionSql(
  input: AddTenantRolePermissionInput
): SQL {
  assertNonEmpty(input.tenantId);
  assertNonEmpty(input.roleId);
  assertPermission(input.permission);

  return sql`
    insert into tenant_role_permissions (
      tenant_id,
      role_id,
      permission,
      created_at,
      updated_at
    )
    select
      r.tenant_id,
      r.id,
      ${input.permission},
      ${input.createdAt},
      ${input.createdAt}
    from tenant_roles r
    where r.tenant_id = ${input.tenantId}
      and r.id = ${input.roleId}
    on conflict (tenant_id, role_id, permission) do nothing
  `;
}

export function buildCreateTenantRoleBindingSql(
  input: CreateTenantRoleBindingInput
): SQL {
  assertNonEmpty(input.id ?? "");
  assertNonEmpty(input.tenantId);
  assertNonEmpty(input.roleId);
  assertRoleBindingSubject(input.subject);
  assertScope(input.scope);
  const createdByEmployeeId = input.createdByEmployeeId ?? null;

  return sql`
    insert into tenant_role_bindings (
      id,
      tenant_id,
      role_id,
      subject_type,
      subject_id,
      scope_type,
      scope_id,
      created_by_employee_id,
      starts_at,
      expires_at,
      revoked_at,
      created_at,
      updated_at
    )
    select
      ${input.id},
      r.tenant_id,
      r.id,
      ${input.subject.type},
      ${input.subject.id},
      ${input.scope.type},
      ${scopeId(input.scope)},
      ${createdByEmployeeId},
      ${input.startsAt ? new Date(input.startsAt) : null},
      ${input.expiresAt ? new Date(input.expiresAt) : null},
      ${input.revokedAt ? new Date(input.revokedAt) : null},
      ${input.createdAt},
      ${input.createdAt}
    from tenant_roles r
    where r.tenant_id = ${input.tenantId}
      and r.id = ${input.roleId}
      and (
        ${createdByEmployeeId} is null
        or exists (
          select 1
          from employees created_by
          where created_by.tenant_id = ${input.tenantId}
            and created_by.id = ${createdByEmployeeId}
        )
      )
      and (
        (
          ${input.subject.type} = 'employee'
          and exists (
            select 1
            from employees subject_employee
            where subject_employee.tenant_id = ${input.tenantId}
              and subject_employee.id = ${input.subject.id}
          )
        )
        or (
          ${input.subject.type} = 'team'
          and exists (
            select 1
            from teams subject_team
            where subject_team.tenant_id = ${input.tenantId}
              and subject_team.id = ${input.subject.id}
          )
        )
        or (
          ${input.subject.type} = 'org_unit'
          and exists (
            select 1
            from org_units subject_org_unit
            where subject_org_unit.tenant_id = ${input.tenantId}
              and subject_org_unit.id = ${input.subject.id}
              and subject_org_unit.status = 'active'
          )
        )
        or (
          ${input.subject.type} = 'queue'
          and exists (
            select 1
            from work_queues subject_work_queue
            where subject_work_queue.tenant_id = ${input.tenantId}
              and subject_work_queue.id = ${input.subject.id}
              and subject_work_queue.status = 'active'
          )
        )
      )
    on conflict (id) do nothing
  `;
}

export function buildCreateDirectPermissionGrantSql(
  input: CreateDirectPermissionGrantInput
): SQL {
  assertNonEmpty(input.id ?? "");
  assertNonEmpty(input.tenantId);
  assertNonEmpty(input.employeeId);
  assertPermission(input.permission);
  assertScope(input.scope);
  assertPermissionScopeAllowed(input.permission, input.scope.type);
  assertNonEmpty(input.reason);
  const createdByEmployeeId = input.createdByEmployeeId ?? null;

  return sql`
    insert into direct_permission_grants (
      id,
      tenant_id,
      employee_id,
      permission,
      scope_type,
      scope_id,
      reason,
      created_by_employee_id,
      starts_at,
      expires_at,
      revoked_at,
      created_at,
      updated_at
    )
    select
      ${input.id},
      target_employee.tenant_id,
      target_employee.id,
      ${input.permission},
      ${input.scope.type},
      ${scopeId(input.scope)},
      ${input.reason.trim()},
      ${createdByEmployeeId},
      ${input.startsAt ? new Date(input.startsAt) : null},
      ${input.expiresAt ? new Date(input.expiresAt) : null},
      ${input.revokedAt ? new Date(input.revokedAt) : null},
      ${input.createdAt},
      ${input.createdAt}
    from employees target_employee
    where target_employee.tenant_id = ${input.tenantId}
      and target_employee.id = ${input.employeeId}
      and (
        ${createdByEmployeeId} is null
        or exists (
          select 1
          from employees created_by
          where created_by.tenant_id = ${input.tenantId}
            and created_by.id = ${createdByEmployeeId}
        )
      )
    on conflict (id) do nothing
  `;
}

export function buildBackfillFixedEmployeeRolesSql(
  input: BackfillFixedEmployeeRolesInput
): SQL {
  const tenantId = input.tenantId ?? null;

  return sql`
    with role_templates as (
      select *
      from jsonb_to_recordset(${serializeFixedEmployeeRoleTemplates()}::jsonb)
        as role_template(
          role text,
          name text,
          description text,
          permissions jsonb
        )
    ),
    source_roles as (
      select distinct employee_roles.tenant_id,
                      employee_roles.role
      from employee_roles
      inner join role_templates
        on role_templates.role = employee_roles.role
      where ${tenantId} is null
         or employee_roles.tenant_id = ${tenantId}
    ),
    source_employee_roles as (
      select employee_roles.tenant_id,
             employee_roles.employee_id,
             employee_roles.role
      from employee_roles
      inner join role_templates
        on role_templates.role = employee_roles.role
      inner join employees
        on employees.tenant_id = employee_roles.tenant_id
       and employees.id = employee_roles.employee_id
      where employees.deactivated_at is null
        and (${tenantId} is null or employee_roles.tenant_id = ${tenantId})
    ),
    inserted_roles as (
      insert into tenant_roles (
        id,
        tenant_id,
        name,
        description,
        status,
        is_system,
        created_by_employee_id,
        archived_at,
        created_at,
        updated_at
      )
      select concat('role:', source_roles.tenant_id, ':', source_roles.role),
             source_roles.tenant_id,
             role_templates.name,
             role_templates.description,
             'active',
             true,
             null,
             null,
             ${input.backfilledAt},
             ${input.backfilledAt}
      from source_roles
      inner join role_templates
        on role_templates.role = source_roles.role
      on conflict (id) do nothing
      returning id
    ),
    inserted_permissions as (
      insert into tenant_role_permissions (
        tenant_id,
        role_id,
        permission,
        created_at,
        updated_at
      )
      select source_roles.tenant_id,
             concat('role:', source_roles.tenant_id, ':', source_roles.role),
             permission_rows.permission,
             ${input.backfilledAt},
             ${input.backfilledAt}
      from source_roles
      inner join role_templates
        on role_templates.role = source_roles.role
      cross join jsonb_array_elements_text(role_templates.permissions)
        as permission_rows(permission)
      on conflict (tenant_id, role_id, permission) do nothing
      returning role_id
    ),
    inserted_bindings as (
      insert into tenant_role_bindings (
        id,
        tenant_id,
        role_id,
        subject_type,
        subject_id,
        scope_type,
        scope_id,
        created_by_employee_id,
        starts_at,
        expires_at,
        revoked_at,
        created_at,
        updated_at
      )
      select concat(
               'role_binding:',
               source_employee_roles.tenant_id,
               ':',
               source_employee_roles.employee_id,
               ':',
               source_employee_roles.role,
               ':tenant'
             ),
             source_employee_roles.tenant_id,
             concat(
               'role:',
               source_employee_roles.tenant_id,
               ':',
               source_employee_roles.role
             ),
             'employee',
             source_employee_roles.employee_id,
             'tenant',
             null,
             null,
             null,
             null,
             null,
             ${input.backfilledAt},
             ${input.backfilledAt}
      from source_employee_roles
      on conflict (id) do nothing
      returning id
    )
    select (select count(*) from inserted_roles) as inserted_role_count,
           (select count(*) from inserted_permissions) as inserted_permission_count,
           (select count(*) from inserted_bindings) as inserted_binding_count
  `;
}

export function buildRevokeTenantRoleBindingSql(
  input: RevokeTenantRoleBindingInput
): SQL {
  assertNonEmpty(input.tenantId);
  assertNonEmpty(input.bindingId);

  return sql`
    update tenant_role_bindings
    set revoked_at = ${input.revokedAt},
        updated_at = ${input.revokedAt}
    where tenant_id = ${input.tenantId}
      and id = ${input.bindingId}
      and revoked_at is null
  `;
}

export function buildRevokeDirectPermissionGrantSql(
  input: RevokeDirectPermissionGrantInput
): SQL {
  assertNonEmpty(input.tenantId);
  assertNonEmpty(input.grantId);

  return sql`
    update direct_permission_grants
    set revoked_at = ${input.revokedAt},
        updated_at = ${input.revokedAt}
    where tenant_id = ${input.tenantId}
      and id = ${input.grantId}
      and revoked_at is null
  `;
}

export function buildListTenantRoleDefinitionsSql(
  input: ListTenantRoleDefinitionsInput
): SQL {
  assertNonEmpty(input.tenantId);

  return sql`
    select r.id,
           r.tenant_id,
           r.name,
           r.description,
           r.status,
           r.is_system,
           r.created_by_employee_id,
           r.archived_at,
           coalesce(
             jsonb_agg(rp.permission order by rp.permission)
               filter (where rp.permission is not null),
             '[]'::jsonb
           ) as permissions
    from tenant_roles r
    left join tenant_role_permissions rp
      on rp.tenant_id = r.tenant_id
     and rp.role_id = r.id
    where r.tenant_id = ${input.tenantId}
    group by r.id,
             r.tenant_id,
             r.name,
             r.description,
             r.status,
             r.is_system,
             r.created_by_employee_id,
             r.archived_at
    order by r.name asc
  `;
}

export function buildListTenantRoleBindingsSql(
  input: ListTenantRoleBindingsInput
): SQL {
  assertNonEmpty(input.tenantId);

  return sql`
    select id,
           tenant_id,
           role_id,
           subject_type,
           subject_id,
           scope_type,
           scope_id,
           starts_at,
           expires_at,
           revoked_at
    from tenant_role_bindings
    where tenant_id = ${input.tenantId}
      and revoked_at is null
      and (starts_at is null or starts_at <= ${input.at})
      and (expires_at is null or expires_at > ${input.at})
    order by created_at asc
  `;
}

export function buildListActorRoleBindingsSql(
  input: ListActorRoleBindingsInput
): SQL {
  assertNonEmpty(input.actor.tenantId);
  assertNonEmpty(input.actor.employeeId);

  return sql`
    select id,
           tenant_id,
           role_id,
           subject_type,
           subject_id,
           scope_type,
           scope_id,
           starts_at,
           expires_at,
           revoked_at
    from tenant_role_bindings
    where tenant_id = ${input.actor.tenantId}
      and revoked_at is null
      and (starts_at is null or starts_at <= ${input.at})
      and (expires_at is null or expires_at > ${input.at})
      and (${actorSubjectPredicate(input.actor)})
    order by created_at asc
  `;
}

export function buildListActorDirectPermissionGrantsSql(
  input: ListActorDirectPermissionGrantsInput
): SQL {
  assertNonEmpty(input.tenantId);
  assertNonEmpty(input.employeeId);

  return sql`
    select id,
           tenant_id,
           employee_id,
           permission,
           scope_type,
           scope_id,
           reason,
           starts_at,
           expires_at,
           revoked_at
    from direct_permission_grants
    where tenant_id = ${input.tenantId}
      and employee_id = ${input.employeeId}
      and revoked_at is null
      and (starts_at is null or starts_at <= ${input.at})
      and (expires_at is null or expires_at > ${input.at})
    order by created_at asc
  `;
}

export function buildListTenantDirectPermissionGrantsSql(
  input: ListTenantDirectPermissionGrantsInput
): SQL {
  assertNonEmpty(input.tenantId);

  return sql`
    select id,
           tenant_id,
           employee_id,
           permission,
           scope_type,
           scope_id,
           reason,
           starts_at,
           expires_at,
           revoked_at
    from direct_permission_grants
    where tenant_id = ${input.tenantId}
      and revoked_at is null
      and (starts_at is null or starts_at <= ${input.at})
      and (expires_at is null or expires_at > ${input.at})
    order by created_at asc
  `;
}

function mapTenantRoleRow(row: TenantRoleRow): TenantRoleRecord {
  const status = parseRoleStatus(row.status);

  return {
    id: row.id,
    tenantId: row.tenant_id as TenantId,
    name: row.name,
    description: row.description,
    status,
    isSystem: row.is_system,
    createdByEmployeeId: row.created_by_employee_id as EmployeeId | null,
    archivedAt: mapOptionalSqlTimestamp(row.archived_at) ?? undefined,
    permissions: parsePermissions(row.permissions)
  };
}

function mapTenantRoleBindingRow(
  row: TenantRoleBindingRow
): PermissionRoleBinding {
  const scope = parsePermissionScope(row.scope_type, row.scope_id);

  return {
    id: row.id,
    tenantId: row.tenant_id as TenantId,
    roleId: row.role_id,
    subject: parseRoleBindingSubject(row.subject_type, row.subject_id),
    scope,
    startsAt: mapOptionalSqlTimestamp(row.starts_at) ?? undefined,
    expiresAt: mapOptionalSqlTimestamp(row.expires_at) ?? undefined,
    revokedAt: mapOptionalSqlTimestamp(row.revoked_at) ?? undefined
  };
}

function mapDirectPermissionGrantRow(
  row: DirectPermissionGrantRow
): DirectPermissionGrant {
  const permission = parsePermission(row.permission);
  const scope = parsePermissionScope(row.scope_type, row.scope_id);

  assertPermissionScopeAllowed(permission, scope.type);

  return {
    id: row.id,
    tenantId: row.tenant_id as TenantId,
    employeeId: row.employee_id as EmployeeId,
    permission,
    scope,
    reason: row.reason,
    startsAt: mapOptionalSqlTimestamp(row.starts_at) ?? undefined,
    expiresAt: mapOptionalSqlTimestamp(row.expires_at) ?? undefined,
    revokedAt: mapOptionalSqlTimestamp(row.revoked_at) ?? undefined
  };
}

function parsePermissions(value: unknown): readonly Permission[] {
  if (!Array.isArray(value)) {
    throw new CoreError("validation.failed");
  }

  return value.map((permission) => {
    if (typeof permission !== "string") {
      throw new CoreError("validation.failed");
    }

    return parsePermission(permission);
  });
}

function parsePermission(value: string): Permission {
  if (!isPermission(value)) {
    throw new CoreError("validation.failed");
  }

  return value;
}

function parseRoleStatus(value: string): TenantRoleStatus {
  assertRoleStatus(value);

  return value;
}

function parseRoleBindingSubject(
  type: string,
  id: string
): PermissionRoleBindingSubject {
  const subject = {
    type,
    id
  };

  assertRoleBindingSubject(subject);

  return subject;
}

function parsePermissionScope(
  scopeType: string,
  scopeId: string | null
): PermissionScope {
  if (!isPermissionScopeType(scopeType)) {
    throw new CoreError("validation.failed");
  }

  const scope =
    scopeId === null
      ? {
          type: scopeType
        }
      : {
          type: scopeType,
          id: scopeId
        };

  assertScope(scope);

  return scope;
}

function actorSubjectPredicate(actor: PermissionActor): SQL {
  const predicates = [
    sql`(subject_type = 'employee' and subject_id = ${actor.employeeId})`
  ];

  if (actor.teamIds?.length) {
    predicates.push(sql`
      (subject_type = 'team' and subject_id in (${sql.join(
        actor.teamIds.map((teamId) => sql`${teamId}`),
        sql`, `
      )}))
    `);
  }

  if (actor.orgUnitIds?.length) {
    predicates.push(sql`
      (subject_type = 'org_unit' and subject_id in (${sql.join(
        actor.orgUnitIds.map((orgUnitId) => sql`${orgUnitId}`),
        sql`, `
      )}))
    `);
  }

  if (actor.queueIds?.length) {
    predicates.push(sql`
      (subject_type = 'queue' and subject_id in (${sql.join(
        actor.queueIds.map((queueId) => sql`${queueId}`),
        sql`, `
      )}))
    `);
  }

  return sql.join(predicates, sql` or `);
}

function serializeFixedEmployeeRoleTemplates(): string {
  return JSON.stringify(
    fixedEmployeeRoles.map((role) => {
      return {
        role,
        name: tenantRoleName(role),
        description: tenantRoleDescription(role),
        permissions: permissionsForRoles([role])
      };
    })
  );
}

const fixedEmployeeRoles = [
  "tenant_admin",
  "supervisor",
  "agent"
] as const satisfies readonly EmployeeRole[];

function scopeId(scope: PermissionScope): string | null {
  return "id" in scope ? scope.id : null;
}

function tenantRoleName(role: EmployeeRole): string {
  switch (role) {
    case "tenant_admin":
      return "Tenant admin";
    case "supervisor":
      return "Supervisor";
    case "agent":
      return "Agent";
  }
}

function tenantRoleDescription(role: EmployeeRole): string {
  return `System compatibility role for ${role}.`;
}

function assertPermission(value: string): asserts value is Permission {
  if (!isPermission(value)) {
    throw new CoreError("validation.failed");
  }
}

function assertPermissions(
  values: readonly string[]
): asserts values is readonly Permission[] {
  if (values.length === 0) {
    throw new CoreError("validation.failed");
  }

  for (const value of values) {
    assertPermission(value);
  }
}

function assertScope(value: unknown): asserts value is PermissionScope {
  if (!isPermissionScope(value)) {
    throw new CoreError("validation.failed");
  }
}

function assertRoleBindingSubject(
  value: unknown
): asserts value is PermissionRoleBindingSubject {
  if (!isRecord(value)) {
    throw new CoreError("validation.failed");
  }

  if (
    value.type !== "employee" &&
    value.type !== "team" &&
    value.type !== "org_unit" &&
    value.type !== "queue"
  ) {
    throw new CoreError("validation.failed");
  }

  if (typeof value.id !== "string" || value.id.trim().length === 0) {
    throw new CoreError("validation.failed");
  }
}

function assertRoleStatus(value: string): asserts value is TenantRoleStatus {
  if (value !== "active" && value !== "archived") {
    throw new CoreError("validation.failed");
  }
}

function assertNonEmpty(value: string): void {
  if (value.trim().length === 0) {
    throw new CoreError("validation.failed");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
