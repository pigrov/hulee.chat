import { createTranslator } from "@hulee/i18n";
import { Plug } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../../src/access-denied";
import {
  canTenantPermission,
  navigationAccessFromSession
} from "../../../src/access";
import { SlotMount } from "../../../src/app-chrome";
import { telegramStatusKey } from "../../../src/formatting";
import {
  loadInboxViewModel,
  loadTelegramIntegration
} from "../../../src/inbox-api-client";
import { resolveCurrentWebAccessSession } from "../../../src/session";
import { TelegramIntegrationPanel } from "../../../src/telegram-integration-panel";
import { TenantAdminShell } from "../../../src/tenant-admin-shell";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function IntegrationsAdminPage(): Promise<ReactNode> {
  const access = await resolveCurrentWebAccessSession();

  if (access === null) {
    redirect("/login");
  }

  if (!canTenantPermission(access, "modules.manage")) {
    return (
      <AccessDeniedPage
        current="tenant-admin"
        navigationAccess={navigationAccessFromSession(access)}
      />
    );
  }

  const [model, telegramIntegration] = await Promise.all([
    loadInboxViewModel(),
    loadTelegramIntegration()
  ]);
  const { t, locale } = createTranslator(model.tenant.locale);

  return (
    <TenantAdminShell
      access={access}
      brand={model.tenant.brand}
      current="integrations"
      t={t}
      tenantDisplayName={model.tenant.displayName}
      title={t("admin.integrations")}
      titleId="admin-title"
    >
      <div className="adminIntegrationGrid">
        <aside
          className="settingsPanel integrationCatalog"
          aria-labelledby="integration-channel-list-title"
        >
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.integrations.channels")}</p>
              <h2 className="sectionTitle" id="integration-channel-list-title">
                {t("admin.integrations.channelList")}
              </h2>
            </div>
          </div>

          <nav
            className="integrationList"
            aria-label={t("admin.integrations.channelList")}
          >
            <Link
              className="integrationListItem integrationNavLink"
              href="/admin/integrations"
              aria-current="page"
            >
              <span className="metricIcon">
                <Plug size={18} aria-hidden="true" />
              </span>
              <div>
                <h3 className="listItemTitle">
                  {t("integrations.telegram.title")}
                </h3>
                <p className="metaText">
                  {t(telegramStatusKey(telegramIntegration.diagnostics.status))}
                </p>
              </div>
            </Link>
          </nav>
        </aside>

        <div className="adminStack">
          <TelegramIntegrationPanel
            integration={telegramIntegration}
            locale={locale}
            t={t}
          />
          <SlotMount slot="integration.settings.section" />
        </div>
      </div>
    </TenantAdminShell>
  );
}
