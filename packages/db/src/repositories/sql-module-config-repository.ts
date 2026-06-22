import type { TenantId } from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export type TenantModuleConfigRecord = {
  tenantId: TenantId;
  moduleId: string;
  enabled: boolean;
  config: unknown;
  diagnostics: unknown;
};

export type FindEnabledTenantModuleConfigInput = {
  tenantId: TenantId;
  moduleId: string;
};

export type FindTenantModuleConfigInput = {
  tenantId: TenantId;
  moduleId: string;
};

export type UpsertTenantModuleConfigInput = {
  tenantId: TenantId;
  moduleId: string;
  enabled: boolean;
  config: unknown;
  diagnostics: unknown;
  updatedAt: Date;
};

export type TenantModuleConfigRepository = {
  findConfig(
    input: FindTenantModuleConfigInput
  ): Promise<TenantModuleConfigRecord | null>;
  findEnabledConfig(
    input: FindEnabledTenantModuleConfigInput
  ): Promise<TenantModuleConfigRecord | null>;
  upsertConfig(input: UpsertTenantModuleConfigInput): Promise<void>;
};

type TenantModuleConfigRow = {
  tenant_id: string;
  module_id: string;
  enabled: boolean;
  config: unknown;
  diagnostics: unknown;
};

export function createSqlTenantModuleConfigRepository(
  executor: RawSqlExecutor | HuleeDatabase
): TenantModuleConfigRepository {
  const rawExecutor = executor as RawSqlExecutor;

  return {
    async findConfig(input) {
      const result = await rawExecutor.execute<TenantModuleConfigRow>(
        buildFindTenantModuleConfigSql(input)
      );

      return result.rows[0] ? mapTenantModuleConfigRow(result.rows[0]) : null;
    },

    async findEnabledConfig(input) {
      const result = await rawExecutor.execute<TenantModuleConfigRow>(
        buildFindEnabledTenantModuleConfigSql(input)
      );

      return result.rows[0] ? mapTenantModuleConfigRow(result.rows[0]) : null;
    },

    async upsertConfig(input) {
      await rawExecutor.execute(buildUpsertTenantModuleConfigSql(input));
    }
  };
}

export function buildFindTenantModuleConfigSql(
  input: FindTenantModuleConfigInput
): SQL {
  return sql`
    select tenant_id,
           module_id,
           enabled,
           config,
           diagnostics
    from tenant_modules
    where tenant_id = ${input.tenantId}
      and module_id = ${input.moduleId}
    limit 1
  `;
}

export function buildFindEnabledTenantModuleConfigSql(
  input: FindEnabledTenantModuleConfigInput
): SQL {
  return sql`
    select tenant_id,
           module_id,
           enabled,
           config,
           diagnostics
    from tenant_modules
    where tenant_id = ${input.tenantId}
      and module_id = ${input.moduleId}
      and enabled = true
    limit 1
  `;
}

export function buildUpsertTenantModuleConfigSql(
  input: UpsertTenantModuleConfigInput
): SQL {
  return sql`
    insert into tenant_modules (
      tenant_id,
      module_id,
      enabled,
      config,
      diagnostics,
      created_at,
      updated_at
    )
    values (
      ${input.tenantId},
      ${input.moduleId},
      ${input.enabled},
      ${JSON.stringify(input.config)}::jsonb,
      ${JSON.stringify(input.diagnostics)}::jsonb,
      ${input.updatedAt},
      ${input.updatedAt}
    )
    on conflict (tenant_id, module_id) do update
    set enabled = excluded.enabled,
        config = excluded.config,
        diagnostics = excluded.diagnostics,
        updated_at = excluded.updated_at
  `;
}

function mapTenantModuleConfigRow(
  row: TenantModuleConfigRow
): TenantModuleConfigRecord {
  return {
    tenantId: row.tenant_id as TenantId,
    moduleId: row.module_id,
    enabled: row.enabled,
    config: row.config,
    diagnostics: row.diagnostics
  };
}
