import type { createTranslator } from "@hulee/i18n";
import {
  LayoutDashboard,
  Palette,
  Plug,
  ShieldCheck,
  Users
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { navigationAccessFromSession, type WebAccessSession } from "./access";
import { AppFrame, SlotMount } from "./app-chrome";
import {
  getVisibleTenantAdminSections,
  type TenantAdminSection,
  type TenantAdminSectionId
} from "./tenant-admin-nav";

type Translator = ReturnType<typeof createTranslator>["t"];

type BrandProfileView = {
  productName: string;
  shortProductName?: string;
  themeTokens: Record<string, string>;
};

export function TenantAdminShell({
  access,
  brand,
  children,
  current,
  sidebarBadge,
  sidebarContent,
  t,
  tenantDisplayName,
  title,
  titleId
}: {
  access: WebAccessSession;
  brand: BrandProfileView;
  children: ReactNode;
  current: TenantAdminSectionId;
  sidebarBadge?: ReactNode;
  sidebarContent?: ReactNode;
  t: Translator;
  tenantDisplayName: string;
  title: string;
  titleId: string;
}): ReactNode {
  const visibleSections = getVisibleTenantAdminSections(access);
  const currentSection =
    visibleSections.find((section) => section.id === current) ??
    visibleSections[0];

  return (
    <AppFrame
      brand={brand}
      current="tenant-admin"
      frameClassName="adminFrame"
      navigationAccess={navigationAccessFromSession(access)}
      t={t}
    >
      <section className="adminWorkspace" aria-labelledby={titleId}>
        <header className="adminHeader">
          <div>
            <p className="eyebrow">{tenantDisplayName}</p>
            <h1 className="adminTitle" id={titleId}>
              {title}
            </h1>
          </div>
          <span className="badge">
            <ShieldCheck size={14} aria-hidden="true" />
            {t("admin.scope.tenant")}
          </span>
        </header>

        <div className="adminContent">
          <div className="adminGrid">
            <aside className="settingsPanel" aria-labelledby="admin-nav-title">
              <div className="sectionHeader">
                <div>
                  <p className="eyebrow">{t("admin.sections")}</p>
                  <h2 className="sectionTitle" id="admin-nav-title">
                    {currentSection
                      ? t(currentSection.titleKey)
                      : t("admin.overview")}
                  </h2>
                </div>
                {sidebarBadge ?? (
                  <span className="badge">
                    <LayoutDashboard size={14} aria-hidden="true" />
                    {visibleSections.length}
                  </span>
                )}
              </div>

              <nav
                className="managementList"
                aria-label={t("admin.navigation")}
              >
                {visibleSections.map((section) => (
                  <TenantAdminNavLink
                    current={current === section.id}
                    key={section.id}
                    section={section}
                    t={t}
                  />
                ))}
              </nav>

              {sidebarContent}
              <SlotMount slot="admin.section" />
            </aside>

            {children}
          </div>
        </div>
      </section>
    </AppFrame>
  );
}

function TenantAdminNavLink({
  current,
  section,
  t
}: {
  current: boolean;
  section: TenantAdminSection;
  t: Translator;
}): ReactNode {
  return (
    <Link
      className="managementRow"
      href={section.href}
      aria-current={current ? "page" : undefined}
    >
      <span className="metricIcon">
        <TenantAdminSectionIcon sectionId={section.id} />
      </span>
      <span className="listItemTitle">{t(section.titleKey)}</span>
      <span className="badge">
        {t(current ? "admin.current" : "admin.open")}
      </span>
    </Link>
  );
}

function TenantAdminSectionIcon({
  sectionId
}: {
  sectionId: TenantAdminSectionId;
}): ReactNode {
  switch (sectionId) {
    case "employees":
      return <Users size={18} aria-hidden="true" />;
    case "integrations":
      return <Plug size={18} aria-hidden="true" />;
    case "branding":
      return <Palette size={18} aria-hidden="true" />;
    default:
      return <LayoutDashboard size={18} aria-hidden="true" />;
  }
}
