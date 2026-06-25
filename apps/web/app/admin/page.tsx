import { createTranslator } from "@hulee/i18n";
import {
  createSqlEmployeeDirectoryRepository,
  createSqlTenantRbacRepository
} from "@hulee/db";
import {
  ArrowRight,
  KeyRound,
  LayoutDashboard,
  Network,
  Palette,
  Plug,
  ScrollText,
  Users
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../src/access-denied";
import { loadTenantAdminViewModel } from "../../src/admin-view-model";
import {
  getWebDatabase,
  resolveCurrentWebAccessSession
} from "../../src/session";
import { resolveEmployeeEffectiveAccess } from "../../src/rbac-effective-access";
import { TenantAdminShell } from "../../src/tenant-admin-shell";
import {
  getVisibleTenantAdminSections,
  navigationAccessFromTenantAdminAccess,
  type TenantAdminSection,
  type TenantAdminSectionId
} from "../../src/tenant-admin-nav";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function TenantAdminPage(): Promise<ReactNode> {
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
  const adminAccess = {
    session: access,
    effectiveAccess: accessSnapshot
  };
  const visibleSections = getVisibleTenantAdminSections(adminAccess);

  if (visibleSections.length === 0) {
    return (
      <AccessDeniedPage
        current="tenant-admin"
        navigationAccess={navigationAccessFromTenantAdminAccess(adminAccess)}
      />
    );
  }

  const model = await loadTenantAdminViewModel({
    tenantId: access.tenantId,
    database
  });
  const { t } = createTranslator(model.tenant.locale);

  return (
    <TenantAdminShell
      access={access}
      brand={model.tenant.brand}
      current="overview"
      effectiveAccess={accessSnapshot}
      t={t}
      tenantDisplayName={model.tenant.displayName}
      title={t("admin.overview")}
      titleId="admin-overview-title"
    >
      <div className="adminStack">
        <section className="settingsPanel" aria-labelledby="admin-blocks-title">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.overview")}</p>
              <h2 className="sectionTitle" id="admin-blocks-title">
                {t("admin.blocks")}
              </h2>
              <p className="metaText">{t("admin.blocks.description")}</p>
            </div>
            <span className="badge">{visibleSections.length}</span>
          </div>

          <div className="adminOverviewGrid">
            {visibleSections.map((section) => (
              <AdminOverviewCard key={section.id} section={section} t={t} />
            ))}
          </div>
        </section>
      </div>
    </TenantAdminShell>
  );
}

function AdminOverviewCard({
  section,
  t
}: {
  section: TenantAdminSection;
  t: ReturnType<typeof createTranslator>["t"];
}): ReactNode {
  return (
    <Link className="managementRow adminOverviewCard" href={section.href}>
      <span className="metricIcon">
        <AdminOverviewIcon sectionId={section.id} />
      </span>
      <span>
        <span className="listItemTitle">{t(section.titleKey)}</span>
        <span className="metaText">{t(section.descriptionKey)}</span>
      </span>
      <span className="badge">
        <ArrowRight size={14} aria-hidden="true" />
        {t("admin.open")}
      </span>
    </Link>
  );
}

function AdminOverviewIcon({
  sectionId
}: {
  sectionId: TenantAdminSectionId;
}): ReactNode {
  switch (sectionId) {
    case "employees":
      return <Users size={18} aria-hidden="true" />;
    case "orgStructure":
      return <Network size={18} aria-hidden="true" />;
    case "roles":
      return <KeyRound size={18} aria-hidden="true" />;
    case "audit":
      return <ScrollText size={18} aria-hidden="true" />;
    case "integrations":
      return <Plug size={18} aria-hidden="true" />;
    case "branding":
      return <Palette size={18} aria-hidden="true" />;
    default:
      return <LayoutDashboard size={18} aria-hidden="true" />;
  }
}
