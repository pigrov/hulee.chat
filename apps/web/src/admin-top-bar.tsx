import type { createTranslator } from "@hulee/i18n";
import { ChevronDown, CircleHelp, LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { logoutAction } from "./auth-actions";

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

export type AdminTopBarMenuItem = {
  readonly href: string;
  readonly icon: ReactNode;
  readonly title: string;
  readonly current?: boolean;
};

export type AdminTopBarMenuGroup = {
  readonly title: string;
  readonly items: readonly AdminTopBarMenuItem[];
};

export function AdminTopBar({
  brand,
  eyebrow,
  icon,
  menuGroups,
  roleLabel,
  t,
  title,
  titleId
}: {
  brand: BrandProfileView;
  eyebrow: string;
  icon: ReactNode;
  menuGroups: readonly AdminTopBarMenuGroup[];
  roleLabel: string;
  t: Translator;
  title: string;
  titleId: string;
}): ReactNode {
  const helpHref = brand.links?.help ?? brand.links?.support;

  return (
    <header className="adminTopBar">
      <div className="adminServiceTitle">
        <span className="adminServiceIconFrame">{icon}</span>
        <span className="adminServiceText">
          <h1 className="adminServiceLabel adminTitle" id={titleId}>
            {title}
          </h1>
          <span className="adminServiceDescription">{eyebrow}</span>
        </span>
      </div>

      <div className="adminTopActions">
        {helpHref ? (
          <Link className="topHelpLink" href={helpHref}>
            <CircleHelp size={16} aria-hidden="true" />
            {t("navigation.help")}
          </Link>
        ) : (
          <span className="topHelpLink" aria-disabled="true">
            <CircleHelp size={16} aria-hidden="true" />
            {t("navigation.help")}
          </span>
        )}

        <details className="topNavMenu">
          <summary className="topNavTrigger" aria-label={t("navigation.menu")}>
            <ShieldCheck size={17} aria-hidden="true" />
            <span>{roleLabel}</span>
            <ChevronDown size={15} aria-hidden="true" />
          </summary>
          <div className="topNavMenuPanel">
            {menuGroups.map((group) =>
              group.items.length > 0 ? (
                <nav
                  className="topNavMenuGroup"
                  aria-label={group.title}
                  key={group.title}
                >
                  <p className="detailLabel">{group.title}</p>
                  {group.items.map((item) => (
                    <Link
                      className="topNavMenuItem"
                      href={item.href}
                      aria-current={item.current ? "page" : undefined}
                      key={item.href}
                    >
                      <span className="topNavMenuIcon">{item.icon}</span>
                      <span>{item.title}</span>
                    </Link>
                  ))}
                </nav>
              ) : null
            )}
            <form className="topNavLogoutForm" action={logoutAction}>
              <button className="topNavMenuItem" type="submit">
                <span className="topNavMenuIcon">
                  <LogOut size={16} aria-hidden="true" />
                </span>
                <span>{t("auth.logout")}</span>
              </button>
            </form>
          </div>
        </details>
      </div>
    </header>
  );
}
