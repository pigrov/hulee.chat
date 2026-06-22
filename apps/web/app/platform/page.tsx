import { defaultBrandProfile } from "@hulee/branding";
import { createTranslator } from "@hulee/i18n";
import {
  Boxes,
  Building2,
  Gauge,
  KeyRound,
  Server,
  ShieldCheck
} from "lucide-react";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../src/access-denied";
import {
  canPlatformAdmin,
  navigationAccessFromSession,
  resolveWebAccessSession
} from "../../src/access";
import { AppFrame, DetailItem } from "../../src/app-chrome";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function PlatformAdminPage(): ReactNode {
  const access = resolveWebAccessSession();

  if (!canPlatformAdmin(access)) {
    return (
      <AccessDeniedPage
        current="platform-admin"
        navigationAccess={navigationAccessFromSession(access)}
      />
    );
  }

  const { t } = createTranslator("ru");
  const deploymentType = process.env.HULEE_DEPLOYMENT_TYPE ?? "saas_shared";
  const publicBaseUrl =
    process.env.HULEE_PUBLIC_BASE_URL ?? "http://127.0.0.1:3001";

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
              icon={<Gauge size={18} aria-hidden="true" />}
              label={t("platform.usage")}
              value={t("platform.status.deferred")}
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
