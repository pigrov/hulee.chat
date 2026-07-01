import { defaultBrandProfile } from "@hulee/branding";
import type { createTranslator, I18nMessageKey } from "@hulee/i18n";
import {
  Building2,
  Inbox,
  KeyRound,
  MessageCircle,
  Network,
  Server,
  Settings,
  ShieldCheck
} from "lucide-react";
import type { ReactNode } from "react";

import type { WebAccessSession } from "./access";
import { navigationAccessFromSession } from "./access";
import {
  AdminTopBar,
  type AdminTopBarMenuGroup,
  type AdminTopBarMenuItem
} from "./admin-top-bar";
import { AppFrame } from "./app-chrome";
import type { ToastMessage } from "./toast";

type Translator = ReturnType<typeof createTranslator>["t"];

export type PlatformAdminSectionId =
  | "companies"
  | "deployments"
  | "commercial"
  | "support"
  | "egress"
  | "providers"
  | "channels";

type PlatformNavigationGroup = {
  readonly titleKey: I18nMessageKey;
  readonly sections: readonly PlatformAdminSectionId[];
};

const platformNavigationGroups = [
  {
    titleKey: "platform.controlPlane",
    sections: ["companies", "deployments", "commercial", "support"]
  },
  {
    titleKey: "platform.dataPlane",
    sections: ["egress", "providers", "channels"]
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
    current,
    navigationAccess,
    t
  });

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
        <AdminTopBar
          brand={defaultBrandProfile}
          eyebrow={t("platform.controlPlane")}
          menuGroups={menuGroups}
          roleLabel={t("navigation.platformAdmin")}
          t={t}
          title={title}
          titleId={titleId}
        />

        <div className="adminContent">
          <div className="adminStack">{children}</div>
        </div>
      </section>
    </AppFrame>
  );
}

function buildPlatformMenuGroups({
  current,
  navigationAccess,
  t
}: {
  current: PlatformAdminSectionId;
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
    },
    ...platformNavigationGroups.map((group) => ({
      title: t(group.titleKey),
      items: group.sections.map((sectionId) => ({
        href: platformSectionHref(sectionId),
        icon: <PlatformSectionIcon sectionId={sectionId} />,
        title: t(platformSectionTitleKey(sectionId)),
        current: current === sectionId
      }))
    }))
  ];
}

function PlatformSectionIcon({
  sectionId
}: {
  sectionId: PlatformAdminSectionId;
}): ReactNode {
  switch (sectionId) {
    case "companies":
      return <Building2 size={18} aria-hidden="true" />;
    case "deployments":
      return <Server size={18} aria-hidden="true" />;
    case "commercial":
      return <KeyRound size={18} aria-hidden="true" />;
    case "support":
      return <ShieldCheck size={18} aria-hidden="true" />;
    case "egress":
    case "providers":
      return <Network size={18} aria-hidden="true" />;
    case "channels":
      return <MessageCircle size={18} aria-hidden="true" />;
  }
}

function platformSectionHref(sectionId: PlatformAdminSectionId): string {
  switch (sectionId) {
    case "companies":
      return "/platform/companies";
    case "deployments":
      return "/platform/deployments";
    case "commercial":
      return "/platform/commercial";
    case "support":
      return "/platform/support";
    case "egress":
      return "/platform/egress";
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
    case "commercial":
      return "platform.commercial";
    case "support":
      return "platform.supportAccess";
    case "egress":
      return "platform.egress";
    case "providers":
      return "platform.providers";
    case "channels":
      return "platform.channels.navTitle";
  }
}
