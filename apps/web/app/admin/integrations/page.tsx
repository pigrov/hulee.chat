import { createTranslator } from "@hulee/i18n";
import { Plug, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../../src/access-denied";
import {
  canTenantPermission,
  navigationAccessFromSession
} from "../../../src/access";
import { AppFrame, DetailItem, SlotMount } from "../../../src/app-chrome";
import {
  formatBoolean,
  formatOptionalValue,
  telegramStatusKey
} from "../../../src/formatting";
import {
  loadInboxViewModel,
  loadTelegramIntegration
} from "../../../src/inbox-api-client";
import { resolveCurrentWebAccessSession } from "../../../src/session";
import { TelegramIntegrationPanel } from "../../../src/telegram-integration-panel";

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
    <AppFrame
      brand={model.tenant.brand}
      current="tenant-admin"
      frameClassName="adminFrame"
      navigationAccess={navigationAccessFromSession(access)}
      t={t}
    >
      <section className="adminWorkspace" aria-labelledby="admin-title">
        <header className="adminHeader">
          <div>
            <p className="eyebrow">{model.tenant.displayName}</p>
            <h1 className="adminTitle" id="admin-title">
              {t("admin.integrations")}
            </h1>
          </div>
          <span className="badge">
            <ShieldCheck size={14} aria-hidden="true" />
            {t("admin.scope.tenant")}
          </span>
        </header>

        <div className="adminContent">
          <div className="adminGrid">
            <aside
              className="settingsPanel integrationCatalog"
              aria-labelledby="channel-list-title"
            >
              <div className="sectionHeader">
                <div>
                  <p className="eyebrow">{t("admin.integrations.channels")}</p>
                  <h2 className="sectionTitle" id="channel-list-title">
                    {t("admin.integrations.channelList")}
                  </h2>
                </div>
                <span className="badge">
                  <Plug size={14} aria-hidden="true" />
                  {formatBoolean(telegramIntegration.enabled, t)}
                </span>
              </div>

              <div className="integrationList">
                <article className="integrationListItem" aria-current="page">
                  <div>
                    <h3 className="listItemTitle">
                      {t("integrations.telegram.title")}
                    </h3>
                    <p className="metaText">
                      {t(
                        telegramStatusKey(
                          telegramIntegration.diagnostics.status
                        )
                      )}
                    </p>
                  </div>
                  <span className="badge">
                    {telegramIntegration.config?.mode
                      ? t(
                          `integrations.telegram.mode.${telegramIntegration.config.mode}`
                        )
                      : t("common.unknown")}
                  </span>
                </article>
              </div>

              <div className="managementList">
                <Link className="managementRow" href="/admin/employees">
                  <div>
                    <h3 className="listItemTitle">{t("admin.employees")}</h3>
                    <p className="metaText">{t("admin.directory")}</p>
                  </div>
                  <span className="badge">
                    <Users size={14} aria-hidden="true" />
                    {t("admin.open")}
                  </span>
                </Link>
              </div>

              <div className="detailGrid">
                <DetailItem
                  label={t("integrations.telegram.webhookPath")}
                  value={formatOptionalValue(
                    telegramIntegration.webhookPath,
                    t
                  )}
                />
                <DetailItem
                  label={t("integrations.telegram.publicWebhookUrl")}
                  value={formatOptionalValue(
                    telegramIntegration.publicWebhookUrl,
                    t
                  )}
                />
                <DetailItem
                  label={t("integrations.telegram.botIdentity")}
                  value={
                    telegramIntegration.diagnostics.bot?.username
                      ? `@${telegramIntegration.diagnostics.bot.username}`
                      : formatOptionalValue(
                          telegramIntegration.diagnostics.bot?.id,
                          t
                        )
                  }
                />
              </div>

              <SlotMount slot="integration.settings.section" />
            </aside>

            <TelegramIntegrationPanel
              integration={telegramIntegration}
              locale={locale}
              t={t}
            />
          </div>
        </div>
      </section>
    </AppFrame>
  );
}
