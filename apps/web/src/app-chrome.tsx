import type { createTranslator } from "@hulee/i18n";
import { createSlotRegistry, resolveSlotHost, type UiSlotId } from "@hulee/ui";
import { Inbox, LogOut, Settings, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  buildBrandMarkLabel,
  brandProfileToCssProperties,
  brandProfileToThemeModeCssProperties
} from "./brand-style";
import { logoutAction } from "./auth-actions";
import { AppThemeToggle } from "./theme-toggle";
import { ToastViewport, type ToastMessage } from "./toast";

const emptySlotRegistry = createSlotRegistry([]);

export type AppNavigationSection = "inbox" | "tenant-admin" | "platform-admin";

export type NavigationAccess = {
  tenantAdmin: boolean;
  platformAdmin: boolean;
};

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
};

export function AppFrame({
  brand,
  children,
  current,
  frameClassName,
  navigationMode = "rail",
  navigationAccess,
  t,
  toasts
}: {
  brand: BrandProfileView;
  children: ReactNode;
  current: AppNavigationSection;
  frameClassName?: string;
  navigationMode?: "rail" | "none";
  navigationAccess?: NavigationAccess;
  t: Translator;
  toasts?: readonly ToastMessage[];
}): ReactNode {
  const productName = t("app.name", {
    productName: brand.productName
  });
  const className = frameClassName ? `appFrame ${frameClassName}` : "appFrame";
  const themeStyles = brandProfileToThemeModeCssProperties(brand);

  return (
    <main className={className} style={brandProfileToCssProperties(brand)}>
      {navigationMode === "rail" ? (
        <nav className="navigationRail" aria-label={t("navigation.primary")}>
          <BrandRailLogo brand={brand} productName={productName} />
          <Link
            className="railButton"
            href="/"
            aria-label={t("navigation.inbox")}
            aria-current={current === "inbox" ? "page" : undefined}
          >
            <Inbox size={20} aria-hidden="true" />
          </Link>
          {(navigationAccess?.tenantAdmin ?? true) ? (
            <Link
              className="railButton"
              href="/admin"
              aria-label={t("navigation.admin")}
              aria-current={current === "tenant-admin" ? "page" : undefined}
            >
              <Settings size={20} aria-hidden="true" />
            </Link>
          ) : null}
          {(navigationAccess?.platformAdmin ?? true) ? (
            <Link
              className="railButton"
              href="/platform"
              aria-label={t("navigation.platformAdmin")}
              aria-current={current === "platform-admin" ? "page" : undefined}
            >
              <ShieldCheck size={20} aria-hidden="true" />
            </Link>
          ) : null}
          <div className="navigationRailFooter">
            <AppThemeToggle
              darkLabel={t("theme.dark")}
              lightLabel={t("theme.light")}
              themeStyles={themeStyles}
              toggleLabel={t("theme.toggle")}
            />
            <form className="railForm" action={logoutAction}>
              <button
                className="railButton"
                type="submit"
                aria-label={t("auth.logout")}
              >
                <LogOut size={20} aria-hidden="true" />
              </button>
            </form>
          </div>
        </nav>
      ) : null}
      <ToastViewport
        closeLabel={t("notifications.close")}
        regionLabel={t("notifications.region")}
        toasts={toasts}
      />
      {children}
    </main>
  );
}

export function BrandIdentity({
  brand,
  productName
}: {
  brand: BrandProfileView;
  productName: string;
}): ReactNode {
  return (
    <div className="appBrandIdentity">
      <div className="brandMark" title={productName}>
        {buildBrandMarkLabel(brand)}
      </div>
      <span className="brandWordmark">{productName}</span>
    </div>
  );
}

export function BrandRailLogo({
  brand,
  productName
}: {
  brand: BrandProfileView;
  productName: string;
}): ReactNode {
  const logoLight =
    brand.assets?.mark ?? brand.assets?.logoLight ?? brand.assets?.logoDark;
  const logoDark =
    brand.assets?.mark ?? brand.assets?.logoDark ?? brand.assets?.logoLight;

  if (!logoLight) {
    return (
      <div className="brandRailLogo brandMark" title={productName}>
        {buildBrandMarkLabel(brand)}
      </div>
    );
  }

  return (
    <div className="brandRailLogo" title={productName} aria-label={productName}>
      <img
        className={
          logoDark && logoDark !== logoLight
            ? "brandRailLogoImage brandRailLogoImageLight brandRailLogoImageLightWithDark"
            : "brandRailLogoImage brandRailLogoImageLight"
        }
        src={logoLight}
        alt=""
        draggable={false}
      />
      {logoDark && logoDark !== logoLight ? (
        <img
          className="brandRailLogoImage brandRailLogoImageDark"
          src={logoDark}
          alt=""
          draggable={false}
        />
      ) : null}
    </div>
  );
}

export function DetailItem({
  label,
  value
}: {
  label: string;
  value: string;
}): ReactNode {
  return (
    <div className="detailItem">
      <span className="detailLabel">{label}</span>
      <span className="detailValue">{value}</span>
    </div>
  );
}

export function SlotMount({ slot }: { slot: UiSlotId }): ReactNode {
  const contributions = resolveSlotHost({
    registry: emptySlotRegistry,
    slot,
    client: "web"
  });

  if (contributions.length === 0) {
    return <div className="slotHost" data-ui-slot={slot} />;
  }

  return (
    <div className="slotHost" data-ui-slot={slot}>
      {contributions.map((contribution) => (
        <div
          key={contribution.id}
          data-component-ref={contribution.componentRef}
        />
      ))}
    </div>
  );
}
