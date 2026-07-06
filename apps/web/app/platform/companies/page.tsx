import { createSqlDeploymentChannelCatalogOverrideRepository } from "@hulee/db";
import type { TenantEmployeeRecord } from "@hulee/db";
import { createTranslator } from "@hulee/i18n";
import { Building2, MessageCircle, Search, UserRound, X } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../../src/access-denied";
import {
  canPlatformAdmin,
  navigationAccessFromSession
} from "../../../src/access";
import { DetailItem } from "../../../src/app-chrome";
import { ChannelIcon, resolveChannelTitle } from "../../../src/channel-display";
import { EmailText } from "../../../src/contact-fields";
import { formatOptionalDateTime } from "../../../src/formatting";
import {
  formatDeploymentType,
  loadPlatformTenantSnapshots,
  type PlatformTenantSnapshot
} from "../../../src/platform-admin-components";
import { PlatformAdminShell } from "../../../src/platform-admin-shell";
import { loadPlatformChannelCatalog } from "../../../src/platform-channel-catalog";
import type { PlatformChannelCatalogView } from "../../../src/platform-channel-catalog";
import type {
  PlatformCompanyChannelConnector,
  PlatformCompanyDetails
} from "../../../src/platform-company-data";
import { loadPlatformCompanyDetails } from "../../../src/platform-company-data";
import {
  getWebDatabase,
  resolveCurrentWebAccessSession
} from "../../../src/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Translator = ReturnType<typeof createTranslator>["t"];

export default async function PlatformCompaniesPage({
  searchParams
}: {
  searchParams?: Promise<{
    q?: string;
    tenantId?: string;
  }>;
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

  const { t, locale } = createTranslator("ru");
  const database = getWebDatabase();
  const resolvedSearchParams = await searchParams;
  const searchQuery = normalizeOptionalSearchParam(resolvedSearchParams?.q);
  const requestedTenantId = normalizeOptionalSearchParam(
    resolvedSearchParams?.tenantId
  );
  const tenants = await loadPlatformTenantSnapshots(database, {
    search: searchQuery
  });
  const selectedTenant =
    tenants.find((tenant) => tenant.tenantId === requestedTenantId) ??
    tenants[0];
  const [details, channelCatalog] = await Promise.all([
    selectedTenant
      ? loadPlatformCompanyDetails({
          database,
          tenantId: selectedTenant.tenantId
        })
      : Promise.resolve(null),
    loadPlatformChannelCatalog({
      repository: createSqlDeploymentChannelCatalogOverrideRepository(database)
    })
  ]);

  return (
    <PlatformAdminShell
      access={access}
      current="companies"
      t={t}
      title={t("platform.tenants")}
      titleId="platform-companies-title"
    >
      <div className="adminIntegrationGrid">
        <aside
          className="settingsPanel integrationCatalog platformCompanyCatalog"
          aria-labelledby="companies-title"
        >
          <div className="sectionHeader">
            <div>
              <h2 className="sectionTitle" id="companies-title">
                {t("platform.tenants")}
              </h2>
              <p className="metaText">{t("platform.tenantsDescription")}</p>
            </div>
            <span className="badge">
              <Building2 size={14} aria-hidden="true" />
              {String(tenants.length)}
            </span>
          </div>

          <form
            className="platformCompanySearchForm"
            action="/platform/companies"
          >
            <label className="fieldStack">
              <span className="detailLabel">
                {t("platform.company.search")}
              </span>
              <input
                className="textInput"
                defaultValue={searchQuery ?? ""}
                name="q"
                placeholder={t("platform.company.searchPlaceholder")}
                type="search"
              />
            </label>
            <div className="buttonRow">
              <button className="secondaryButton" type="submit">
                <Search size={14} aria-hidden="true" />
                {t("platform.company.searchSubmit")}
              </button>
              {searchQuery ? (
                <Link className="secondaryButton" href="/platform/companies">
                  <X size={14} aria-hidden="true" />
                  {t("platform.company.searchClear")}
                </Link>
              ) : null}
            </div>
          </form>

          <nav className="integrationList" aria-label={t("platform.tenants")}>
            {tenants.length > 0 ? (
              tenants.map((tenant) => (
                <CompanyListItem
                  current={tenant.tenantId === selectedTenant?.tenantId}
                  key={tenant.tenantId}
                  searchQuery={searchQuery}
                  tenant={tenant}
                  t={t}
                />
              ))
            ) : (
              <p className="metaText">
                {searchQuery
                  ? t("platform.company.searchEmpty")
                  : t("platform.tenantsEmpty")}
              </p>
            )}
          </nav>
        </aside>

        <div className="adminStack adminSectionContent">
          {details ? (
            <CompanyDetailsPanel
              channelCatalog={channelCatalog}
              details={details}
              locale={locale}
              t={t}
            />
          ) : (
            <section className="settingsPanel" aria-labelledby="company-empty">
              <div className="sectionHeader">
                <div>
                  <p className="eyebrow">{t("platform.tenants")}</p>
                  <h2 className="sectionTitle" id="company-empty">
                    {t("platform.company.selectCompany")}
                  </h2>
                  <p className="metaText">
                    {t("platform.company.selectCompanyDescription")}
                  </p>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </PlatformAdminShell>
  );
}

function CompanyListItem({
  current,
  searchQuery,
  tenant,
  t
}: {
  current: boolean;
  searchQuery?: string;
  tenant: PlatformTenantSnapshot;
  t: Translator;
}): ReactNode {
  const href = `/platform/companies?tenantId=${encodeURIComponent(
    tenant.tenantId
  )}${searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""}`;

  return (
    <Link
      className="integrationListItem integrationNavLink platformCompanyListItem"
      href={href}
      aria-current={current ? "page" : undefined}
    >
      <span className="metricIcon">
        <Building2 size={24} strokeWidth={1.2} aria-hidden="true" />
      </span>
      <div className="integrationListText">
        <h3 className="listItemTitle" title={tenant.displayName}>
          {tenant.displayName}
        </h3>
        <p className="metaText integrationListType" title={tenant.slug}>
          {tenant.slug}
        </p>
      </div>
      <span className="integrationListBadges">
        <span className="badge">
          {formatDeploymentType(tenant.deploymentType, t)}
        </span>
      </span>
    </Link>
  );
}

function CompanyDetailsPanel({
  channelCatalog,
  details,
  locale,
  t
}: {
  channelCatalog: readonly PlatformChannelCatalogView[];
  details: PlatformCompanyDetails;
  locale: string;
  t: Translator;
}): ReactNode {
  return (
    <>
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
                channelCatalog={channelCatalog}
                connector={connector}
                key={connector.connectorId}
                locale={locale}
                t={t}
                tenantId={details.tenant.tenantId}
              />
            ))
          ) : (
            <p className="metaText">
              {t("admin.integrations.noConnectedChannels")}
            </p>
          )}
        </div>
      </section>
    </>
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
        <EmailText asLink={false} className="metaText" value={employee.email} />
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
  channelCatalog,
  connector,
  locale,
  tenantId,
  t
}: {
  channelCatalog: readonly PlatformChannelCatalogView[];
  connector: PlatformCompanyChannelConnector;
  locale: string;
  tenantId: string;
  t: Translator;
}): ReactNode {
  const channel = channelCatalog.find(
    (item) => item.channelType === connector.channelType
  );
  const channelTitle = channel
    ? resolveChannelTitle({
        channel,
        locale,
        t,
        fallback: connector.channelType
      })
    : connector.channelType;

  return (
    <Link
      className="managementRow platformConnectorRow"
      href={`/platform/companies/${encodeURIComponent(
        tenantId
      )}/channels/${encodeURIComponent(connector.connectorId)}`}
    >
      <span className="metricIcon">
        <ChannelIcon channel={channel} channelClass={connector.channelClass} />
      </span>
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

function normalizeOptionalSearchParam(
  value: string | undefined
): string | undefined {
  const normalized = value?.trim();

  return normalized && normalized.length > 0 ? normalized : undefined;
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
