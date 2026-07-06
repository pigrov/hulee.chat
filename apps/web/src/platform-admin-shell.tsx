import { defaultBrandProfile } from "@hulee/branding";
import type { createTranslator, I18nMessageKey } from "@hulee/i18n";
import {
  Building2,
  Inbox,
  MessageCircle,
  Network,
  Server,
  Settings
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import type { WebAccessSession } from "./access";
import { navigationAccessFromSession } from "./access";
import {
  AdminTopBar,
  type AdminTopBarMenuGroup,
  type AdminTopBarMenuItem
} from "./admin-top-bar";
import { AppFrame, BrandRailLogo } from "./app-chrome";
import { brandProfileToThemeModeCssProperties } from "./brand-style";
import { AppThemeToggle } from "./theme-toggle";
import type { ToastMessage } from "./toast";

type Translator = ReturnType<typeof createTranslator>["t"];

export type PlatformAdminSectionId =
  | "companies"
  | "deployments"
  | "providers"
  | "channels";

type PlatformNavigationGroup = {
  readonly titleKey: I18nMessageKey;
  readonly sections: readonly PlatformAdminSectionId[];
};

const platformNavigationGroups = [
  {
    titleKey: "platform.controlPlane",
    sections: ["companies", "deployments"]
  },
  {
    titleKey: "platform.dataPlane",
    sections: ["providers", "channels"]
  }
] satisfies readonly PlatformNavigationGroup[];

export function PlatformAdminShell({
  access,
  children,
  current,
  t,
  title,
  titleId,
  toasts
}: {
  access: WebAccessSession;
  children: ReactNode;
  current: PlatformAdminSectionId;
  t: Translator;
  title: string;
  titleId: string;
  toasts?: readonly ToastMessage[];
}): ReactNode {
  const navigationAccess = navigationAccessFromSession(access);
  const menuGroups = buildPlatformMenuGroups({
    navigationAccess,
    t
  });
  const productName = t("app.name", {
    productName: defaultBrandProfile.productName
  });
  const themeStyles = brandProfileToThemeModeCssProperties(defaultBrandProfile);

  return (
    <AppFrame
      brand={defaultBrandProfile}
      current="platform-admin"
      frameClassName="adminFrame"
      navigationAccess={navigationAccess}
      navigationMode="none"
      t={t}
      toasts={toasts}
    >
      <section className="adminWorkspace" aria-labelledby={titleId}>
        <div className="adminShellLayout">
          <aside
            className="adminNavPanel platformNavPanel"
            aria-label={t("platform.navigation")}
          >
            <Link
              className="adminRailLogoLink"
              href="/platform"
              aria-label={productName}
              title={productName}
            >
              <BrandRailLogo
                brand={defaultBrandProfile}
                productName={productName}
              />
            </Link>
            <div className="adminRailMenu">
              <PlatformNavigation current={current} t={t} />
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
              brand={defaultBrandProfile}
              eyebrow={t(platformSectionGroupTitleKey(current))}
              icon={<PlatformSectionIcon sectionId={current} />}
              menuGroups={menuGroups}
              roleLabel={t("navigation.platformAdmin")}
              t={t}
              title={title}
              titleId={titleId}
            />

            <div className="adminContent">
              <div className="adminStack">{children}</div>
            </div>
          </div>
        </div>
      </section>
    </AppFrame>
  );
}

function buildPlatformMenuGroups({
  navigationAccess,
  t
}: {
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
      title: t("navigation.admin")
    });
  }

  return [
    {
      title: t("navigation.primary"),
      items: primaryItems
    }
  ];
}

function PlatformNavigation({
  current,
  t
}: {
  current: PlatformAdminSectionId;
  t: Translator;
}): ReactNode {
  return (
    <nav className="platformNavGroups" aria-label={t("platform.navigation")}>
      {platformNavigationGroups.map((group) => (
        <div className="platformNavGroup" key={group.titleKey}>
          <p className="detailLabel">{t(group.titleKey)}</p>
          <div className="managementList">
            {group.sections.map((sectionId) => (
              <PlatformNavLink
                current={current === sectionId}
                key={sectionId}
                sectionId={sectionId}
                t={t}
              />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function PlatformNavLink({
  current,
  sectionId,
  t
}: {
  current: boolean;
  sectionId: PlatformAdminSectionId;
  t: Translator;
}): ReactNode {
  return (
    <Link
      className="managementRow adminNavLink platformNavLink"
      href={platformSectionHref(sectionId)}
      aria-current={current ? "page" : undefined}
    >
      <span className="metricIcon">
        <PlatformSectionIcon sectionId={sectionId} />
      </span>
      <span className="listItemTitle">
        {t(platformSectionTitleKey(sectionId))}
      </span>
    </Link>
  );
}

function PlatformSectionIcon({
  sectionId
}: {
  sectionId: PlatformAdminSectionId;
}): ReactNode {
  switch (sectionId) {
    case "companies":
      return <Building2 size={24} strokeWidth={1.2} aria-hidden="true" />;
    case "deployments":
      return <Server size={24} strokeWidth={1.2} aria-hidden="true" />;
    case "providers":
      return <Network size={24} strokeWidth={1.2} aria-hidden="true" />;
    case "channels":
      return <MessageCircle size={24} strokeWidth={1.2} aria-hidden="true" />;
  }
}

function platformSectionHref(sectionId: PlatformAdminSectionId): string {
  switch (sectionId) {
    case "companies":
      return "/platform/companies";
    case "deployments":
      return "/platform/deployments";
    case "providers":
      return "/platform/providers";
    case "channels":
      return "/platform/channels";
  }
}

function platformSectionTitleKey(
  sectionId: PlatformAdminSectionId
): I18nMessageKey {
  switch (sectionId) {
    case "companies":
      return "platform.tenants";
    case "deployments":
      return "platform.deployments";
    case "providers":
      return "platform.providers";
    case "channels":
      return "platform.channels.navTitle";
  }
}

function platformSectionGroupTitleKey(
  sectionId: PlatformAdminSectionId
): I18nMessageKey {
  switch (sectionId) {
    case "providers":
    case "channels":
      return "platform.dataPlane";
    case "companies":
    case "deployments":
      return "platform.controlPlane";
  }
}
