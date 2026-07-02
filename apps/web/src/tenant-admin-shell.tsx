import type { createTranslator } from "@hulee/i18n";
import {
  ChevronsLeft,
  ChevronsRight,
  Inbox,
  KeyRound,
  LayoutDashboard,
  Network,
  Palette,
  Plug,
  ScrollText,
  Settings,
  Users
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  isTenantEmailVerificationRequired,
  type WebAccessSession
} from "./access";
import {
  AdminTopBar,
  type AdminTopBarMenuGroup,
  type AdminTopBarMenuItem
} from "./admin-top-bar";
import { AppFrame, SlotMount } from "./app-chrome";
import { resendEmailVerificationAction } from "./auth-actions";
import {
  getVisibleTenantAdminSections,
  navigationAccessFromTenantAdminAccess,
  type TenantAdminSection,
  type TenantAdminSectionId
} from "./tenant-admin-nav";
import type { WebEffectiveAccessSnapshot } from "./rbac-effective-access";
import type { ToastMessage } from "./toast";

type Translator = ReturnType<typeof createTranslator>["t"];

type BrandProfileView = {
  productName: string;
  shortProductName?: string;
  themeTokens: Record<string, string>;
  links?: Record<string, string>;
};

export function TenantAdminShell({
  access,
  brand,
  children,
  current,
  effectiveAccess,
  sidebarContent,
  t,
  tenantDisplayName,
  title,
  titleId,
  toasts
}: {
  access: WebAccessSession;
  brand: BrandProfileView;
  children: ReactNode;
  current: TenantAdminSectionId;
  effectiveAccess?: WebEffectiveAccessSnapshot | undefined;
  sidebarContent?: ReactNode;
  t: Translator;
  tenantDisplayName: string;
  title: string;
  titleId: string;
  toasts?: readonly ToastMessage[];
}): ReactNode {
  const adminAccess = {
    session: access,
    effectiveAccess
  };
  const visibleSections = getVisibleTenantAdminSections(adminAccess);
  const shouldRequireEmailVerification =
    isTenantEmailVerificationRequired(access);
  const currentPath =
    current === "overview"
      ? "/admin"
      : (visibleSections.find((section) => section.id === current)?.href ??
        "/admin");
  const navigationAccess = navigationAccessFromTenantAdminAccess(adminAccess);
  const menuGroups = buildTenantAdminMenuGroups({
    current,
    navigationAccess,
    t
  });

  return (
    <AppFrame
      brand={brand}
      current="tenant-admin"
      frameClassName="adminFrame"
      navigationAccess={navigationAccess}
      navigationMode="none"
      t={t}
      toasts={toasts}
    >
      <section className="adminWorkspace" aria-labelledby={titleId}>
        <input
          aria-label={t("navigation.collapseMenu")}
          className="adminNavToggleInput"
          id="tenant-admin-nav-toggle"
          type="checkbox"
        />
        <AdminTopBar
          brand={brand}
          eyebrow={tenantDisplayName}
          menuGroups={menuGroups}
          roleLabel={t("admin.scope.tenant")}
          t={t}
          title={title}
          titleId={titleId}
        />

        <div className="adminContent">
          <div className="adminGrid">
            <aside
              className="settingsPanel adminNavPanel"
              aria-label={t("admin.navigation")}
            >
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

              {shouldRequireEmailVerification ? (
                <form
                  className="inlineNoticeForm"
                  action={resendEmailVerificationAction}
                >
                  <input name="returnTo" type="hidden" value={currentPath} />
                  <p className="formNotice">
                    {t("auth.emailVerification.status.required")}
                  </p>
                  <button className="secondaryButton" type="submit">
                    {t("auth.emailVerification.resend")}
                  </button>
                </form>
              ) : null}

              {sidebarContent}
              <SlotMount slot="admin.section" />

              <label
                className="adminNavCollapseButton"
                htmlFor="tenant-admin-nav-toggle"
              >
                <ChevronsLeft
                  className="adminNavCollapseExpandedIcon"
                  size={16}
                  aria-hidden="true"
                />
                <ChevronsRight
                  className="adminNavCollapseCollapsedIcon"
                  size={16}
                  aria-hidden="true"
                />
                <span className="adminNavCollapseExpandedText">
                  {t("navigation.collapseMenu")}
                </span>
                <span className="adminNavCollapseCollapsedText">
                  {t("navigation.expandMenu")}
                </span>
              </label>
            </aside>

            {children}
          </div>
        </div>
      </section>
    </AppFrame>
  );
}

function buildTenantAdminMenuGroups({
  current,
  navigationAccess,
  t
}: {
  current: TenantAdminSectionId;
  navigationAccess: {
    readonly tenantAdmin: boolean;
    readonly platformAdmin: boolean;
  };
  t: Translator;
}): readonly AdminTopBarMenuGroup[] {
  const primaryItems: AdminTopBarMenuItem[] = [
    {
      href: "/",
      icon: <Inbox size={16} aria-hidden="true" />,
      title: t("navigation.inbox")
    }
  ];

  if (navigationAccess.tenantAdmin) {
    primaryItems.push({
      href: "/admin",
      icon: <Settings size={16} aria-hidden="true" />,
      title: t("navigation.admin"),
      current: current === "overview"
    });
  }

  return [
    {
      title: t("navigation.primary"),
      items: primaryItems
    }
  ];
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
      className="managementRow adminNavLink"
      href={section.href}
      aria-current={current ? "page" : undefined}
    >
      <span className="metricIcon">
        <TenantAdminSectionIcon sectionId={section.id} />
      </span>
      <span className="listItemTitle">{t(section.titleKey)}</span>
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
