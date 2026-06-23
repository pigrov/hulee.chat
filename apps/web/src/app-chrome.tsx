import type { createTranslator } from "@hulee/i18n";
import { createSlotRegistry, resolveSlotHost, type UiSlotId } from "@hulee/ui";
import { Inbox, LogOut, Settings, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  buildBrandMarkLabel,
  brandProfileToCssProperties
} from "./brand-style";
import { logoutAction } from "./auth-actions";

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
  themeTokens: Record<string, string>;
};

export function AppFrame({
  brand,
  children,
  current,
  frameClassName,
  navigationAccess,
  t
}: {
  brand: BrandProfileView;
  children: ReactNode;
  current: AppNavigationSection;
  frameClassName?: string;
  navigationAccess?: NavigationAccess;
  t: Translator;
}): ReactNode {
  const productName = t("app.name", {
    productName: brand.productName
  });
  const className = frameClassName ? `appFrame ${frameClassName}` : "appFrame";

  return (
    <main className={className} style={brandProfileToCssProperties(brand)}>
      <nav className="navigationRail" aria-label={t("navigation.primary")}>
        <div className="brandMark" title={productName}>
          {buildBrandMarkLabel(brand)}
        </div>
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
        <form className="railForm" action={logoutAction}>
          <button
            className="railButton"
            type="submit"
            aria-label={t("auth.logout")}
          >
            <LogOut size={20} aria-hidden="true" />
          </button>
        </form>
      </nav>
      {children}
    </main>
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
