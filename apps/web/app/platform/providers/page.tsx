import { createTranslator } from "@hulee/i18n";
import { Network } from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import {
  createSqlDeploymentChannelCatalogOverrideRepository,
  createSqlDeploymentEgressProviderPolicyRepository,
  createSqlDeploymentEgressStatusRepository
} from "@hulee/db";

import { AccessDeniedPage } from "../../../src/access-denied";
import {
  canPlatformAdmin,
  navigationAccessFromSession
} from "../../../src/access";
import { PlatformEgressProviderPolicy } from "../../../src/platform-admin-components";
import { PlatformAdminShell } from "../../../src/platform-admin-shell";
import { loadPlatformChannelCatalog } from "../../../src/platform-channel-catalog";
import { loadPlatformEgressProviderPolicies } from "../../../src/platform-egress-policies";
import { loadPlatformEgressStatus } from "../../../src/platform-egress-status";
import {
  getWebDatabase,
  resolveCurrentWebAccessSession,
  resolveWebConfig
} from "../../../src/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PlatformProvidersPage(): Promise<ReactNode> {
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
  const config = resolveWebConfig();
  const egressStatus = await loadPlatformEgressStatus({
    config,
    repository: createSqlDeploymentEgressStatusRepository(database)
  });
  const channelCatalog = await loadPlatformChannelCatalog({
    repository: createSqlDeploymentChannelCatalogOverrideRepository(database)
  });
  const providerPolicies = await loadPlatformEgressProviderPolicies({
    config,
    egressStatus,
    repository: createSqlDeploymentEgressProviderPolicyRepository(database)
  });

  return (
    <PlatformAdminShell
      access={access}
      current="providers"
      t={t}
      title={t("platform.providers")}
      titleId="platform-providers-title"
    >
      <section className="settingsPanel" aria-labelledby="providers-title">
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">{t("platform.dataPlane")}</p>
            <h2 className="sectionTitle" id="providers-title">
              {t("platform.providers")}
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
    </PlatformAdminShell>
  );
}
