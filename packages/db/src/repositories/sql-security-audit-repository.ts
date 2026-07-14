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

export type SecurityAuditAuthorization =
  | {
      readonly kind: "tenant";
    }
  | {
      readonly kind: "scoped";
      readonly orgUnitIds: readonly string[];
      readonly teamIds: readonly string[];
      readonly queueIds: readonly string[];
    }
  | {
      readonly kind: "conversation";
      readonly conversationId: string;
    };

export type ListAccessAuditRecordsInput = {
  tenantId: TenantId;
  authorization: SecurityAuditAuthorization;
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
  authorization: SecurityAuditAuthorization;
  conversationId?: string;
  limit: number;
  actorEmployeeId?: EmployeeId;
  from?: Date;
  to?: Date;
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

      return filterSecurityAuditRecordsByAuthorization(
        input.authorization,
        records
      );
    },

    async listConversationRoutingRecords(
      input: ListConversationRoutingAuditRecordsInput
    ): Promise<readonly ConversationRoutingAuditRecord[]> {
      const result = await rawExecutor.execute<ConversationRoutingAuditRow>(
        buildListConversationRoutingAuditRecordsSql(input)
      );
      const records = result.rows.map(mapConversationRoutingAuditRow);

      assertTenantScopedConversationRoutingAuditRows(input, records);

      return filterSecurityAuditRecordsByAuthorization(
        input.authorization,
        records
      );
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
  const actorEmployeeId = input.actorEmployeeId ?? null;
  const conversationId = normalizeOptionalFilter(input.conversationId);
  const from = input.from ?? null;
  const to = input.to ?? null;
  const limit = normalizeLimit(input.limit);
  const authorizationPredicate = buildSecurityAuditAuthorizationPredicate(
    input.authorization,
    "routing",
    conversationId
  );

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
      and (${actorEmployeeId}::text is null or actor_employee_id = ${actorEmployeeId})
      and (${conversationId}::text is null or entity_id = ${conversationId})
      and (${from}::timestamptz is null or created_at >= ${from})
      and (${to}::timestamptz is null or created_at <= ${to})
      and ${authorizationPredicate}
    order by created_at desc
    limit ${limit}
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
  const authorizationPredicate = buildSecurityAuditAuthorizationPredicate(
    input.authorization,
    "access"
  );

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
      and ${authorizationPredicate}
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

function buildSecurityAuditAuthorizationPredicate(
  authorization: SecurityAuditAuthorization,
  listKind: "access" | "routing",
  routeConversationId: string | null = null
): SQL {
  if (authorization.kind === "tenant") {
    return sql`true`;
  }

  if (authorization.kind === "conversation") {
    const conversationId = normalizeOptionalFilter(
      authorization.conversationId
    );

    return listKind === "routing" &&
      conversationId !== null &&
      routeConversationId === conversationId
      ? sql`entity_id = ${conversationId}`
      : sql`false`;
  }

  const scopePredicates = [
    ...buildAuthorizationScopePredicates("org_unit", authorization.orgUnitIds),
    ...buildAuthorizationScopePredicates("team", authorization.teamIds),
    ...buildAuthorizationScopePredicates("queue", authorization.queueIds)
  ];

  if (scopePredicates.length === 0) {
    return sql`false`;
  }

  return sql`exists (
    select 1
    from jsonb_array_elements(
      case
        when jsonb_typeof(metadata->'authorizationScopes') = 'array'
          then metadata->'authorizationScopes'
        else '[]'::jsonb
      end
    ) as authorization_scope(scope)
    where ${sql.join(scopePredicates, sql` or `)}
  )`;
}

function buildAuthorizationScopePredicates(
  type: "org_unit" | "team" | "queue",
  ids: readonly string[]
): readonly SQL[] {
  return normalizeAuthorizationScopeIds(ids).map(
    (id) =>
      sql`(authorization_scope.scope->>'type' = ${type} and authorization_scope.scope->>'id' = ${id})`
  );
}

function normalizeAuthorizationScopeIds(ids: readonly string[]): string[] {
  return [
    ...new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0))
  ].sort();
}

function filterSecurityAuditRecordsByAuthorization<
  AuditRecord extends { readonly metadata: Record<string, unknown> }
>(
  authorization: SecurityAuditAuthorization,
  records: readonly AuditRecord[]
): readonly AuditRecord[] {
  if (authorization.kind !== "scoped") {
    return records;
  }

  const allowedScopeIds = {
    org_unit: new Set(normalizeAuthorizationScopeIds(authorization.orgUnitIds)),
    team: new Set(normalizeAuthorizationScopeIds(authorization.teamIds)),
    queue: new Set(normalizeAuthorizationScopeIds(authorization.queueIds))
  };

  return records.flatMap((record) => {
    const matchingScopes = matchingSecurityAuditAuthorizationScopes(
      record.metadata.authorizationScopes,
      allowedScopeIds
    );

    if (matchingScopes.length === 0) {
      return [];
    }

    return [
      {
        ...record,
        metadata: redactScopedSecurityAuditMetadata(
          record.metadata,
          allowedScopeIds,
          matchingScopes
        )
      } as AuditRecord
    ];
  });
}

type StructuralAuditScopeType = "org_unit" | "team" | "queue";

type AllowedStructuralAuditScopeIds = Readonly<
  Record<StructuralAuditScopeType, ReadonlySet<string>>
>;

type SecurityAuditAuthorizationScope = {
  readonly type: StructuralAuditScopeType;
  readonly id: string;
};

const omittedAuditMetadataValue = Symbol("omitted-audit-metadata-value");

function matchingSecurityAuditAuthorizationScopes(
  value: unknown,
  allowedScopeIds: AllowedStructuralAuditScopeIds
): readonly SecurityAuditAuthorizationScope[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const matchingScopes = new Map<string, SecurityAuditAuthorizationScope>();

  for (const rawScope of value) {
    if (
      rawScope === null ||
      typeof rawScope !== "object" ||
      Array.isArray(rawScope)
    ) {
      continue;
    }

    const candidate = rawScope as Record<string, unknown>;
    const type = candidate.type;
    const id = candidate.id;

    if (
      typeof id === "string" &&
      isStructuralAuditScopeType(type) &&
      allowedScopeIds[type].has(id)
    ) {
      matchingScopes.set(`${type}:${id}`, { type, id });
    }
  }

  return [...matchingScopes.values()];
}

function redactScopedSecurityAuditMetadata(
  metadata: Record<string, unknown>,
  allowedScopeIds: AllowedStructuralAuditScopeIds,
  matchingScopes: readonly SecurityAuditAuthorizationScope[]
): Record<string, unknown> {
  return {
    ...redactSecurityAuditMetadataObject(metadata, allowedScopeIds),
    authorizationScopes: matchingScopes
  };
}

function redactSecurityAuditMetadataObject(
  metadata: Record<string, unknown>,
  allowedScopeIds: AllowedStructuralAuditScopeIds
): Record<string, unknown> {
  const redactedMetadata: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (key === "authorizationScopes") {
      continue;
    }

    if (isScopedAuditIdentifierAlwaysHidden(key, metadata)) {
      continue;
    }

    const dimension = structuralAuditDimensionForMetadataKey(key, metadata);
    const redactedValue =
      dimension === undefined
        ? redactNestedSecurityAuditMetadataValue(value, allowedScopeIds)
        : redactStructuralAuditMetadataValue(value, allowedScopeIds[dimension]);

    if (redactedValue !== omittedAuditMetadataValue) {
      redactedMetadata[key] = redactedValue;
    }
  }

  return redactedMetadata;
}

function isScopedAuditIdentifierAlwaysHidden(
  key: string,
  metadata: Record<string, unknown>
): boolean {
  const normalizedKey = key.replace(/[^a-z]/gi, "").toLowerCase();

  if (normalizedKey === "scopeid" || normalizedKey === "scopeids") {
    return !isStructuralAuditScopeType(metadata.scopeType);
  }

  if (normalizedKey === "subjectid" || normalizedKey === "subjectids") {
    return (
      metadata.subjectType !== "employee" &&
      !isStructuralAuditScopeType(metadata.subjectType)
    );
  }

  return (
    (normalizedKey === "id" || normalizedKey === "ids") &&
    (metadata.type === "client" || metadata.type === "conversation")
  );
}

function redactNestedSecurityAuditMetadataValue(
  value: unknown,
  allowedScopeIds: AllowedStructuralAuditScopeIds
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) =>
      redactNestedSecurityAuditMetadataValue(item, allowedScopeIds)
    );
  }

  if (value !== null && typeof value === "object") {
    return redactSecurityAuditMetadataObject(
      value as Record<string, unknown>,
      allowedScopeIds
    );
  }

  return value;
}

function redactStructuralAuditMetadataValue(
  value: unknown,
  allowedIds: ReadonlySet<string>
): unknown | typeof omittedAuditMetadataValue {
  if (value === null) {
    return null;
  }

  if (typeof value === "string") {
    return allowedIds.has(value) ? value : omittedAuditMetadataValue;
  }

  if (Array.isArray(value)) {
    return value.filter(
      (candidate): candidate is string =>
        typeof candidate === "string" && allowedIds.has(candidate)
    );
  }

  return omittedAuditMetadataValue;
}

function structuralAuditDimensionForMetadataKey(
  key: string,
  metadata: Record<string, unknown>
): StructuralAuditScopeType | undefined {
  const normalizedKey = key.replace(/[^a-z]/gi, "").toLowerCase();

  if (normalizedKey !== "id" && normalizedKey !== "ids") {
    if (!normalizedKey.endsWith("id") && !normalizedKey.endsWith("ids")) {
      return undefined;
    }

    if (normalizedKey.includes("orgunit")) {
      return "org_unit";
    }

    if (normalizedKey.includes("queue")) {
      return "queue";
    }

    if (normalizedKey.includes("team")) {
      return "team";
    }
  }

  const explicitScopeType =
    normalizedKey === "scopeid" || normalizedKey === "scopeids"
      ? metadata.scopeType
      : normalizedKey === "subjectid" || normalizedKey === "subjectids"
        ? metadata.subjectType
        : metadata.type;

  return isStructuralAuditScopeType(explicitScopeType)
    ? explicitScopeType
    : undefined;
}

function isStructuralAuditScopeType(
  value: unknown
): value is StructuralAuditScopeType {
  return value === "org_unit" || value === "team" || value === "queue";
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
        (input.conversationId !== undefined &&
          record.conversationId !== input.conversationId) ||
        (input.authorization.kind === "conversation" &&
          record.conversationId !== input.authorization.conversationId)
    )
  ) {
    throw new CoreError("tenant.boundary_violation");
  }
}
