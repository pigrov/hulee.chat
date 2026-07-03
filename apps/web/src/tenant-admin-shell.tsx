import type { createTranslator } from "@hulee/i18n";
import {
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
import { AppFrame, BrandRailLogo, SlotMount } from "./app-chrome";
import { brandProfileToThemeModeCssProperties } from "./brand-style";
import { resendEmailVerificationAction } from "./auth-actions";
import {
  getVisibleTenantAdminSections,
  navigationAccessFromTenantAdminAccess,
  type TenantAdminSection,
  type TenantAdminSectionId
} from "./tenant-admin-nav";
import type { WebEffectiveAccessSnapshot } from "./rbac-effective-access";
import { AppThemeToggle } from "./theme-toggle";
import type { ToastMessage } from "./toast";

type Translator = ReturnType<typeof createTranslator>["t"];

type BrandProfileView = {
  productName: string;
  shortProductName?: string;
  assets?: {
    logoLight?: string;
    logoDark?: string;
    mark?: string;
  };
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
  const productName = t("app.name", {
    productName: brand.productName
  });
  const themeStyles = brandProfileToThemeModeCssProperties(brand);

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
        <div className="adminShellLayout">
          <aside className="adminNavPanel" aria-label={t("admin.navigation")}>
            <Link
              className="adminRailLogoLink"
              href="/admin"
              aria-label={productName}
              title={productName}
            >
              <BrandRailLogo brand={brand} productName={productName} />
            </Link>
            <div className="adminRailMenu">
              <nav
                className="managementList adminRailMenuList"
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
            </div>

            <div className="adminNavFooter">
              <AppThemeToggle
                darkLabel={t("theme.dark")}
                lightLabel={t("theme.light")}
                themeStyles={themeStyles}
                toggleLabel={t("theme.toggle")}
              />
            </div>
          </aside>

          <div className="adminShellMain">
            <AdminTopBar
              brand={brand}
              eyebrow={tenantDisplayName}
              icon={<TenantAdminSectionIcon sectionId={current} />}
              menuGroups={menuGroups}
              roleLabel={t("admin.scope.tenant")}
              t={t}
              title={title}
              titleId={titleId}
            />

            <div className="adminContent">
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
              {children}
            </div>
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
      <span className="listItemTitle">
        {t(section.navTitleKey ?? section.titleKey)}
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
      return <Users size={24} strokeWidth={1.2} aria-hidden="true" />;
    case "orgStructure":
      return <Network size={24} strokeWidth={1.2} aria-hidden="true" />;
    case "roles":
      return <KeyRound size={24} strokeWidth={1.2} aria-hidden="true" />;
    case "audit":
      return <ScrollText size={24} strokeWidth={1.2} aria-hidden="true" />;
    case "integrations":
      return <Plug size={24} strokeWidth={1.2} aria-hidden="true" />;
    case "branding":
      return <Palette size={24} strokeWidth={1.2} aria-hidden="true" />;
    default:
      return <LayoutDashboard size={24} strokeWidth={1.2} aria-hidden="true" />;
  }
}
