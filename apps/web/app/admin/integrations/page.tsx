import { createTranslator } from "@hulee/i18n";
import { Plug } from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../../src/access-denied";
import {
  canTenantPermission,
  navigationAccessFromSession
} from "../../../src/access";
import { DetailItem, SlotMount } from "../../../src/app-chrome";
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
      sidebarBadge={
        <span className="badge">
          <Plug size={14} aria-hidden="true" />
          {formatBoolean(telegramIntegration.enabled, t)}
        </span>
      }
      sidebarContent={
        <>
          <div className="integrationList">
            <article className="integrationListItem" aria-current="page">
              <div>
                <h3 className="listItemTitle">
                  {t("integrations.telegram.title")}
                </h3>
                <p className="metaText">
                  {t(telegramStatusKey(telegramIntegration.diagnostics.status))}
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

          <div className="detailGrid">
            <DetailItem
              label={t("integrations.telegram.webhookPath")}
              value={formatOptionalValue(telegramIntegration.webhookPath, t)}
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
        </>
      }
      t={t}
      tenantDisplayName={model.tenant.displayName}
      title={t("admin.integrations")}
      titleId="admin-title"
    >
      <TelegramIntegrationPanel
        integration={telegramIntegration}
        locale={locale}
        t={t}
      />
    </TenantAdminShell>
  );
}
