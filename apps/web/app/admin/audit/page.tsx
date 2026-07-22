import {
  isPermission,
  isPermissionScopeType,
  permissionCatalog,
  type Permission
} from "@hulee/core";
import type { EmployeeId } from "@hulee/contracts";
import {
  accessAuditActions,
  createSqlEmployeeDirectoryRepository,
  createSqlSecurityAuditRepository,
  createSqlTenantRbacRepository,
  type AccessAuditAction,
  type AccessAuditRecord
} from "@hulee/db";
import { createTranslator, type I18nMessageKey } from "@hulee/i18n";
import { ListChecks, Search } from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../../src/access-denied";
import { resolveAdminAuditAuthorization } from "../../../src/admin-audit-access";
import { formatDateTime } from "../../../src/formatting";
import { loadTenantAdminViewModel } from "../../../src/admin-view-model";
import { permissionScopeTypeKey } from "../../../src/rbac-permission-display";
import {
  getWebDatabase,
  resolveCurrentWebAccessSession
} from "../../../src/session";
import { resolveEmployeeEffectiveAccess } from "../../../src/rbac-effective-access";
import { TenantAdminShell } from "../../../src/tenant-admin-shell";
import { navigationAccessFromTenantAdminAccess } from "../../../src/tenant-admin-nav";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Translator = ReturnType<typeof createTranslator>["t"];

export default async function AuditAdminPage({
  searchParams
}: {
  searchParams?: Promise<{
    auditAction?: string;
    auditActorEmployeeId?: string;
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

  const auditAuthorization = resolveAdminAuditAuthorization(accessSnapshot);

  if (auditAuthorization === undefined) {
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
  const [model, resolvedSearchParams] = await Promise.all([
    loadTenantAdminViewModel({ tenantId: access.tenantId, database }),
    searchParams
  ]);
  const { t, locale } = createTranslator(model.tenant.locale);
  const filters = resolveAuditFilters(resolvedSearchParams);
  const records = await securityAuditRepository.listAccessRecords({
    tenantId: access.tenantId,
    authorization: auditAuthorization,
    limit: 50,
    action: filters.accessAction,
    actorEmployeeId: filters.actorEmployeeId,
    targetEmployeeId: filters.targetEmployeeId,
    roleId: filters.roleId,
    permission: filters.permission,
    from: filters.from,
    to: filters.to
  });

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
      <div className="adminSectionGrid">
        <aside
          className="settingsPanel adminSectionNav auditFilterPanel"
          aria-labelledby="audit-filter-title"
        >
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

          <form
            className="settingsForm accessAuditFilterForm auditFilterForm"
            method="get"
          >
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
              <input
                className="textInput"
                defaultValue={filters.actorEmployeeId ?? ""}
                name="auditActorEmployeeId"
                placeholder={t("admin.audit.allActors")}
                type="text"
              />
            </label>
            <label className="fieldStack">
              <span className="detailLabel">
                {t("admin.audit.targetEmployee")}
              </span>
              <input
                className="textInput"
                defaultValue={filters.targetEmployeeId ?? ""}
                name="auditTargetEmployeeId"
                placeholder={t("admin.audit.allEmployees")}
                type="text"
              />
            </label>
            <label className="fieldStack">
              <span className="detailLabel">{t("admin.audit.role")}</span>
              <input
                className="textInput"
                defaultValue={filters.roleId ?? ""}
                name="auditRoleId"
                placeholder={t("admin.audit.allRoles")}
                type="text"
              />
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
        </aside>

        <div className="adminStack adminSectionContent">
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
                records.map((record) => (
                  <AccessAuditRow
                    key={record.id}
                    locale={locale}
                    record={record}
                    t={t}
                  />
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </TenantAdminShell>
  );
}

function AccessAuditRow({
  locale,
  record,
  t
}: {
  locale: string;
  record: AccessAuditRecord;
  t: Translator;
}): ReactNode {
  const targetEmployeeId = metadataString(record.metadata, "targetEmployeeId");
  const roleId = metadataString(record.metadata, "roleId");
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
            value: formatActor(record.actorEmployeeId, t)
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
              value: targetEmployeeId
            })}
          </span>
        )}
        {roleId === undefined ? null : (
          <span className="badge">
            {t("admin.audit.roleValue", {
              value: roleId
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

function resolveAuditFilters(
  searchParams:
    | {
        auditAction?: string;
        auditActorEmployeeId?: string;
        auditFrom?: string;
        auditPermission?: string;
        auditRoleId?: string;
        auditTargetEmployeeId?: string;
        auditTo?: string;
      }
    | undefined
): {
  readonly accessAction?: AccessAuditAction;
  readonly actorEmployeeId?: EmployeeId;
  readonly from?: Date;
  readonly permission?: Permission;
  readonly roleId?: string;
  readonly targetEmployeeId?: EmployeeId;
  readonly to?: Date;
} {
  const actorEmployeeId = normalizeOptionalFilter(
    searchParams?.auditActorEmployeeId
  ) as EmployeeId | undefined;
  const targetEmployeeId = normalizeOptionalFilter(
    searchParams?.auditTargetEmployeeId
  ) as EmployeeId | undefined;
  const roleId = normalizeOptionalFilter(searchParams?.auditRoleId);
  const permission =
    searchParams?.auditPermission && isPermission(searchParams.auditPermission)
      ? searchParams.auditPermission
      : undefined;
  return {
    accessAction: resolveAccessAuditAction(searchParams?.auditAction),
    actorEmployeeId,
    from: resolveAuditDate(searchParams?.auditFrom, "start"),
    permission,
    roleId,
    targetEmployeeId,
    to: resolveAuditDate(searchParams?.auditTo, "end")
  };
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

  return trimmedValue === undefined ||
    trimmedValue === "" ||
    trimmedValue.length > 200
    ? undefined
    : trimmedValue;
}

function formatActor(
  actorEmployeeId: string | undefined,
  t: Translator
): string {
  return actorEmployeeId === undefined
    ? t("admin.audit.systemActor")
    : actorEmployeeId;
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
