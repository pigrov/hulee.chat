import { createTranslator } from "@hulee/i18n";
import {
  createSqlDeploymentChannelCatalogOverrideRepository,
  createSqlDeploymentEgressStatusRepository
} from "@hulee/db";
import { ArrowLeft, MessageCircle, Network } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../../../../../src/access-denied";
import {
  canPlatformAdmin,
  navigationAccessFromSession
} from "../../../../../../src/access";
import { DetailItem } from "../../../../../../src/app-chrome";
import {
  ChannelIcon,
  resolveChannelTitle
} from "../../../../../../src/channel-display";
import {
  egressProfileKindKey,
  egressStatusKey,
  resolveOverallEgressStatus
} from "../../../../../../src/egress-formatting";
import { formatOptionalDateTime } from "../../../../../../src/formatting";
import { PlatformEgressProfile } from "../../../../../../src/platform-admin-components";
import { PlatformAdminShell } from "../../../../../../src/platform-admin-shell";
import { loadPlatformChannelCatalog } from "../../../../../../src/platform-channel-catalog";
import type { PlatformCompanyChannelConnector } from "../../../../../../src/platform-company-data";
import { loadPlatformCompanyChannelDetails } from "../../../../../../src/platform-company-data";
import { loadPlatformEgressStatus } from "../../../../../../src/platform-egress-status";
import {
  getWebDatabase,
  resolveCurrentWebAccessSession,
  resolveWebConfig
} from "../../../../../../src/session";
import { TelegramDiagnosticsGrid } from "../../../../../../src/telegram-integration-panel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Translator = ReturnType<typeof createTranslator>["t"];

export default async function PlatformCompanyChannelPage({
  params
}: {
  params: Promise<{ connectorId: string; tenantId: string }>;
}): Promise<ReactNode> {
  const access = await resolveCurrentWebAccessSession();

  if (access === null) {
    redirect("/login");
  }

  if (!canPlatformAdmin(access)) {
    return (
      <AccessDeniedPage
        current="platform-admin"
        navigationAccess={navigationAccessFromSession(access)}
      />
    );
  }

  const { connectorId, tenantId } = await params;
  const { t, locale } = createTranslator("ru");
  const database = getWebDatabase();
  const config = resolveWebConfig();
  const [details, channelCatalog, egressStatus] = await Promise.all([
    loadPlatformCompanyChannelDetails({
      database,
      publicWebhookBaseUrl: config.publicWebhookBaseUrl,
      tenantId,
      connectorId
    }),
    loadPlatformChannelCatalog({
      repository: createSqlDeploymentChannelCatalogOverrideRepository(database)
    }),
    loadPlatformEgressStatus({
      config,
      repository: createSqlDeploymentEgressStatusRepository(database)
    })
  ]);

  if (!details) {
    notFound();
  }

  const channel = channelCatalog.find(
    (item) => item.channelType === details.connector.channelType
  );
  const channelTitle = channel
    ? resolveChannelTitle({
        channel,
        locale,
        t,
        fallback: details.connector.channelType
      })
    : details.connector.channelType;
  const overallEgressStatus = resolveOverallEgressStatus(egressStatus.profiles);

  return (
    <PlatformAdminShell
      access={access}
      current="companies"
      t={t}
      title={details.connector.displayName}
      titleId="platform-company-channel-title"
    >
      <div className="buttonRow">
        <Link
          className="secondaryButton"
          href={`/platform/companies/${encodeURIComponent(
            details.tenant.tenantId
          )}`}
        >
          <ArrowLeft size={16} aria-hidden="true" />
          {t("platform.company.backToCompany")}
        </Link>
      </div>

      <section className="settingsPanel" aria-labelledby="channel-overview">
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">{details.tenant.displayName}</p>
            <h2 className="sectionTitle" id="channel-overview">
              {details.connector.displayName}
            </h2>
            <p className="metaText">{channelTitle}</p>
          </div>
          <span className="badge">
            <ChannelIcon
              channel={channel}
              channelClass={details.connector.channelClass}
            />
            {t(channelConnectorStatusKey(details.connector.status))}
          </span>
        </div>
        <ChannelOverview connector={details.connector} locale={locale} t={t} />
      </section>

      <section className="settingsPanel" aria-labelledby="channel-diagnostics">
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">{t("platform.dataPlane")}</p>
            <h2 className="sectionTitle" id="channel-diagnostics">
              {t("platform.company.channelDiagnostics")}
            </h2>
            <p className="metaText">
              {t("platform.company.channelDiagnosticsDescription")}
            </p>
          </div>
          <span className="badge">
            <MessageCircle size={14} aria-hidden="true" />
            {t(channelHealthStatusKey(details.connector.healthStatus))}
          </span>
        </div>
        {details.telegramIntegration ? (
          <TelegramDiagnosticsGrid
            integration={details.telegramIntegration}
            locale={locale}
            t={t}
          />
        ) : (
          <GenericChannelDiagnostics connector={details.connector} t={t} />
        )}
      </section>

      <section className="settingsPanel" aria-labelledby="provider-network">
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">{t("platform.egress")}</p>
            <h2 className="sectionTitle" id="provider-network">
              {t("platform.company.providerNetwork")}
            </h2>
            <p className="metaText">
              {t("platform.company.providerNetworkDescription")}
            </p>
          </div>
          <span className="badge">
            <Network size={14} aria-hidden="true" />
            {t(egressStatusKey(overallEgressStatus))}
          </span>
        </div>
        <div className="managementList">
          {egressStatus.profiles.map((profile) => (
            <PlatformEgressProfile
              key={profile.profileId}
              locale={locale}
              profile={profile}
              t={t}
            />
          ))}
        </div>
      </section>
    </PlatformAdminShell>
  );
}

function ChannelOverview({
  connector,
  locale,
  t
}: {
  connector: PlatformCompanyChannelConnector;
  locale: string;
  t: Translator;
}): ReactNode {
  return (
    <div className="diagnosticGrid">
      <DetailItem
        label={t("integrations.channel.details.type")}
        value={connector.channelType}
      />
      <DetailItem
        label={t("integrations.channel.details.provider")}
        value={connector.provider}
      />
      <DetailItem
        label={t("integrations.channel.details.class")}
        value={t(channelClassKey(connector.channelClass))}
      />
      <DetailItem
        label={t("integrations.telegram.lifecycleStatus")}
        value={t(channelConnectorStatusKey(connector.status))}
      />
      <DetailItem
        label={t("integrations.channel.details.health")}
        value={t(channelHealthStatusKey(connector.healthStatus))}
      />
      <DetailItem
        label={t("platform.company.createdAt")}
        value={formatOptionalDateTime(connector.createdAt, locale, t)}
      />
      <DetailItem
        label={t("platform.company.updatedAt")}
        value={formatOptionalDateTime(connector.updatedAt, locale, t)}
      />
    </div>
  );
}

function GenericChannelDiagnostics({
  connector,
  t
}: {
  connector: PlatformCompanyChannelConnector;
  t: Translator;
}): ReactNode {
  return (
    <div className="diagnosticGrid">
      <DetailItem
        label={t("integrations.telegram.lifecycleStatus")}
        value={t(channelConnectorStatusKey(connector.status))}
      />
      <DetailItem
        label={t("integrations.channel.details.health")}
        value={t(channelHealthStatusKey(connector.healthStatus))}
      />
      {connector.diagnosticsStatus ? (
        <DetailItem
          label={t("integrations.channel.details.diagnosticsStatus")}
          value={connector.diagnosticsStatus}
        />
      ) : null}
      {connector.egress ? (
        <>
          <DetailItem
            label={t("integrations.egress.status")}
            value={t(egressStatusKey(connector.egress.status))}
          />
          <DetailItem
            label={t("integrations.egress.profileKind")}
            value={
              connector.egress.profileKind
                ? t(egressProfileKindKey(connector.egress.profileKind))
                : t("common.unknown")
            }
          />
          {connector.egress.lastErrorCode ? (
            <DetailItem
              label={t("integrations.channel.details.error")}
              value={connector.egress.lastErrorCode}
            />
          ) : null}
          {connector.egress.operatorHint ? (
            <DetailItem
              label={t("integrations.egress.operatorHint")}
              value={connector.egress.operatorHint}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function channelConnectorStatusKey(
  status: PlatformCompanyChannelConnector["status"]
) {
  return `integrations.channel.status.${status}` as const;
}

function channelHealthStatusKey(
  status: PlatformCompanyChannelConnector["healthStatus"]
) {
  return `integrations.channel.health.${status}` as const;
}

function channelClassKey(
  channelClass: PlatformCompanyChannelConnector["channelClass"]
) {
  return `integrations.channel.class.${channelClass}` as const;
}
