import type { createTranslator } from "@hulee/i18n";
import {
  Inbox,
  KeyRound,
  LayoutDashboard,
  Network,
  Palette,
  Plug,
  ScrollText,
  ShieldCheck,
  Settings,
  Users
} from "lucide-react";
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
    sections: visibleSections,
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
          {shouldRequireEmailVerification ? (
            <form
              className="settingsPanel inlineNoticeForm adminNoticePanel"
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
          {sidebarContent ? (
            <aside className="settingsPanel adminAuxPanel">
              {sidebarContent}
            </aside>
          ) : null}
          <SlotMount slot="admin.section" />
          {children}
        </div>
      </section>
    </AppFrame>
  );
}

function buildTenantAdminMenuGroups({
  current,
  navigationAccess,
  sections,
  t
}: {
  current: TenantAdminSectionId;
  navigationAccess: {
    readonly tenantAdmin: boolean;
    readonly platformAdmin: boolean;
  };
  sections: readonly TenantAdminSection[];
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

  if (navigationAccess.platformAdmin) {
    primaryItems.push({
      href: "/platform",
      icon: <ShieldCheck size={16} aria-hidden="true" />,
      title: t("navigation.platformAdmin")
    });
  }

  return [
    {
      title: t("navigation.primary"),
      items: primaryItems
    },
    {
      title: t("admin.sections"),
      items: sections.map((section) => ({
        href: section.href,
        icon: <TenantAdminSectionIcon sectionId={section.id} />,
        title: t(section.titleKey),
        current: current === section.id
      }))
    }
  ];
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
