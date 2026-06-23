import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export type PlatformAuditAction =
  | "platform.auth.login.succeeded"
  | "platform.auth.logout.succeeded";

export type PlatformAuditRecord = {
  id: string;
  actorPlatformAdminAccountId?: string;
  action: PlatformAuditAction;
  entityType: "session";
  entityId: string;
  metadata?: Record<string, unknown>;
  occurredAt: Date;
};

export type PlatformAuditRepository = {
  record(record: PlatformAuditRecord): Promise<void>;
};

export function createSqlPlatformAuditRepository(
  executor: RawSqlExecutor | HuleeDatabase
): PlatformAuditRepository {
  const rawExecutor = executor as RawSqlExecutor;

  return {
    async record(record: PlatformAuditRecord): Promise<void> {
      await rawExecutor.execute(buildInsertPlatformAuditLogSql(record));
    }
  };
}

export function buildInsertPlatformAuditLogSql(
  record: PlatformAuditRecord
): SQL {
  return sql`
    insert into platform_audit_log (
      id,
      actor_platform_admin_account_id,
      action,
      entity_type,
      entity_id,
      metadata,
      created_at,
      updated_at
    )
    values (
      ${record.id},
      ${record.actorPlatformAdminAccountId ?? null},
      ${record.action},
      ${record.entityType},
      ${record.entityId},
      ${JSON.stringify(record.metadata ?? {})}::jsonb,
      ${record.occurredAt},
      ${record.occurredAt}
    )
    on conflict (id) do nothing
  `;
}
