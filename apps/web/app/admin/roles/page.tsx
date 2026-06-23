import {
  getPermissionDefinition,
  permissionCatalog,
  type Permission,
  type PermissionDomain
} from "@hulee/core";
import {
  createSqlTenantRbacRepository,
  type TenantRoleRecord
} from "@hulee/db";
import { createTranslator, type I18nMessageKey } from "@hulee/i18n";
import { KeyRound, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../../src/access-denied";
import {
  canTenantPermission,
  navigationAccessFromSession
} from "../../../src/access";
import { loadInboxViewModel } from "../../../src/inbox-api-client";
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

export default async function RolesAdminPage(): Promise<ReactNode> {
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
  const [model, roles] = await Promise.all([
    loadInboxViewModel(),
    repository.listRoleDefinitions({ tenantId: access.tenantId })
  ]);
  const { t } = createTranslator(model.tenant.locale);

  return (
    <TenantAdminShell
      access={access}
      brand={model.tenant.brand}
      current="roles"
      t={t}
      tenantDisplayName={model.tenant.displayName}
      title={t("admin.roles")}
      titleId="roles-title"
    >
      <div className="adminStack">
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
                <RoleDefinitionRow key={role.id} role={role} t={t} />
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
  role,
  t
}: {
  role: TenantRoleRecord;
  t: Translator;
}): ReactNode {
  const summaries = summarizeRoleDomains(role.permissions);
  const roleLabelKey = role.isSystem ? fixedRoleLabelKey(role.id) : undefined;

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
        <h3 className="listItemTitle">
          {roleLabelKey ? t(roleLabelKey) : role.name}
        </h3>
        <p className="metaText">
          {t("admin.roles.permissionCount", {
            count: role.permissions.length
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
