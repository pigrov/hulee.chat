import { createTranslator } from "@hulee/i18n";
import { createSqlDeploymentChannelCatalogOverrideRepository } from "@hulee/db";
import { ArrowLeft, Building2, MessageCircle, UserRound } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../../../src/access-denied";
import {
  canPlatformAdmin,
  navigationAccessFromSession
} from "../../../../src/access";
import { DetailItem } from "../../../../src/app-chrome";
import {
  ChannelIcon,
  resolveChannelTitle
} from "../../../../src/channel-display";
import { formatOptionalDateTime } from "../../../../src/formatting";
import { PlatformAdminShell } from "../../../../src/platform-admin-shell";
import {
  formatDeploymentType,
  type PlatformTenantSnapshot
} from "../../../../src/platform-admin-components";
import { loadPlatformChannelCatalog } from "../../../../src/platform-channel-catalog";
import type { PlatformCompanyChannelConnector } from "../../../../src/platform-company-data";
import { loadPlatformCompanyDetails } from "../../../../src/platform-company-data";
import {
  getWebDatabase,
  resolveCurrentWebAccessSession
} from "../../../../src/session";
import type { TenantEmployeeRecord } from "@hulee/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Translator = ReturnType<typeof createTranslator>["t"];

export default async function PlatformCompanyPage({
  params
}: {
  params: Promise<{ tenantId: string }>;
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

  const { tenantId } = await params;
  const { t, locale } = createTranslator("ru");
  const database = getWebDatabase();
  const [details, channelCatalog] = await Promise.all([
    loadPlatformCompanyDetails({ database, tenantId }),
    loadPlatformChannelCatalog({
      repository: createSqlDeploymentChannelCatalogOverrideRepository(database)
    })
  ]);

  if (!details) {
    notFound();
  }

  return (
    <PlatformAdminShell
      access={access}
      current="companies"
      t={t}
      title={details.tenant.displayName}
      titleId="platform-company-title"
    >
      <div className="buttonRow">
        <Link className="secondaryButton" href="/platform/companies">
          <ArrowLeft size={16} aria-hidden="true" />
          {t("platform.company.backToCompanies")}
        </Link>
      </div>

      <section className="settingsPanel" aria-labelledby="company-overview">
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">{t("platform.tenants")}</p>
            <h2 className="sectionTitle" id="company-overview">
              {details.tenant.displayName}
            </h2>
            <p className="metaText">{details.tenant.slug}</p>
          </div>
          <span className="badge">
            <Building2 size={14} aria-hidden="true" />
            {formatDeploymentType(details.tenant.deploymentType, t)}
          </span>
        </div>
        <CompanyOverview locale={locale} t={t} tenant={details.tenant} />
      </section>

      <section className="settingsPanel" aria-labelledby="company-employees">
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">{t("platform.company.directory")}</p>
            <h2 className="sectionTitle" id="company-employees">
              {t("admin.employees.directory")}
            </h2>
          </div>
          <span className="badge">
            <UserRound size={14} aria-hidden="true" />
            {String(details.employees.length)}
          </span>
        </div>
        <div className="managementList">
          {details.employees.length > 0 ? (
            details.employees.map((employee) => (
              <CompanyEmployeeRow
                employee={employee}
                key={employee.employeeId}
                locale={locale}
                t={t}
              />
            ))
          ) : (
            <p className="metaText">{t("admin.employees.empty")}</p>
          )}
        </div>
      </section>

      <section className="settingsPanel" aria-labelledby="company-channels">
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">{t("admin.integrations")}</p>
            <h2 className="sectionTitle" id="company-channels">
              {t("admin.integrations.channels")}
            </h2>
          </div>
          <span className="badge">
            <MessageCircle size={14} aria-hidden="true" />
            {String(details.connectors.length)}
          </span>
        </div>
        <div className="managementList">
          {details.connectors.length > 0 ? (
            details.connectors.map((connector) => (
              <CompanyConnectorRow
                connector={connector}
                key={connector.connectorId}
                locale={locale}
                t={t}
                tenantId={details.tenant.tenantId}
                channelTitle={
                  channelCatalog.find(
                    (channel) => channel.channelType === connector.channelType
                  )
                    ? resolveChannelTitle({
                        channel: channelCatalog.find(
                          (channel) =>
                            channel.channelType === connector.channelType
                        )!,
                        locale,
                        t,
                        fallback: connector.channelType
                      })
                    : connector.channelType
                }
                channelIcon={
                  <ChannelIcon
                    channel={channelCatalog.find(
                      (channel) => channel.channelType === connector.channelType
                    )}
                    channelClass={connector.channelClass}
                  />
                }
              />
            ))
          ) : (
            <p className="metaText">
              {t("admin.integrations.noConnectedChannels")}
            </p>
          )}
        </div>
      </section>
    </PlatformAdminShell>
  );
}

function CompanyOverview({
  locale,
  tenant,
  t
}: {
  locale: string;
  tenant: PlatformTenantSnapshot;
  t: Translator;
}): ReactNode {
  return (
    <div className="diagnosticGrid">
      <DetailItem label={t("platform.company.id")} value={tenant.tenantId} />
      <DetailItem label={t("platform.company.slug")} value={tenant.slug} />
      <DetailItem
        label={t("platform.deploymentType")}
        value={formatDeploymentType(tenant.deploymentType, t)}
      />
      <DetailItem
        label={t("platform.tenantCreatedAt")}
        value={formatOptionalDateTime(tenant.createdAt, locale, t)}
      />
      <DetailItem
        label={t("platform.company.updatedAt")}
        value={formatOptionalDateTime(tenant.updatedAt, locale, t)}
      />
    </div>
  );
}

function CompanyEmployeeRow({
  employee,
  locale,
  t
}: {
  employee: TenantEmployeeRecord;
  locale: string;
  t: Translator;
}): ReactNode {
  return (
    <article className="managementRow platformEmployeeRow">
      <span className="metricIcon">
        <UserRound size={18} aria-hidden="true" />
      </span>
      <span>
        <span className="detailValue">{employee.displayName}</span>
        <span className="metaText">{employee.email}</span>
      </span>
      <span className="badge">
        {employee.deactivatedAt
          ? t("admin.employees.status.deactivated")
          : t("admin.employees.status.active")}
      </span>
      <DetailItem
        label={t("platform.company.createdAt")}
        value={formatOptionalDateTime(employee.createdAt, locale, t)}
      />
    </article>
  );
}

function CompanyConnectorRow({
  channelIcon,
  channelTitle,
  connector,
  locale,
  tenantId,
  t
}: {
  channelIcon: ReactNode;
  channelTitle: string;
  connector: PlatformCompanyChannelConnector;
  locale: string;
  tenantId: string;
  t: Translator;
}): ReactNode {
  return (
    <Link
      className="managementRow platformConnectorRow"
      href={`/platform/companies/${encodeURIComponent(
        tenantId
      )}/channels/${encodeURIComponent(connector.connectorId)}`}
    >
      <span className="metricIcon">{channelIcon}</span>
      <span>
        <span className="detailValue">{connector.displayName}</span>
        <span className="metaText">
          {[channelTitle, connector.provider].join(" / ")}
        </span>
      </span>
      <span className="badge">
        {t(channelConnectorStatusKey(connector.status))}
      </span>
      <DetailItem
        label={t("integrations.channel.details.health")}
        value={t(channelHealthStatusKey(connector.healthStatus))}
      />
      <DetailItem
        label={t("platform.company.updatedAt")}
        value={formatOptionalDateTime(connector.updatedAt, locale, t)}
      />
    </Link>
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
