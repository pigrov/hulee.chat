import { createTranslator } from "@hulee/i18n";
import type { I18nMessageKey } from "@hulee/i18n";
import {
  createSqlEmployeeDirectoryRepository,
  createSqlTenantRbacRepository
} from "@hulee/db";
import type {
  InternalChannelAuthChallenge,
  InternalChannelCatalogItem,
  InternalChannelConnectorSummary,
  InternalEgressProfileStatus
} from "@hulee/contracts";
import {
  Bot,
  CheckCircle2,
  Circle,
  MessageCircle,
  Network,
  Smartphone
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../../src/access-denied";
import { DetailItem, SlotMount } from "../../../src/app-chrome";
import { loadTenantAdminViewModel } from "../../../src/admin-view-model";
import { createChannelConnectorAction } from "../../../src/actions";
import { ChannelAuthChallengePanel } from "../../../src/channel-auth-challenge-panel";
import {
  loadChannelCatalog,
  loadChannelAuthChallenge,
  loadChannelConnectors,
  loadEgressStatus,
  loadTelegramIntegration,
  type EgressStatusViewModel,
  type TelegramIntegrationViewModel
} from "../../../src/inbox-api-client";
import {
  egressProfileKindKey,
  egressStatusKey,
  resolveOverallEgressStatus
} from "../../../src/egress-formatting";
import { formatOptionalDateTime } from "../../../src/formatting";
import {
  getWebDatabase,
  resolveCurrentWebAccessSession
} from "../../../src/session";
import {
  hasEffectivePermission,
  resolveEmployeeEffectiveAccess
} from "../../../src/rbac-effective-access";
import { TelegramIntegrationPanel } from "../../../src/telegram-integration-panel";
import { TenantAdminShell } from "../../../src/tenant-admin-shell";
import { navigationAccessFromTenantAdminAccess } from "../../../src/tenant-admin-nav";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function IntegrationsAdminPage({
  searchParams
}: {
  searchParams?: Promise<{
    challengeId?: string;
    connectorId?: string;
  }>;
}): Promise<ReactNode> {
  const access = await resolveCurrentWebAccessSession();

  if (access === null) {
    redirect("/login");
  }

  const database = getWebDatabase();
  const employeeRepository = createSqlEmployeeDirectoryRepository(database);
  const rbacRepository = createSqlTenantRbacRepository(database);
  const accessSnapshot = await resolveEmployeeEffectiveAccess({
    tenantId: access.tenantId,
    employeeId: access.employeeId,
    employeeRepository,
    rbacRepository
  });

  if (!hasEffectivePermission(accessSnapshot, "modules.manage")) {
    const adminAccess = {
      session: access,
      effectiveAccess: accessSnapshot
    };

    return (
      <AccessDeniedPage
        current="tenant-admin"
        navigationAccess={navigationAccessFromTenantAdminAccess(adminAccess)}
      />
    );
  }

  const internalApiAccess = {
    effectivePermissionOverride: "modules.manage" as const
  };
  const resolvedSearchParams = await searchParams;
  const requestedConnectorId = normalizeOptionalSearchParam(
    resolvedSearchParams?.connectorId
  );
  const requestedChallengeId = normalizeOptionalSearchParam(
    resolvedSearchParams?.challengeId
  );
  const [model, channelCatalog, channelConnectors, egressStatus] =
    await Promise.all([
      loadTenantAdminViewModel({ tenantId: access.tenantId, database }),
      loadChannelCatalog(internalApiAccess),
      loadChannelConnectors(internalApiAccess),
      loadEgressStatus(internalApiAccess)
    ]);
  const { t, locale } = createTranslator(model.tenant.locale);
  const selectedConnector = selectChannelConnector({
    connectors: channelConnectors.connectors,
    requestedConnectorId
  });
  const selectedConnectorId = selectedConnector?.connectorId;
  const telegramChannel = channelCatalog.channels.find(
    (channel) => channel.channelType === "telegram_bot"
  );
  const integrationContent =
    selectedConnector?.channelType === "telegram_bot" || !selectedConnector ? (
      <TelegramIntegrationPanel
        channel={telegramChannel}
        integration={
          selectedConnector?.channelType === "telegram_bot"
            ? await loadTelegramIntegration(internalApiAccess, {
                connectorId: selectedConnector.connectorId
              })
            : createEmptyTelegramIntegrationViewModel()
        }
        locale={locale}
        t={t}
      />
    ) : (
      <GenericChannelConnectorPanel
        catalog={channelCatalog.channels}
        challenge={
          selectedConnector.channelClass === "user_bridge" &&
          requestedChallengeId
            ? await loadOptionalChannelAuthChallenge({
                challengeId: requestedChallengeId,
                connectorId: selectedConnector.connectorId,
                options: internalApiAccess
              })
            : undefined
        }
        connector={selectedConnector}
        locale={locale}
        t={t}
      />
    );

  return (
    <TenantAdminShell
      access={access}
      brand={model.tenant.brand}
      current="integrations"
      effectiveAccess={accessSnapshot}
      t={t}
      tenantDisplayName={model.tenant.displayName}
      title={t("admin.integrations")}
      titleId="admin-title"
    >
      <div className="adminIntegrationGrid">
        <aside
          className="settingsPanel integrationCatalog"
          aria-labelledby="integration-channel-list-title"
        >
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.integrations.channels")}</p>
              <h2 className="sectionTitle" id="integration-channel-list-title">
                {t("admin.integrations.channelList")}
              </h2>
            </div>
          </div>

          <nav
            className="integrationList"
            aria-label={t("admin.integrations.channelList")}
          >
            <div className="integrationListGroup">
              <h3 className="detailLabel">
                {t("admin.integrations.connectedChannels")}
              </h3>
              {channelConnectors.connectors.length > 0 ? (
                channelConnectors.connectors.map((connector) => (
                  <ConnectorListItem
                    key={connector.connectorId}
                    connector={connector}
                    catalog={channelCatalog.channels}
                    current={connector.connectorId === selectedConnectorId}
                    t={t}
                  />
                ))
              ) : (
                <p className="metaText">
                  {t("admin.integrations.noConnectedChannels")}
                </p>
              )}
            </div>
            <div className="integrationListGroup">
              <h3 className="detailLabel">
                {t("admin.integrations.availableChannels")}
              </h3>
              {channelCatalog.channels.map((channel) => (
                <CatalogListItem
                  key={channel.channelType}
                  channel={channel}
                  t={t}
                />
              ))}
            </div>
          </nav>
        </aside>

        <div className="adminStack">
          {integrationContent}
          <EgressStatusPanel
            egressStatus={egressStatus}
            locale={locale}
            t={t}
          />
          <SlotMount slot="integration.settings.section" />
        </div>
      </div>
    </TenantAdminShell>
  );
}

type Translator = ReturnType<typeof createTranslator>["t"];

function EgressStatusPanel({
  egressStatus,
  locale,
  t
}: {
  egressStatus: EgressStatusViewModel;
  locale: string;
  t: Translator;
}): ReactNode {
  const overallStatus = resolveOverallEgressStatus(egressStatus.profiles);

  return (
    <section className="settingsPanel" aria-labelledby="egress-status-title">
      <div className="sectionHeader">
        <div>
          <p className="eyebrow">{t("admin.integrations.egress")}</p>
          <h2 className="sectionTitle" id="egress-status-title">
            {t("admin.integrations.egressStatus")}
          </h2>
          <p className="metaText">
            {t("admin.integrations.egressDescription")}
          </p>
        </div>
        <span className="badge">
          <Network size={14} aria-hidden="true" />
          {t(egressStatusKey(overallStatus))}
        </span>
      </div>

      {egressStatus.profiles.length > 0 ? (
        <div className="integrationList">
          {egressStatus.profiles.map((profile) => (
            <EgressProfileStatusRow
              key={profile.profileId}
              locale={locale}
              profile={profile}
              t={t}
            />
          ))}
        </div>
      ) : (
        <p className="metaText">{t("integrations.egress.empty")}</p>
      )}
    </section>
  );
}

function EgressProfileStatusRow({
  locale,
  profile,
  t
}: {
  locale: string;
  profile: InternalEgressProfileStatus;
  t: Translator;
}): ReactNode {
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
        label={t("integrations.egress.checkedAt")}
        value={formatOptionalDateTime(profile.checkedAt, locale, t)}
      />
      <DetailItem
        label={t("integrations.egress.source")}
        value={t(egressSourceKey(profile.source))}
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
        label={t("integrations.egress.providers")}
        value={formatList(profile.supportedProviders, t)}
      />
      <DetailItem
        label={t("integrations.egress.channelTypes")}
        value={formatList(profile.supportedChannelTypes, t)}
      />
      {profile.lastErrorCode ? (
        <DetailItem
          label={t("integrations.egress.error")}
          value={profile.lastErrorCode}
        />
      ) : null}
      {profile.operatorHint ? (
        <DetailItem
          label={t("integrations.egress.operatorHint")}
          value={profile.operatorHint}
        />
      ) : null}
      {profile.alerts && profile.alerts.length > 0 ? (
        <DetailItem
          label={t("integrations.egress.alerts")}
          value={profile.alerts.map((alert) => alert.code).join(", ")}
        />
      ) : null}
      {profile.probes && profile.probes.length > 0 ? (
        <DetailItem
          label={t("integrations.egress.probes")}
          value={profile.probes
            .map((probe) =>
              [
                probe.name,
                t(egressProbeStatusKey(probe.status)),
                probe.latencyMs === undefined
                  ? undefined
                  : `${probe.latencyMs} ms`
              ]
                .filter(Boolean)
                .join(" / ")
            )
            .join("; ")}
        />
      ) : null}
    </div>
  );
}

function formatList(
  values: readonly string[] | undefined,
  t: Translator
): string {
  return values && values.length > 0 ? values.join(", ") : t("common.unknown");
}

function GenericChannelConnectorPanel({
  catalog,
  challenge,
  connector,
  locale,
  t
}: {
  catalog: readonly InternalChannelCatalogItem[];
  challenge?: InternalChannelAuthChallenge;
  connector: InternalChannelConnectorSummary;
  locale: string;
  t: Translator;
}): ReactNode {
  const channel = catalog.find(
    (item) => item.channelType === connector.channelType
  );
  const step = resolveGenericChannelStep({ channel, challenge, connector });

  return (
    <section className="settingsPanel" aria-labelledby="channel-detail-title">
      <div className="sectionHeader">
        <div>
          <p className="eyebrow">{t("admin.integrations.channelSettings")}</p>
          <h2 className="sectionTitle" id="channel-detail-title">
            {connector.displayName}
          </h2>
        </div>
        <span className="badge">
          <ChannelIcon channelClass={connector.channelClass} />
          {t(channelConnectorStatusKey(connector.status))}
        </span>
      </div>

      {channel ? (
        <GenericChannelStepper
          channel={channel}
          currentStepId={step.id}
          t={t}
        />
      ) : null}

      <div className="diagnosticGrid">
        <DetailItem
          label={t("integrations.channel.details.type")}
          value={
            channel
              ? t(channel.titleKey as I18nMessageKey)
              : connector.channelType
          }
        />
        <DetailItem
          label={t("integrations.channel.details.health")}
          value={t(channelHealthStatusKey(connector.healthStatus))}
        />
        <DetailItem
          label={t("integrations.channel.details.provider")}
          value={connector.provider}
        />
        <DetailItem
          label={t("integrations.channel.details.class")}
          value={t(channelClassKey(connector.channelClass))}
        />
      </div>

      {isAuthChallengeStep(step.kind) ? (
        <ChannelAuthChallengePanel
          challenge={challenge}
          challengeType={resolveChallengeType({
            challenge,
            stepKind: step.kind
          })}
          connectorId={connector.connectorId}
          locale={locale}
          stepKind={step.kind}
          t={t}
        />
      ) : null}
    </section>
  );
}

function GenericChannelStepper({
  channel,
  currentStepId,
  t
}: {
  channel: InternalChannelCatalogItem;
  currentStepId: string;
  t: Translator;
}): ReactNode {
  const currentIndex = channel.onboarding.steps.findIndex(
    (step) => step.id === currentStepId
  );
  const normalizedCurrentIndex = currentIndex >= 0 ? currentIndex : 0;

  return (
    <ol
      className="setupStepList"
      aria-label={t("integrations.channel.onboardingFlow")}
    >
      {channel.onboarding.steps.map((step, index) => {
        const state =
          index < normalizedCurrentIndex
            ? "complete"
            : step.id === currentStepId
              ? "current"
              : "pending";

        return (
          <li className="setupStep" data-state={state} key={step.id}>
            <span className="setupStepMarker" aria-hidden="true">
              {state === "complete" ? (
                <CheckCircle2 size={16} />
              ) : (
                <Circle size={16} />
              )}
            </span>
            <span className="setupStepLabel">
              {t(step.titleKey as I18nMessageKey)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ConnectorListItem({
  connector,
  catalog,
  current,
  t
}: {
  connector: InternalChannelConnectorSummary;
  catalog: readonly InternalChannelCatalogItem[];
  current: boolean;
  t: Translator;
}): ReactNode {
  const channel = catalog.find(
    (item) => item.channelType === connector.channelType
  );

  return (
    <Link
      className="integrationListItem integrationNavLink"
      href={`/admin/integrations?connectorId=${encodeURIComponent(
        connector.connectorId
      )}`}
      aria-current={current ? "page" : undefined}
    >
      <span className="metricIcon">
        <ChannelIcon channelClass={connector.channelClass} />
      </span>
      <div>
        <h3 className="listItemTitle">{connector.displayName}</h3>
        <p className="metaText">
          {[
            channel
              ? t(channel.titleKey as I18nMessageKey)
              : connector.provider,
            t(channelConnectorStatusKey(connector.status))
          ].join(" / ")}
        </p>
      </div>
      <span className="badge">
        {t(channelHealthStatusKey(connector.healthStatus))}
      </span>
    </Link>
  );
}

function CatalogListItem({
  channel,
  t
}: {
  channel: InternalChannelCatalogItem;
  t: Translator;
}): ReactNode {
  const content = (
    <>
      <span className="metricIcon">
        <ChannelIcon channelClass={channel.channelClass} />
      </span>
      <div>
        <h3 className="listItemTitle">
          {t(channel.titleKey as I18nMessageKey)}
        </h3>
        <p className="metaText">
          {t(channel.descriptionKey as I18nMessageKey)}
        </p>
      </div>
      <span className="badge">{t(channelReadinessKey(channel.readiness))}</span>
    </>
  );

  if (channel.readiness !== "available") {
    return (
      <div className="integrationListItem" aria-disabled="true">
        {content}
      </div>
    );
  }

  return (
    <form className="integrationListForm" action={createChannelConnectorAction}>
      <input type="hidden" name="channelType" value={channel.channelType} />
      <button className="integrationListItem integrationNavLink" type="submit">
        {content}
      </button>
    </form>
  );
}

function ChannelIcon({
  channelClass
}: {
  channelClass: InternalChannelCatalogItem["channelClass"];
}): ReactNode {
  switch (channelClass) {
    case "bot_bridge":
      return <Bot size={18} aria-hidden="true" />;
    case "user_bridge":
      return <Smartphone size={18} aria-hidden="true" />;
    case "official_api":
      return <MessageCircle size={18} aria-hidden="true" />;
  }
}

function channelReadinessKey(
  readiness: InternalChannelCatalogItem["readiness"]
): I18nMessageKey {
  return `integrations.channel.readiness.${readiness}` as I18nMessageKey;
}

function channelConnectorStatusKey(
  status: InternalChannelConnectorSummary["status"]
): I18nMessageKey {
  return `integrations.channel.status.${status}` as I18nMessageKey;
}

function channelHealthStatusKey(
  status: InternalChannelConnectorSummary["healthStatus"]
): I18nMessageKey {
  return `integrations.channel.health.${status}` as I18nMessageKey;
}

function egressSourceKey(
  source: InternalEgressProfileStatus["source"]
): I18nMessageKey {
  return `integrations.egress.source.${source}` as I18nMessageKey;
}

function egressProbeStatusKey(
  status: NonNullable<InternalEgressProfileStatus["probes"]>[number]["status"]
): I18nMessageKey {
  return `integrations.egress.probeStatus.${status}` as I18nMessageKey;
}

function channelClassKey(
  channelClass: InternalChannelConnectorSummary["channelClass"]
): I18nMessageKey {
  return `integrations.channel.class.${channelClass}` as I18nMessageKey;
}

function selectChannelConnector(input: {
  connectors: readonly InternalChannelConnectorSummary[];
  requestedConnectorId?: string;
}): InternalChannelConnectorSummary | undefined {
  if (input.requestedConnectorId) {
    const requested = input.connectors.find(
      (connector) => connector.connectorId === input.requestedConnectorId
    );

    if (requested) {
      return requested;
    }
  }

  return (
    input.connectors.find(
      (connector) => connector.channelType === "telegram_bot"
    ) ?? input.connectors[0]
  );
}

async function loadOptionalChannelAuthChallenge(input: {
  challengeId: string;
  connectorId: string;
  options: { effectivePermissionOverride: "modules.manage" };
}): Promise<InternalChannelAuthChallenge | undefined> {
  try {
    const response = await loadChannelAuthChallenge(
      {
        challengeId: input.challengeId,
        connectorId: input.connectorId
      },
      input.options
    );

    return response.challenge;
  } catch {
    return undefined;
  }
}

function resolveGenericChannelStep(input: {
  challenge?: InternalChannelAuthChallenge;
  channel: InternalChannelCatalogItem | undefined;
  connector: InternalChannelConnectorSummary;
}): {
  id: string;
  kind: InternalChannelCatalogItem["onboarding"]["steps"][number]["kind"];
} {
  const challengeStepKind = resolveChallengeStepKind(input.challenge);

  if (challengeStepKind) {
    return (
      findStepByKind(input.channel, challengeStepKind) ?? {
        id: challengeStepKind,
        kind: challengeStepKind
      }
    );
  }

  if (input.connector.status === "connected") {
    return (
      findStepByKind(input.channel, "complete") ?? {
        id: "complete",
        kind: "complete"
      }
    );
  }

  return (
    findStepByKind(input.channel, "qr_code") ??
    findStepByKind(input.channel, "phone_number") ??
    findStepByKind(input.channel, "waiting") ?? {
      id: "waiting",
      kind: "waiting"
    }
  );
}

function resolveChallengeStepKind(
  challenge: InternalChannelAuthChallenge | undefined
):
  | "qr_code"
  | "phone_number"
  | "verification_code"
  | "password"
  | "waiting"
  | "complete"
  | undefined {
  if (!challenge) {
    return undefined;
  }

  if (challenge.status === "succeeded") {
    return "complete";
  }

  if (challenge.status === "requires_code") {
    return "verification_code";
  }

  if (challenge.status === "requires_password") {
    return "password";
  }

  if (
    (challenge.status === "pending" || challenge.status === "waiting") &&
    challenge.challengeType === "qr"
  ) {
    return "qr_code";
  }

  if (challenge.status === "pending" || challenge.status === "waiting") {
    return "waiting";
  }

  return undefined;
}

function findStepByKind(
  channel: InternalChannelCatalogItem | undefined,
  kind: InternalChannelCatalogItem["onboarding"]["steps"][number]["kind"]
):
  | {
      id: string;
      kind: InternalChannelCatalogItem["onboarding"]["steps"][number]["kind"];
    }
  | undefined {
  return channel?.onboarding.steps.find((step) => step.kind === kind);
}

function isAuthChallengeStep(
  kind: InternalChannelCatalogItem["onboarding"]["steps"][number]["kind"]
): kind is
  | "qr_code"
  | "phone_number"
  | "verification_code"
  | "password"
  | "waiting"
  | "complete" {
  return (
    kind === "qr_code" ||
    kind === "phone_number" ||
    kind === "verification_code" ||
    kind === "password" ||
    kind === "waiting" ||
    kind === "complete"
  );
}

function resolveChallengeType(input: {
  challenge?: InternalChannelAuthChallenge;
  stepKind:
    | "qr_code"
    | "phone_number"
    | "verification_code"
    | "password"
    | "waiting"
    | "complete";
}): InternalChannelAuthChallenge["challengeType"] {
  if (input.challenge) {
    return input.challenge.challengeType;
  }

  if (
    input.stepKind === "phone_number" ||
    input.stepKind === "verification_code"
  ) {
    return "phone_code";
  }

  if (input.stepKind === "password") {
    return "password";
  }

  if (input.stepKind === "qr_code") {
    return "qr";
  }

  return "reauth";
}

function normalizeOptionalSearchParam(
  value: string | undefined
): string | undefined {
  const normalized = value?.trim();

  return normalized && normalized.length > 0 ? normalized : undefined;
}

function createEmptyTelegramIntegrationViewModel(): TelegramIntegrationViewModel {
  return {
    moduleId: "channel-telegram",
    enabled: false,
    diagnostics: {
      status: "disabled",
      checkedAt: new Date().toISOString(),
      checks: {
        moduleEnabled: false,
        configValid: false,
        inboundWebhookReady: false,
        outboundEnabled: false,
        botTokenSecretRefConfigured: false
      }
    }
  };
}
