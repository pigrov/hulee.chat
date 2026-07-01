import { defaultBrandProfile } from "@hulee/branding";
import type { createTranslator, I18nMessageKey } from "@hulee/i18n";
import {
  Building2,
  KeyRound,
  MessageCircle,
  Network,
  Server,
  ShieldCheck
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import type { WebAccessSession } from "./access";
import { navigationAccessFromSession } from "./access";
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
  return (
    <AppFrame
      brand={defaultBrandProfile}
      current="platform-admin"
      frameClassName="adminFrame"
      navigationAccess={navigationAccessFromSession(access)}
      t={t}
      toasts={toasts}
    >
      <section className="adminWorkspace" aria-labelledby={titleId}>
        <header className="adminHeader">
          <div>
            <p className="eyebrow">{t("platform.controlPlane")}</p>
            <h1 className="adminTitle" id={titleId}>
              {title}
            </h1>
          </div>
          <span className="badge">
            <ShieldCheck size={14} aria-hidden="true" />
            {t("platform.customerDataPolicy")}
          </span>
        </header>

        <div className="adminContent">
          <div className="platformAdminGrid">
            <aside
              className="settingsPanel platformNavPanel"
              aria-labelledby="platform-nav-title"
            >
              <h2 className="sectionTitle" id="platform-nav-title">
                {t("platform.navigation")}
              </h2>
              <PlatformNavigation current={current} t={t} />
            </aside>

            <div className="adminStack">{children}</div>
          </div>
        </div>
      </section>
    </AppFrame>
  );
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
