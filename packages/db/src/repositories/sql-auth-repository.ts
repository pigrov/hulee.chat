import type { EmployeeId, TenantId } from "@hulee/contracts";
import {
  isEmployeeRole,
  isPermission,
  permissionsForRoles,
  type EmployeeRole,
  type Permission
} from "@hulee/core";
import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";
import type { SqlTimestamp } from "./sql-timestamp";

export type TenantAuthAccount = {
  tenantId: TenantId;
  tenantSlug: string;
  tenantDisplayName: string;
  accountId: string;
  employeeId: EmployeeId;
  email: string;
  emailVerifiedAt: Date | null;
  displayName: string;
  passwordHash: string | null;
  roles: readonly EmployeeRole[];
  permissions: readonly Permission[];
};

export type PlatformAdminAuthAccount = {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string | null;
};

export type AuthSessionPrincipal = {
  sessionId: string;
  expiresAt: Date;
  tenantAccount?: TenantAuthAccount;
  platformAdmin?: Omit<PlatformAdminAuthAccount, "passwordHash">;
};

export type CreateAuthSessionInput = {
  id: string;
  token: string;
  tenantId?: TenantId;
  employeeId?: EmployeeId;
  platformAdminAccountId?: string;
  expiresAt: Date;
  createdAt: Date;
};

export type UpsertPlatformAdminAccountInput = {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  updatedAt: Date;
};

export type UpsertTenantAdminAccountInput = {
  accountId: string;
  employeeId: EmployeeId;
  tenantId: TenantId;
  email: string;
  displayName: string;
  passwordHash: string;
  updatedAt: Date;
};

export type LocalAuthRepository = {
  findTenantAccount(input: {
    tenantSlug: string;
    email: string;
  }): Promise<TenantAuthAccount | null>;
  listTenantAccountsByEmail(
    email: string
  ): Promise<readonly TenantAuthAccount[]>;
  findPlatformAdminAccount(
    email: string
  ): Promise<PlatformAdminAuthAccount | null>;
  createSession(input: CreateAuthSessionInput): Promise<void>;
  findSessionByToken(
    token: string,
    now: Date
  ): Promise<AuthSessionPrincipal | null>;
  revokeSession(token: string, revokedAt: Date): Promise<void>;
  upsertPlatformAdminAccount(
    input: UpsertPlatformAdminAccountInput
  ): Promise<void>;
  upsertTenantAdminAccount(input: UpsertTenantAdminAccountInput): Promise<void>;
};

type TenantAuthAccountRow = {
  tenant_id: string;
  tenant_slug: string;
  tenant_display_name: string;
  account_id: string;
  employee_id: string;
  email: string;
  email_verified_at: SqlTimestamp | null;
  display_name: string;
  password_hash: string | null;
  roles: unknown;
  permissions: unknown;
};

type PlatformAdminAccountRow = {
  id: string;
  email: string;
  display_name: string;
  password_hash: string | null;
};

type AuthSessionRow = {
  session_id: string;
  expires_at: SqlTimestamp;
  tenant_id: string | null;
  tenant_slug: string | null;
  tenant_display_name: string | null;
  account_id: string | null;
  employee_id: string | null;
  employee_email: string | null;
  employee_email_verified_at: SqlTimestamp | null;
  employee_display_name: string | null;
  employee_password_hash: string | null;
  employee_roles: unknown;
  employee_permissions: unknown;
  platform_admin_account_id: string | null;
  platform_admin_email: string | null;
  platform_admin_display_name: string | null;
};

export function createSqlLocalAuthRepository(
  executor: RawSqlExecutor | HuleeDatabase
): LocalAuthRepository {
  const rawExecutor = executor as RawSqlExecutor;

  return {
    async findTenantAccount(input) {
      const result = await rawExecutor.execute<TenantAuthAccountRow>(
        buildFindTenantAccountByEmailSql(input)
      );
      const row = result.rows[0];

      return row === undefined ? null : mapTenantAccountRow(row);
    },

    async listTenantAccountsByEmail(email) {
      const result = await rawExecutor.execute<TenantAuthAccountRow>(
        buildListTenantAccountsByEmailSql(email)
      );

      return result.rows.map(mapTenantAccountRow);
    },

    async findPlatformAdminAccount(email) {
      const result = await rawExecutor.execute<PlatformAdminAccountRow>(
        buildFindPlatformAdminByEmailSql(email)
      );
      const row = result.rows[0];

      return row === undefined
        ? null
        : {
            id: row.id,
            email: row.email,
            displayName: row.display_name,
            passwordHash: row.password_hash
          };
    },

    async createSession(input) {
      await rawExecutor.execute(buildInsertAuthSessionSql(input));
    },

    async findSessionByToken(token, now) {
      const result = await rawExecutor.execute<AuthSessionRow>(
        buildFindAuthSessionByTokenSql(token, now)
      );
      const row = result.rows[0];

      return row === undefined ? null : mapAuthSessionRow(row);
    },

    async revokeSession(token, revokedAt) {
      await rawExecutor.execute(buildRevokeAuthSessionSql(token, revokedAt));
    },

    async upsertPlatformAdminAccount(input) {
      await rawExecutor.execute(buildUpsertPlatformAdminAccountSql(input));
    },

    async upsertTenantAdminAccount(input) {
      await rawExecutor.execute(buildUpsertTenantAdminAccountSql(input));
    }
  };
}

export function buildFindTenantAccountByEmailSql(input: {
  tenantSlug: string;
  email: string;
}): SQL {
  return sql`
    select tenants.id as tenant_id,
           tenants.slug as tenant_slug,
           tenants.display_name as tenant_display_name,
           accounts.id as account_id,
           employees.id as employee_id,
           accounts.email,
           accounts.email_verified_at,
           employees.display_name,
           accounts.password_hash,
           legacy_roles.roles,
           tenant_permissions.permissions
    from tenants
    inner join accounts on accounts.tenant_id = tenants.id
    inner join employees on employees.tenant_id = tenants.id
      and employees.account_id = accounts.id
      and employees.deactivated_at is null
    left join lateral (
      select coalesce(
               json_agg(employee_roles.role order by employee_roles.role)
                 filter (where employee_roles.role is not null),
               '[]'::json
             ) as roles
      from employee_roles
      where employee_roles.tenant_id = tenants.id
        and employee_roles.employee_id = employees.id
    ) legacy_roles on true
    left join lateral (
      ${buildAccessiblePermissionAggregationSql(sql`tenants.id`, sql`employees.id`, sql`now()`)}
    ) tenant_permissions on true
    where tenants.slug = ${input.tenantSlug}
      and lower(accounts.email) = lower(${input.email})
    limit 1
  `;
}

export function buildListTenantAccountsByEmailSql(email: string): SQL {
  return sql`
    select tenants.id as tenant_id,
           tenants.slug as tenant_slug,
           tenants.display_name as tenant_display_name,
           accounts.id as account_id,
           employees.id as employee_id,
           accounts.email,
           accounts.email_verified_at,
           employees.display_name,
           accounts.password_hash,
           legacy_roles.roles,
           tenant_permissions.permissions
    from tenants
    inner join accounts on accounts.tenant_id = tenants.id
    inner join employees on employees.tenant_id = tenants.id
      and employees.account_id = accounts.id
      and employees.deactivated_at is null
    left join lateral (
      select coalesce(
               json_agg(employee_roles.role order by employee_roles.role)
                 filter (where employee_roles.role is not null),
               '[]'::json
             ) as roles
      from employee_roles
      where employee_roles.tenant_id = tenants.id
        and employee_roles.employee_id = employees.id
    ) legacy_roles on true
    left join lateral (
      ${buildAccessiblePermissionAggregationSql(sql`tenants.id`, sql`employees.id`, sql`now()`)}
    ) tenant_permissions on true
    where lower(accounts.email) = lower(${email})
    order by tenants.display_name asc,
             tenants.slug asc
  `;
}

export function buildFindPlatformAdminByEmailSql(email: string): SQL {
  return sql`
    select id,
           email,
           display_name,
           password_hash
    from platform_admin_accounts
    where lower(email) = lower(${email})
    limit 1
  `;
}

export function buildInsertAuthSessionSql(input: CreateAuthSessionInput): SQL {
  return sql`
    insert into sessions (
      id,
      session_hash,
      tenant_id,
      employee_id,
      platform_admin_account_id,
      expires_at,
      created_at,
      updated_at
    )
    values (
      ${input.id},
      ${hashAuthSessionToken(input.token)},
      ${input.tenantId ?? null},
      ${input.employeeId ?? null},
      ${input.platformAdminAccountId ?? null},
      ${input.expiresAt},
      ${input.createdAt},
      ${input.createdAt}
    )
  `;
}

export function buildFindAuthSessionByTokenSql(token: string, now: Date): SQL {
  return sql`
    select sessions.id as session_id,
           sessions.expires_at,
           tenants.id as tenant_id,
           tenants.slug as tenant_slug,
           tenants.display_name as tenant_display_name,
           accounts.id as account_id,
           employees.id as employee_id,
           employees.email as employee_email,
           accounts.email_verified_at as employee_email_verified_at,
           employees.display_name as employee_display_name,
           accounts.password_hash as employee_password_hash,
           legacy_roles.roles as employee_roles,
           tenant_permissions.permissions as employee_permissions,
           platform_admin_accounts.id as platform_admin_account_id,
           platform_admin_accounts.email as platform_admin_email,
           platform_admin_accounts.display_name as platform_admin_display_name
    from sessions
    left join tenants on tenants.id = sessions.tenant_id
    left join employees on employees.id = sessions.employee_id
      and employees.tenant_id = sessions.tenant_id
      and employees.deactivated_at is null
    left join accounts on accounts.id = employees.account_id
      and accounts.tenant_id = sessions.tenant_id
    left join lateral (
      select coalesce(
               json_agg(employee_roles.role order by employee_roles.role)
                 filter (where employee_roles.role is not null),
               '[]'::json
             ) as roles
      from employee_roles
      where employee_roles.tenant_id = sessions.tenant_id
        and employee_roles.employee_id = employees.id
    ) legacy_roles on true
    left join lateral (
      ${buildAccessiblePermissionAggregationSql(sql`sessions.tenant_id`, sql`employees.id`, sql`${now}`)}
    ) tenant_permissions on true
    left join platform_admin_accounts
      on platform_admin_accounts.id = sessions.platform_admin_account_id
    where sessions.session_hash = ${hashAuthSessionToken(token)}
      and sessions.revoked_at is null
      and sessions.expires_at > ${now}
      and (sessions.tenant_id is null or employees.id is not null)
    limit 1
  `;
}

export function buildRevokeAuthSessionSql(token: string, revokedAt: Date): SQL {
  return sql`
    update sessions
    set revoked_at = ${revokedAt},
        updated_at = ${revokedAt}
    where session_hash = ${hashAuthSessionToken(token)}
      and revoked_at is null
  `;
}

export function buildUpsertPlatformAdminAccountSql(
  input: UpsertPlatformAdminAccountInput
): SQL {
  return sql`
    insert into platform_admin_accounts (
      id,
      email,
      display_name,
      password_hash,
      created_at,
      updated_at
    )
    values (
      ${input.id},
      ${normalizeEmail(input.email)},
      ${input.displayName},
      ${input.passwordHash},
      ${input.updatedAt},
      ${input.updatedAt}
    )
    on conflict (email) do update
    set display_name = excluded.display_name,
        password_hash = excluded.password_hash,
        updated_at = excluded.updated_at
  `;
}

export function buildUpsertTenantAdminAccountSql(
  input: UpsertTenantAdminAccountInput
): SQL {
  return sql`
    with account_upsert as (
      insert into accounts (
        id,
        tenant_id,
        email,
        password_hash,
        created_at,
        updated_at
      )
      values (
        ${input.accountId},
        ${input.tenantId},
        ${normalizeEmail(input.email)},
        ${input.passwordHash},
        ${input.updatedAt},
        ${input.updatedAt}
      )
      on conflict (id) do update
      set email = excluded.email,
          password_hash = excluded.password_hash,
          updated_at = excluded.updated_at
      returning id
    ),
    employee_upsert as (
      insert into employees (
        id,
        tenant_id,
        account_id,
        email,
        display_name,
        created_at,
        updated_at
      )
      values (
        ${input.employeeId},
        ${input.tenantId},
        ${input.accountId},
        ${normalizeEmail(input.email)},
        ${input.displayName},
        ${input.updatedAt},
        ${input.updatedAt}
      )
      on conflict (id) do update
      set account_id = excluded.account_id,
          email = excluded.email,
          display_name = excluded.display_name,
          updated_at = excluded.updated_at
      returning id
    ),
    legacy_role_upsert as (
      insert into employee_roles (
        tenant_id,
        employee_id,
        role,
        created_at,
        updated_at
      )
      values (
        ${input.tenantId},
        ${input.employeeId},
        'tenant_admin',
        ${input.updatedAt},
        ${input.updatedAt}
      )
      on conflict (tenant_id, employee_id, role) do nothing
      returning role
    ),
    tenant_role_upsert as (
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
      values (
        ${tenantRoleIdSql(input.tenantId, "tenant_admin")},
        ${input.tenantId},
        'Tenant admin',
        'System compatibility role for tenant_admin.',
        'active',
        true,
        null,
        null,
        ${input.updatedAt},
        ${input.updatedAt}
      )
      on conflict (id) do update
      set status = 'active',
          archived_at = null,
          updated_at = excluded.updated_at
      returning id
    ),
    tenant_role_permission_upsert as (
      insert into tenant_role_permissions (
        tenant_id,
        role_id,
        permission,
        created_at,
        updated_at
      )
      select ${input.tenantId},
             ${tenantRoleIdSql(input.tenantId, "tenant_admin")},
             permission_rows.permission,
             ${input.updatedAt},
             ${input.updatedAt}
      from jsonb_array_elements_text(${tenantAdminPermissionsJson()}::jsonb)
        as permission_rows(permission)
      on conflict (tenant_id, role_id, permission) do nothing
      returning permission
    ),
    tenant_role_binding_upsert as (
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
      values (
        ${tenantRoleBindingIdSql(input.tenantId, input.employeeId, "tenant_admin")},
        ${input.tenantId},
        ${tenantRoleIdSql(input.tenantId, "tenant_admin")},
        'employee',
        ${input.employeeId},
        'tenant',
        null,
        null,
        null,
        null,
        null,
        ${input.updatedAt},
        ${input.updatedAt}
      )
      on conflict (id) do update
      set revoked_at = null,
          updated_at = excluded.updated_at
      returning id
    )
    select id
    from tenant_role_binding_upsert
    limit 1
  `;
}

export function hashAuthSessionToken(token: string): string {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

function mapTenantAccountRow(row: TenantAuthAccountRow): TenantAuthAccount {
  const roles = parseEmployeeRoles(row.roles);
  const permissions = parsePermissions(row.permissions);

  return {
    tenantId: row.tenant_id as TenantId,
    tenantSlug: row.tenant_slug,
    tenantDisplayName: row.tenant_display_name,
    accountId: row.account_id,
    employeeId: row.employee_id as EmployeeId,
    email: row.email,
    emailVerifiedAt:
      row.email_verified_at === null ? null : new Date(row.email_verified_at),
    displayName: row.display_name,
    passwordHash: row.password_hash,
    roles,
    permissions
  };
}

function mapAuthSessionRow(row: AuthSessionRow): AuthSessionPrincipal {
  const tenantAccount =
    row.tenant_id &&
    row.tenant_slug &&
    row.tenant_display_name &&
    row.account_id &&
    row.employee_id &&
    row.employee_email &&
    row.employee_display_name
      ? mapTenantAccountRow({
          tenant_id: row.tenant_id,
          tenant_slug: row.tenant_slug,
          tenant_display_name: row.tenant_display_name,
          account_id: row.account_id,
          employee_id: row.employee_id,
          email: row.employee_email,
          email_verified_at: row.employee_email_verified_at,
          display_name: row.employee_display_name,
          password_hash: row.employee_password_hash,
          roles: row.employee_roles,
          permissions: row.employee_permissions
        })
      : undefined;
  const platformAdmin =
    row.platform_admin_account_id &&
    row.platform_admin_email &&
    row.platform_admin_display_name
      ? {
          id: row.platform_admin_account_id,
          email: row.platform_admin_email,
          displayName: row.platform_admin_display_name
        }
      : undefined;

  return {
    sessionId: row.session_id,
    expiresAt: new Date(row.expires_at),
    tenantAccount,
    platformAdmin
  };
}

function parseEmployeeRoles(value: unknown): readonly EmployeeRole[] {
  const roles = Array.isArray(value) ? value : [];

  return roles.filter((role): role is EmployeeRole => {
    return typeof role === "string" && isEmployeeRole(role);
  });
}

function parsePermissions(value: unknown): readonly Permission[] {
  const permissions = Array.isArray(value) ? value : [];

  return permissions.filter((permission): permission is Permission => {
    return typeof permission === "string" && isPermission(permission);
  });
}

function buildAccessiblePermissionAggregationSql(
  tenantId: SQL,
  employeeId: SQL,
  at: SQL
): SQL {
  return sql`
    select coalesce(
             json_agg(permission_rows.permission order by permission_rows.permission),
             '[]'::json
           ) as permissions
    from (
      select distinct permission_source.permission
      from (
        select tenant_role_permissions.permission
        from tenant_role_bindings
        inner join tenant_roles
          on tenant_roles.tenant_id = tenant_role_bindings.tenant_id
         and tenant_roles.id = tenant_role_bindings.role_id
         and tenant_roles.status = 'active'
         and tenant_roles.archived_at is null
        inner join tenant_role_permissions
          on tenant_role_permissions.tenant_id = tenant_role_bindings.tenant_id
         and tenant_role_permissions.role_id = tenant_role_bindings.role_id
        where tenant_role_bindings.tenant_id = ${tenantId}
          and (
            (
              tenant_role_bindings.subject_type = 'employee'
              and tenant_role_bindings.subject_id = ${employeeId}
            )
            or (
              tenant_role_bindings.subject_type = 'org_unit'
              and exists (
                select 1
                from employee_org_unit_memberships
                inner join org_units
                  on org_units.tenant_id =
                      employee_org_unit_memberships.tenant_id
                 and org_units.id =
                      employee_org_unit_memberships.org_unit_id
                 and org_units.status = 'active'
                where employee_org_unit_memberships.tenant_id = ${tenantId}
                  and employee_org_unit_memberships.employee_id = ${employeeId}
                  and employee_org_unit_memberships.org_unit_id =
                      tenant_role_bindings.subject_id
              )
            )
            or (
              tenant_role_bindings.subject_type = 'queue'
              and exists (
                select 1
                from employee_work_queue_memberships
                inner join work_queues
                  on work_queues.tenant_id =
                      employee_work_queue_memberships.tenant_id
                 and work_queues.id =
                      employee_work_queue_memberships.work_queue_id
                 and work_queues.status = 'active'
                where employee_work_queue_memberships.tenant_id = ${tenantId}
                  and employee_work_queue_memberships.employee_id = ${employeeId}
                  and employee_work_queue_memberships.work_queue_id =
                      tenant_role_bindings.subject_id
              )
            )
          )
          and tenant_role_bindings.revoked_at is null
          and (
            tenant_role_bindings.starts_at is null
            or tenant_role_bindings.starts_at <= ${at}
          )
          and (
            tenant_role_bindings.expires_at is null
            or tenant_role_bindings.expires_at > ${at}
          )
        union all
        select direct_permission_grants.permission
        from direct_permission_grants
        where direct_permission_grants.tenant_id = ${tenantId}
          and direct_permission_grants.employee_id = ${employeeId}
          and direct_permission_grants.revoked_at is null
          and (
            direct_permission_grants.starts_at is null
            or direct_permission_grants.starts_at <= ${at}
          )
          and (
            direct_permission_grants.expires_at is null
            or direct_permission_grants.expires_at > ${at}
          )
      ) permission_source
    ) permission_rows
  `;
}

function tenantRoleIdSql(tenantId: TenantId, role: EmployeeRole): string {
  return `role:${tenantId}:${role}`;
}

function tenantRoleBindingIdSql(
  tenantId: TenantId,
  employeeId: EmployeeId,
  role: EmployeeRole
): string {
  return `role_binding:${tenantId}:${employeeId}:${role}:tenant`;
}

function tenantAdminPermissionsJson(): string {
  return JSON.stringify(permissionsForRoles(["tenant_admin"]));
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
