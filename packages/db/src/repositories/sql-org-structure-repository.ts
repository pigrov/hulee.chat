import type { EmployeeId, TenantId } from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";
import { assertTenantScopedRows } from "./tenant-scope";

export const orgUnitKinds = [
  "department",
  "branch",
  "function",
  "custom"
] as const;
export const workQueueKinds = [
  "lead_intake",
  "sales",
  "claims",
  "measurements",
  "support",
  "custom"
] as const;
export const orgStructureStatuses = ["active", "archived"] as const;

export type OrgUnitKind = (typeof orgUnitKinds)[number];
export type WorkQueueKind = (typeof workQueueKinds)[number];
export type OrgStructureStatus = (typeof orgStructureStatuses)[number];

export type OrgUnitRecord = {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly parentOrgUnitId: string | null;
  readonly name: string;
  readonly kind: OrgUnitKind;
  readonly status: OrgStructureStatus;
};

export type TeamRecord = {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly name: string;
};

export type WorkQueueRecord = {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly kind: WorkQueueKind;
  readonly owningOrgUnitId: string | null;
  readonly status: OrgStructureStatus;
  readonly routingConfig: Record<string, unknown>;
};

export type UpsertOrgUnitInput = {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly parentOrgUnitId?: string | null;
  readonly name: string;
  readonly kind: OrgUnitKind;
  readonly status?: OrgStructureStatus;
  readonly updatedAt: Date;
};

export type UpsertTeamInput = {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly updatedAt: Date;
};

export type UpsertWorkQueueInput = {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly kind: WorkQueueKind;
  readonly owningOrgUnitId?: string | null;
  readonly status?: OrgStructureStatus;
  readonly routingConfig?: Record<string, unknown>;
  readonly updatedAt: Date;
};

export type ListOrgUnitsInput = {
  readonly tenantId: TenantId;
  readonly activeOnly?: boolean;
};

export type ListTeamsInput = {
  readonly tenantId: TenantId;
};

export type ListWorkQueuesInput = {
  readonly tenantId: TenantId;
  readonly activeOnly?: boolean;
};

export type SetEmployeeOrgUnitMembershipsInput = {
  readonly tenantId: TenantId;
  readonly employeeId: EmployeeId;
  readonly orgUnitIds: readonly string[];
  readonly updatedAt: Date;
};

export type SetEmployeeTeamMembershipsInput = {
  readonly tenantId: TenantId;
  readonly employeeId: EmployeeId;
  readonly teamIds: readonly string[];
  readonly updatedAt: Date;
};

export type SetEmployeeWorkQueueMembershipsInput = {
  readonly tenantId: TenantId;
  readonly employeeId: EmployeeId;
  readonly workQueueIds: readonly string[];
  readonly updatedAt: Date;
};

export type OrgStructureRepository = {
  upsertOrgUnit(input: UpsertOrgUnitInput): Promise<OrgUnitRecord>;
  upsertTeam(input: UpsertTeamInput): Promise<TeamRecord>;
  upsertWorkQueue(input: UpsertWorkQueueInput): Promise<WorkQueueRecord>;
  listOrgUnits(input: ListOrgUnitsInput): Promise<readonly OrgUnitRecord[]>;
  listTeams(input: ListTeamsInput): Promise<readonly TeamRecord[]>;
  listWorkQueues(
    input: ListWorkQueuesInput
  ): Promise<readonly WorkQueueRecord[]>;
  setEmployeeOrgUnitMemberships(
    input: SetEmployeeOrgUnitMembershipsInput
  ): Promise<void>;
  setEmployeeTeamMemberships(
    input: SetEmployeeTeamMembershipsInput
  ): Promise<void>;
  setEmployeeWorkQueueMemberships(
    input: SetEmployeeWorkQueueMembershipsInput
  ): Promise<void>;
};

type OrgUnitRow = {
  id: string;
  tenant_id: string;
  parent_org_unit_id: string | null;
  name: string;
  kind: string;
  status: string;
};

type TeamRow = {
  id: string;
  tenant_id: string;
  name: string;
};

type WorkQueueRow = {
  id: string;
  tenant_id: string;
  name: string;
  kind: string;
  owning_org_unit_id: string | null;
  status: string;
  routing_config: unknown;
};

type MembershipUpdateValidationRow = {
  employee_exists: boolean;
  references_valid: boolean;
};

export function createSqlOrgStructureRepository(
  executor: RawSqlExecutor | HuleeDatabase
): OrgStructureRepository {
  const rawExecutor = executor as RawSqlExecutor;

  return {
    async upsertOrgUnit(input) {
      const result = await rawExecutor.execute<OrgUnitRow>(
        buildUpsertOrgUnitSql(input)
      );
      const row = result.rows[0];

      if (row === undefined) {
        throw new CoreError("tenant.boundary_violation");
      }

      return mapOrgUnitRow(row);
    },

    async upsertTeam(input) {
      const result = await rawExecutor.execute<TeamRow>(
        buildUpsertTeamSql(input)
      );
      const row = result.rows[0];

      if (row === undefined) {
        throw new CoreError("tenant.boundary_violation");
      }

      return mapTeamRow(row);
    },

    async upsertWorkQueue(input) {
      const result = await rawExecutor.execute<WorkQueueRow>(
        buildUpsertWorkQueueSql(input)
      );
      const row = result.rows[0];

      if (row === undefined) {
        throw new CoreError("tenant.boundary_violation");
      }

      return mapWorkQueueRow(row);
    },

    async listOrgUnits(input) {
      const result = await rawExecutor.execute<OrgUnitRow>(
        buildListOrgUnitsSql(input)
      );
      const rows = result.rows.map(mapOrgUnitRow);

      assertTenantScopedRows(input.tenantId, rows);

      return rows;
    },

    async listTeams(input) {
      const result = await rawExecutor.execute<TeamRow>(
        buildListTeamsSql(input)
      );
      const rows = result.rows.map(mapTeamRow);

      assertTenantScopedRows(input.tenantId, rows);

      return rows;
    },

    async listWorkQueues(input) {
      const result = await rawExecutor.execute<WorkQueueRow>(
        buildListWorkQueuesSql(input)
      );
      const rows = result.rows.map(mapWorkQueueRow);

      assertTenantScopedRows(input.tenantId, rows);

      return rows;
    },

    async setEmployeeOrgUnitMemberships(input) {
      const result = await rawExecutor.execute<MembershipUpdateValidationRow>(
        buildSetEmployeeOrgUnitMembershipsSql(input)
      );

      assertMembershipUpdateResult(result.rows[0]);
    },

    async setEmployeeTeamMemberships(input) {
      const result = await rawExecutor.execute<MembershipUpdateValidationRow>(
        buildSetEmployeeTeamMembershipsSql(input)
      );

      assertMembershipUpdateResult(result.rows[0]);
    },

    async setEmployeeWorkQueueMemberships(input) {
      const result = await rawExecutor.execute<MembershipUpdateValidationRow>(
        buildSetEmployeeWorkQueueMembershipsSql(input)
      );

      assertMembershipUpdateResult(result.rows[0]);
    }
  };
}

export function buildUpsertOrgUnitSql(input: UpsertOrgUnitInput): SQL {
  assertNonEmpty(input.id);
  assertNonEmpty(input.tenantId);
  assertNonEmpty(input.name);
  assertOrgUnitKind(input.kind);
  assertOrgStructureStatus(input.status ?? "active");

  if (input.parentOrgUnitId === input.id) {
    throw new CoreError("validation.failed");
  }

  const parentOrgUnitId = input.parentOrgUnitId ?? null;
  const status = input.status ?? "active";

  return sql`
    with parent_row as (
      select id
      from org_units
      where tenant_id = ${input.tenantId}
        and id = ${parentOrgUnitId}
      limit 1
    ),
    input_row as (
      select ${input.id} as id,
             ${input.tenantId} as tenant_id,
             ${parentOrgUnitId} as parent_org_unit_id,
             ${input.name} as name,
             ${input.kind} as kind,
             ${status} as status,
             ${input.updatedAt} as updated_at
      where ${parentOrgUnitId}::text is null
         or exists (select 1 from parent_row)
    )
    insert into org_units (
      id,
      tenant_id,
      parent_org_unit_id,
      name,
      kind,
      status,
      created_at,
      updated_at
    )
    select id,
           tenant_id,
           parent_org_unit_id,
           name,
           kind,
           status,
           updated_at,
           updated_at
    from input_row
    on conflict (id) do update
    set parent_org_unit_id = excluded.parent_org_unit_id,
        name = excluded.name,
        kind = excluded.kind,
        status = excluded.status,
        updated_at = excluded.updated_at
    where org_units.tenant_id = excluded.tenant_id
    returning id,
              tenant_id,
              parent_org_unit_id,
              name,
              kind,
              status
  `;
}

export function buildUpsertTeamSql(input: UpsertTeamInput): SQL {
  assertNonEmpty(input.id);
  assertNonEmpty(input.tenantId);
  assertNonEmpty(input.name);

  return sql`
    insert into teams (
      id,
      tenant_id,
      name,
      created_at,
      updated_at
    )
    values (
      ${input.id},
      ${input.tenantId},
      ${input.name},
      ${input.updatedAt},
      ${input.updatedAt}
    )
    on conflict (id) do update
    set name = excluded.name,
        updated_at = excluded.updated_at
    where teams.tenant_id = excluded.tenant_id
    returning id,
              tenant_id,
              name
  `;
}

export function buildUpsertWorkQueueSql(input: UpsertWorkQueueInput): SQL {
  assertNonEmpty(input.id);
  assertNonEmpty(input.tenantId);
  assertNonEmpty(input.name);
  assertWorkQueueKind(input.kind);
  assertOrgStructureStatus(input.status ?? "active");

  const owningOrgUnitId = input.owningOrgUnitId ?? null;
  const status = input.status ?? "active";
  const routingConfig = input.routingConfig ?? {};

  return sql`
    with owning_org_unit as (
      select id
      from org_units
      where tenant_id = ${input.tenantId}
        and id = ${owningOrgUnitId}
      limit 1
    ),
    input_row as (
      select ${input.id} as id,
             ${input.tenantId} as tenant_id,
             ${input.name} as name,
             ${input.kind} as kind,
             ${owningOrgUnitId} as owning_org_unit_id,
             ${status} as status,
             ${JSON.stringify(routingConfig)}::jsonb as routing_config,
             ${input.updatedAt} as updated_at
      where ${owningOrgUnitId}::text is null
         or exists (select 1 from owning_org_unit)
    )
    insert into work_queues (
      id,
      tenant_id,
      name,
      kind,
      owning_org_unit_id,
      status,
      routing_config,
      created_at,
      updated_at
    )
    select id,
           tenant_id,
           name,
           kind,
           owning_org_unit_id,
           status,
           routing_config,
           updated_at,
           updated_at
    from input_row
    on conflict (id) do update
    set name = excluded.name,
        kind = excluded.kind,
        owning_org_unit_id = excluded.owning_org_unit_id,
        status = excluded.status,
        routing_config = excluded.routing_config,
        updated_at = excluded.updated_at
    where work_queues.tenant_id = excluded.tenant_id
    returning id,
              tenant_id,
              name,
              kind,
              owning_org_unit_id,
              status,
              routing_config
  `;
}

export function buildListOrgUnitsSql(input: ListOrgUnitsInput): SQL {
  return sql`
    select id,
           tenant_id,
           parent_org_unit_id,
           name,
           kind,
           status
    from org_units
    where tenant_id = ${input.tenantId}
      ${input.activeOnly ? sql`and status = 'active'` : sql``}
    order by name asc, id asc
  `;
}

export function buildListTeamsSql(input: ListTeamsInput): SQL {
  return sql`
    select id,
           tenant_id,
           name
    from teams
    where tenant_id = ${input.tenantId}
    order by name asc, id asc
  `;
}

export function buildListWorkQueuesSql(input: ListWorkQueuesInput): SQL {
  return sql`
    select id,
           tenant_id,
           name,
           kind,
           owning_org_unit_id,
           status,
           routing_config
    from work_queues
    where tenant_id = ${input.tenantId}
      ${input.activeOnly ? sql`and status = 'active'` : sql``}
    order by name asc, id asc
  `;
}

export function buildSetEmployeeOrgUnitMembershipsSql(
  input: SetEmployeeOrgUnitMembershipsInput
): SQL {
  assertNonEmpty(input.tenantId);
  assertNonEmpty(input.employeeId);
  const orgUnitIds = uniqueMembershipIds(input.orgUnitIds);

  return sql`
    with requested as (
      select distinct value as org_unit_id
      from jsonb_array_elements_text(${JSON.stringify(orgUnitIds)}::jsonb)
    ),
    target_employee as (
      select id,
             tenant_id
      from employees
      where tenant_id = ${input.tenantId}
        and id = ${input.employeeId}
        and deactivated_at is null
      limit 1
    ),
    valid_requested as (
      select requested.org_unit_id
      from requested
      inner join org_units on org_units.tenant_id = ${input.tenantId}
        and org_units.id = requested.org_unit_id
        and org_units.status = 'active'
    ),
    validation as (
      select exists (select 1 from target_employee) as employee_exists,
             (select count(*) from requested) =
               (select count(*) from valid_requested) as references_valid
    ),
    deleted as (
      delete from employee_org_unit_memberships memberships
      using target_employee,
            validation
      where memberships.tenant_id = target_employee.tenant_id
        and memberships.employee_id = target_employee.id
        and validation.employee_exists
        and validation.references_valid
      returning memberships.org_unit_id
    ),
    inserted as (
      insert into employee_org_unit_memberships (
        tenant_id,
        employee_id,
        org_unit_id,
        created_at,
        updated_at
      )
      select target_employee.tenant_id,
             target_employee.id,
             valid_requested.org_unit_id,
             ${input.updatedAt},
             ${input.updatedAt}
      from target_employee
      cross join valid_requested
      cross join validation
      where validation.employee_exists
        and validation.references_valid
      on conflict (tenant_id, employee_id, org_unit_id) do update
      set updated_at = excluded.updated_at
      returning org_unit_id
    )
    select employee_exists,
           references_valid
    from validation
  `;
}

export function buildSetEmployeeTeamMembershipsSql(
  input: SetEmployeeTeamMembershipsInput
): SQL {
  assertNonEmpty(input.tenantId);
  assertNonEmpty(input.employeeId);
  const teamIds = uniqueMembershipIds(input.teamIds);

  return sql`
    with requested as (
      select distinct value as team_id
      from jsonb_array_elements_text(${JSON.stringify(teamIds)}::jsonb)
    ),
    target_employee as (
      select id,
             tenant_id
      from employees
      where tenant_id = ${input.tenantId}
        and id = ${input.employeeId}
        and deactivated_at is null
      limit 1
    ),
    valid_requested as (
      select requested.team_id
      from requested
      inner join teams on teams.tenant_id = ${input.tenantId}
        and teams.id = requested.team_id
    ),
    validation as (
      select exists (select 1 from target_employee) as employee_exists,
             (select count(*) from requested) =
               (select count(*) from valid_requested) as references_valid
    ),
    deleted as (
      delete from employee_team_memberships memberships
      using target_employee,
            validation
      where memberships.tenant_id = target_employee.tenant_id
        and memberships.employee_id = target_employee.id
        and validation.employee_exists
        and validation.references_valid
      returning memberships.team_id
    ),
    inserted as (
      insert into employee_team_memberships (
        tenant_id,
        employee_id,
        team_id,
        status,
        role_label,
        created_at,
        updated_at
      )
      select target_employee.tenant_id,
             target_employee.id,
             valid_requested.team_id,
             'active',
             null,
             ${input.updatedAt},
             ${input.updatedAt}
      from target_employee
      cross join valid_requested
      cross join validation
      where validation.employee_exists
        and validation.references_valid
      on conflict (tenant_id, employee_id, team_id) do update
      set status = 'active',
          role_label = excluded.role_label,
          updated_at = excluded.updated_at
      returning team_id
    )
    select employee_exists,
           references_valid
    from validation
  `;
}

export function buildSetEmployeeWorkQueueMembershipsSql(
  input: SetEmployeeWorkQueueMembershipsInput
): SQL {
  assertNonEmpty(input.tenantId);
  assertNonEmpty(input.employeeId);
  const workQueueIds = uniqueMembershipIds(input.workQueueIds);

  return sql`
    with requested as (
      select distinct value as work_queue_id
      from jsonb_array_elements_text(${JSON.stringify(workQueueIds)}::jsonb)
    ),
    target_employee as (
      select id,
             tenant_id
      from employees
      where tenant_id = ${input.tenantId}
        and id = ${input.employeeId}
        and deactivated_at is null
      limit 1
    ),
    valid_requested as (
      select requested.work_queue_id
      from requested
      inner join work_queues on work_queues.tenant_id = ${input.tenantId}
        and work_queues.id = requested.work_queue_id
        and work_queues.status = 'active'
    ),
    validation as (
      select exists (select 1 from target_employee) as employee_exists,
             (select count(*) from requested) =
               (select count(*) from valid_requested) as references_valid
    ),
    deleted as (
      delete from employee_work_queue_memberships memberships
      using target_employee,
            validation
      where memberships.tenant_id = target_employee.tenant_id
        and memberships.employee_id = target_employee.id
        and validation.employee_exists
        and validation.references_valid
      returning memberships.work_queue_id
    ),
    inserted as (
      insert into employee_work_queue_memberships (
        tenant_id,
        employee_id,
        work_queue_id,
        created_at,
        updated_at
      )
      select target_employee.tenant_id,
             target_employee.id,
             valid_requested.work_queue_id,
             ${input.updatedAt},
             ${input.updatedAt}
      from target_employee
      cross join valid_requested
      cross join validation
      where validation.employee_exists
        and validation.references_valid
      on conflict (tenant_id, employee_id, work_queue_id) do update
      set updated_at = excluded.updated_at
      returning work_queue_id
    )
    select employee_exists,
           references_valid
    from validation
  `;
}

function mapOrgUnitRow(row: OrgUnitRow): OrgUnitRecord {
  assertOrgUnitKind(row.kind);
  assertOrgStructureStatus(row.status);

  return {
    id: row.id,
    tenantId: row.tenant_id as TenantId,
    parentOrgUnitId: row.parent_org_unit_id,
    name: row.name,
    kind: row.kind,
    status: row.status
  };
}

function mapTeamRow(row: TeamRow): TeamRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id as TenantId,
    name: row.name
  };
}

function mapWorkQueueRow(row: WorkQueueRow): WorkQueueRecord {
  assertWorkQueueKind(row.kind);
  assertOrgStructureStatus(row.status);

  return {
    id: row.id,
    tenantId: row.tenant_id as TenantId,
    name: row.name,
    kind: row.kind,
    owningOrgUnitId: row.owning_org_unit_id,
    status: row.status,
    routingConfig: recordFromUnknown(row.routing_config)
  };
}

function assertOrgUnitKind(kind: string): asserts kind is OrgUnitKind {
  if (!orgUnitKinds.includes(kind as OrgUnitKind)) {
    throw new CoreError("validation.failed");
  }
}

function assertWorkQueueKind(kind: string): asserts kind is WorkQueueKind {
  if (!workQueueKinds.includes(kind as WorkQueueKind)) {
    throw new CoreError("validation.failed");
  }
}

function assertOrgStructureStatus(
  status: string
): asserts status is OrgStructureStatus {
  if (!orgStructureStatuses.includes(status as OrgStructureStatus)) {
    throw new CoreError("validation.failed");
  }
}

function assertNonEmpty(value: string): void {
  if (value.trim().length === 0) {
    throw new CoreError("validation.failed");
  }
}

function uniqueMembershipIds(ids: readonly string[]): readonly string[] {
  const uniqueIds = [...new Set(ids.map((id) => id.trim()))];

  for (const id of uniqueIds) {
    assertNonEmpty(id);
  }

  return uniqueIds;
}

function assertMembershipUpdateResult(
  row: MembershipUpdateValidationRow | undefined
): void {
  if (row === undefined || !row.employee_exists) {
    throw new CoreError("tenant.boundary_violation");
  }

  if (!row.references_valid) {
    throw new CoreError("validation.failed");
  }
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...value }
    : {};
}
