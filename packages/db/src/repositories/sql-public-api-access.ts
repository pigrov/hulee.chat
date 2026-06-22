import type { PlatformErrorCode, TenantId } from "@hulee/contracts";
import { createHash } from "crypto";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export type AuthenticatedTenantApiKey = {
  tenantId: TenantId;
  apiKeyId: string;
  name: string;
};

export type CreateTenantApiKeyInput = {
  id: string;
  tenantId: TenantId;
  name: string;
  rawKey: string;
  createdAt: Date;
};

export type TenantApiKeyAuthenticator = {
  authenticate(rawApiKey: string): Promise<AuthenticatedTenantApiKey | null>;
};

export type TenantApiKeyWriter = {
  createApiKey(input: CreateTenantApiKeyInput): Promise<void>;
};

export type PublicApiAuditLogRecord = {
  requestId: string;
  tenantId: TenantId;
  apiKeyId: string;
  action: string;
  entityType: string;
  entityId: string;
  outcome: "success" | "failure";
  status: number;
  errorCode?: PlatformErrorCode;
};

export type PublicApiAuditSink = {
  record(record: PublicApiAuditLogRecord): Promise<void>;
};

type TenantApiKeyRow = {
  id: string;
  tenant_id: string;
  name: string;
};

export function createSqlTenantApiKeyRepository(
  executor: RawSqlExecutor | HuleeDatabase
): TenantApiKeyAuthenticator & TenantApiKeyWriter {
  const rawExecutor = executor as RawSqlExecutor;

  return {
    async authenticate(
      rawApiKey: string
    ): Promise<AuthenticatedTenantApiKey | null> {
      const result = await rawExecutor.execute<TenantApiKeyRow>(
        buildAuthenticateTenantApiKeySql(rawApiKey)
      );
      const row = result.rows[0];

      if (row === undefined) {
        return null;
      }

      return {
        tenantId: row.tenant_id as TenantId,
        apiKeyId: row.id,
        name: row.name
      };
    },

    async createApiKey(input: CreateTenantApiKeyInput): Promise<void> {
      await rawExecutor.execute(buildInsertTenantApiKeySql(input));
    }
  };
}

export function createSqlPublicApiAuditSink(
  executor: RawSqlExecutor | HuleeDatabase,
  now: () => Date = () => new Date()
): PublicApiAuditSink {
  const rawExecutor = executor as RawSqlExecutor;

  return {
    async record(record: PublicApiAuditLogRecord): Promise<void> {
      await rawExecutor.execute(buildInsertPublicApiAuditLogSql(record, now()));
    }
  };
}

export function buildAuthenticateTenantApiKeySql(rawApiKey: string): SQL {
  return sql`
    select id,
           tenant_id,
           name
    from tenant_api_keys
    where key_hash = ${hashTenantApiKey(rawApiKey)}
      and revoked_at is null
    limit 1
  `;
}

export function buildInsertTenantApiKeySql(
  input: CreateTenantApiKeyInput
): SQL {
  return sql`
    insert into tenant_api_keys (
      id,
      tenant_id,
      name,
      key_hash,
      created_at,
      updated_at
    )
    values (
      ${input.id},
      ${input.tenantId},
      ${input.name},
      ${hashTenantApiKey(input.rawKey)},
      ${input.createdAt},
      ${input.createdAt}
    )
    on conflict (id) do nothing
  `;
}

export function buildInsertPublicApiAuditLogSql(
  record: PublicApiAuditLogRecord,
  createdAt: Date
): SQL {
  return sql`
    insert into audit_log (
      id,
      tenant_id,
      actor_employee_id,
      action,
      entity_type,
      entity_id,
      metadata,
      created_at,
      updated_at
    )
    values (
      ${`audit:${record.requestId}`},
      ${record.tenantId},
      null,
      ${record.action},
      ${record.entityType},
      ${record.entityId},
      ${JSON.stringify({
        requestId: record.requestId,
        apiKeyId: record.apiKeyId,
        outcome: record.outcome,
        status: record.status,
        errorCode: record.errorCode
      })}::jsonb,
      ${createdAt},
      ${createdAt}
    )
    on conflict (id) do nothing
  `;
}

export function hashTenantApiKey(rawApiKey: string): string {
  return `sha256:${createHash("sha256").update(rawApiKey).digest("hex")}`;
}
