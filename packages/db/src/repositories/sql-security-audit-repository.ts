import type { EmployeeId, TenantId } from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export type SecurityAuditAction =
  | "auth.login.succeeded"
  | "auth.login.tenant_selected"
  | "auth.logout.succeeded"
  | "auth.registration.completed"
  | "auth.invite.accepted";

export type SecurityAuditRecord = {
  id: string;
  tenantId: TenantId;
  actorEmployeeId?: EmployeeId;
  action: SecurityAuditAction;
  entityType: "session";
  entityId: string;
  metadata?: Record<string, unknown>;
  occurredAt: Date;
};

export type SecurityAuditRepository = {
  record(record: SecurityAuditRecord): Promise<void>;
};

export function createSqlSecurityAuditRepository(
  executor: RawSqlExecutor | HuleeDatabase
): SecurityAuditRepository {
  const rawExecutor = executor as RawSqlExecutor;

  return {
    async record(record: SecurityAuditRecord): Promise<void> {
      await rawExecutor.execute(buildInsertSecurityAuditLogSql(record));
    }
  };
}

export function buildInsertSecurityAuditLogSql(
  record: SecurityAuditRecord
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
      ${record.id},
      ${record.tenantId},
      ${record.actorEmployeeId ?? null},
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
