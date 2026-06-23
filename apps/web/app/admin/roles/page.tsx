import {
  getPermissionDefinition,
  permissionCatalog,
  type Permission,
  type PermissionDomain,
  type PermissionRoleBinding,
  type PermissionRoleBindingSubject,
  type PermissionScope
} from "@hulee/core";
import {
  createSqlEmployeeDirectoryRepository,
  createSqlTenantRbacRepository,
  type TenantEmployeeRecord,
  type TenantRoleRecord
} from "@hulee/db";
import { createTranslator, type I18nMessageKey } from "@hulee/i18n";
import { KeyRound, Plus, ShieldCheck, XCircle } from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../../src/access-denied";
import {
  canTenantPermission,
  navigationAccessFromSession
} from "../../../src/access";
import { DetailItem } from "../../../src/app-chrome";
import { loadInboxViewModel } from "../../../src/inbox-api-client";
import {
  assignTenantRoleAction,
  revokeTenantRoleBindingAction
} from "../../../src/role-actions";
import {
  getWebDatabase,
  resolveCurrentWebAccessSession
} from "../../../src/session";
import { TenantAdminShell } from "../../../src/tenant-admin-shell";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const domainOrder = [
  "tenant",
  "employees",
  "roles",
  "integrations",
  "branding",
  "inbox",
  "messages",
  "conversations",
  "clients",
  "leads",
  "files",
  "reports",
  "audit",
  "api"
] as const satisfies readonly PermissionDomain[];

type Translator = ReturnType<typeof createTranslator>["t"];

type DomainSummary = {
  domain: PermissionDomain;
  permissions: readonly Permission[];
};

export default async function RolesAdminPage({
  searchParams
}: {
  searchParams?: Promise<{
    roleActionStatus?: string;
  }>;
}): Promise<ReactNode> {
  const access = await resolveCurrentWebAccessSession();

  if (access === null) {
    redirect("/login");
  }

  if (!canTenantPermission(access, "roles.manage")) {
    return (
      <AccessDeniedPage
        current="tenant-admin"
        navigationAccess={navigationAccessFromSession(access)}
      />
    );
  }

  const repository = createSqlTenantRbacRepository(getWebDatabase());
  const employeeRepository =
    createSqlEmployeeDirectoryRepository(getWebDatabase());
  const now = new Date();
  const [model, roles, roleBindings, employees, resolvedSearchParams] =
    await Promise.all([
      loadInboxViewModel(),
      repository.listRoleDefinitions({ tenantId: access.tenantId }),
      repository.listRoleBindings({ tenantId: access.tenantId, at: now }),
      employeeRepository.listEmployees({ tenantId: access.tenantId }),
      searchParams
    ]);
  const { t } = createTranslator(model.tenant.locale);
  const activeRoles = roles.filter((role) => role.status === "active");
  const activeEmployees = employees.filter(
    (employee) => employee.deactivatedAt === null
  );
  const roleBindingsByRoleId = countBindingsByRoleId(roleBindings);

  return (
    <TenantAdminShell
      access={access}
      brand={model.tenant.brand}
      current="roles"
      sidebarContent={
        resolvedSearchParams?.roleActionStatus ? (
          <DetailItem
            label={t("admin.roles.actionStatus")}
            value={t(
              roleActionStatusKey(resolvedSearchParams.roleActionStatus)
            )}
          />
        ) : null
      }
      t={t}
      tenantDisplayName={model.tenant.displayName}
      title={t("admin.roles")}
      titleId="roles-title"
    >
      <div className="adminStack">
        <section className="settingsPanel" aria-labelledby="role-assign-title">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.roles.assignments")}</p>
              <h2 className="sectionTitle" id="role-assign-title">
                {t("admin.roles.assignRole")}
              </h2>
              <p className="metaText">
                {t("admin.roles.assignRole.description")}
              </p>
            </div>
            <span className="badge">{activeEmployees.length}</span>
          </div>

          <form
            className="settingsForm roleAssignForm"
            action={assignTenantRoleAction}
          >
            <label className="fieldStack">
              <span className="detailLabel">{t("admin.roles.employee")}</span>
              <select className="selectInput" name="employeeId" required>
                <option value="">{t("admin.roles.selectEmployee")}</option>
                {activeEmployees.map((employee) => (
                  <option key={employee.employeeId} value={employee.employeeId}>
                    {employee.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="fieldStack">
              <span className="detailLabel">{t("admin.roles.role")}</span>
              <select className="selectInput" name="roleId" required>
                <option value="">{t("admin.roles.selectRole")}</option>
                {activeRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {roleName(role, t)}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="primaryButton"
              type="submit"
              disabled={
                activeEmployees.length === 0 || activeRoles.length === 0
              }
            >
              <Plus size={18} aria-hidden="true" />
              {t("admin.roles.assign")}
            </button>
          </form>
        </section>

        <section
          className="settingsPanel"
          aria-labelledby="role-bindings-title"
        >
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.roles.assignments")}</p>
              <h2 className="sectionTitle" id="role-bindings-title">
                {t("admin.roles.activeAssignments")}
              </h2>
              <p className="metaText">
                {t("admin.roles.activeAssignments.description")}
              </p>
            </div>
            <span className="badge">{roleBindings.length}</span>
          </div>

          <div className="managementList">
            {roleBindings.length === 0 ? (
              <p className="metaText">{t("admin.roles.noAssignments")}</p>
            ) : (
              roleBindings.map((binding) => (
                <RoleBindingRow
                  binding={binding}
                  currentEmployeeId={access.employeeId}
                  employees={employees}
                  key={binding.id}
                  roles={roles}
                  t={t}
                />
              ))
            )}
          </div>
        </section>

        <section className="settingsPanel" aria-labelledby="roles-list-title">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.roles")}</p>
              <h2 className="sectionTitle" id="roles-list-title">
                {t("admin.roles.roleDefinitions")}
              </h2>
              <p className="metaText">
                {t("admin.roles.roleDefinitions.description")}
              </p>
            </div>
            <span className="badge">{roles.length}</span>
          </div>

          <div className="managementList">
            {roles.length === 0 ? (
              <p className="metaText">{t("admin.roles.empty")}</p>
            ) : (
              roles.map((role) => (
                <RoleDefinitionRow
                  bindingCount={roleBindingsByRoleId.get(role.id) ?? 0}
                  key={role.id}
                  role={role}
                  t={t}
                />
              ))
            )}
          </div>
        </section>

        <section
          className="settingsPanel"
          aria-labelledby="permission-catalog-title"
        >
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.roles.permissions")}</p>
              <h2 className="sectionTitle" id="permission-catalog-title">
                {t("admin.roles.permissionCatalog")}
              </h2>
              <p className="metaText">
                {t("admin.roles.permissionCatalog.description")}
              </p>
            </div>
            <span className="badge">{permissionCatalog.length}</span>
          </div>

          <div className="managementList">
            {summarizeCatalogDomains().map((summary) => (
              <article
                className="managementRow roleCatalogRow"
                key={summary.domain}
              >
                <div>
                  <h3 className="listItemTitle">
                    {t(permissionDomainKey(summary.domain))}
                  </h3>
                  <p className="metaText">
                    {t("admin.roles.permissionCount", {
                      count: summary.permissions.length
                    })}
                  </p>
                </div>
                <div className="permissionCodeList">
                  {summary.permissions.map((permission) => (
                    <code className="permissionCode" key={permission}>
                      {permission}
                    </code>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </TenantAdminShell>
  );
}

function RoleDefinitionRow({
  bindingCount,
  role,
  t
}: {
  bindingCount: number;
  role: TenantRoleRecord;
  t: Translator;
}): ReactNode {
  const summaries = summarizeRoleDomains(role.permissions);

  return (
    <article className="managementRow roleDefinitionRow">
      <span className="metricIcon">
        {role.isSystem ? (
          <ShieldCheck size={18} aria-hidden="true" />
        ) : (
          <KeyRound size={18} aria-hidden="true" />
        )}
      </span>
      <div>
        <h3 className="listItemTitle">{roleName(role, t)}</h3>
        <p className="metaText">
          {t("admin.roles.permissionCount", {
            count: role.permissions.length
          })}
        </p>
        <p className="metaText">
          {t("admin.roles.assignmentCount", {
            count: bindingCount
          })}
        </p>
      </div>
      <div className="badgeRow roleDefinitionMeta">
        <span className="badge">
          {t(
            role.isSystem
              ? "admin.roles.kind.system"
              : "admin.roles.kind.custom"
          )}
        </span>
        <span className="badge">{t(roleStatusKey(role.status))}</span>
      </div>
      <div className="badgeRow rolePermissionDomains">
        {summaries.map((summary) => (
          <span className="badge" key={summary.domain}>
            {t("admin.roles.domainCount", {
              domain: t(permissionDomainKey(summary.domain)),
              count: summary.permissions.length
            })}
          </span>
        ))}
      </div>
    </article>
  );
}

function RoleBindingRow({
  binding,
  currentEmployeeId,
  employees,
  roles,
  t
}: {
  binding: PermissionRoleBinding;
  currentEmployeeId: string;
  employees: readonly TenantEmployeeRecord[];
  roles: readonly TenantRoleRecord[];
  t: Translator;
}): ReactNode {
  const role = roles.find((candidate) => candidate.id === binding.roleId);
  const employee =
    binding.subject.type === "employee"
      ? employees.find(
          (candidate) => candidate.employeeId === binding.subject.id
        )
      : undefined;
  const isCurrentEmployee =
    binding.subject.type === "employee" &&
    binding.subject.id === currentEmployeeId;

  return (
    <article className="managementRow roleBindingRow">
      <span className="metricIcon">
        <KeyRound size={18} aria-hidden="true" />
      </span>
      <div>
        <h3 className="listItemTitle">
          {role ? roleName(role, t) : binding.roleId}
        </h3>
        <p className="metaText">
          {t("admin.roles.assignmentSubject", {
            subject: t(subjectTypeKey(binding.subject)),
            value: subjectValue(binding.subject, employee)
          })}
        </p>
        <p className="metaText">
          {t("admin.roles.assignmentScope", {
            value: scopeValue(binding.scope, t)
          })}
        </p>
      </div>
      <div className="rowActions">
        {isCurrentEmployee ? (
          <span className="badge">{t("admin.roles.currentUser")}</span>
        ) : (
          <form className="inlineForm" action={revokeTenantRoleBindingAction}>
            <input name="bindingId" type="hidden" value={binding.id} />
            <button className="dangerButton" type="submit">
              <XCircle size={14} aria-hidden="true" />
              {t("admin.roles.revoke")}
            </button>
          </form>
        )}
      </div>
    </article>
  );
}

function roleName(role: TenantRoleRecord, t: Translator): string {
  const roleLabelKey = role.isSystem ? fixedRoleLabelKey(role.id) : undefined;

  return roleLabelKey ? t(roleLabelKey) : role.name;
}

function countBindingsByRoleId(
  bindings: readonly PermissionRoleBinding[]
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const binding of bindings) {
    counts.set(binding.roleId, (counts.get(binding.roleId) ?? 0) + 1);
  }

  return counts;
}

function subjectValue(
  subject: PermissionRoleBindingSubject,
  employee: TenantEmployeeRecord | undefined
): string {
  if (subject.type !== "employee") {
    return subject.id;
  }

  return employee ? `${employee.displayName} (${employee.email})` : subject.id;
}

function scopeValue(scope: PermissionScope, t: Translator): string {
  if (scope.type === "tenant") {
    return t("admin.roles.scope.tenant");
  }

  return "id" in scope ? `${scope.type}:${scope.id}` : scope.type;
}

function summarizeRoleDomains(
  permissions: readonly Permission[]
): readonly DomainSummary[] {
  const permissionsByDomain = new Map<PermissionDomain, Permission[]>();

  for (const permission of permissions) {
    const definition = getPermissionDefinition(permission);
    const domainPermissions = permissionsByDomain.get(definition.domain) ?? [];

    permissionsByDomain.set(definition.domain, [
      ...domainPermissions,
      permission
    ]);
  }

  return domainOrder.flatMap((domain) => {
    const domainPermissions = permissionsByDomain.get(domain);

    return domainPermissions
      ? [
          {
            domain,
            permissions: domainPermissions
          }
        ]
      : [];
  });
}

function summarizeCatalogDomains(): readonly DomainSummary[] {
  return summarizeRoleDomains(permissionCatalog.map(({ id }) => id));
}

function fixedRoleLabelKey(roleId: string): I18nMessageKey | undefined {
  const segments = roleId.split(":");
  const role = segments[segments.length - 1];

  switch (role) {
    case "tenant_admin":
      return "admin.employees.role.tenantAdmin";
    case "supervisor":
      return "admin.employees.role.supervisor";
    case "agent":
      return "admin.employees.role.agent";
    default:
      return undefined;
  }
}

function roleStatusKey(status: TenantRoleRecord["status"]): I18nMessageKey {
  switch (status) {
    case "archived":
      return "admin.roles.status.archived";
    default:
      return "admin.roles.status.active";
  }
}

function roleActionStatusKey(status: string): I18nMessageKey {
  switch (status) {
    case "assigned":
      return "admin.roles.actionStatus.assigned";
    case "revoked":
      return "admin.roles.actionStatus.revoked";
    case "email_verification_required":
      return "auth.emailVerification.status.required";
    default:
      return "admin.roles.actionStatus.invalid";
  }
}

function subjectTypeKey(subject: PermissionRoleBindingSubject): I18nMessageKey {
  switch (subject.type) {
    case "team":
      return "admin.roles.subject.team";
    case "org_unit":
      return "admin.roles.subject.orgUnit";
    default:
      return "admin.roles.subject.employee";
  }
}

function permissionDomainKey(domain: PermissionDomain): I18nMessageKey {
  switch (domain) {
    case "tenant":
      return "permission.domain.tenant";
    case "employees":
      return "permission.domain.employees";
    case "roles":
      return "permission.domain.roles";
    case "integrations":
      return "permission.domain.integrations";
    case "branding":
      return "permission.domain.branding";
    case "inbox":
      return "permission.domain.inbox";
    case "messages":
      return "permission.domain.messages";
    case "conversations":
      return "permission.domain.conversations";
    case "clients":
      return "permission.domain.clients";
    case "leads":
      return "permission.domain.leads";
    case "files":
      return "permission.domain.files";
    case "reports":
      return "permission.domain.reports";
    case "audit":
      return "permission.domain.audit";
    case "api":
      return "permission.domain.api";
  }
}
