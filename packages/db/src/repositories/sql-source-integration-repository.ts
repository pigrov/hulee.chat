import type {
  EmployeeId,
  SourceAccountId,
  SourceAccountType,
  SourceAuthType,
  SourceConnectionId,
  SourceConnectionStatus,
  SourceType,
  TenantId
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export type SourceConnectionRecord = {
  id: SourceConnectionId;
  tenantId: TenantId;
  sourceType: SourceType | (string & {});
  sourceName: string;
  displayName: string;
  status: SourceConnectionStatus | (string & {});
  authType: SourceAuthType | (string & {});
  capabilities: unknown;
  config: unknown;
  diagnostics: unknown;
  metadata: unknown;
  createdByEmployeeId: EmployeeId | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SourceAccountRecord = {
  id: SourceAccountId;
  tenantId: TenantId;
  sourceConnectionId: SourceConnectionId;
  externalAccountId: string | null;
  externalAccountName: string | null;
  accountType: SourceAccountType | (string & {});
  displayName: string;
  status: SourceConnectionStatus | (string & {});
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export type FindSourceConnectionInput = {
  tenantId: TenantId;
  sourceConnectionId: SourceConnectionId | string;
};

export type ListTenantSourceConnectionsInput = {
  tenantId: TenantId;
  includeDeleted?: boolean;
  limit?: number;
};

export type UpsertSourceConnectionInput = {
  id: SourceConnectionId | string;
  tenantId: TenantId;
  sourceType: SourceType | string;
  sourceName: string;
  displayName: string;
  status: SourceConnectionStatus | string;
  authType: SourceAuthType | string;
  capabilities?: unknown;
  config?: unknown;
  diagnostics?: unknown;
  metadata?: unknown;
  createdByEmployeeId?: EmployeeId | null;
  updatedAt: Date;
};

export type UpsertSourceAccountInput = {
  id: SourceAccountId | string;
  tenantId: TenantId;
  sourceConnectionId: SourceConnectionId | string;
  externalAccountId?: string | null;
  externalAccountName?: string | null;
  accountType: SourceAccountType | string;
  displayName: string;
  status: SourceConnectionStatus | string;
  metadata?: unknown;
  updatedAt: Date;
};

export type SourceIntegrationRepository = {
  findSourceConnection(
    input: FindSourceConnectionInput
  ): Promise<SourceConnectionRecord | null>;
  listTenantSourceConnections(
    input: ListTenantSourceConnectionsInput
  ): Promise<SourceConnectionRecord[]>;
  upsertSourceConnection(
    input: UpsertSourceConnectionInput
  ): Promise<SourceConnectionRecord>;
  upsertSourceAccount(
    input: UpsertSourceAccountInput
  ): Promise<SourceAccountRecord>;
};

type SourceConnectionRow = {
  id: string;
  tenant_id: string;
  source_type: string;
  source_name: string;
  display_name: string;
  status: string;
  auth_type: string;
  capabilities: unknown;
  config: unknown;
  diagnostics: unknown;
  metadata: unknown;
  created_by_employee_id: string | null;
  created_at: PgDateValue;
  updated_at: PgDateValue;
};

type SourceAccountRow = {
  id: string;
  tenant_id: string;
  source_connection_id: string;
  external_account_id: string | null;
  external_account_name: string | null;
  account_type: string;
  display_name: string;
  status: string;
  metadata: unknown;
  created_at: PgDateValue;
  updated_at: PgDateValue;
};

type PgDateValue = Date | string;

export function createSqlSourceIntegrationRepository(
  executor: RawSqlExecutor | HuleeDatabase
): SourceIntegrationRepository {
  const rawExecutor = executor as RawSqlExecutor;

  return {
    async findSourceConnection(input) {
      const result = await rawExecutor.execute<SourceConnectionRow>(
        buildFindSourceConnectionSql(input)
      );

      return result.rows[0] ? mapSourceConnectionRow(result.rows[0]) : null;
    },

    async listTenantSourceConnections(input) {
      const result = await rawExecutor.execute<SourceConnectionRow>(
        buildListTenantSourceConnectionsSql(input)
      );

      return result.rows.map(mapSourceConnectionRow);
    },

    async upsertSourceConnection(input) {
      const result = await rawExecutor.execute<SourceConnectionRow>(
        buildUpsertSourceConnectionSql(input)
      );

      return mapSourceConnectionRow(
        requireReturnedRow(result.rows[0], "source connection")
      );
    },

    async upsertSourceAccount(input) {
      const result = await rawExecutor.execute<SourceAccountRow>(
        buildUpsertSourceAccountSql(input)
      );

      return mapSourceAccountRow(
        requireReturnedRow(result.rows[0], "source account")
      );
    }
  };
}

export function buildFindSourceConnectionSql(
  input: FindSourceConnectionInput
): SQL {
  return sql`
    select ${sourceConnectionSelectList}
    from source_connections
    where tenant_id = ${input.tenantId}
      and id = ${input.sourceConnectionId}
    limit 1
  `;
}

export function buildListTenantSourceConnectionsSql(
  input: ListTenantSourceConnectionsInput
): SQL {
  const deletedClause = input.includeDeleted
    ? sql``
    : sql`and status <> 'deleted'`;

  return sql`
    select ${sourceConnectionSelectList}
    from source_connections
    where tenant_id = ${input.tenantId}
      ${deletedClause}
    order by created_at asc, id asc
    limit ${input.limit ?? 100}
  `;
}

export function buildUpsertSourceConnectionSql(
  input: UpsertSourceConnectionInput
): SQL {
  return sql`
    insert into source_connections (
      id,
      tenant_id,
      source_type,
      source_name,
      display_name,
      status,
      auth_type,
      capabilities,
      config,
      diagnostics,
      metadata,
      created_by_employee_id,
      created_at,
      updated_at
    )
    values (
      ${input.id},
      ${input.tenantId},
      ${input.sourceType},
      ${input.sourceName},
      ${input.displayName},
      ${input.status},
      ${input.authType},
      ${JSON.stringify(input.capabilities ?? {})}::jsonb,
      ${JSON.stringify(input.config ?? {})}::jsonb,
      ${JSON.stringify(input.diagnostics ?? {})}::jsonb,
      ${JSON.stringify(input.metadata ?? {})}::jsonb,
      ${input.createdByEmployeeId ?? null},
      ${input.updatedAt},
      ${input.updatedAt}
    )
    on conflict (id) do update
    set source_type = excluded.source_type,
        source_name = excluded.source_name,
        display_name = excluded.display_name,
        status = excluded.status,
        auth_type = excluded.auth_type,
        capabilities = excluded.capabilities,
        config = excluded.config,
        diagnostics = excluded.diagnostics,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
    where source_connections.tenant_id = excluded.tenant_id
    returning ${sourceConnectionSelectList}
  `;
}

export function buildUpsertSourceAccountSql(
  input: UpsertSourceAccountInput
): SQL {
  return sql`
    insert into source_accounts (
      id,
      tenant_id,
      source_connection_id,
      external_account_id,
      external_account_name,
      account_type,
      display_name,
      status,
      metadata,
      created_at,
      updated_at
    )
    values (
      ${input.id},
      ${input.tenantId},
      ${input.sourceConnectionId},
      ${input.externalAccountId ?? null},
      ${input.externalAccountName ?? null},
      ${input.accountType},
      ${input.displayName},
      ${input.status},
      ${JSON.stringify(input.metadata ?? {})}::jsonb,
      ${input.updatedAt},
      ${input.updatedAt}
    )
    on conflict (id) do update
    set external_account_id = excluded.external_account_id,
        external_account_name = excluded.external_account_name,
        account_type = excluded.account_type,
        display_name = excluded.display_name,
        status = excluded.status,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
    where source_accounts.tenant_id = excluded.tenant_id
      and source_accounts.source_connection_id = excluded.source_connection_id
    returning ${sourceAccountSelectList}
  `;
}

const sourceConnectionSelectList = sql`
  id,
  tenant_id,
  source_type,
  source_name,
  display_name,
  status,
  auth_type,
  capabilities,
  config,
  diagnostics,
  metadata,
  created_by_employee_id,
  created_at,
  updated_at
`;

const sourceAccountSelectList = sql`
  id,
  tenant_id,
  source_connection_id,
  external_account_id,
  external_account_name,
  account_type,
  display_name,
  status,
  metadata,
  created_at,
  updated_at
`;

function mapSourceConnectionRow(
  row: SourceConnectionRow
): SourceConnectionRecord {
  return {
    id: row.id as SourceConnectionId,
    tenantId: row.tenant_id as TenantId,
    sourceType: row.source_type,
    sourceName: row.source_name,
    displayName: row.display_name,
    status: row.status,
    authType: row.auth_type,
    capabilities: row.capabilities,
    config: row.config,
    diagnostics: row.diagnostics,
    metadata: row.metadata,
    createdByEmployeeId: row.created_by_employee_id as EmployeeId | null,
    createdAt: normalizePgDate(row.created_at),
    updatedAt: normalizePgDate(row.updated_at)
  };
}

function mapSourceAccountRow(row: SourceAccountRow): SourceAccountRecord {
  return {
    id: row.id as SourceAccountId,
    tenantId: row.tenant_id as TenantId,
    sourceConnectionId: row.source_connection_id as SourceConnectionId,
    externalAccountId: row.external_account_id,
    externalAccountName: row.external_account_name,
    accountType: row.account_type,
    displayName: row.display_name,
    status: row.status,
    metadata: row.metadata,
    createdAt: normalizePgDate(row.created_at),
    updatedAt: normalizePgDate(row.updated_at)
  };
}

function normalizePgDate(value: PgDateValue): Date {
  return value instanceof Date ? value : new Date(value);
}

function requireReturnedRow<Row>(row: Row | undefined, label: string): Row {
  if (!row) {
    throw new Error(`SQL source integration repository returned no ${label}.`);
  }

  return row;
}
