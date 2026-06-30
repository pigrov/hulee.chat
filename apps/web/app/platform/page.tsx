import { defaultBrandProfile } from "@hulee/branding";
import { createTranslator } from "@hulee/i18n";
import type { I18nMessageKey } from "@hulee/i18n";
import type {
  InternalChannelType,
  InternalEgressProfileStatus
} from "@hulee/contracts";
import {
  createSqlDeploymentChannelCatalogOverrideRepository,
  createSqlDeploymentChannelProviderPolicyRepository,
  createSqlDeploymentEgressProviderPolicyRepository,
  createSqlDeploymentEgressStatusRepository
} from "@hulee/db";
import {
  AlertTriangle,
  Boxes,
  Building2,
  KeyRound,
  MessageCircle,
  Network,
  Server,
  ShieldCheck
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../src/access-denied";
import {
  canPlatformAdmin,
  navigationAccessFromSession
} from "../../src/access";
import { AppFrame, DetailItem } from "../../src/app-chrome";
import {
  resolveCurrentWebAccessSession,
  getWebDatabase,
  resolveWebConfig
} from "../../src/session";
import {
  egressProfileKindKey,
  egressStatusKey,
  resolveOverallEgressStatus
} from "../../src/egress-formatting";
import { formatOptionalDateTime } from "../../src/formatting";
import { resolveChannelTitle } from "../../src/channel-display";
import { updatePlatformChannelProviderPolicyAction } from "../../src/platform-channel-actions";
import {
  loadPlatformChannelCatalog,
  type PlatformChannelCatalogView
} from "../../src/platform-channel-catalog";
import {
  loadPlatformChannelProviderPolicies,
  type PlatformChannelProviderPolicyView
} from "../../src/platform-channel-policies";
import { updatePlatformEgressProviderPolicyAction } from "../../src/platform-egress-actions";
import {
  loadPlatformEgressProviderPolicies,
  platformEgressProviderRoutingModes,
  type PlatformEgressProviderPolicyView
} from "../../src/platform-egress-policies";
import { loadPlatformEgressStatus } from "../../src/platform-egress-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PlatformAdminPage({
  searchParams
}: {
  searchParams?: Promise<{
    channelPolicy?: string;
    egressPolicy?: string;
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
  const webConfig = resolveWebConfig();
  const database = getWebDatabase();
  const deploymentType = webConfig.deploymentType;
  const publicBaseUrl = webConfig.publicBaseUrl ?? "http://127.0.0.1:3001";
  const egressStatus = await loadPlatformEgressStatus({
    config: webConfig,
    repository: createSqlDeploymentEgressStatusRepository(database)
  });
  const channelCatalog = await loadPlatformChannelCatalog({
    repository: createSqlDeploymentChannelCatalogOverrideRepository(database)
  });
  const providerPolicies = await loadPlatformEgressProviderPolicies({
    config: webConfig,
    egressStatus,
    repository: createSqlDeploymentEgressProviderPolicyRepository(database)
  });
  const channelPolicies = await loadPlatformChannelProviderPolicies({
    config: webConfig,
    repository: createSqlDeploymentChannelProviderPolicyRepository(database)
  });
  const resolvedSearchParams = await searchParams;
  const overallEgressStatus = resolveOverallEgressStatus(egressStatus.profiles);

  return (
    <AppFrame
      brand={defaultBrandProfile}
      current="platform-admin"
      frameClassName="adminFrame"
      navigationAccess={navigationAccessFromSession(access)}
      t={t}
    >
      <section className="adminWorkspace" aria-labelledby="platform-title">
        <header className="adminHeader">
          <div>
            <p className="eyebrow">{t("platform.controlPlane")}</p>
            <h1 className="adminTitle" id="platform-title">
              {t("platform.title")}
            </h1>
          </div>
          <span className="badge">
            <ShieldCheck size={14} aria-hidden="true" />
            {t("platform.customerDataPolicy")}
          </span>
        </header>

        <div className="adminContent">
          {resolvedSearchParams?.egressPolicy ? (
            <p
              className={
                resolvedSearchParams.egressPolicy === "updated"
                  ? "formNotice"
                  : "formError"
              }
            >
              {resolvedSearchParams.egressPolicy === "updated"
                ? t("platform.egressPolicyStatus.updated")
                : t("platform.egressPolicyStatus.invalid")}
            </p>
          ) : null}
          {resolvedSearchParams?.channelPolicy ? (
            <p
              className={
                resolvedSearchParams.channelPolicy === "updated"
                  ? "formNotice"
                  : "formError"
              }
            >
              {resolvedSearchParams.channelPolicy === "updated"
                ? t("platform.channelPolicyStatus.updated")
                : t("platform.channelPolicyStatus.invalid")}
            </p>
          ) : null}

          <section
            className="platformMetricGrid"
            aria-label={t("platform.overview")}
          >
            <PlatformMetric
              icon={<Building2 size={18} aria-hidden="true" />}
              label={t("platform.tenants")}
              value={t("platform.status.localSnapshot")}
            />
            <PlatformMetric
              icon={<Server size={18} aria-hidden="true" />}
              label={t("platform.deployments")}
              value={formatDeploymentType(deploymentType, t)}
            />
            <PlatformMetric
              icon={<Boxes size={18} aria-hidden="true" />}
              label={t("platform.modules")}
              value={t("platform.status.moduleCatalogSnapshot")}
            />
            <PlatformMetric
              icon={<Network size={18} aria-hidden="true" />}
              label={t("platform.egress")}
              value={t(egressStatusKey(overallEgressStatus))}
            />
          </section>

          <div className="platformGrid">
            <section
              className="settingsPanel"
              aria-labelledby="deployments-title"
            >
              <div className="sectionHeader">
                <div>
                  <p className="eyebrow">{t("platform.controlPlane")}</p>
                  <h2 className="sectionTitle" id="deployments-title">
                    {t("platform.deployments")}
                  </h2>
                </div>
                <Server size={18} aria-hidden="true" />
              </div>
              <div className="detailGrid">
                <DetailItem
                  label={t("platform.deploymentType")}
                  value={formatDeploymentType(deploymentType, t)}
                />
                <DetailItem
                  label={t("platform.publicBaseUrl")}
                  value={publicBaseUrl}
                />
                <DetailItem
                  label={t("platform.dataPlane")}
                  value={t("platform.status.currentDeployment")}
                />
              </div>
            </section>

            <section className="settingsPanel" aria-labelledby="egress-title">
              <div className="sectionHeader">
                <div>
                  <p className="eyebrow">{t("platform.dataPlane")}</p>
                  <h2 className="sectionTitle" id="egress-title">
                    {t("platform.egress")}
                  </h2>
                </div>
                <span className="badge">
                  <Network size={14} aria-hidden="true" />
                  {t(egressStatusKey(overallEgressStatus))}
                </span>
              </div>
              <p className="metaText">{t("platform.egressDescription")}</p>
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

            <section
              className="settingsPanel"
              aria-labelledby="egress-provider-routing-title"
            >
              <div className="sectionHeader">
                <div>
                  <p className="eyebrow">{t("platform.dataPlane")}</p>
                  <h2
                    className="sectionTitle"
                    id="egress-provider-routing-title"
                  >
                    {t("platform.egressProviderRouting")}
                  </h2>
                </div>
                <Network size={18} aria-hidden="true" />
              </div>
              <p className="metaText">
                {t("platform.egressProviderRoutingDescription")}
              </p>
              <div className="managementList">
                {providerPolicies.map((policy) => (
                  <PlatformEgressProviderPolicy
                    key={policy.provider}
                    locale={locale}
                    policy={policy}
                    channelCatalog={channelCatalog}
                    t={t}
                  />
                ))}
              </div>
            </section>

            <section
              className="settingsPanel"
              aria-labelledby="channel-provider-policy-title"
            >
              <div className="sectionHeader">
                <div>
                  <p className="eyebrow">{t("platform.dataPlane")}</p>
                  <h2
                    className="sectionTitle"
                    id="channel-provider-policy-title"
                  >
                    {t("platform.channelProviderBehavior")}
                  </h2>
                </div>
                <MessageCircle size={18} aria-hidden="true" />
              </div>
              <p className="metaText">
                {t("platform.channelProviderBehaviorDescription")}
              </p>
              <Link className="managementRow" href="/platform/channels">
                <span>
                  <span className="detailValue">
                    {t("platform.channels.title")}
                  </span>
                  <span className="metaText">
                    {t("platform.channels.description")}
                  </span>
                </span>
                <span className="badge">
                  {t("platform.channels.openCatalog")}
                </span>
              </Link>
              <div className="managementList">
                {channelPolicies.map((policy) => (
                  <PlatformChannelProviderPolicy
                    key={`${policy.provider}:${policy.channelType}`}
                    channelCatalog={channelCatalog}
                    locale={locale}
                    policy={policy}
                    t={t}
                  />
                ))}
              </div>
            </section>

            <section
              className="settingsPanel"
              aria-labelledby="commercial-title"
            >
              <div className="sectionHeader">
                <div>
                  <p className="eyebrow">{t("platform.controlPlane")}</p>
                  <h2 className="sectionTitle" id="commercial-title">
                    {t("platform.commercial")}
                  </h2>
                </div>
                <KeyRound size={18} aria-hidden="true" />
              </div>
              <div className="managementList">
                <ManagementRow
                  label={t("platform.plans")}
                  value={t("platform.status.deferred")}
                />
                <ManagementRow
                  label={t("platform.entitlements")}
                  value={t("platform.status.localSnapshot")}
                />
                <ManagementRow
                  label={t("platform.licenses")}
                  value={t("platform.status.localSnapshot")}
                />
              </div>
            </section>

            <section className="settingsPanel" aria-labelledby="access-title">
              <div className="sectionHeader">
                <div>
                  <p className="eyebrow">{t("platform.boundary")}</p>
                  <h2 className="sectionTitle" id="access-title">
                    {t("platform.supportAccess")}
                  </h2>
                </div>
                <ShieldCheck size={18} aria-hidden="true" />
              </div>
              <div className="managementList">
                <ManagementRow
                  label={t("platform.customerData")}
                  value={t("platform.status.notStored")}
                />
                <ManagementRow
                  label={t("platform.audit")}
                  value={t("platform.status.required")}
                />
                <ManagementRow
                  label={t("platform.impersonation")}
                  value={t("platform.status.deferred")}
                />
              </div>
            </section>
          </div>
        </div>
      </section>
    </AppFrame>
  );
}

function PlatformChannelProviderPolicy({
  channelCatalog,
  locale,
  policy,
  t
}: {
  channelCatalog: readonly PlatformChannelCatalogView[];
  locale: string;
  policy: PlatformChannelProviderPolicyView;
  t: ReturnType<typeof createTranslator>["t"];
}): ReactNode {
  const channelTitle = formatChannelType({
    channelCatalog,
    channelType: policy.channelType,
    fallbackKey: policy.titleKey,
    locale,
    t
  });

  return (
    <form
      action={updatePlatformChannelProviderPolicyAction}
      className="managementRow channelProviderPolicyRow"
    >
      <input name="provider" type="hidden" value={policy.provider} />
      <input name="channelType" type="hidden" value={policy.channelType} />

      <div>
        <p className="detailValue">{channelTitle}</p>
        <p className="metaText">{policy.channelType}</p>
        <div className="sourceList">
          <span className="badge">
            {t(channelPolicySourceKey(policy.source))}
          </span>
        </div>
      </div>

      <label className="fieldStack">
        <span className="detailLabel">
          {t("platform.channelPolicy.inboundMode")}
        </span>
        <select
          className="selectInput"
          defaultValue={policy.inboundMode}
          name="inboundMode"
        >
          {policy.supportedInboundModes.map((mode) => (
            <option key={mode} value={mode}>
              {t(telegramModeKey(mode))}
            </option>
          ))}
        </select>
      </label>

      <label className="toggleRow">
        <input
          type="checkbox"
          name="outboundEnabled"
          defaultChecked={policy.outboundEnabled}
        />
        <span>{t("platform.channelPolicy.outboundEnabled")}</span>
      </label>

      <div className="egressProviderPolicyStatus">
        {policy.updatedAt ? (
          <DetailItem
            label={t("platform.channelPolicy.updatedAt")}
            value={formatOptionalDateTime(policy.updatedAt, locale, t)}
          />
        ) : (
          <DetailItem
            label={t("platform.channelPolicy.updatedAt")}
            value={t("common.unknown")}
          />
        )}
      </div>

      <button className="primaryButton" type="submit">
        {t("common.save")}
      </button>
    </form>
  );
}

function PlatformEgressProfile({
  locale,
  profile,
  t
}: {
  locale: string;
  profile: InternalEgressProfileStatus;
  t: ReturnType<typeof createTranslator>["t"];
}): ReactNode {
  const failedProbeCount =
    profile.probes?.filter((probe) => probe.status === "failed").length ?? 0;

  return (
    <div className="diagnosticGrid">
      <DetailItem
        label={t("integrations.egress.profile")}
        value={profile.profileId}
      />
      <DetailItem
        label={t("integrations.egress.status")}
        value={t(egressStatusKey(profile.status))}
      />
      <DetailItem
        label={t("integrations.egress.profileKind")}
        value={t(egressProfileKindKey(profile.profileKind))}
      />
      <DetailItem
        label={t("integrations.egress.source")}
        value={t(egressSourceKey(profile.source))}
      />
      <DetailItem
        label={t("integrations.egress.checkedAt")}
        value={formatOptionalDateTime(profile.checkedAt, locale, t)}
      />
      <DetailItem
        label={t("integrations.egress.publicIp")}
        value={profile.publicIp ?? t("common.unknown")}
      />
      <DetailItem
        label={t("integrations.egress.consecutiveFailures")}
        value={String(profile.consecutiveFailures ?? 0)}
      />
      <DetailItem
        label={t("integrations.egress.failedProbes")}
        value={String(failedProbeCount)}
      />
      {profile.lastFailureAt ? (
        <DetailItem
          label={t("integrations.egress.lastFailureAt")}
          value={formatOptionalDateTime(profile.lastFailureAt, locale, t)}
        />
      ) : null}
      {profile.operatorHint ? (
        <DetailItem
          label={t("integrations.egress.operatorHint")}
          value={profile.operatorHint}
        />
      ) : null}
      {profile.alerts && profile.alerts.length > 0 ? (
        <div className="managementRow">
          <span className="detailValue">
            <AlertTriangle size={14} aria-hidden="true" />
            {t("integrations.egress.alerts")}
          </span>
          <span className="badge">
            {profile.alerts.map((alert) => alert.code).join(", ")}
          </span>
        </div>
      ) : null}
      {profile.probes && profile.probes.length > 0 ? (
        <div className="managementList">
          {profile.probes.map((probe) => (
            <ManagementRow
              key={`${probe.name}:${probe.target}`}
              label={probe.name}
              value={[
                t(egressProbeStatusKey(probe.status)),
                probe.latencyMs === undefined
                  ? undefined
                  : `${probe.latencyMs} ms`
              ]
                .filter(Boolean)
                .join(" / ")}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PlatformEgressProviderPolicy({
  channelCatalog,
  locale,
  policy,
  t
}: {
  channelCatalog: readonly PlatformChannelCatalogView[];
  locale: string;
  policy: PlatformEgressProviderPolicyView;
  t: ReturnType<typeof createTranslator>["t"];
}): ReactNode {
  return (
    <form
      action={updatePlatformEgressProviderPolicyAction}
      className="managementRow egressProviderPolicyRow"
    >
      <input name="provider" type="hidden" value={policy.provider} />
      <div>
        <p className="detailValue">{t(policy.titleKey)}</p>
        <p className="metaText">
          {policy.supportedChannelTypes
            .map((channelType) =>
              formatChannelType({
                channelCatalog,
                channelType,
                fallbackKey: channelTypeKey(channelType),
                locale,
                t
              })
            )
            .join(", ")}
        </p>
        <div className="sourceList">
          <span className="badge">
            {t(egressPolicySourceKey(policy.source))}
          </span>
          <span className="badge">
            {t(egressPolicyApplyStateKey(policy.applyState))}
          </span>
          {policy.directRouteWarning ? (
            <span className="badge">
              <AlertTriangle size={14} aria-hidden="true" />
              {t("platform.egressPolicy.directWarning")}
            </span>
          ) : null}
        </div>
      </div>

      <label className="fieldStack">
        <span className="detailLabel">{t("platform.egressPolicy.route")}</span>
        <select
          className="selectInput"
          defaultValue={policy.routingMode}
          name="routingMode"
        >
          {platformEgressProviderRoutingModes.map((routingMode) => (
            <option key={routingMode} value={routingMode}>
              {t(egressProfileKindKey(routingMode))}
            </option>
          ))}
        </select>
      </label>

      <div className="egressProviderPolicyStatus">
        <DetailItem
          label={t("integrations.egress.profile")}
          value={policy.profileId}
        />
        <DetailItem
          label={t("integrations.egress.status")}
          value={
            policy.runtimeProfile
              ? t(egressStatusKey(policy.runtimeProfile.status))
              : t("common.unknown")
          }
        />
        <DetailItem
          label={t("integrations.egress.checkedAt")}
          value={formatOptionalDateTime(
            policy.runtimeProfile?.checkedAt,
            locale,
            t
          )}
        />
        {policy.updatedAt ? (
          <DetailItem
            label={t("platform.egressPolicy.updatedAt")}
            value={formatOptionalDateTime(policy.updatedAt, locale, t)}
          />
        ) : null}
      </div>

      <button className="primaryButton" type="submit">
        {t("common.save")}
      </button>
    </form>
  );
}

function PlatformMetric({
  icon,
  label,
  value
}: {
  icon: ReactNode;
  label: string;
  value: string;
}): ReactNode {
  return (
    <article className="metricCard">
      <div className="metricIcon">{icon}</div>
      <div>
        <p className="detailLabel">{label}</p>
        <p className="metricValue">{value}</p>
      </div>
    </article>
  );
}

function ManagementRow({
  label,
  value
}: {
  label: string;
  value: string;
}): ReactNode {
  return (
    <div className="managementRow">
      <span className="detailValue">{label}</span>
      <span className="badge">{value}</span>
    </div>
  );
}

function formatDeploymentType(
  deploymentType: string,
  t: ReturnType<typeof createTranslator>["t"]
): string {
  if (deploymentType === "saas_isolated") {
    return t("platform.deploymentType.saasIsolated");
  }

  if (deploymentType === "on_prem") {
    return t("platform.deploymentType.onPrem");
  }

  return t("platform.deploymentType.saasShared");
}

function egressSourceKey(
  source: InternalEgressProfileStatus["source"]
): ReturnType<typeof egressStatusKey> {
  return `integrations.egress.source.${source}` as ReturnType<
    typeof egressStatusKey
  >;
}

function egressProbeStatusKey(
  status: NonNullable<InternalEgressProfileStatus["probes"]>[number]["status"]
): ReturnType<typeof egressStatusKey> {
  return `integrations.egress.probeStatus.${status}` as ReturnType<
    typeof egressStatusKey
  >;
}

function egressPolicySourceKey(
  source: PlatformEgressProviderPolicyView["source"]
): I18nMessageKey {
  return `platform.egressPolicy.source.${source}` as I18nMessageKey;
}

function egressPolicyApplyStateKey(
  state: PlatformEgressProviderPolicyView["applyState"]
): I18nMessageKey {
  return `platform.egressPolicy.applyState.${state}` as I18nMessageKey;
}

function channelPolicySourceKey(
  source: PlatformChannelProviderPolicyView["source"]
): I18nMessageKey {
  return `platform.channelPolicy.source.${source}` as I18nMessageKey;
}

function telegramModeKey(
  mode: PlatformChannelProviderPolicyView["inboundMode"]
): I18nMessageKey {
  return `integrations.telegram.mode.${mode}` as I18nMessageKey;
}

function channelTypeKey(
  channelType:
    | PlatformEgressProviderPolicyView["supportedChannelTypes"][number]
    | PlatformChannelProviderPolicyView["channelType"]
): I18nMessageKey {
  const keys = {
    telegram_bot: "integrations.catalog.telegramBot.title",
    telegram_qr_bridge: "integrations.catalog.telegramQr.title",
    whatsapp_qr_bridge: "integrations.catalog.whatsappQr.title",
    max_qr_bridge: "integrations.catalog.maxQr.title",
    max_bot: "integrations.catalog.maxBot.title",
    vk_community: "integrations.catalog.vkCommunity.title"
  } satisfies Record<InternalChannelType, I18nMessageKey>;

  return keys[channelType];
}

function formatChannelType(input: {
  channelCatalog: readonly PlatformChannelCatalogView[];
  channelType: InternalChannelType;
  fallbackKey: I18nMessageKey;
  locale: string;
  t: ReturnType<typeof createTranslator>["t"];
}): string {
  const channel = input.channelCatalog.find(
    (item) => item.channelType === input.channelType
  );

  return channel
    ? resolveChannelTitle({
        channel,
        locale: input.locale,
        t: input.t,
        fallback: input.t(input.fallbackKey)
      })
    : input.t(input.fallbackKey);
}
