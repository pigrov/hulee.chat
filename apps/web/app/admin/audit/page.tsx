import {
  isPermission,
  isPermissionScopeType,
  permissionCatalog,
  type Permission,
  type PermissionScopeType
} from "@hulee/core";
import {
  accessAuditActions,
  createSqlEmployeeDirectoryRepository,
  createSqlOrgStructureRepository,
  createSqlSecurityAuditRepository,
  createSqlTenantRbacRepository,
  type AccessAuditAction,
  type AccessAuditRecord,
  type ConversationRoutingAuditRecord,
  type TenantEmployeeRecord,
  type TenantRoleRecord,
  type TeamRecord,
  type WorkQueueRecord
} from "@hulee/db";
import { createTranslator, type I18nMessageKey } from "@hulee/i18n";
import { ListChecks, Route, Search } from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../../src/access-denied";
import { formatDateTime } from "../../../src/formatting";
import { loadInboxViewModel } from "../../../src/inbox-api-client";
import {
  getWebDatabase,
  resolveCurrentWebAccessSession
} from "../../../src/session";
import {
  hasEffectivePermission,
  resolveEmployeeEffectiveAccess
} from "../../../src/rbac-effective-access";
import { TenantAdminShell } from "../../../src/tenant-admin-shell";
import { navigationAccessFromTenantAdminAccess } from "../../../src/tenant-admin-nav";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Translator = ReturnType<typeof createTranslator>["t"];

type AuditEventType = "all" | "access" | "routing";

type AuditListRecord =
  | {
      readonly type: "access";
      readonly id: string;
      readonly occurredAt: string;
      readonly record: AccessAuditRecord;
    }
  | {
      readonly type: "routing";
      readonly id: string;
      readonly occurredAt: string;
      readonly record: ConversationRoutingAuditRecord;
    };

export default async function AuditAdminPage({
  searchParams
}: {
  searchParams?: Promise<{
    auditAction?: string;
    auditActorEmployeeId?: string;
    auditConversationId?: string;
    auditEventType?: string;
    auditFrom?: string;
    auditPermission?: string;
    auditRoleId?: string;
    auditTargetEmployeeId?: string;
    auditTo?: string;
  }>;
}): Promise<ReactNode> {
  const access = await resolveCurrentWebAccessSession();

  if (access === null) {
    redirect("/login");
  }

  const database = getWebDatabase();
  const employeeRepository = createSqlEmployeeDirectoryRepository(database);
  const rbacRepository = createSqlTenantRbacRepository(database);
  const accessSnapshot = await resolveEmployeeEffectiveAccess({
    tenantId: access.tenantId,
    employeeId: access.employeeId,
    employeeRepository,
    rbacRepository
  });

  if (!hasEffectivePermission(accessSnapshot, "audit.view")) {
    const adminAccess = {
      session: access,
      effectiveAccess: accessSnapshot
    };

    return (
      <AccessDeniedPage
        current="tenant-admin"
        navigationAccess={navigationAccessFromTenantAdminAccess(adminAccess)}
      />
    );
  }

  const securityAuditRepository = createSqlSecurityAuditRepository(database);
  const orgStructureRepository = createSqlOrgStructureRepository(database);
  const [model, employees, roles, teams, workQueues, resolvedSearchParams] =
    await Promise.all([
      loadInboxViewModel(),
      employeeRepository.listEmployees({ tenantId: access.tenantId }),
      rbacRepository.listRoleDefinitions({ tenantId: access.tenantId }),
      orgStructureRepository.listTeams({ tenantId: access.tenantId }),
      orgStructureRepository.listWorkQueues({
        tenantId: access.tenantId,
        activeOnly: true
      }),
      searchParams
    ]);
  const { t, locale } = createTranslator(model.tenant.locale);
  const filters = resolveAuditFilters(resolvedSearchParams, employees, roles);
  const includeAccessAudit = shouldIncludeAccessAudit(filters);
  const includeRoutingAudit = shouldIncludeRoutingAudit(filters);
  const [accessAuditRecords, routingAuditRecords] = await Promise.all([
    !includeAccessAudit
      ? Promise.resolve<readonly AccessAuditRecord[]>([])
      : securityAuditRepository.listAccessRecords({
          tenantId: access.tenantId,
          limit: 50,
          action: filters.accessAction,
          actorEmployeeId: filters.actorEmployeeId,
          targetEmployeeId: filters.targetEmployeeId,
          roleId: filters.roleId,
          permission: filters.permission,
          from: filters.from,
          to: filters.to
        }),
    !includeRoutingAudit
      ? Promise.resolve<readonly ConversationRoutingAuditRecord[]>([])
      : securityAuditRepository.listConversationRoutingRecords({
          tenantId: access.tenantId,
          limit: 50,
          actorEmployeeId: filters.actorEmployeeId,
          conversationId: filters.conversationId,
          from: filters.from,
          to: filters.to
        })
  ]);
  const records = mergeAuditRecords(accessAuditRecords, routingAuditRecords);

  return (
    <TenantAdminShell
      access={access}
      brand={model.tenant.brand}
      current="audit"
      effectiveAccess={accessSnapshot}
      t={t}
      tenantDisplayName={model.tenant.displayName}
      title={t("admin.audit")}
      titleId="admin-audit-title"
    >
      <div className="adminStack">
        <section className="settingsPanel" aria-labelledby="audit-filter-title">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.audit.eyebrow")}</p>
              <h2 className="sectionTitle" id="audit-filter-title">
                {t("admin.audit.filters")}
              </h2>
              <p className="metaText">{t("admin.audit.description")}</p>
            </div>
            <span className="badge">{records.length}</span>
          </div>

          <form className="settingsForm accessAuditFilterForm" method="get">
            <label className="fieldStack">
              <span className="detailLabel">{t("admin.audit.eventType")}</span>
              <select
                className="selectInput"
                defaultValue={filters.eventType}
                name="auditEventType"
              >
                <option value="all">{t("admin.audit.eventType.all")}</option>
                <option value="access">
                  {t("admin.audit.eventType.access")}
                </option>
                <option value="routing">
                  {t("admin.audit.eventType.routing")}
                </option>
              </select>
            </label>
            <label className="fieldStack">
              <span className="detailLabel">{t("admin.audit.action")}</span>
              <select
                className="selectInput"
                defaultValue={filters.accessAction ?? ""}
                name="auditAction"
              >
                <option value="">{t("admin.audit.allActions")}</option>
                {accessAuditActions.map((action) => (
                  <option key={action} value={action}>
                    {t(accessAuditActionKey(action))}
                  </option>
                ))}
              </select>
            </label>
            <label className="fieldStack">
              <span className="detailLabel">{t("admin.audit.actor")}</span>
              <select
                className="selectInput"
                defaultValue={filters.actorEmployeeId ?? ""}
                name="auditActorEmployeeId"
              >
                <option value="">{t("admin.audit.allActors")}</option>
                {employees.map((employee) => (
                  <option key={employee.employeeId} value={employee.employeeId}>
                    {employee.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="fieldStack">
              <span className="detailLabel">
                {t("admin.audit.targetEmployee")}
              </span>
              <select
                className="selectInput"
                defaultValue={filters.targetEmployeeId ?? ""}
                name="auditTargetEmployeeId"
              >
                <option value="">{t("admin.audit.allEmployees")}</option>
                {employees.map((employee) => (
                  <option key={employee.employeeId} value={employee.employeeId}>
                    {employee.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="fieldStack">
              <span className="detailLabel">{t("admin.audit.role")}</span>
              <select
                className="selectInput"
                defaultValue={filters.roleId ?? ""}
                name="auditRoleId"
              >
                <option value="">{t("admin.audit.allRoles")}</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {roleName(role, t)}
                  </option>
                ))}
              </select>
            </label>
            <label className="fieldStack">
              <span className="detailLabel">{t("admin.audit.permission")}</span>
              <select
                className="selectInput"
                defaultValue={filters.permission ?? ""}
                name="auditPermission"
              >
                <option value="">{t("admin.audit.allPermissions")}</option>
                {permissionCatalog.map((definition) => (
                  <option key={definition.id} value={definition.id}>
                    {definition.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="fieldStack">
              <span className="detailLabel">
                {t("admin.audit.conversationId")}
              </span>
              <input
                className="textInput"
                defaultValue={resolvedSearchParams?.auditConversationId ?? ""}
                name="auditConversationId"
                type="text"
              />
            </label>
            <label className="fieldStack">
              <span className="detailLabel">{t("admin.audit.from")}</span>
              <input
                className="textInput"
                defaultValue={resolvedSearchParams?.auditFrom ?? ""}
                name="auditFrom"
                type="date"
              />
            </label>
            <label className="fieldStack">
              <span className="detailLabel">{t("admin.audit.to")}</span>
              <input
                className="textInput"
                defaultValue={resolvedSearchParams?.auditTo ?? ""}
                name="auditTo"
                type="date"
              />
            </label>
            <button className="primaryButton" type="submit">
              <Search size={18} aria-hidden="true" />
              {t("admin.audit.filter")}
            </button>
          </form>
        </section>

        <section className="settingsPanel" aria-labelledby="audit-list-title">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.audit.eyebrow")}</p>
              <h2 className="sectionTitle" id="audit-list-title">
                {t("admin.audit.events")}
              </h2>
            </div>
            <span className="badge">{records.length}</span>
          </div>

          <div className="managementList">
            {records.length === 0 ? (
              <p className="metaText">{t("admin.audit.empty")}</p>
            ) : (
              records.map((record) =>
                record.type === "access" ? (
                  <AccessAuditRow
                    employees={employees}
                    key={record.id}
                    locale={locale}
                    record={record.record}
                    roles={roles}
                    t={t}
                  />
                ) : (
                  <RoutingAuditRow
                    employees={employees}
                    key={record.id}
                    locale={locale}
                    record={record.record}
                    teams={teams}
                    t={t}
                    workQueues={workQueues}
                  />
                )
              )
            )}
          </div>
        </section>
      </div>
    </TenantAdminShell>
  );
}

function AccessAuditRow({
  employees,
  locale,
  record,
  roles,
  t
}: {
  employees: readonly TenantEmployeeRecord[];
  locale: string;
  record: AccessAuditRecord;
  roles: readonly TenantRoleRecord[];
  t: Translator;
}): ReactNode {
  const actor = findEmployee(employees, record.actorEmployeeId);
  const targetEmployeeId = metadataString(record.metadata, "targetEmployeeId");
  const targetEmployee = findEmployee(employees, targetEmployeeId);
  const roleId = metadataString(record.metadata, "roleId");
  const role =
    roleId === undefined
      ? undefined
      : roles.find((candidate) => candidate.id === roleId);
  const permission = metadataString(record.metadata, "permission");
  const reason = metadataString(record.metadata, "reason");
  const scope = scopeValueFromAuditMetadata(record.metadata, t);

  return (
    <article className="managementRow accessAuditRow">
      <span className="metricIcon">
        <ListChecks size={18} aria-hidden="true" />
      </span>
      <div>
        <h3 className="listItemTitle">
          {t(accessAuditActionKey(record.action))}
        </h3>
        <p className="metaText">
          {t("admin.audit.occurredAtValue", {
            value: formatDateTime(record.occurredAt, locale)
          })}
        </p>
        <p className="metaText">
          {t("admin.audit.actorValue", {
            value: formatActor(record.actorEmployeeId, actor, t)
          })}
        </p>
        <p className="metaText">
          {t("admin.audit.entityValue", {
            value: `${t(accessAuditEntityKey(record.entityType))}:${record.entityId}`
          })}
        </p>
      </div>
      <div className="auditMetadataList">
        {targetEmployeeId === undefined ? null : (
          <span className="badge">
            {t("admin.audit.targetEmployeeValue", {
              value: employeeValue(targetEmployeeId, targetEmployee)
            })}
          </span>
        )}
        {roleId === undefined ? null : (
          <span className="badge">
            {t("admin.audit.roleValue", {
              value: role === undefined ? roleId : roleName(role, t)
            })}
          </span>
        )}
        {permission === undefined ? null : (
          <span className="badge">
            {t("admin.audit.permissionValue", {
              value: permission
            })}
          </span>
        )}
        {scope === undefined ? null : (
          <span className="badge">
            {t("admin.audit.scopeValue", {
              value: scope
            })}
          </span>
        )}
        {reason === undefined ? null : (
          <span className="badge">
            {t("admin.audit.reasonValue", {
              value: reason
            })}
          </span>
        )}
      </div>
    </article>
  );
}

function RoutingAuditRow({
  employees,
  locale,
  record,
  teams,
  t,
  workQueues
}: {
  employees: readonly TenantEmployeeRecord[];
  locale: string;
  record: ConversationRoutingAuditRecord;
  teams: readonly TeamRecord[];
  t: Translator;
  workQueues: readonly WorkQueueRecord[];
}): ReactNode {
  const actor = findEmployee(employees, record.actorEmployeeId);

  return (
    <article className="managementRow accessAuditRow">
      <span className="metricIcon">
        <Route size={18} aria-hidden="true" />
      </span>
      <div>
        <h3 className="listItemTitle">
          {t("admin.audit.action.conversationRoutingUpdated")}
        </h3>
        <p className="metaText">
          {t("admin.audit.occurredAtValue", {
            value: formatDateTime(record.occurredAt, locale)
          })}
        </p>
        <p className="metaText">
          {t("admin.audit.actorValue", {
            value: formatActor(record.actorEmployeeId, actor, t)
          })}
        </p>
        <p className="metaText">
          {t("admin.audit.conversationValue", {
            value: record.conversationId
          })}
        </p>
      </div>
      <div className="auditMetadataList">
        <span className="badge">
          {t("admin.audit.queueValue", {
            value: formatRoutingTransition({
              emptyLabel: t("inbox.routing.noQueue"),
              metadata: record.metadata,
              nextKey: "currentQueueId",
              previousKey: "previousCurrentQueueId",
              resolveLabel: (queueId) => queueLabel(queueId, workQueues)
            })
          })}
        </span>
        <span className="badge">
          {t("admin.audit.assigneeValue", {
            value: formatRoutingTransition({
              emptyLabel: t("inbox.routing.noAssignee"),
              metadata: record.metadata,
              nextKey: "assignedEmployeeId",
              previousKey: "previousAssignedEmployeeId",
              resolveLabel: (employeeId) =>
                employeeValue(employeeId, findEmployee(employees, employeeId))
            })
          })}
        </span>
        <span className="badge">
          {t("admin.audit.teamValue", {
            value: formatRoutingTransition({
              emptyLabel: t("inbox.routing.noTeam"),
              metadata: record.metadata,
              nextKey: "assignedTeamId",
              previousKey: "previousAssignedTeamId",
              resolveLabel: (teamId) => teamLabel(teamId, teams)
            })
          })}
        </span>
      </div>
    </article>
  );
}

function mergeAuditRecords(
  accessAuditRecords: readonly AccessAuditRecord[],
  routingAuditRecords: readonly ConversationRoutingAuditRecord[]
): readonly AuditListRecord[] {
  return [
    ...accessAuditRecords.map((record) => ({
      type: "access" as const,
      id: `access:${record.id}`,
      occurredAt: record.occurredAt,
      record
    })),
    ...routingAuditRecords.map((record) => ({
      type: "routing" as const,
      id: `routing:${record.id}`,
      occurredAt: record.occurredAt,
      record
    }))
  ]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, 50);
}

function shouldIncludeAccessAudit(filters: {
  readonly conversationId?: string;
  readonly eventType: AuditEventType;
}): boolean {
  return (
    filters.eventType !== "routing" && filters.conversationId === undefined
  );
}

function shouldIncludeRoutingAudit(filters: {
  readonly accessAction?: AccessAuditAction;
  readonly eventType: AuditEventType;
  readonly permission?: Permission;
  readonly roleId?: string;
  readonly targetEmployeeId?: string;
}): boolean {
  return (
    filters.eventType !== "access" &&
    filters.accessAction === undefined &&
    filters.permission === undefined &&
    filters.roleId === undefined &&
    filters.targetEmployeeId === undefined
  );
}

function resolveAuditFilters(
  searchParams:
    | {
        auditAction?: string;
        auditActorEmployeeId?: string;
        auditConversationId?: string;
        auditEventType?: string;
        auditFrom?: string;
        auditPermission?: string;
        auditRoleId?: string;
        auditTargetEmployeeId?: string;
        auditTo?: string;
      }
    | undefined,
  employees: readonly TenantEmployeeRecord[],
  roles: readonly TenantRoleRecord[]
): {
  readonly accessAction?: AccessAuditAction;
  readonly actorEmployeeId?: TenantEmployeeRecord["employeeId"];
  readonly conversationId?: string;
  readonly eventType: AuditEventType;
  readonly from?: Date;
  readonly permission?: Permission;
  readonly roleId?: string;
  readonly targetEmployeeId?: TenantEmployeeRecord["employeeId"];
  readonly to?: Date;
} {
  const actor = findEmployee(employees, searchParams?.auditActorEmployeeId);
  const targetEmployee = findEmployee(
    employees,
    searchParams?.auditTargetEmployeeId
  );
  const roleId =
    searchParams?.auditRoleId &&
    roles.some((role) => role.id === searchParams.auditRoleId)
      ? searchParams.auditRoleId
      : undefined;
  const permission =
    searchParams?.auditPermission && isPermission(searchParams.auditPermission)
      ? searchParams.auditPermission
      : undefined;
  const conversationId = normalizeOptionalFilter(
    searchParams?.auditConversationId
  );

  return {
    accessAction: resolveAccessAuditAction(searchParams?.auditAction),
    actorEmployeeId: actor?.employeeId,
    conversationId,
    eventType: resolveAuditEventType(searchParams?.auditEventType),
    from: resolveAuditDate(searchParams?.auditFrom, "start"),
    permission,
    roleId,
    targetEmployeeId: targetEmployee?.employeeId,
    to: resolveAuditDate(searchParams?.auditTo, "end")
  };
}

function resolveAuditEventType(value: string | undefined): AuditEventType {
  return value === "access" || value === "routing" ? value : "all";
}

function resolveAccessAuditAction(
  value: string | undefined
): AccessAuditAction | undefined {
  return accessAuditActions.includes(value as AccessAuditAction)
    ? (value as AccessAuditAction)
    : undefined;
}

function resolveAuditDate(
  value: string | undefined,
  boundary: "start" | "end"
): Date | undefined {
  if (value === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  if (boundary === "end") {
    date.setUTCHours(23, 59, 59, 999);
  }

  return date;
}

function normalizeOptionalFilter(
  value: string | undefined
): string | undefined {
  const trimmedValue = value?.trim();

  return trimmedValue === undefined || trimmedValue === ""
    ? undefined
    : trimmedValue;
}

function formatActor(
  actorEmployeeId: string | undefined,
  actor: TenantEmployeeRecord | undefined,
  t: Translator
): string {
  return actorEmployeeId === undefined
    ? t("admin.audit.systemActor")
    : employeeValue(actorEmployeeId, actor);
}

function findEmployee(
  employees: readonly TenantEmployeeRecord[],
  employeeId: string | undefined
): TenantEmployeeRecord | undefined {
  return employeeId === undefined
    ? undefined
    : employees.find((employee) => employee.employeeId === employeeId);
}

function metadataString(
  metadata: Record<string, unknown>,
  key: string
): string | undefined {
  const value = metadata[key];

  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function scopeValueFromAuditMetadata(
  metadata: Record<string, unknown>,
  t: Translator
): string | undefined {
  const scopeType = metadataString(metadata, "scopeType");
  const scopeId = metadataString(metadata, "scopeId");

  if (scopeType === undefined || !isPermissionScopeType(scopeType)) {
    return undefined;
  }

  return scopeId === undefined
    ? t(permissionScopeTypeKey(scopeType))
    : `${t(permissionScopeTypeKey(scopeType))}:${scopeId}`;
}

function formatRoutingTransition(input: {
  readonly emptyLabel: string;
  readonly metadata: Record<string, unknown>;
  readonly previousKey: string;
  readonly nextKey: string;
  readonly resolveLabel: (id: string) => string;
}): string {
  const previousValue = metadataString(input.metadata, input.previousKey);
  const nextValue = metadataString(input.metadata, input.nextKey);

  return `${previousValue ? input.resolveLabel(previousValue) : input.emptyLabel} -> ${
    nextValue ? input.resolveLabel(nextValue) : input.emptyLabel
  }`;
}

function employeeValue(
  employeeId: string,
  employee: TenantEmployeeRecord | undefined
): string {
  return employee === undefined
    ? employeeId
    : `${employee.displayName} (${employee.email})`;
}

function roleName(role: TenantRoleRecord, t: Translator): string {
  const roleLabelKey = role.isSystem ? fixedRoleLabelKey(role.id) : undefined;

  return roleLabelKey ? t(roleLabelKey) : role.name;
}

function queueLabel(
  queueId: string,
  workQueues: readonly WorkQueueRecord[]
): string {
  return (
    workQueues.find((workQueue) => workQueue.id === queueId)?.name ?? queueId
  );
}

function teamLabel(teamId: string, teams: readonly TeamRecord[]): string {
  return teams.find((team) => team.id === teamId)?.name ?? teamId;
}

function fixedRoleLabelKey(roleId: string): I18nMessageKey | undefined {
  if (roleId.endsWith(":tenant_admin")) {
    return "admin.employees.role.tenantAdmin";
  }

  if (roleId.endsWith(":supervisor")) {
    return "admin.employees.role.supervisor";
  }

  if (roleId.endsWith(":agent")) {
    return "admin.employees.role.agent";
  }

  return undefined;
}

function permissionScopeTypeKey(
  scopeType: PermissionScopeType
): I18nMessageKey {
  switch (scopeType) {
    case "tenant":
      return "admin.roles.scope.tenant";
    case "org_unit":
      return "admin.roles.scope.orgUnit";
    case "team":
      return "admin.roles.scope.team";
    case "queue":
      return "admin.roles.scope.queue";
    case "assigned":
      return "admin.roles.scope.assigned";
    case "own":
      return "admin.roles.scope.own";
    case "client":
      return "admin.roles.scope.client";
    case "conversation":
      return "admin.roles.scope.conversation";
  }
}

function accessAuditActionKey(action: AccessAuditAction): I18nMessageKey {
  switch (action) {
    case "role.created":
      return "admin.roles.auditAction.roleCreated";
    case "role.updated":
      return "admin.roles.auditAction.roleUpdated";
    case "role.archived":
      return "admin.roles.auditAction.roleArchived";
    case "role.restored":
      return "admin.roles.auditAction.roleRestored";
    case "role_binding.created":
      return "admin.roles.auditAction.roleBindingCreated";
    case "role_binding.revoked":
      return "admin.roles.auditAction.roleBindingRevoked";
    case "direct_grant.created":
      return "admin.roles.auditAction.directGrantCreated";
    case "direct_grant.revoked":
      return "admin.roles.auditAction.directGrantRevoked";
  }
}

function accessAuditEntityKey(
  entityType: AccessAuditRecord["entityType"]
): I18nMessageKey {
  switch (entityType) {
    case "role":
      return "admin.roles.auditEntity.role";
    case "role_binding":
      return "admin.roles.auditEntity.roleBinding";
    case "direct_grant":
      return "admin.roles.auditEntity.directGrant";
  }
}
