import { createTranslator } from "@hulee/i18n";
import { Network } from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../../src/access-denied";
import {
  canPlatformAdmin,
  navigationAccessFromSession
} from "../../../src/access";
import {
  egressStatusKey,
  resolveOverallEgressStatus
} from "../../../src/egress-formatting";
import { PlatformEgressProfile } from "../../../src/platform-admin-components";
import { PlatformAdminShell } from "../../../src/platform-admin-shell";
import { loadPlatformEgressStatus } from "../../../src/platform-egress-status";
import {
  getWebDatabase,
  resolveCurrentWebAccessSession,
  resolveWebConfig
} from "../../../src/session";
import { createSqlDeploymentEgressStatusRepository } from "@hulee/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PlatformEgressPage(): Promise<ReactNode> {
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
  const egressStatus = await loadPlatformEgressStatus({
    config: resolveWebConfig(),
    repository: createSqlDeploymentEgressStatusRepository(database)
  });
  const overallStatus = resolveOverallEgressStatus(egressStatus.profiles);

  return (
    <PlatformAdminShell
      access={access}
      current="egress"
      t={t}
      title={t("platform.egress")}
      titleId="platform-egress-title"
    >
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
            {t(egressStatusKey(overallStatus))}
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
    </PlatformAdminShell>
  );
}
