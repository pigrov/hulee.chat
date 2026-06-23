import type { EmployeeId, PlatformEvent, TenantId } from "@hulee/contracts";
import {
  CoreError,
  isEmployeeRole,
  permissionsForRoles,
  type Employee,
  type EmployeeInvitation,
  type EmployeeRole
} from "@hulee/core";
import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";
import type { TenantAuthAccount } from "./sql-auth-repository";

export type TenantEmployeeRecord = {
  tenantId: TenantId;
  employeeId: EmployeeId;
  accountId: string | null;
  email: string;
  displayName: string;
  roles: readonly EmployeeRole[];
  createdAt: Date;
  deactivatedAt: Date | null;
};

export type EmployeeInvitationPreview = {
  invitation: EmployeeInvitation;
  tenantSlug: string;
  tenantDisplayName: string;
  productName: string;
};

export type ListTenantEmployeesInput = {
  tenantId: TenantId;
};

export type ListTenantInvitationsInput = {
  tenantId: TenantId;
  limit: number;
};

export type FindTenantEmployeeInput = {
  tenantId: TenantId;
  employeeId: EmployeeId;
};

export type FindTenantInvitationInput = {
  tenantId: TenantId;
  invitationId: string;
};

export type CreateEmployeeInvitationPersistenceInput = {
  invitation: EmployeeInvitation;
  events: readonly PlatformEvent[];
};

export type AcceptEmployeeInvitationPersistenceInput = {
  tokenHash: string;
  accountId: string;
  passwordHash: string;
  employee: Employee;
  events: readonly PlatformEvent[];
  acceptedAt: Date;
};

export type ChangeEmployeeRolePersistenceInput = {
  tenantId: TenantId;
  employeeId: EmployeeId;
  role: EmployeeRole;
  changedAt: Date;
  events: readonly PlatformEvent[];
};

export type DeactivateEmployeePersistenceInput = {
  tenantId: TenantId;
  employeeId: EmployeeId;
  deactivatedAt: Date;
  events: readonly PlatformEvent[];
};

export type RevokeEmployeeInvitationPersistenceInput = {
  tenantId: TenantId;
  invitationId: string;
  revokedAt: Date;
  events: readonly PlatformEvent[];
};

export type RefreshEmployeeInvitationPersistenceInput = {
  invitation: EmployeeInvitation;
  refreshedAt: Date;
  events: readonly PlatformEvent[];
};

export type EmployeeDirectoryRepository = {
  listEmployees(
    input: ListTenantEmployeesInput
  ): Promise<readonly TenantEmployeeRecord[]>;
  listInvitations(
    input: ListTenantInvitationsInput
  ): Promise<readonly EmployeeInvitation[]>;
  findInvitationByTokenHash(
    tokenHash: string
  ): Promise<EmployeeInvitationPreview | null>;
  findEmployee(
    input: FindTenantEmployeeInput
  ): Promise<TenantEmployeeRecord | null>;
  findInvitation(
    input: FindTenantInvitationInput
  ): Promise<EmployeeInvitationPreview | null>;
  createInvitation(
    input: CreateEmployeeInvitationPersistenceInput
  ): Promise<void>;
  acceptInvitation(
    input: AcceptEmployeeInvitationPersistenceInput
  ): Promise<TenantAuthAccount>;
  changeEmployeeRole(input: ChangeEmployeeRolePersistenceInput): Promise<void>;
  deactivateEmployee(input: DeactivateEmployeePersistenceInput): Promise<void>;
  revokeInvitation(
    input: RevokeEmployeeInvitationPersistenceInput
  ): Promise<void>;
  refreshInvitation(
    input: RefreshEmployeeInvitationPersistenceInput
  ): Promise<void>;
};

type EmployeeRow = {
  tenant_id: string;
  employee_id: string;
  account_id: string | null;
  email: string;
  display_name: string;
  roles: unknown;
  created_at: Date;
  deactivated_at: Date | null;
};

type InvitationRow = {
  id: string;
  tenant_id: string;
  email: string;
  display_name: string | null;
  role: string;
  token_hash: string;
  invited_by_employee_id: string;
  accepted_employee_id: string | null;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
};

type InvitationPreviewRow = InvitationRow & {
  tenant_slug: string;
  tenant_display_name: string;
  product_name: string | null;
};

type AcceptedInvitationRow = {
  tenant_id: string;
  tenant_slug: string;
  account_id: string;
  employee_id: string;
  email: string;
  display_name: string;
  password_hash: string | null;
  roles: unknown;
};

export function createSqlEmployeeDirectoryRepository(
  executor: RawSqlExecutor | HuleeDatabase
): EmployeeDirectoryRepository {
  const rawExecutor = executor as RawSqlExecutor;

  return {
    async listEmployees(input) {
      const result = await rawExecutor.execute<EmployeeRow>(
        buildListTenantEmployeesSql(input)
      );

      return result.rows.map(mapEmployeeRow);
    },

    async listInvitations(input) {
      const result = await rawExecutor.execute<InvitationRow>(
        buildListTenantInvitationsSql(input)
      );

      return result.rows.map(mapInvitationRow);
    },

    async findInvitationByTokenHash(tokenHash) {
      const result = await rawExecutor.execute<InvitationPreviewRow>(
        buildFindInvitationByTokenHashSql(tokenHash)
      );
      const row = result.rows[0];

      return row === undefined ? null : mapInvitationPreviewRow(row);
    },

    async findEmployee(input) {
      const result = await rawExecutor.execute<EmployeeRow>(
        buildFindTenantEmployeeSql(input)
      );
      const row = result.rows[0];

      return row === undefined ? null : mapEmployeeRow(row);
    },

    async findInvitation(input) {
      const result = await rawExecutor.execute<InvitationPreviewRow>(
        buildFindInvitationByIdSql(input)
      );
      const row = result.rows[0];

      return row === undefined ? null : mapInvitationPreviewRow(row);
    },

    async createInvitation(input) {
      await rawExecutor.execute(buildCreateEmployeeInvitationSql(input));
    },

    async acceptInvitation(input) {
      const result = await rawExecutor.execute<AcceptedInvitationRow>(
        buildAcceptEmployeeInvitationSql(input)
      );
      const row = result.rows[0];

      if (row === undefined) {
        throw new CoreError("validation.failed");
      }

      return mapAcceptedInvitationRow(row);
    },

    async changeEmployeeRole(input) {
      const result = await rawExecutor.execute<{ employee_id: string }>(
        buildChangeEmployeeRoleSql(input)
      );

      if (result.rows[0] === undefined) {
        throw new CoreError("validation.failed");
      }
    },

    async deactivateEmployee(input) {
      const result = await rawExecutor.execute<{ employee_id: string }>(
        buildDeactivateEmployeeSql(input)
      );

      if (result.rows[0] === undefined) {
        throw new CoreError("validation.failed");
      }
    },

    async revokeInvitation(input) {
      const result = await rawExecutor.execute<{ invitation_id: string }>(
        buildRevokeEmployeeInvitationSql(input)
      );

      if (result.rows[0] === undefined) {
        throw new CoreError("validation.failed");
      }
    },

    async refreshInvitation(input) {
      const result = await rawExecutor.execute<{ invitation_id: string }>(
        buildRefreshEmployeeInvitationSql(input)
      );

      if (result.rows[0] === undefined) {
        throw new CoreError("validation.failed");
      }
    }
  };
}

export function buildListTenantEmployeesSql(
  input: ListTenantEmployeesInput
): SQL {
  return sql`
    select employees.tenant_id,
           employees.id as employee_id,
           employees.account_id,
           employees.email,
           employees.display_name,
           employees.created_at,
           employees.deactivated_at,
           coalesce(json_agg(employee_roles.role order by employee_roles.role)
             filter (where employee_roles.role is not null), '[]'::json) as roles
    from employees
    left join employee_roles on employee_roles.tenant_id = employees.tenant_id
      and employee_roles.employee_id = employees.id
    where employees.tenant_id = ${input.tenantId}
    group by employees.tenant_id,
             employees.id,
             employees.account_id,
             employees.email,
             employees.display_name,
             employees.created_at,
             employees.deactivated_at
    order by employees.created_at asc
  `;
}

export function buildFindTenantEmployeeSql(
  input: FindTenantEmployeeInput
): SQL {
  return sql`
    select employees.tenant_id,
           employees.id as employee_id,
           employees.account_id,
           employees.email,
           employees.display_name,
           employees.created_at,
           employees.deactivated_at,
           coalesce(json_agg(employee_roles.role order by employee_roles.role)
             filter (where employee_roles.role is not null), '[]'::json) as roles
    from employees
    left join employee_roles on employee_roles.tenant_id = employees.tenant_id
      and employee_roles.employee_id = employees.id
    where employees.tenant_id = ${input.tenantId}
      and employees.id = ${input.employeeId}
    group by employees.tenant_id,
             employees.id,
             employees.account_id,
             employees.email,
             employees.display_name,
             employees.created_at,
             employees.deactivated_at
    limit 1
  `;
}

export function buildListTenantInvitationsSql(
  input: ListTenantInvitationsInput
): SQL {
  return sql`
    select id,
           tenant_id,
           email,
           display_name,
           role,
           token_hash,
           invited_by_employee_id,
           accepted_employee_id,
           expires_at,
           accepted_at,
           revoked_at,
           created_at
    from employee_invitations
    where tenant_id = ${input.tenantId}
    order by created_at desc
    limit ${input.limit}
  `;
}

export function buildFindInvitationByIdSql(
  input: FindTenantInvitationInput
): SQL {
  return sql`
    select employee_invitations.id,
           employee_invitations.tenant_id,
           employee_invitations.email,
           employee_invitations.display_name,
           employee_invitations.role,
           employee_invitations.token_hash,
           employee_invitations.invited_by_employee_id,
           employee_invitations.accepted_employee_id,
           employee_invitations.expires_at,
           employee_invitations.accepted_at,
           employee_invitations.revoked_at,
           employee_invitations.created_at,
           tenants.slug as tenant_slug,
           tenants.display_name as tenant_display_name,
           brand.product_name
    from employee_invitations
    inner join tenants on tenants.id = employee_invitations.tenant_id
    left join lateral (
      select tenant_brand_profiles.product_name
      from tenant_brand_profiles
      where tenant_brand_profiles.tenant_id = tenants.id
      order by tenant_brand_profiles.created_at desc
      limit 1
    ) brand on true
    where employee_invitations.tenant_id = ${input.tenantId}
      and employee_invitations.id = ${input.invitationId}
    limit 1
  `;
}

export function buildFindInvitationByTokenHashSql(tokenHash: string): SQL {
  return sql`
    select employee_invitations.id,
           employee_invitations.tenant_id,
           employee_invitations.email,
           employee_invitations.display_name,
           employee_invitations.role,
           employee_invitations.token_hash,
           employee_invitations.invited_by_employee_id,
           employee_invitations.accepted_employee_id,
           employee_invitations.expires_at,
           employee_invitations.accepted_at,
           employee_invitations.revoked_at,
           employee_invitations.created_at,
           tenants.slug as tenant_slug,
           tenants.display_name as tenant_display_name,
           brand.product_name
    from employee_invitations
    inner join tenants on tenants.id = employee_invitations.tenant_id
    left join lateral (
      select tenant_brand_profiles.product_name
      from tenant_brand_profiles
      where tenant_brand_profiles.tenant_id = tenants.id
      order by tenant_brand_profiles.created_at desc
      limit 1
    ) brand on true
    where employee_invitations.token_hash = ${tokenHash}
    limit 1
  `;
}

export function buildCreateEmployeeInvitationSql(
  input: CreateEmployeeInvitationPersistenceInput
): SQL {
  return sql`
    with inserted_invitation as (
      insert into employee_invitations (
        id,
        tenant_id,
        email,
        display_name,
        role,
        token_hash,
        invited_by_employee_id,
        expires_at,
        created_at,
        updated_at
      )
      values (
        ${input.invitation.id},
        ${input.invitation.tenantId},
        ${input.invitation.email},
        ${input.invitation.displayName ?? null},
        ${input.invitation.role},
        ${input.invitation.tokenHash},
        ${input.invitation.invitedByEmployeeId},
        ${new Date(input.invitation.expiresAt)},
        ${new Date(input.invitation.createdAt)},
        ${new Date(input.invitation.createdAt)}
      )
      returning id
    ),
    event_rows as (
      select *
      from jsonb_to_recordset(${serializeEventRows(input.events)}::jsonb)
        as event_row(
          id text,
          tenant_id text,
          type text,
          version text,
          occurred_at timestamptz,
          idempotency_key text,
          payload jsonb
        )
    ),
    inserted_events as (
      insert into event_store (
        id,
        tenant_id,
        type,
        version,
        occurred_at,
        idempotency_key,
        payload,
        created_at,
        updated_at
      )
      select id,
             tenant_id,
             type,
             version,
             occurred_at,
             idempotency_key,
             payload,
             occurred_at,
             occurred_at
      from event_rows
      returning id,
                tenant_id,
                payload,
                occurred_at
    )
    insert into outbox (
      id,
      tenant_id,
      event_id,
      status,
      attempts,
      payload,
      created_at,
      updated_at
    )
    select concat('outbox:', id),
           tenant_id,
           id,
           'pending',
           0,
           payload,
           occurred_at,
           occurred_at
    from inserted_events
  `;
}

export function buildAcceptEmployeeInvitationSql(
  input: AcceptEmployeeInvitationPersistenceInput
): SQL {
  const roles = input.employee.roles;
  const role = roles.length === 1 ? roles[0] : undefined;

  if (role === undefined) {
    throw new CoreError("validation.failed");
  }

  return sql`
    with pending_invitation as (
      select employee_invitations.id,
             employee_invitations.tenant_id,
             employee_invitations.email,
             employee_invitations.role,
             tenants.slug as tenant_slug
      from employee_invitations
      inner join tenants on tenants.id = employee_invitations.tenant_id
      where employee_invitations.token_hash = ${input.tokenHash}
        and employee_invitations.tenant_id = ${input.employee.tenantId}
        and employee_invitations.email = ${input.employee.email}
        and employee_invitations.role = ${role}
        and employee_invitations.accepted_at is null
        and employee_invitations.revoked_at is null
        and employee_invitations.expires_at > ${input.acceptedAt}
      limit 1
    ),
    inserted_account as (
      insert into accounts (
        id,
        tenant_id,
        email,
        password_hash,
        email_verified_at,
        created_at,
        updated_at
      )
      select ${input.accountId},
             pending_invitation.tenant_id,
             pending_invitation.email,
             ${input.passwordHash},
             ${input.acceptedAt},
             ${input.acceptedAt},
             ${input.acceptedAt}
      from pending_invitation
      returning id,
                tenant_id,
                email,
                password_hash
    ),
    inserted_employee as (
      insert into employees (
        id,
        tenant_id,
        account_id,
        email,
        display_name,
        created_at,
        updated_at
      )
      select ${input.employee.id},
             pending_invitation.tenant_id,
             inserted_account.id,
             pending_invitation.email,
             ${input.employee.displayName},
             ${input.acceptedAt},
             ${input.acceptedAt}
      from pending_invitation
      inner join inserted_account
        on inserted_account.tenant_id = pending_invitation.tenant_id
      returning id,
                tenant_id,
                account_id,
                email,
                display_name
    ),
    inserted_role as (
      insert into employee_roles (
        tenant_id,
        employee_id,
        role,
        created_at,
        updated_at
      )
      select pending_invitation.tenant_id,
             ${input.employee.id},
             pending_invitation.role,
             ${input.acceptedAt},
             ${input.acceptedAt}
      from pending_invitation
      returning tenant_id,
                employee_id,
                role
    ),
    updated_invitation as (
      update employee_invitations
      set accepted_employee_id = ${input.employee.id},
          accepted_at = ${input.acceptedAt},
          updated_at = ${input.acceptedAt}
      from pending_invitation
      where employee_invitations.id = pending_invitation.id
      returning employee_invitations.id
    ),
    event_rows as (
      select *
      from jsonb_to_recordset(${serializeEventRows(input.events)}::jsonb)
        as event_row(
          id text,
          tenant_id text,
          type text,
          version text,
          occurred_at timestamptz,
          idempotency_key text,
          payload jsonb
        )
    ),
    inserted_events as (
      insert into event_store (
        id,
        tenant_id,
        type,
        version,
        occurred_at,
        idempotency_key,
        payload,
        created_at,
        updated_at
      )
      select event_rows.id,
             event_rows.tenant_id,
             event_rows.type,
             event_rows.version,
             event_rows.occurred_at,
             event_rows.idempotency_key,
             event_rows.payload,
             event_rows.occurred_at,
             event_rows.occurred_at
      from event_rows
      where exists (select 1 from updated_invitation)
      returning id,
                tenant_id,
                payload,
                occurred_at
    ),
    inserted_outbox as (
      insert into outbox (
        id,
        tenant_id,
        event_id,
        status,
        attempts,
        payload,
        created_at,
        updated_at
      )
      select concat('outbox:', id),
             tenant_id,
             id,
             'pending',
             0,
             payload,
             occurred_at,
             occurred_at
      from inserted_events
      returning id
    )
    select pending_invitation.tenant_id,
           pending_invitation.tenant_slug,
           inserted_account.id as account_id,
           inserted_employee.id as employee_id,
           inserted_employee.email,
           inserted_employee.display_name,
           inserted_account.password_hash,
           json_build_array(inserted_role.role) as roles
    from pending_invitation
    inner join inserted_account
      on inserted_account.tenant_id = pending_invitation.tenant_id
    inner join inserted_employee
      on inserted_employee.tenant_id = pending_invitation.tenant_id
    inner join inserted_role
      on inserted_role.tenant_id = pending_invitation.tenant_id
  `;
}

export function buildChangeEmployeeRoleSql(
  input: ChangeEmployeeRolePersistenceInput
): SQL {
  return sql`
    with target_employee as (
      select id,
             tenant_id
      from employees
      where tenant_id = ${input.tenantId}
        and id = ${input.employeeId}
        and deactivated_at is null
      limit 1
    ),
    deleted_roles as (
      delete from employee_roles
      using target_employee
      where employee_roles.tenant_id = target_employee.tenant_id
        and employee_roles.employee_id = target_employee.id
      returning employee_roles.employee_id
    ),
    inserted_role as (
      insert into employee_roles (
        tenant_id,
        employee_id,
        role,
        created_at,
        updated_at
      )
      select target_employee.tenant_id,
             target_employee.id,
             ${input.role},
             ${input.changedAt},
             ${input.changedAt}
      from target_employee
      returning tenant_id,
                employee_id,
                role
    ),
    updated_employee as (
      update employees
      set updated_at = ${input.changedAt}
      from target_employee
      where employees.tenant_id = target_employee.tenant_id
        and employees.id = target_employee.id
      returning employees.id
    ),
    event_rows as (
      select *
      from jsonb_to_recordset(${serializeEventRows(input.events)}::jsonb)
        as event_row(
          id text,
          tenant_id text,
          type text,
          version text,
          occurred_at timestamptz,
          idempotency_key text,
          payload jsonb
        )
    ),
    inserted_events as (
      insert into event_store (
        id,
        tenant_id,
        type,
        version,
        occurred_at,
        idempotency_key,
        payload,
        created_at,
        updated_at
      )
      select event_rows.id,
             event_rows.tenant_id,
             event_rows.type,
             event_rows.version,
             event_rows.occurred_at,
             event_rows.idempotency_key,
             event_rows.payload,
             event_rows.occurred_at,
             event_rows.occurred_at
      from event_rows
      where exists (select 1 from inserted_role)
      returning id,
                tenant_id,
                payload,
                occurred_at
    ),
    inserted_outbox as (
      insert into outbox (
        id,
        tenant_id,
        event_id,
        status,
        attempts,
        payload,
        created_at,
        updated_at
      )
      select concat('outbox:', id),
             tenant_id,
             id,
             'pending',
             0,
             payload,
             occurred_at,
             occurred_at
      from inserted_events
      returning id
    )
    select employee_id
    from inserted_role
    limit 1
  `;
}

export function buildDeactivateEmployeeSql(
  input: DeactivateEmployeePersistenceInput
): SQL {
  return sql`
    with updated_employee as (
      update employees
      set deactivated_at = ${input.deactivatedAt},
          updated_at = ${input.deactivatedAt}
      where tenant_id = ${input.tenantId}
        and id = ${input.employeeId}
        and deactivated_at is null
      returning tenant_id,
                id
    ),
    revoked_sessions as (
      update sessions
      set revoked_at = ${input.deactivatedAt},
          updated_at = ${input.deactivatedAt}
      from updated_employee
      where sessions.tenant_id = updated_employee.tenant_id
        and sessions.employee_id = updated_employee.id
        and sessions.revoked_at is null
      returning sessions.id
    ),
    event_rows as (
      select *
      from jsonb_to_recordset(${serializeEventRows(input.events)}::jsonb)
        as event_row(
          id text,
          tenant_id text,
          type text,
          version text,
          occurred_at timestamptz,
          idempotency_key text,
          payload jsonb
        )
    ),
    inserted_events as (
      insert into event_store (
        id,
        tenant_id,
        type,
        version,
        occurred_at,
        idempotency_key,
        payload,
        created_at,
        updated_at
      )
      select event_rows.id,
             event_rows.tenant_id,
             event_rows.type,
             event_rows.version,
             event_rows.occurred_at,
             event_rows.idempotency_key,
             event_rows.payload,
             event_rows.occurred_at,
             event_rows.occurred_at
      from event_rows
      where exists (select 1 from updated_employee)
      returning id,
                tenant_id,
                payload,
                occurred_at
    ),
    inserted_outbox as (
      insert into outbox (
        id,
        tenant_id,
        event_id,
        status,
        attempts,
        payload,
        created_at,
        updated_at
      )
      select concat('outbox:', id),
             tenant_id,
             id,
             'pending',
             0,
             payload,
             occurred_at,
             occurred_at
      from inserted_events
      returning id
    )
    select id as employee_id
    from updated_employee
    limit 1
  `;
}

export function buildRevokeEmployeeInvitationSql(
  input: RevokeEmployeeInvitationPersistenceInput
): SQL {
  return sql`
    with updated_invitation as (
      update employee_invitations
      set revoked_at = ${input.revokedAt},
          updated_at = ${input.revokedAt}
      where tenant_id = ${input.tenantId}
        and id = ${input.invitationId}
        and accepted_at is null
        and revoked_at is null
      returning tenant_id,
                id
    ),
    event_rows as (
      select *
      from jsonb_to_recordset(${serializeEventRows(input.events)}::jsonb)
        as event_row(
          id text,
          tenant_id text,
          type text,
          version text,
          occurred_at timestamptz,
          idempotency_key text,
          payload jsonb
        )
    ),
    inserted_events as (
      insert into event_store (
        id,
        tenant_id,
        type,
        version,
        occurred_at,
        idempotency_key,
        payload,
        created_at,
        updated_at
      )
      select event_rows.id,
             event_rows.tenant_id,
             event_rows.type,
             event_rows.version,
             event_rows.occurred_at,
             event_rows.idempotency_key,
             event_rows.payload,
             event_rows.occurred_at,
             event_rows.occurred_at
      from event_rows
      where exists (select 1 from updated_invitation)
      returning id,
                tenant_id,
                payload,
                occurred_at
    ),
    inserted_outbox as (
      insert into outbox (
        id,
        tenant_id,
        event_id,
        status,
        attempts,
        payload,
        created_at,
        updated_at
      )
      select concat('outbox:', id),
             tenant_id,
             id,
             'pending',
             0,
             payload,
             occurred_at,
             occurred_at
      from inserted_events
      returning id
    )
    select id as invitation_id
    from updated_invitation
    limit 1
  `;
}

export function buildRefreshEmployeeInvitationSql(
  input: RefreshEmployeeInvitationPersistenceInput
): SQL {
  return sql`
    with updated_invitation as (
      update employee_invitations
      set token_hash = ${input.invitation.tokenHash},
          expires_at = ${new Date(input.invitation.expiresAt)},
          revoked_at = null,
          updated_at = ${input.refreshedAt}
      where tenant_id = ${input.invitation.tenantId}
        and id = ${input.invitation.id}
        and accepted_at is null
      returning tenant_id,
                id
    ),
    event_rows as (
      select *
      from jsonb_to_recordset(${serializeEventRows(input.events)}::jsonb)
        as event_row(
          id text,
          tenant_id text,
          type text,
          version text,
          occurred_at timestamptz,
          idempotency_key text,
          payload jsonb
        )
    ),
    inserted_events as (
      insert into event_store (
        id,
        tenant_id,
        type,
        version,
        occurred_at,
        idempotency_key,
        payload,
        created_at,
        updated_at
      )
      select event_rows.id,
             event_rows.tenant_id,
             event_rows.type,
             event_rows.version,
             event_rows.occurred_at,
             event_rows.idempotency_key,
             event_rows.payload,
             event_rows.occurred_at,
             event_rows.occurred_at
      from event_rows
      where exists (select 1 from updated_invitation)
      returning id,
                tenant_id,
                payload,
                occurred_at
    ),
    inserted_outbox as (
      insert into outbox (
        id,
        tenant_id,
        event_id,
        status,
        attempts,
        payload,
        created_at,
        updated_at
      )
      select concat('outbox:', id),
             tenant_id,
             id,
             'pending',
             0,
             payload,
             occurred_at,
             occurred_at
      from inserted_events
      returning id
    )
    select id as invitation_id
    from updated_invitation
    limit 1
  `;
}

export function hashEmployeeInvitationToken(token: string): string {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

function serializeEventRows(events: readonly PlatformEvent[]): string {
  return JSON.stringify(
    events.map((event) => {
      return {
        id: event.id,
        tenant_id: event.tenantId,
        type: event.type,
        version: event.version,
        occurred_at: event.occurredAt,
        idempotency_key: event.idempotencyKey ?? null,
        payload: event
      };
    })
  );
}

function mapEmployeeRow(row: EmployeeRow): TenantEmployeeRecord {
  return {
    tenantId: row.tenant_id as TenantId,
    employeeId: row.employee_id as EmployeeId,
    accountId: row.account_id,
    email: row.email,
    displayName: row.display_name,
    roles: parseEmployeeRoles(row.roles),
    createdAt: row.created_at,
    deactivatedAt: row.deactivated_at
  };
}

function mapInvitationPreviewRow(
  row: InvitationPreviewRow
): EmployeeInvitationPreview {
  return {
    invitation: mapInvitationRow(row),
    tenantSlug: row.tenant_slug,
    tenantDisplayName: row.tenant_display_name,
    productName: row.product_name ?? row.tenant_display_name
  };
}

function mapInvitationRow(row: InvitationRow): EmployeeInvitation {
  const role = parseInvitationRole(row.role);

  return {
    id: row.id,
    tenantId: row.tenant_id as TenantId,
    email: row.email,
    displayName: row.display_name ?? undefined,
    role,
    tokenHash: row.token_hash,
    invitedByEmployeeId: row.invited_by_employee_id as EmployeeId,
    expiresAt: row.expires_at.toISOString(),
    acceptedAt: row.accepted_at?.toISOString(),
    revokedAt: row.revoked_at?.toISOString(),
    createdAt: row.created_at.toISOString()
  };
}

function mapAcceptedInvitationRow(
  row: AcceptedInvitationRow
): TenantAuthAccount {
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

function parseInvitationRole(value: string): EmployeeRole {
  if (!isEmployeeRole(value)) {
    throw new CoreError("validation.failed");
  }

  return value;
}

function parseEmployeeRoles(value: unknown): readonly EmployeeRole[] {
  const roles = Array.isArray(value) ? value : [];

  return roles.filter((role): role is EmployeeRole => {
    return typeof role === "string" && isEmployeeRole(role);
  });
}
