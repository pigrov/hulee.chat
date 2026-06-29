import { createTranslator } from "@hulee/i18n";
import type { I18nMessageKey } from "@hulee/i18n";
import {
  createSqlEmployeeDirectoryRepository,
  createSqlTenantRbacRepository
} from "@hulee/db";
import type {
  InternalChannelCatalogItem,
  InternalChannelConnectorSummary
} from "@hulee/contracts";
import { Bot, MessageCircle, Smartphone } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../../src/access-denied";
import { SlotMount } from "../../../src/app-chrome";
import { loadTenantAdminViewModel } from "../../../src/admin-view-model";
import { createChannelConnectorAction } from "../../../src/actions";
import {
  loadChannelCatalog,
  loadChannelConnectors,
  loadTelegramIntegration
} from "../../../src/inbox-api-client";
import {
  getWebDatabase,
  resolveCurrentWebAccessSession
} from "../../../src/session";
import {
  hasEffectivePermission,
  resolveEmployeeEffectiveAccess
} from "../../../src/rbac-effective-access";
import { TelegramIntegrationPanel } from "../../../src/telegram-integration-panel";
import { TenantAdminShell } from "../../../src/tenant-admin-shell";
import { navigationAccessFromTenantAdminAccess } from "../../../src/tenant-admin-nav";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function IntegrationsAdminPage({
  searchParams
}: {
  searchParams?: Promise<{
    connectorId?: string;
  }>;
}): Promise<ReactNode> {
  const access = await resolveCurrentWebAccessSession();

  if (access === null) {
    redirect("/login");
  }

  const database = getWebDatabase();
  const employeeRepository = createSqlEmployeeDirectoryRepository(database);
  const rbacRepository = createSqlTenantRbacRepository(database);
  const accessSnapshot = await resolveEmployeeEffectiveAccess({
    tenantId: access.tenantId,
    employeeId: access.employeeId,
    employeeRepository,
    rbacRepository
  });

  if (!hasEffectivePermission(accessSnapshot, "modules.manage")) {
    const adminAccess = {
      session: access,
      effectiveAccess: accessSnapshot
    };

    return (
      <AccessDeniedPage
        current="tenant-admin"
        navigationAccess={navigationAccessFromTenantAdminAccess(adminAccess)}
      />
    );
  }

  const internalApiAccess = {
    effectivePermissionOverride: "modules.manage" as const
  };
  const resolvedSearchParams = await searchParams;
  const requestedConnectorId = normalizeOptionalSearchParam(
    resolvedSearchParams?.connectorId
  );
  const [model, channelCatalog, channelConnectors, telegramIntegration] =
    await Promise.all([
      loadTenantAdminViewModel({ tenantId: access.tenantId, database }),
      loadChannelCatalog(internalApiAccess),
      loadChannelConnectors(internalApiAccess),
      loadTelegramIntegration(internalApiAccess, {
        connectorId: requestedConnectorId
      })
    ]);
  const { t, locale } = createTranslator(model.tenant.locale);
  const selectedConnectorId =
    telegramIntegration.connectorId ??
    channelConnectors.connectors.find(
      (connector) => connector.channelType === "telegram_bot"
    )?.connectorId;

  return (
    <TenantAdminShell
      access={access}
      brand={model.tenant.brand}
      current="integrations"
      effectiveAccess={accessSnapshot}
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
            <div className="integrationListGroup">
              <h3 className="detailLabel">
                {t("admin.integrations.connectedChannels")}
              </h3>
              {channelConnectors.connectors.length > 0 ? (
                channelConnectors.connectors.map((connector) => (
                  <ConnectorListItem
                    key={connector.connectorId}
                    connector={connector}
                    catalog={channelCatalog.channels}
                    current={connector.connectorId === selectedConnectorId}
                    t={t}
                  />
                ))
              ) : (
                <p className="metaText">
                  {t("admin.integrations.noConnectedChannels")}
                </p>
              )}
            </div>
            <div className="integrationListGroup">
              <h3 className="detailLabel">
                {t("admin.integrations.availableChannels")}
              </h3>
              {channelCatalog.channels.map((channel) => (
                <CatalogListItem
                  key={channel.channelType}
                  channel={channel}
                  t={t}
                />
              ))}
            </div>
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

type Translator = ReturnType<typeof createTranslator>["t"];

function ConnectorListItem({
  connector,
  catalog,
  current,
  t
}: {
  connector: InternalChannelConnectorSummary;
  catalog: readonly InternalChannelCatalogItem[];
  current: boolean;
  t: Translator;
}): ReactNode {
  const channel = catalog.find(
    (item) => item.channelType === connector.channelType
  );

  return (
    <Link
      className="integrationListItem integrationNavLink"
      href={`/admin/integrations?connectorId=${encodeURIComponent(
        connector.connectorId
      )}`}
      aria-current={current ? "page" : undefined}
    >
      <span className="metricIcon">
        <ChannelIcon channelClass={connector.channelClass} />
      </span>
      <div>
        <h3 className="listItemTitle">{connector.displayName}</h3>
        <p className="metaText">
          {[
            channel
              ? t(channel.titleKey as I18nMessageKey)
              : connector.provider,
            t(channelConnectorStatusKey(connector.status))
          ].join(" / ")}
        </p>
      </div>
      <span className="badge">
        {t(channelHealthStatusKey(connector.healthStatus))}
      </span>
    </Link>
  );
}

function CatalogListItem({
  channel,
  t
}: {
  channel: InternalChannelCatalogItem;
  t: Translator;
}): ReactNode {
  const content = (
    <>
      <span className="metricIcon">
        <ChannelIcon channelClass={channel.channelClass} />
      </span>
      <div>
        <h3 className="listItemTitle">
          {t(channel.titleKey as I18nMessageKey)}
        </h3>
        <p className="metaText">
          {t(channel.descriptionKey as I18nMessageKey)}
        </p>
      </div>
      <span className="badge">{t(channelReadinessKey(channel.readiness))}</span>
    </>
  );

  if (channel.readiness !== "available") {
    return (
      <div className="integrationListItem" aria-disabled="true">
        {content}
      </div>
    );
  }

  return (
    <form className="integrationListForm" action={createChannelConnectorAction}>
      <input type="hidden" name="channelType" value={channel.channelType} />
      <button className="integrationListItem integrationNavLink" type="submit">
        {content}
      </button>
    </form>
  );
}

function ChannelIcon({
  channelClass
}: {
  channelClass: InternalChannelCatalogItem["channelClass"];
}): ReactNode {
  switch (channelClass) {
    case "bot_bridge":
      return <Bot size={18} aria-hidden="true" />;
    case "user_bridge":
      return <Smartphone size={18} aria-hidden="true" />;
    case "official_api":
      return <MessageCircle size={18} aria-hidden="true" />;
  }
}

function channelReadinessKey(
  readiness: InternalChannelCatalogItem["readiness"]
): I18nMessageKey {
  return `integrations.channel.readiness.${readiness}` as I18nMessageKey;
}

function channelConnectorStatusKey(
  status: InternalChannelConnectorSummary["status"]
): I18nMessageKey {
  return `integrations.channel.status.${status}` as I18nMessageKey;
}

function channelHealthStatusKey(
  status: InternalChannelConnectorSummary["healthStatus"]
): I18nMessageKey {
  return `integrations.channel.health.${status}` as I18nMessageKey;
}

function normalizeOptionalSearchParam(
  value: string | undefined
): string | undefined {
  const normalized = value?.trim();

  return normalized && normalized.length > 0 ? normalized : undefined;
}
