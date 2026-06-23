import type { TenantId } from "@hulee/contracts";
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

export type ListWorkQueuesInput = {
  readonly tenantId: TenantId;
  readonly activeOnly?: boolean;
};

export type OrgStructureRepository = {
  upsertOrgUnit(input: UpsertOrgUnitInput): Promise<OrgUnitRecord>;
  upsertWorkQueue(input: UpsertWorkQueueInput): Promise<WorkQueueRecord>;
  listOrgUnits(input: ListOrgUnitsInput): Promise<readonly OrgUnitRecord[]>;
  listWorkQueues(
    input: ListWorkQueuesInput
  ): Promise<readonly WorkQueueRecord[]>;
};

type OrgUnitRow = {
  id: string;
  tenant_id: string;
  parent_org_unit_id: string | null;
  name: string;
  kind: string;
  status: string;
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

    async listWorkQueues(input) {
      const result = await rawExecutor.execute<WorkQueueRow>(
        buildListWorkQueuesSql(input)
      );
      const rows = result.rows.map(mapWorkQueueRow);

      assertTenantScopedRows(input.tenantId, rows);

      return rows;
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

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...value }
    : {};
}
