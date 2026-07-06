import { createTranslator } from "@hulee/i18n";
import { Network } from "lucide-react";
import Link from "next/link";
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
import { resolveChannelTitle } from "../../../src/channel-display";
import {
  egressProfileKindKey,
  egressStatusKey
} from "../../../src/egress-formatting";
import { PlatformEgressProviderPolicy } from "../../../src/platform-admin-components";
import { PlatformAdminShell } from "../../../src/platform-admin-shell";
import {
  loadPlatformChannelCatalog,
  type PlatformChannelCatalogView
} from "../../../src/platform-channel-catalog";
import {
  loadPlatformEgressProviderPolicies,
  type PlatformEgressProviderPolicyView
} from "../../../src/platform-egress-policies";
import { loadPlatformEgressStatus } from "../../../src/platform-egress-status";
import {
  getWebDatabase,
  resolveCurrentWebAccessSession,
  resolveWebConfig
} from "../../../src/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Translator = ReturnType<typeof createTranslator>["t"];

export default async function PlatformProvidersPage({
  searchParams
}: {
  searchParams?: Promise<{
    provider?: string;
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
  const config = resolveWebConfig();
  const [resolvedSearchParams, egressStatus, channelCatalog] =
    await Promise.all([
      searchParams,
      loadPlatformEgressStatus({
        config,
        repository: createSqlDeploymentEgressStatusRepository(database)
      }),
      loadPlatformChannelCatalog({
        repository: createSqlDeploymentChannelCatalogOverrideRepository(database)
      })
    ]);
  const providerPolicies = await loadPlatformEgressProviderPolicies({
    config,
    egressStatus,
    repository: createSqlDeploymentEgressProviderPolicyRepository(database)
  });
  const requestedProvider = normalizeOptionalSearchParam(
    resolvedSearchParams?.provider
  );
  const selectedPolicy =
    providerPolicies.find((policy) => policy.provider === requestedProvider) ??
    providerPolicies[0];

  return (
    <PlatformAdminShell
      access={access}
      current="providers"
      t={t}
      title={t("platform.providers")}
      titleId="platform-providers-title"
    >
      <div className="adminIntegrationGrid">
        <aside
          className="settingsPanel integrationCatalog"
          aria-labelledby="platform-provider-list-title"
        >
          <div className="sectionHeader">
            <div>
              <h2 className="sectionTitle" id="platform-provider-list-title">
                {t("platform.providers")}
              </h2>
            </div>
          </div>

          <nav
            className="integrationList"
            aria-label={t("platform.providers")}
          >
            {providerPolicies.length > 0 ? (
              providerPolicies.map((policy) => (
                <ProviderListItem
                  key={policy.provider}
                  channelCatalog={channelCatalog}
                  current={policy.provider === selectedPolicy?.provider}
                  locale={locale}
                  policy={policy}
                  t={t}
                />
              ))
            ) : (
              <p className="metaText">{t("platform.providersEmpty")}</p>
            )}
          </nav>
        </aside>

        <div className="adminStack adminSectionContent">
          {selectedPolicy ? (
            <ProviderSettingsPanel
              channelCatalog={channelCatalog}
              locale={locale}
              policy={selectedPolicy}
              t={t}
            />
          ) : (
            <section className="settingsPanel">
              <p className="metaText">{t("platform.providersEmpty")}</p>
            </section>
          )}
        </div>
      </div>
    </PlatformAdminShell>
  );
}

function ProviderListItem({
  channelCatalog,
  current,
  locale,
  policy,
  t
}: {
  channelCatalog: readonly PlatformChannelCatalogView[];
  current: boolean;
  locale: string;
  policy: PlatformEgressProviderPolicyView;
  t: Translator;
}): ReactNode {
  return (
    <Link
      className="integrationListItem integrationNavLink"
      href={`/platform/providers?provider=${encodeURIComponent(
        policy.provider
      )}`}
      aria-current={current ? "page" : undefined}
    >
      <span className="metricIcon">
        <Network size={24} strokeWidth={1.2} aria-hidden="true" />
      </span>
      <div className="integrationListText">
        <h3 className="listItemTitle">{t(policy.titleKey)}</h3>
        <p className="metaText integrationListType">
          {formatSupportedChannels({
            channelCatalog,
            locale,
            policy,
            t
          })}
        </p>
      </div>
      <span className="integrationListBadges">
        <span
          className="channelStatusBadge"
          data-state={policy.applyState === "current" ? "ok" : "new"}
        >
          {t(egressProfileKindKey(policy.routingMode))}
        </span>
      </span>
    </Link>
  );
}

function ProviderSettingsPanel({
  channelCatalog,
  locale,
  policy,
  t
}: {
  channelCatalog: readonly PlatformChannelCatalogView[];
  locale: string;
  policy: PlatformEgressProviderPolicyView;
  t: Translator;
}): ReactNode {
  return (
    <section className="settingsPanel" aria-labelledby="provider-title">
      <div className="sectionHeader">
        <div>
          <p className="eyebrow">{t("platform.dataPlane")}</p>
          <h2 className="sectionTitle" id="provider-title">
            {t(policy.titleKey)}
          </h2>
          <p className="metaText">
            {t("platform.egressProviderRoutingDescription")}
          </p>
        </div>
        <span className="badge">
          <Network size={14} aria-hidden="true" />
          {policy.runtimeProfile
            ? t(egressStatusKey(policy.runtimeProfile.status))
            : t("common.unknown")}
        </span>
      </div>

      <div className="managementList">
        <PlatformEgressProviderPolicy
          channelCatalog={channelCatalog}
          locale={locale}
          policy={policy}
          t={t}
        />
      </div>
    </section>
  );
}

function formatSupportedChannels(input: {
  channelCatalog: readonly PlatformChannelCatalogView[];
  locale: string;
  policy: PlatformEgressProviderPolicyView;
  t: Translator;
}): string {
  return input.policy.supportedChannelTypes
    .map((channelType) => {
      const channel = input.channelCatalog.find(
        (item) => item.channelType === channelType
      );

      return channel
        ? resolveChannelTitle({
            channel,
            locale: input.locale,
            t: input.t,
            fallback: channelType
          })
        : channelType;
    })
    .join(", ");
}

function normalizeOptionalSearchParam(
  value: string | undefined
): string | undefined {
  const normalized = value?.trim();

  return normalized && normalized.length > 0 ? normalized : undefined;
}
