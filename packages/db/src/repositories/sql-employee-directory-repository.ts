import type { EmployeeId, PlatformEvent, TenantId } from "@hulee/contracts";
import {
  CoreError,
  isPermission,
  isSystemRoleTemplateId,
  type Employee,
  type EmployeeInvitation,
  type Permission,
  type SystemRoleTemplateId
} from "@hulee/core";
import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";
import type { TenantAuthAccount } from "./sql-auth-repository";
import { assertTenantScopedRows } from "./tenant-scope";
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
  phoneNumber: string | null;
  avatarUrl: string | null;
  avatar: TenantEmployeeAvatarAsset | null;
  systemRoleTemplateIds: readonly SystemRoleTemplateId[];
  teamIds: readonly string[];
  orgUnitIds: readonly string[];
  queueIds: readonly string[];
  createdAt: Date;
  deactivatedAt: Date | null;
};

export type TenantEmployeeAvatarAsset = {
  storageKey: string;
  mediaType: string;
  sizeBytes: number;
  version: string;
};

export type TenantEmployeeProfile = {
  phoneNumber: string | null;
  avatar: TenantEmployeeAvatarAsset | null;
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

export type ListTenantEmployeesByMembershipScopesInput = {
  tenantId: TenantId;
  orgUnitIds: readonly string[];
  teamIds: readonly string[];
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

export type DeactivateEmployeePersistenceInput = {
  tenantId: TenantId;
  employeeId: EmployeeId;
  deactivatedAt: Date;
  events: readonly PlatformEvent[];
};

export type UpdateEmployeeProfilePersistenceInput = {
  tenantId: TenantId;
  employeeId: EmployeeId;
  displayName: string;
  profile: TenantEmployeeProfile;
  updatedAt: Date;
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
  listEmployeesByMembershipScopes(
    input: ListTenantEmployeesByMembershipScopesInput
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
  updateEmployeeProfile(
    input: UpdateEmployeeProfilePersistenceInput
  ): Promise<void>;
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
  profile: unknown;
  system_role_template_ids: unknown;
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
  system_role_template_ids: unknown;
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
      const employees = result.rows.map(mapEmployeeRow);

      assertTenantScopedRows(input.tenantId, employees);

      return employees;
    },

    async listEmployeesByMembershipScopes(input) {
      const orgUnitIds = normalizeMembershipScopeIds(input.orgUnitIds);
      const teamIds = normalizeMembershipScopeIds(input.teamIds);

      if (orgUnitIds.length === 0 && teamIds.length === 0) {
        return [];
      }

      const result = await rawExecutor.execute<EmployeeRow>(
        buildListTenantEmployeesByMembershipScopesSql({
          tenantId: input.tenantId,
          orgUnitIds,
          teamIds
        })
      );
      const employees = result.rows.map(mapEmployeeRow);

      assertTenantScopedRows(input.tenantId, employees);

      return employees;
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

      if (row === undefined) {
        return null;
      }

      const employee = mapEmployeeRow(row);

      assertTenantScopedRows(input.tenantId, [employee]);

      return employee;
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

    async deactivateEmployee(input) {
      const result = await rawExecutor.execute<{ employee_id: string }>(
        buildDeactivateEmployeeSql(input)
      );

      if (result.rows[0] === undefined) {
        throw new CoreError("validation.failed");
      }
    },

    async updateEmployeeProfile(input) {
      const result = await rawExecutor.execute<{ employee_id: string }>(
        buildUpdateEmployeeProfileSql(input)
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
  return buildListTenantEmployeeRowsSql(
    sql`employees.tenant_id = ${input.tenantId}`
  );
}

export function buildListTenantEmployeesByMembershipScopesSql(
  input: ListTenantEmployeesByMembershipScopesInput
): SQL {
  const orgUnitIds = normalizeMembershipScopeIds(input.orgUnitIds);
  const teamIds = normalizeMembershipScopeIds(input.teamIds);
  const scopePredicates: SQL[] = [];

  if (orgUnitIds.length > 0) {
    scopePredicates.push(sql`
      exists (
        select 1
        from employee_org_unit_memberships scoped_org_unit_memberships
        inner join org_units scoped_org_units
          on scoped_org_units.tenant_id =
              scoped_org_unit_memberships.tenant_id
         and scoped_org_units.id =
              scoped_org_unit_memberships.org_unit_id
         and scoped_org_units.status = 'active'
        where scoped_org_unit_memberships.tenant_id = employees.tenant_id
          and scoped_org_unit_memberships.employee_id = employees.id
          and scoped_org_unit_memberships.org_unit_id in (
            ${sql.join(
              orgUnitIds.map((orgUnitId) => sql`${orgUnitId}`),
              sql`, `
            )}
          )
      )
    `);
  }

  if (teamIds.length > 0) {
    scopePredicates.push(sql`
      exists (
        select 1
        from employee_team_memberships scoped_team_memberships
        inner join teams scoped_teams
          on scoped_teams.tenant_id = scoped_team_memberships.tenant_id
         and scoped_teams.id = scoped_team_memberships.team_id
        where scoped_team_memberships.tenant_id = employees.tenant_id
          and scoped_team_memberships.employee_id = employees.id
          and scoped_team_memberships.status = 'active'
          and scoped_team_memberships.team_id in (
            ${sql.join(
              teamIds.map((teamId) => sql`${teamId}`),
              sql`, `
            )}
          )
      )
    `);
  }

  if (scopePredicates.length === 0) {
    throw new CoreError("validation.failed");
  }

  return buildListTenantEmployeeRowsSql(sql`
    employees.tenant_id = ${input.tenantId}
    and (${sql.join(scopePredicates, sql` or `)})
  `);
}

function buildListTenantEmployeeRowsSql(where: SQL): SQL {
  return sql`
    select employees.tenant_id,
           employees.id as employee_id,
           employees.account_id,
           employees.email,
           employees.display_name,
           employees.profile,
           employees.created_at,
           employees.deactivated_at,
           '[]'::json as system_role_template_ids,
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
    where ${where}
    order by employees.created_at asc,
             employees.id asc
  `;
}

function normalizeMembershipScopeIds(
  ids: readonly string[]
): readonly string[] {
  if (ids.some((id) => id.trim().length === 0)) {
    throw new CoreError("validation.failed");
  }

  return [...new Set(ids)].sort();
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
           employees.profile,
           employees.created_at,
           employees.deactivated_at,
           '[]'::json as system_role_template_ids,
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
  return sql`
    with pending_invitation as (
      select employee_invitations.id,
             employee_invitations.tenant_id,
             employee_invitations.email,
             tenants.slug as tenant_slug,
             tenants.display_name as tenant_display_name
      from employee_invitations
      inner join tenants on tenants.id = employee_invitations.tenant_id
      where employee_invitations.token_hash = ${input.tokenHash}
        and employee_invitations.tenant_id = ${input.employee.tenantId}
        and employee_invitations.email = ${input.employee.email}
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
           '[]'::json as system_role_template_ids,
           '[]'::json as permissions
    from pending_invitation
    inner join inserted_account
      on inserted_account.tenant_id = pending_invitation.tenant_id
    inner join inserted_employee
      on inserted_employee.tenant_id = pending_invitation.tenant_id
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

export function buildUpdateEmployeeProfileSql(
  input: UpdateEmployeeProfilePersistenceInput
): SQL {
  return sql`
    with updated_employee as (
      update employees
      set display_name = ${input.displayName},
          profile = ${serializeEmployeeProfile(input.profile)}::jsonb,
          updated_at = ${input.updatedAt}
      where tenant_id = ${input.tenantId}
        and id = ${input.employeeId}
        and deactivated_at is null
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
  const profile = parseEmployeeProfile(row.profile);

  return {
    tenantId: row.tenant_id as TenantId,
    employeeId: row.employee_id as EmployeeId,
    accountId: row.account_id,
    email: row.email,
    displayName: row.display_name,
    phoneNumber: profile.phoneNumber,
    avatarUrl:
      profile.avatar === null
        ? null
        : employeeAvatarUrl(row.employee_id as EmployeeId, profile.avatar),
    avatar: profile.avatar,
    systemRoleTemplateIds: parseSystemRoleTemplateIds(
      row.system_role_template_ids
    ),
    teamIds: parseStringIds(row.team_ids),
    orgUnitIds: parseStringIds(row.org_unit_ids),
    queueIds: parseStringIds(row.queue_ids),
    createdAt: new Date(row.created_at),
    deactivatedAt:
      row.deactivated_at === null ? null : new Date(row.deactivated_at)
  };
}

function parseEmployeeProfile(value: unknown): TenantEmployeeProfile {
  const profile = recordFromUnknown(value);
  const phoneNumber =
    typeof profile.phoneNumber === "string" &&
    profile.phoneNumber.trim().length > 0
      ? profile.phoneNumber.trim()
      : null;
  const avatar = parseEmployeeAvatarAsset(profile.avatar);

  return {
    phoneNumber,
    avatar
  };
}

function parseEmployeeAvatarAsset(
  value: unknown
): TenantEmployeeAvatarAsset | null {
  const avatar = recordFromUnknown(value);
  const storageKey =
    typeof avatar.storageKey === "string" ? avatar.storageKey.trim() : "";
  const mediaType =
    typeof avatar.mediaType === "string" ? avatar.mediaType.trim() : "";
  const version =
    typeof avatar.version === "string" ? avatar.version.trim() : "";
  const sizeBytes =
    typeof avatar.sizeBytes === "number" && Number.isFinite(avatar.sizeBytes)
      ? avatar.sizeBytes
      : undefined;

  if (
    storageKey.length === 0 ||
    version.length === 0 ||
    sizeBytes === undefined ||
    sizeBytes <= 0 ||
    (mediaType !== "image/png" &&
      mediaType !== "image/jpeg" &&
      mediaType !== "image/webp")
  ) {
    return null;
  }

  return {
    storageKey,
    mediaType,
    sizeBytes,
    version
  };
}

function employeeAvatarUrl(
  employeeId: EmployeeId,
  avatar: TenantEmployeeAvatarAsset
): string {
  return `/employee-assets/${encodeURIComponent(
    employeeId
  )}/avatar?v=${encodeURIComponent(avatar.version)}`;
}

function serializeEmployeeProfile(profile: TenantEmployeeProfile): string {
  return JSON.stringify({
    phoneNumber: profile.phoneNumber,
    ...(profile.avatar === null ? {} : { avatar: profile.avatar })
  });
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
  return {
    id: row.id,
    tenantId: row.tenant_id as TenantId,
    email: row.email,
    displayName: row.display_name ?? undefined,
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
  const systemRoleTemplateIds = parseSystemRoleTemplateIds(
    row.system_role_template_ids
  );
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
    systemRoleTemplateIds,
    permissions
  };
}

function parseSystemRoleTemplateIds(
  value: unknown
): readonly SystemRoleTemplateId[] {
  const templateIds = Array.isArray(value) ? value : [];

  return templateIds.filter(
    (templateId): templateId is SystemRoleTemplateId => {
      return (
        typeof templateId === "string" && isSystemRoleTemplateId(templateId)
      );
    }
  );
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

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
