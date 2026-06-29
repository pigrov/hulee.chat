import { defaultBrandProfile } from "@hulee/branding";
import { createTranslator } from "@hulee/i18n";
import type { InternalEgressProfileStatus } from "@hulee/contracts";
import { createSqlDeploymentEgressStatusRepository } from "@hulee/db";
import {
  AlertTriangle,
  Boxes,
  Building2,
  KeyRound,
  Network,
  Server,
  ShieldCheck
} from "lucide-react";
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
import { loadPlatformEgressStatus } from "../../src/platform-egress-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PlatformAdminPage(): Promise<ReactNode> {
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
  const deploymentType = webConfig.deploymentType;
  const publicBaseUrl = webConfig.publicBaseUrl ?? "http://127.0.0.1:3001";
  const egressStatus = await loadPlatformEgressStatus({
    config: webConfig,
    repository: createSqlDeploymentEgressStatusRepository(getWebDatabase())
  });
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
