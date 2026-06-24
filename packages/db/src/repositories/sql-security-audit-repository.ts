import type { EmployeeId, TenantId } from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";
import { mapSqlTimestamp, type SqlTimestamp } from "./sql-timestamp";

export type AuthSecurityAuditAction =
  | "auth.login.succeeded"
  | "auth.login.tenant_selected"
  | "auth.logout.succeeded"
  | "auth.registration.completed"
  | "auth.invite.accepted";

export const accessAuditActions = [
  "role.created",
  "role.updated",
  "role.archived",
  "role.restored",
  "role_binding.created",
  "role_binding.revoked",
  "direct_grant.created",
  "direct_grant.revoked"
] as const;

export type AccessAuditAction = (typeof accessAuditActions)[number];

export type OrgStructureAuditAction =
  | "org_unit.created"
  | "org_unit.updated"
  | "org_unit.archived"
  | "org_unit.restored"
  | "team.created"
  | "team.updated"
  | "work_queue.created"
  | "work_queue.updated"
  | "work_queue.archived"
  | "work_queue.restored"
  | "employee_org_membership.updated"
  | "employee_team_membership.updated"
  | "employee_queue_membership.updated";

export type ConversationAuditAction = "conversation.routing.updated";

export type SecurityAuditAction =
  | AuthSecurityAuditAction
  | AccessAuditAction
  | OrgStructureAuditAction
  | ConversationAuditAction;

export type AccessAuditEntityType = "role" | "role_binding" | "direct_grant";

export type SecurityAuditEntityType =
  | "session"
  | AccessAuditEntityType
  | "employee"
  | "conversation"
  | "org_unit"
  | "team"
  | "work_queue";

export type SecurityAuditRecord = {
  id: string;
  tenantId: TenantId;
  actorEmployeeId?: EmployeeId;
  action: SecurityAuditAction;
  entityType: SecurityAuditEntityType;
  entityId: string;
  metadata?: Record<string, unknown>;
  occurredAt: Date;
};

export type AccessAuditRecord = {
  id: string;
  tenantId: TenantId;
  actorEmployeeId?: EmployeeId;
  action: AccessAuditAction;
  entityType: AccessAuditEntityType;
  entityId: string;
  metadata: Record<string, unknown>;
  occurredAt: string;
};

export type ListAccessAuditRecordsInput = {
  tenantId: TenantId;
  limit: number;
  action?: AccessAuditAction;
  actorEmployeeId?: EmployeeId;
  targetEmployeeId?: EmployeeId;
  roleId?: string;
  permission?: string;
  from?: Date;
  to?: Date;
};

export type ConversationRoutingAuditRecord = {
  id: string;
  tenantId: TenantId;
  actorEmployeeId?: EmployeeId;
  conversationId: string;
  metadata: Record<string, unknown>;
  occurredAt: string;
};

export type ListConversationRoutingAuditRecordsInput = {
  tenantId: TenantId;
  conversationId: string;
  limit: number;
};

export type SecurityAuditRepository = {
  record(record: SecurityAuditRecord): Promise<void>;
  listAccessRecords(
    input: ListAccessAuditRecordsInput
  ): Promise<readonly AccessAuditRecord[]>;
  listConversationRoutingRecords(
    input: ListConversationRoutingAuditRecordsInput
  ): Promise<readonly ConversationRoutingAuditRecord[]>;
};

export function createSqlSecurityAuditRepository(
  executor: RawSqlExecutor | HuleeDatabase
): SecurityAuditRepository {
  const rawExecutor = executor as RawSqlExecutor;

  return {
    async record(record: SecurityAuditRecord): Promise<void> {
      await rawExecutor.execute(buildInsertSecurityAuditLogSql(record));
    },

    async listAccessRecords(
      input: ListAccessAuditRecordsInput
    ): Promise<readonly AccessAuditRecord[]> {
      const result = await rawExecutor.execute<AccessAuditRow>(
        buildListAccessAuditRecordsSql(input)
      );
      const records = result.rows.map(mapAccessAuditRow);

      assertTenantScopedAccessAuditRows(input.tenantId, records);

      return records;
    },

    async listConversationRoutingRecords(
      input: ListConversationRoutingAuditRecordsInput
    ): Promise<readonly ConversationRoutingAuditRecord[]> {
      const result = await rawExecutor.execute<ConversationRoutingAuditRow>(
        buildListConversationRoutingAuditRecordsSql(input)
      );
      const records = result.rows.map(mapConversationRoutingAuditRow);

      assertTenantScopedConversationRoutingAuditRows(input, records);

      return records;
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

export function buildListConversationRoutingAuditRecordsSql(
  input: ListConversationRoutingAuditRecordsInput
): SQL {
  return sql`
    select id,
           tenant_id,
           actor_employee_id,
           entity_id,
           metadata,
           created_at
    from audit_log
    where tenant_id = ${input.tenantId}
      and action = 'conversation.routing.updated'
      and entity_type = 'conversation'
      and entity_id = ${input.conversationId}
    order by created_at desc
    limit ${normalizeLimit(input.limit)}
  `;
}

export function buildListAccessAuditRecordsSql(
  input: ListAccessAuditRecordsInput
): SQL {
  const action = input.action ?? null;
  const actorEmployeeId = input.actorEmployeeId ?? null;
  const targetEmployeeId = input.targetEmployeeId ?? null;
  const roleId = normalizeOptionalFilter(input.roleId);
  const permission = normalizeOptionalFilter(input.permission);
  const from = input.from ?? null;
  const to = input.to ?? null;
  const limit = normalizeLimit(input.limit);

  return sql`
    select id,
           tenant_id,
           actor_employee_id,
           action,
           entity_type,
           entity_id,
           metadata,
           created_at
    from audit_log
    where tenant_id = ${input.tenantId}
      and action in (${sql.join(
        accessAuditActions.map(
          (accessAuditAction) => sql`${accessAuditAction}`
        ),
        sql`, `
      )})
      and (${action}::text is null or action = ${action})
      and (${actorEmployeeId}::text is null or actor_employee_id = ${actorEmployeeId})
      and (${targetEmployeeId}::text is null or metadata->>'targetEmployeeId' = ${targetEmployeeId})
      and (${roleId}::text is null or metadata->>'roleId' = ${roleId})
      and (${permission}::text is null or metadata->>'permission' = ${permission})
      and (${from}::timestamptz is null or created_at >= ${from})
      and (${to}::timestamptz is null or created_at <= ${to})
    order by created_at desc
    limit ${limit}
  `;
}

type AccessAuditRow = {
  id: string;
  tenant_id: string;
  actor_employee_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: unknown;
  created_at: SqlTimestamp;
};

type ConversationRoutingAuditRow = {
  id: string;
  tenant_id: string;
  actor_employee_id: string | null;
  entity_id: string;
  metadata: unknown;
  created_at: SqlTimestamp;
};

function mapAccessAuditRow(row: AccessAuditRow): AccessAuditRecord {
  if (
    !isAccessAuditAction(row.action) ||
    !isAccessAuditEntity(row.entity_type)
  ) {
    throw new Error("Invalid access audit record.");
  }

  return {
    id: row.id,
    tenantId: row.tenant_id as TenantId,
    actorEmployeeId: row.actor_employee_id
      ? (row.actor_employee_id as EmployeeId)
      : undefined,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    metadata: mapMetadata(row.metadata),
    occurredAt: mapSqlTimestamp(row.created_at)
  };
}

function mapConversationRoutingAuditRow(
  row: ConversationRoutingAuditRow
): ConversationRoutingAuditRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id as TenantId,
    actorEmployeeId: row.actor_employee_id
      ? (row.actor_employee_id as EmployeeId)
      : undefined,
    conversationId: row.entity_id,
    metadata: mapMetadata(row.metadata),
    occurredAt: mapSqlTimestamp(row.created_at)
  };
}

function normalizeLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1) {
    return 50;
  }

  return Math.min(limit, 100);
}

function normalizeOptionalFilter(value: string | undefined): string | null {
  if (value === undefined || value.trim().length === 0) {
    return null;
  }

  return value.trim();
}

function isAccessAuditAction(action: string): action is AccessAuditAction {
  return accessAuditActions.includes(action as AccessAuditAction);
}

function isAccessAuditEntity(
  entityType: string
): entityType is AccessAuditEntityType {
  return (
    entityType === "role" ||
    entityType === "role_binding" ||
    entityType === "direct_grant"
  );
}

function mapMetadata(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function assertTenantScopedAccessAuditRows(
  tenantId: TenantId,
  records: readonly AccessAuditRecord[]
): void {
  if (records.some((record) => record.tenantId !== tenantId)) {
    throw new CoreError("tenant.boundary_violation");
  }
}

function assertTenantScopedConversationRoutingAuditRows(
  input: ListConversationRoutingAuditRecordsInput,
  records: readonly ConversationRoutingAuditRecord[]
): void {
  if (
    records.some(
      (record) =>
        record.tenantId !== input.tenantId ||
        record.conversationId !== input.conversationId
    )
  ) {
    throw new CoreError("tenant.boundary_violation");
  }
}
