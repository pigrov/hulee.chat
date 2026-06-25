import type { EmployeeId, PlatformEvent, TenantId } from "@hulee/contracts";
import {
  CoreError,
  isPermission,
  isEmployeeRole,
  permissionsForRoles,
  type Employee,
  type EmployeeInvitation,
  type EmployeeRole,
  type Permission
} from "@hulee/core";
import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";
import type { TenantAuthAccount } from "./sql-auth-repository";
import {
  mapOptionalSqlTimestamp,
  mapSqlTimestamp,
  type SqlTimestamp
} from "./sql-timestamp";

export type TenantEmployeeRecord = {
  tenantId: TenantId;
  employeeId: EmployeeId;
  accountId: string | null;
  email: string;
  displayName: string;
  roles: readonly EmployeeRole[];
  teamIds: readonly string[];
  orgUnitIds: readonly string[];
  queueIds: readonly string[];
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
  team_ids: unknown;
  org_unit_ids: unknown;
  queue_ids: unknown;
  created_at: SqlTimestamp;
  deactivated_at: SqlTimestamp | null;
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
  expires_at: SqlTimestamp;
  accepted_at: SqlTimestamp | null;
  revoked_at: SqlTimestamp | null;
  created_at: SqlTimestamp;
};

type InvitationPreviewRow = InvitationRow & {
  tenant_slug: string;
  tenant_display_name: string;
  product_name: string | null;
};

type AcceptedInvitationRow = {
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
           coalesce(employee_role_rows.roles, '[]'::json) as roles,
           coalesce(
             team_membership_rows.team_ids,
             '[]'::json
           ) as team_ids,
           coalesce(
             org_unit_membership_rows.org_unit_ids,
             '[]'::json
           ) as org_unit_ids,
           coalesce(
             work_queue_membership_rows.queue_ids,
             '[]'::json
           ) as queue_ids
    from employees
    left join lateral (
      select json_agg(employee_roles.role order by employee_roles.role) as roles
      from employee_roles
      where employee_roles.tenant_id = employees.tenant_id
        and employee_roles.employee_id = employees.id
    ) employee_role_rows on true
    left join lateral (
      select json_agg(
               employee_team_memberships.team_id
               order by employee_team_memberships.team_id
             ) as team_ids
      from employee_team_memberships
      inner join teams on teams.tenant_id =
          employee_team_memberships.tenant_id
        and teams.id = employee_team_memberships.team_id
      where employee_team_memberships.tenant_id = employees.tenant_id
        and employee_team_memberships.employee_id = employees.id
        and employee_team_memberships.status = 'active'
    ) team_membership_rows on true
    left join lateral (
      select json_agg(
               employee_org_unit_memberships.org_unit_id
               order by employee_org_unit_memberships.org_unit_id
             ) as org_unit_ids
      from employee_org_unit_memberships
      inner join org_units on org_units.tenant_id =
          employee_org_unit_memberships.tenant_id
        and org_units.id = employee_org_unit_memberships.org_unit_id
        and org_units.status = 'active'
      where employee_org_unit_memberships.tenant_id = employees.tenant_id
        and employee_org_unit_memberships.employee_id = employees.id
    ) org_unit_membership_rows on true
    left join lateral (
      select json_agg(
               employee_work_queue_memberships.work_queue_id
               order by employee_work_queue_memberships.work_queue_id
             ) as queue_ids
      from employee_work_queue_memberships
      inner join work_queues on work_queues.tenant_id =
          employee_work_queue_memberships.tenant_id
        and work_queues.id = employee_work_queue_memberships.work_queue_id
        and work_queues.status = 'active'
      where employee_work_queue_memberships.tenant_id = employees.tenant_id
        and employee_work_queue_memberships.employee_id = employees.id
    ) work_queue_membership_rows on true
    where employees.tenant_id = ${input.tenantId}
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
           coalesce(employee_role_rows.roles, '[]'::json) as roles,
           coalesce(
             team_membership_rows.team_ids,
             '[]'::json
           ) as team_ids,
           coalesce(
             org_unit_membership_rows.org_unit_ids,
             '[]'::json
           ) as org_unit_ids,
           coalesce(
             work_queue_membership_rows.queue_ids,
             '[]'::json
           ) as queue_ids
    from employees
    left join lateral (
      select json_agg(employee_roles.role order by employee_roles.role) as roles
      from employee_roles
      where employee_roles.tenant_id = employees.tenant_id
        and employee_roles.employee_id = employees.id
    ) employee_role_rows on true
    left join lateral (
      select json_agg(
               employee_team_memberships.team_id
               order by employee_team_memberships.team_id
             ) as team_ids
      from employee_team_memberships
      inner join teams on teams.tenant_id =
          employee_team_memberships.tenant_id
        and teams.id = employee_team_memberships.team_id
      where employee_team_memberships.tenant_id = employees.tenant_id
        and employee_team_memberships.employee_id = employees.id
        and employee_team_memberships.status = 'active'
    ) team_membership_rows on true
    left join lateral (
      select json_agg(
               employee_org_unit_memberships.org_unit_id
               order by employee_org_unit_memberships.org_unit_id
             ) as org_unit_ids
      from employee_org_unit_memberships
      inner join org_units on org_units.tenant_id =
          employee_org_unit_memberships.tenant_id
        and org_units.id = employee_org_unit_memberships.org_unit_id
        and org_units.status = 'active'
      where employee_org_unit_memberships.tenant_id = employees.tenant_id
        and employee_org_unit_memberships.employee_id = employees.id
    ) org_unit_membership_rows on true
    left join lateral (
      select json_agg(
               employee_work_queue_memberships.work_queue_id
               order by employee_work_queue_memberships.work_queue_id
             ) as queue_ids
      from employee_work_queue_memberships
      inner join work_queues on work_queues.tenant_id =
          employee_work_queue_memberships.tenant_id
        and work_queues.id = employee_work_queue_memberships.work_queue_id
        and work_queues.status = 'active'
      where employee_work_queue_memberships.tenant_id = employees.tenant_id
        and employee_work_queue_memberships.employee_id = employees.id
    ) work_queue_membership_rows on true
    where employees.tenant_id = ${input.tenantId}
      and employees.id = ${input.employeeId}
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
             tenants.slug as tenant_slug,
             tenants.display_name as tenant_display_name
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
    role_template as (
      select *
      from jsonb_to_recordset(${serializeEmployeeRoleTemplates([role])}::jsonb)
        as role_template(
          role text,
          name text,
          description text,
          permissions jsonb
        )
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
                email_verified_at,
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
      select concat('role:', pending_invitation.tenant_id, ':', pending_invitation.role),
             pending_invitation.tenant_id,
             role_template.name,
             role_template.description,
             'active',
             true,
             null,
             null,
             ${input.acceptedAt},
             ${input.acceptedAt}
      from pending_invitation
      inner join role_template
        on role_template.role = pending_invitation.role
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
      select pending_invitation.tenant_id,
             concat('role:', pending_invitation.tenant_id, ':', pending_invitation.role),
             permission_rows.permission,
             ${input.acceptedAt},
             ${input.acceptedAt}
      from pending_invitation
      inner join role_template
        on role_template.role = pending_invitation.role
      cross join jsonb_array_elements_text(role_template.permissions)
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
      select concat(
               'role_binding:',
               pending_invitation.tenant_id,
               ':',
               inserted_employee.id,
               ':',
               pending_invitation.role,
               ':tenant'
             ),
             pending_invitation.tenant_id,
             concat('role:', pending_invitation.tenant_id, ':', pending_invitation.role),
             'employee',
             inserted_employee.id,
             'tenant',
             null,
             null,
             null,
             null,
             null,
             ${input.acceptedAt},
             ${input.acceptedAt}
      from pending_invitation
      inner join inserted_employee
        on inserted_employee.tenant_id = pending_invitation.tenant_id
      on conflict (id) do update
      set revoked_at = null,
          updated_at = excluded.updated_at
      returning id
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
           pending_invitation.tenant_display_name,
           inserted_account.id as account_id,
           inserted_employee.id as employee_id,
           inserted_employee.email,
           inserted_account.email_verified_at,
           inserted_employee.display_name,
           inserted_account.password_hash,
           json_build_array(inserted_role.role) as roles,
           role_template.permissions
    from pending_invitation
    inner join inserted_account
      on inserted_account.tenant_id = pending_invitation.tenant_id
    inner join inserted_employee
      on inserted_employee.tenant_id = pending_invitation.tenant_id
    inner join inserted_role
      on inserted_role.tenant_id = pending_invitation.tenant_id
    inner join role_template
      on role_template.role = inserted_role.role
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
    role_template as (
      select *
      from jsonb_to_recordset(${serializeEmployeeRoleTemplates([input.role])}::jsonb)
        as role_template(
          role text,
          name text,
          description text,
          permissions jsonb
        )
    ),
    legacy_role_templates as (
      select *
      from jsonb_to_recordset(${serializeEmployeeRoleTemplates(fixedEmployeeRoles)}::jsonb)
        as role_template(
          role text,
          name text,
          description text,
          permissions jsonb
        )
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
    revoked_tenant_role_bindings as (
      update tenant_role_bindings
      set revoked_at = ${input.changedAt},
          updated_at = ${input.changedAt}
      from target_employee,
           legacy_role_templates
      where tenant_role_bindings.tenant_id = target_employee.tenant_id
        and tenant_role_bindings.subject_type = 'employee'
        and tenant_role_bindings.subject_id = target_employee.id
        and tenant_role_bindings.role_id = concat(
          'role:',
          target_employee.tenant_id,
          ':',
          legacy_role_templates.role
        )
        and tenant_role_bindings.revoked_at is null
      returning tenant_role_bindings.id
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
      select concat('role:', target_employee.tenant_id, ':', ${input.role}),
             target_employee.tenant_id,
             role_template.name,
             role_template.description,
             'active',
             true,
             null,
             null,
             ${input.changedAt},
             ${input.changedAt}
      from target_employee
      inner join role_template
        on role_template.role = ${input.role}
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
      select target_employee.tenant_id,
             concat('role:', target_employee.tenant_id, ':', ${input.role}),
             permission_rows.permission,
             ${input.changedAt},
             ${input.changedAt}
      from target_employee
      inner join role_template
        on role_template.role = ${input.role}
      cross join jsonb_array_elements_text(role_template.permissions)
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
      select concat(
               'role_binding:',
               target_employee.tenant_id,
               ':',
               target_employee.id,
               ':',
               ${input.role},
               ':tenant'
             ),
             target_employee.tenant_id,
             concat('role:', target_employee.tenant_id, ':', ${input.role}),
             'employee',
             target_employee.id,
             'tenant',
             null,
             null,
             null,
             null,
             null,
             ${input.changedAt},
             ${input.changedAt}
      from target_employee
      on conflict (id) do update
      set revoked_at = null,
          updated_at = excluded.updated_at
      returning id
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

function serializeEmployeeRoleTemplates(
  roles: readonly EmployeeRole[]
): string {
  return JSON.stringify(
    roles.map((role) => {
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

function mapEmployeeRow(row: EmployeeRow): TenantEmployeeRecord {
  return {
    tenantId: row.tenant_id as TenantId,
    employeeId: row.employee_id as EmployeeId,
    accountId: row.account_id,
    email: row.email,
    displayName: row.display_name,
    roles: parseEmployeeRoles(row.roles),
    teamIds: parseStringIds(row.team_ids),
    orgUnitIds: parseStringIds(row.org_unit_ids),
    queueIds: parseStringIds(row.queue_ids),
    createdAt: new Date(row.created_at),
    deactivatedAt:
      row.deactivated_at === null ? null : new Date(row.deactivated_at)
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
    expiresAt: mapSqlTimestamp(row.expires_at),
    acceptedAt: mapOptionalSqlTimestamp(row.accepted_at) ?? undefined,
    revokedAt: mapOptionalSqlTimestamp(row.revoked_at) ?? undefined,
    createdAt: mapSqlTimestamp(row.created_at)
  };
}

function mapAcceptedInvitationRow(
  row: AcceptedInvitationRow
): TenantAuthAccount {
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

function parsePermissions(value: unknown): readonly Permission[] {
  const permissions = Array.isArray(value) ? value : [];

  return permissions.filter((permission): permission is Permission => {
    return typeof permission === "string" && isPermission(permission);
  });
}

function parseStringIds(value: unknown): readonly string[] {
  const ids = Array.isArray(value) ? value : [];

  return ids.filter((id): id is string => {
    return typeof id === "string" && id.trim().length > 0;
  });
}
