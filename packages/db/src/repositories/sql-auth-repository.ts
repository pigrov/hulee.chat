import type { EmployeeId, TenantId } from "@hulee/contracts";
import {
  isEmployeeRole,
  permissionsForRoles,
  type EmployeeRole,
  type Permission
} from "@hulee/core";
import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export type TenantAuthAccount = {
  tenantId: TenantId;
  tenantSlug: string;
  accountId: string;
  employeeId: EmployeeId;
  email: string;
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
  account_id: string;
  employee_id: string;
  email: string;
  display_name: string;
  password_hash: string | null;
  roles: unknown;
};

type PlatformAdminAccountRow = {
  id: string;
  email: string;
  display_name: string;
  password_hash: string | null;
};

type AuthSessionRow = {
  session_id: string;
  expires_at: Date;
  tenant_id: string | null;
  tenant_slug: string | null;
  account_id: string | null;
  employee_id: string | null;
  employee_email: string | null;
  employee_display_name: string | null;
  employee_password_hash: string | null;
  employee_roles: unknown;
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
           accounts.id as account_id,
           employees.id as employee_id,
           accounts.email,
           employees.display_name,
           accounts.password_hash,
           coalesce(json_agg(employee_roles.role order by employee_roles.role)
             filter (where employee_roles.role is not null), '[]'::json) as roles
    from tenants
    inner join accounts on accounts.tenant_id = tenants.id
    inner join employees on employees.tenant_id = tenants.id
      and employees.account_id = accounts.id
    left join employee_roles on employee_roles.tenant_id = tenants.id
      and employee_roles.employee_id = employees.id
    where tenants.slug = ${input.tenantSlug}
      and lower(accounts.email) = lower(${input.email})
    group by tenants.id,
             tenants.slug,
             accounts.id,
             employees.id,
             accounts.email,
             employees.display_name,
             accounts.password_hash
    limit 1
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
           accounts.id as account_id,
           employees.id as employee_id,
           employees.email as employee_email,
           employees.display_name as employee_display_name,
           accounts.password_hash as employee_password_hash,
           coalesce(json_agg(employee_roles.role order by employee_roles.role)
             filter (where employee_roles.role is not null), '[]'::json) as employee_roles,
           platform_admin_accounts.id as platform_admin_account_id,
           platform_admin_accounts.email as platform_admin_email,
           platform_admin_accounts.display_name as platform_admin_display_name
    from sessions
    left join tenants on tenants.id = sessions.tenant_id
    left join employees on employees.id = sessions.employee_id
      and employees.tenant_id = sessions.tenant_id
    left join accounts on accounts.id = employees.account_id
      and accounts.tenant_id = sessions.tenant_id
    left join employee_roles on employee_roles.tenant_id = sessions.tenant_id
      and employee_roles.employee_id = employees.id
    left join platform_admin_accounts
      on platform_admin_accounts.id = sessions.platform_admin_account_id
    where sessions.session_hash = ${hashAuthSessionToken(token)}
      and sessions.revoked_at is null
      and sessions.expires_at > ${now}
    group by sessions.id,
             sessions.expires_at,
             tenants.id,
             tenants.slug,
             accounts.id,
             employees.id,
             employees.email,
             employees.display_name,
             accounts.password_hash,
             platform_admin_accounts.id,
             platform_admin_accounts.email,
             platform_admin_accounts.display_name
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
    )
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
  `;
}

export function hashAuthSessionToken(token: string): string {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

function mapTenantAccountRow(row: TenantAuthAccountRow): TenantAuthAccount {
  const roles = parseEmployeeRoles(row.roles);

  return {
    tenantId: row.tenant_id as TenantId,
    tenantSlug: row.tenant_slug,
    accountId: row.account_id,
    employeeId: row.employee_id as EmployeeId,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    roles,
    permissions: permissionsForRoles(roles)
  };
}

function mapAuthSessionRow(row: AuthSessionRow): AuthSessionPrincipal {
  const tenantAccount =
    row.tenant_id &&
    row.tenant_slug &&
    row.account_id &&
    row.employee_id &&
    row.employee_email &&
    row.employee_display_name
      ? mapTenantAccountRow({
          tenant_id: row.tenant_id,
          tenant_slug: row.tenant_slug,
          account_id: row.account_id,
          employee_id: row.employee_id,
          email: row.employee_email,
          display_name: row.employee_display_name,
          password_hash: row.employee_password_hash,
          roles: row.employee_roles
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
    expiresAt: row.expires_at,
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

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
