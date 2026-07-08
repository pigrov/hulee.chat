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

export type AdminTopBarProfile = {
  readonly displayName?: string;
  readonly email?: string;
  readonly avatarUrl?: string | null;
};

export function AdminTopBar({
  brand,
  eyebrow,
  icon,
  menuGroups,
  notice,
  profile,
  roleLabel,
  t,
  title,
  titleId
}: {
  brand: BrandProfileView;
  eyebrow: string;
  icon: ReactNode;
  menuGroups: readonly AdminTopBarMenuGroup[];
  notice?: ReactNode;
  profile?: AdminTopBarProfile;
  roleLabel: string;
  t: Translator;
  title: string;
  titleId: string;
}): ReactNode {
  const helpHref = brand.links?.help ?? brand.links?.support;
  const profileName = profileDisplayName(profile, roleLabel);
  const profileEmail = profile?.email?.trim();

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
        {notice}

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
            <div className="topNavProfile">
              <span className="topNavProfileAvatar" aria-hidden="true">
                {profile?.avatarUrl ? (
                  <img src={profile.avatarUrl} alt="" />
                ) : (
                  profileInitials(profileName)
                )}
              </span>
              <span className="topNavProfileText">
                <span className="topNavProfileName">{profileName}</span>
                {profileEmail ? (
                  <span className="topNavProfileEmail">{profileEmail}</span>
                ) : null}
              </span>
            </div>
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

function profileDisplayName(
  profile: AdminTopBarProfile | undefined,
  fallback: string
): string {
  const displayName = profile?.displayName?.trim();

  if (displayName && displayName.length > 0) {
    return displayName;
  }

  const email = profile?.email?.trim();

  return email && email.length > 0 ? email : fallback;
}

function profileInitials(displayName: string): string {
  const initials = displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return initials.length > 0 ? initials : "?";
}
