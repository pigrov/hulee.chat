import type {
  ChannelClass,
  ChannelConnectorHealthStatus,
  ChannelConnectorId,
  ChannelConnectorStatus,
  ChannelType,
  EmployeeId,
  SourceConnectionId,
  TenantId
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export type ChannelConnectorRecord = {
  id: ChannelConnectorId;
  tenantId: TenantId;
  channelType: ChannelType | (string & {});
  channelClass: ChannelClass | (string & {});
  provider: string;
  displayName: string;
  status: ChannelConnectorStatus | (string & {});
  healthStatus: ChannelConnectorHealthStatus | (string & {});
  capabilities: unknown;
  onboardingState: unknown;
  config: unknown;
  diagnostics: unknown;
  sourceConnectionId?: SourceConnectionId | null;
  createdByEmployeeId: EmployeeId | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FindChannelConnectorInput = {
  tenantId: TenantId;
  connectorId: ChannelConnectorId | string;
};

export type FindFirstChannelConnectorByTypeInput = {
  tenantId: TenantId;
  channelType: ChannelType | string;
  includeDeleted?: boolean;
};

export type ListActiveChannelConnectorsByTypeInput = {
  channelType: ChannelType | string;
  limit?: number;
};

export type ListTenantChannelConnectorsInput = {
  tenantId: TenantId;
  includeDeleted?: boolean;
  limit?: number;
};

export type FindActiveChannelConnectorByConfigStringInput = {
  channelType: ChannelType | string;
  configKey: string;
  configValue: string;
};

export type FindActiveChannelConnectorByExternalIdInput = {
  tenantId: TenantId;
  channelType: ChannelType | string;
  channelExternalId: string;
};

export type UpsertChannelConnectorInput = {
  id: ChannelConnectorId | string;
  tenantId: TenantId;
  channelType: ChannelType | string;
  channelClass: ChannelClass | string;
  provider: string;
  displayName: string;
  status: ChannelConnectorStatus | string;
  healthStatus: ChannelConnectorHealthStatus | string;
  capabilities?: unknown;
  onboardingState?: unknown;
  config?: unknown;
  diagnostics?: unknown;
  sourceConnectionId?: SourceConnectionId | string | null;
  createdByEmployeeId?: EmployeeId | null;
  updatedAt: Date;
};

export type ChannelConnectorRepository = {
  findConnector(
    input: FindChannelConnectorInput
  ): Promise<ChannelConnectorRecord | null>;
  findFirstConnectorByType(
    input: FindFirstChannelConnectorByTypeInput
  ): Promise<ChannelConnectorRecord | null>;
  listActiveConnectorsByType(
    input: ListActiveChannelConnectorsByTypeInput
  ): Promise<ChannelConnectorRecord[]>;
  listTenantConnectors(
    input: ListTenantChannelConnectorsInput
  ): Promise<ChannelConnectorRecord[]>;
  findActiveConnectorByConfigString(
    input: FindActiveChannelConnectorByConfigStringInput
  ): Promise<ChannelConnectorRecord | null>;
  findActiveConnectorByExternalId(
    input: FindActiveChannelConnectorByExternalIdInput
  ): Promise<ChannelConnectorRecord | null>;
  upsertConnector(input: UpsertChannelConnectorInput): Promise<void>;
};

type ChannelConnectorRow = {
  id: string;
  tenant_id: string;
  channel_type: string;
  channel_class: string;
  provider: string;
  display_name: string;
  status: string;
  health_status: string;
  capabilities: unknown;
  onboarding_state: unknown;
  config: unknown;
  diagnostics: unknown;
  source_connection_id?: string | null;
  created_by_employee_id: string | null;
  created_at: Date;
  updated_at: Date;
};

export function createSqlChannelConnectorRepository(
  executor: RawSqlExecutor | HuleeDatabase
): ChannelConnectorRepository {
  const rawExecutor = executor as RawSqlExecutor;

  return {
    async findConnector(input) {
      const result = await rawExecutor.execute<ChannelConnectorRow>(
        buildFindChannelConnectorSql(input)
      );

      return result.rows[0] ? mapChannelConnectorRow(result.rows[0]) : null;
    },

    async findFirstConnectorByType(input) {
      const result = await rawExecutor.execute<ChannelConnectorRow>(
        buildFindFirstChannelConnectorByTypeSql(input)
      );

      return result.rows[0] ? mapChannelConnectorRow(result.rows[0]) : null;
    },

    async listActiveConnectorsByType(input) {
      const result = await rawExecutor.execute<ChannelConnectorRow>(
        buildListActiveChannelConnectorsByTypeSql(input)
      );

      return result.rows.map(mapChannelConnectorRow);
    },

    async listTenantConnectors(input) {
      const result = await rawExecutor.execute<ChannelConnectorRow>(
        buildListTenantChannelConnectorsSql(input)
      );

      return result.rows.map(mapChannelConnectorRow);
    },

    async findActiveConnectorByConfigString(input) {
      const result = await rawExecutor.execute<ChannelConnectorRow>(
        buildFindActiveChannelConnectorByConfigStringSql(input)
      );

      return result.rows[0] ? mapChannelConnectorRow(result.rows[0]) : null;
    },

    async findActiveConnectorByExternalId(input) {
      const result = await rawExecutor.execute<ChannelConnectorRow>(
        buildFindActiveChannelConnectorByExternalIdSql(input)
      );

      return result.rows[0] ? mapChannelConnectorRow(result.rows[0]) : null;
    },

    async upsertConnector(input) {
      await rawExecutor.execute(buildUpsertChannelConnectorSql(input));
    }
  };
}

export function buildFindChannelConnectorSql(
  input: FindChannelConnectorInput
): SQL {
  return sql`
    select ${channelConnectorSelectList}
    from channel_connectors
    where tenant_id = ${input.tenantId}
      and id = ${input.connectorId}
    limit 1
  `;
}

export function buildFindFirstChannelConnectorByTypeSql(
  input: FindFirstChannelConnectorByTypeInput
): SQL {
  const deletedClause = input.includeDeleted
    ? sql``
    : sql`and status <> 'deleted'`;

  return sql`
    select ${channelConnectorSelectList}
    from channel_connectors
    where tenant_id = ${input.tenantId}
      and channel_type = ${input.channelType}
      ${deletedClause}
    order by created_at asc, id asc
    limit 1
  `;
}

export function buildListActiveChannelConnectorsByTypeSql(
  input: ListActiveChannelConnectorsByTypeInput
): SQL {
  return sql`
    select ${channelConnectorSelectList}
    from channel_connectors
    where channel_type = ${input.channelType}
      and status in ('connected', 'degraded')
    order by tenant_id asc, created_at asc, id asc
    limit ${input.limit ?? 100}
  `;
}

export function buildListTenantChannelConnectorsSql(
  input: ListTenantChannelConnectorsInput
): SQL {
  const deletedClause = input.includeDeleted
    ? sql``
    : sql`and status <> 'deleted'`;

  return sql`
    select ${channelConnectorSelectList}
    from channel_connectors
    where tenant_id = ${input.tenantId}
      ${deletedClause}
    order by created_at asc, id asc
    limit ${input.limit ?? 100}
  `;
}

export function buildFindActiveChannelConnectorByConfigStringSql(
  input: FindActiveChannelConnectorByConfigStringInput
): SQL {
  return sql`
    with matching_connectors as (
      select ${channelConnectorSelectList},
             count(*) over () as match_count
      from channel_connectors
      where channel_type = ${input.channelType}
        and status in ('connected', 'degraded')
        and config ->> ${input.configKey} = ${input.configValue}
      order by created_at asc, id asc
      limit 2
    )
    select ${channelConnectorSelectList}
    from matching_connectors
    where match_count = 1
  `;
}

export function buildFindActiveChannelConnectorByExternalIdSql(
  input: FindActiveChannelConnectorByExternalIdInput
): SQL {
  return sql`
    with matching_connectors as (
      select ${channelConnectorSelectList},
             count(*) over () as match_count
      from channel_connectors
      where tenant_id = ${input.tenantId}
        and channel_type = ${input.channelType}
        and status in ('connected', 'degraded')
        and config ->> 'channelExternalId' = ${input.channelExternalId}
      order by created_at asc, id asc
      limit 2
    )
    select ${channelConnectorSelectList}
    from matching_connectors
    where match_count = 1
  `;
}

export function buildUpsertChannelConnectorSql(
  input: UpsertChannelConnectorInput
): SQL {
  return sql`
    insert into channel_connectors (
      id,
      tenant_id,
      channel_type,
      channel_class,
      provider,
      display_name,
      status,
      health_status,
      capabilities,
      onboarding_state,
      config,
      diagnostics,
      source_connection_id,
      created_by_employee_id,
      created_at,
      updated_at
    )
    values (
      ${input.id},
      ${input.tenantId},
      ${input.channelType},
      ${input.channelClass},
      ${input.provider},
      ${input.displayName},
      ${input.status},
      ${input.healthStatus},
      ${JSON.stringify(input.capabilities ?? {})}::jsonb,
      ${JSON.stringify(input.onboardingState ?? {})}::jsonb,
      ${JSON.stringify(input.config ?? {})}::jsonb,
      ${JSON.stringify(input.diagnostics ?? {})}::jsonb,
      ${input.sourceConnectionId ?? null},
      ${input.createdByEmployeeId ?? null},
      ${input.updatedAt},
      ${input.updatedAt}
    )
    on conflict (id) do update
    set channel_type = excluded.channel_type,
        channel_class = excluded.channel_class,
        provider = excluded.provider,
        display_name = excluded.display_name,
        status = excluded.status,
        health_status = excluded.health_status,
        capabilities = excluded.capabilities,
        onboarding_state = excluded.onboarding_state,
        config = excluded.config,
        diagnostics = excluded.diagnostics,
        source_connection_id = coalesce(
          excluded.source_connection_id,
          channel_connectors.source_connection_id
        ),
        updated_at = excluded.updated_at
    where channel_connectors.tenant_id = excluded.tenant_id
  `;
}

const channelConnectorSelectList = sql`
  id,
  tenant_id,
  channel_type,
  channel_class,
  provider,
  display_name,
  status,
  health_status,
  capabilities,
  onboarding_state,
  config,
  diagnostics,
  source_connection_id,
  created_by_employee_id,
  created_at,
  updated_at
`;

function mapChannelConnectorRow(
  row: ChannelConnectorRow
): ChannelConnectorRecord {
  return {
    id: row.id as ChannelConnectorId,
    tenantId: row.tenant_id as TenantId,
    channelType: row.channel_type,
    channelClass: row.channel_class,
    provider: row.provider,
    displayName: row.display_name,
    status: row.status,
    healthStatus: row.health_status,
    capabilities: row.capabilities,
    onboardingState: row.onboarding_state,
    config: row.config,
    diagnostics: row.diagnostics,
    sourceConnectionId: row.source_connection_id as SourceConnectionId | null,
    createdByEmployeeId: row.created_by_employee_id as EmployeeId | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
