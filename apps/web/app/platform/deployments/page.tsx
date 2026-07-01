import { createTranslator } from "@hulee/i18n";
import { Server } from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../../src/access-denied";
import {
  canPlatformAdmin,
  navigationAccessFromSession
} from "../../../src/access";
import { DetailItem } from "../../../src/app-chrome";
import { formatDeploymentType } from "../../../src/platform-admin-components";
import { PlatformAdminShell } from "../../../src/platform-admin-shell";
import {
  resolveCurrentWebAccessSession,
  resolveWebConfig
} from "../../../src/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PlatformDeploymentsPage(): Promise<ReactNode> {
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

  const { t } = createTranslator("ru");
  const webConfig = resolveWebConfig();
  const publicBaseUrl = webConfig.publicBaseUrl ?? "http://127.0.0.1:3001";

  return (
    <PlatformAdminShell
      access={access}
      current="deployments"
      t={t}
      title={t("platform.deployments")}
      titleId="platform-deployments-title"
    >
      <section className="settingsPanel" aria-labelledby="deployments-title">
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
            value={formatDeploymentType(webConfig.deploymentType, t)}
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
    </PlatformAdminShell>
  );
}
