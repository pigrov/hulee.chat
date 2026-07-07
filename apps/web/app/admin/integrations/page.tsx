import { createTranslator } from "@hulee/i18n";
import type { I18nMessageKey } from "@hulee/i18n";
import {
  createSqlEmployeeDirectoryRepository,
  createSqlTenantRbacRepository
} from "@hulee/db";
import type {
  InternalChannelAuthChallenge,
  InternalChannelCatalogItem,
  InternalChannelConnectorSummary
} from "@hulee/contracts";
import { Activity, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../../src/access-denied";
import { SlotMount } from "../../../src/app-chrome";
import { loadTenantAdminViewModel } from "../../../src/admin-view-model";
import { ChannelConnectorCreateForm } from "../../../src/channel-connector-create-form";
import { ChannelConnectorLifecycleActions } from "../../../src/channel-connector-lifecycle-actions";
import { ChannelAuthChallengePanel } from "../../../src/channel-auth-challenge-panel";
import {
  ChannelIcon,
  resolveChannelDescription,
  resolveChannelShortDescription,
  resolveChannelTitle
} from "../../../src/channel-display";
import {
  loadChannelCatalog,
  loadChannelAuthChallenge,
  loadChannelConnectors,
  loadTelegramIntegration,
  type TelegramIntegrationViewModel
} from "../../../src/inbox-api-client";
import {
  getWebDatabase,
  resolveCurrentWebAccessSession
} from "../../../src/session";
import { MarkdownContent } from "../../../src/markdown";
import {
  hasEffectivePermission,
  resolveEmployeeEffectiveAccess
} from "../../../src/rbac-effective-access";
import { TelegramBotCatalogConnectForm } from "../../../src/telegram-bot-catalog-connect-form";
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
    channelType?: string;
    connectionPendingAt?: string;
    tab?: string;
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
  const requestedChannelType = normalizeOptionalSearchParam(
    resolvedSearchParams?.channelType
  );
  const requestedTab = normalizeIntegrationsTab(resolvedSearchParams?.tab);
  const connectionPendingAt = normalizeOptionalSearchParam(
    resolvedSearchParams?.connectionPendingAt
  );
  const requestedChallengeId = normalizeOptionalSearchParam(
    resolvedSearchParams?.challengeId
  );
  const [model, channelCatalog, channelConnectors] = await Promise.all([
    loadTenantAdminViewModel({ tenantId: access.tenantId, database }),
    loadChannelCatalog(internalApiAccess),
    loadChannelConnectors(internalApiAccess)
  ]);
  const { t, locale } = createTranslator(model.tenant.locale);
  const selectedConnector = selectChannelConnector({
    connectors: channelConnectors.connectors,
    requestedConnectorId
  });
  const currentTab =
    selectedConnector?.channelClass === "user_bridge"
      ? "accounts"
      : selectedConnector
        ? "channels"
        : (requestedTab ?? "channels");
  const displayedConnectors = channelConnectors.connectors.filter(
    (connector) =>
      currentTab === "accounts"
        ? connector.channelClass === "user_bridge"
        : connector.channelClass !== "user_bridge"
  );
  const selectedConnectorId = selectedConnector?.connectorId;
  const availableChannels = channelCatalog.channels.filter(
    (channel) =>
      channel.readiness === "available" &&
      (currentTab === "accounts"
        ? channel.channelClass === "user_bridge"
        : channel.channelClass !== "user_bridge")
  );
  const selectedCatalogChannel =
    selectedConnector === undefined && requestedChannelType
      ? availableChannels.find(
          (channel) => channel.channelType === requestedChannelType
        )
      : undefined;
  const selectedTelegramIntegration =
    selectedConnector?.channelType === "telegram_bot"
      ? await loadTelegramIntegration(internalApiAccess, {
          connectorId: selectedConnector.connectorId
        })
      : undefined;
  const integrationContent =
    selectedConnector?.channelType === "telegram_bot" ? (
      <TelegramIntegrationPanel
        integration={
          selectedTelegramIntegration ??
          createEmptyTelegramIntegrationViewModel()
        }
        initialConnectionSubmittedAt={
          selectedConnector.connectorId === requestedConnectorId
            ? connectionPendingAt
            : undefined
        }
        locale={locale}
        t={t}
      />
    ) : selectedConnector ? (
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
    ) : selectedCatalogChannel ? (
      <ChannelCatalogDetailPanel
        channel={selectedCatalogChannel}
        locale={locale}
        tab={currentTab}
        t={t}
      />
    ) : (
      <NoChannelSelectedPanel t={t} />
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
              <h2 className="sectionTitle" id="integration-channel-list-title">
                {t("admin.integrations.channelList")}
              </h2>
            </div>
          </div>

          <nav
            className="integrationTabNav"
            aria-label={t("admin.integrations.tabs")}
          >
            <Link
              className="secondaryButton integrationTabLink"
              href="/admin/integrations?tab=channels"
              aria-current={currentTab === "channels" ? "page" : undefined}
            >
              {t("admin.integrations.tab.channels")}
            </Link>
            <Link
              className="secondaryButton integrationTabLink"
              href="/admin/integrations?tab=accounts"
              aria-current={currentTab === "accounts" ? "page" : undefined}
            >
              {t("admin.integrations.tab.accounts")}
            </Link>
          </nav>

          <nav
            className="integrationList"
            aria-label={t("admin.integrations.channelList")}
          >
            <div className="integrationListGroup">
              <h3 className="detailLabel">
                {t(connectedGroupTitleKey(currentTab))}
              </h3>
              {displayedConnectors.length > 0 ? (
                displayedConnectors.map((connector) => (
                  <ConnectorListItem
                    key={connector.connectorId}
                    connector={connector}
                    catalog={channelCatalog.channels}
                    current={connector.connectorId === selectedConnectorId}
                    locale={locale}
                    tab={currentTab}
                    t={t}
                  />
                ))
              ) : (
                <p className="metaText">
                  {t(emptyConnectedGroupKey(currentTab))}
                </p>
              )}
            </div>
            <div className="integrationListGroup">
              <h3 className="detailLabel">
                {t(availableGroupTitleKey(currentTab))}
              </h3>
              {availableChannels.map((channel) => (
                <CatalogListItem
                  key={channel.channelType}
                  channel={channel}
                  current={channel.channelType === requestedChannelType}
                  locale={locale}
                  tab={currentTab}
                  t={t}
                />
              ))}
            </div>
          </nav>
        </aside>

        <div className="adminStack">
          {integrationContent}
          <SlotMount slot="integration.settings.section" />
        </div>
      </div>
    </TenantAdminShell>
  );
}

type Translator = ReturnType<typeof createTranslator>["t"];
type IntegrationsTab = "channels" | "accounts";

function normalizeIntegrationsTab(
  value: string | undefined
): IntegrationsTab | undefined {
  return value === "accounts" || value === "channels" ? value : undefined;
}

function connectedGroupTitleKey(tab: IntegrationsTab): I18nMessageKey {
  return (
    tab === "accounts"
      ? "admin.integrations.connectedAccounts"
      : "admin.integrations.connectedChannels"
  ) as I18nMessageKey;
}

function availableGroupTitleKey(tab: IntegrationsTab): I18nMessageKey {
  return (
    tab === "accounts"
      ? "admin.integrations.availableAccounts"
      : "admin.integrations.availableChannels"
  ) as I18nMessageKey;
}

function emptyConnectedGroupKey(tab: IntegrationsTab): I18nMessageKey {
  return (
    tab === "accounts"
      ? "admin.integrations.noConnectedAccounts"
      : "admin.integrations.noConnectedChannels"
  ) as I18nMessageKey;
}

function ChannelCatalogDetailPanel({
  channel,
  locale,
  tab,
  t
}: {
  channel: InternalChannelCatalogItem;
  locale: string;
  tab: IntegrationsTab;
  t: Translator;
}): ReactNode {
  const title = resolveChannelTitle({
    channel,
    locale,
    t,
    fallback: channel.channelType
  });
  const description = resolveChannelDescription({ channel, locale, t });

  return (
    <section className="settingsPanel" aria-label={title}>
      <MarkdownContent value={description} />

      {channel.channelType === "telegram_bot" ? (
        <TelegramBotCatalogConnectForm
          channelType="telegram_bot"
          labels={{
            botToken: t("integrations.telegram.botToken"),
            botTokenPlaceholder: t("integrations.telegram.botTokenPlaceholder"),
            connect: t("admin.integrations.connectChannel"),
            connecting: t("integrations.telegram.connectionConnecting"),
            invalidToken: t("integrations.telegram.invalidTokenFormat")
          }}
          messages={{
            duplicateLink: t("admin.integrations.telegramTokenDuplicateLink"),
            invalid: t("admin.integrations.actionStatus.invalid"),
            telegramTokenCheckUnavailable: t(
              "admin.integrations.telegramTokenCheckUnavailable"
            ),
            telegramTokenDuplicate: t(
              "admin.integrations.telegramTokenDuplicate"
            ),
            telegramTokenInvalid: t("admin.integrations.telegramTokenInvalid")
          }}
        />
      ) : (
        <ChannelConnectorCreateForm
          channelType={channel.channelType}
          label={t("admin.integrations.createChannel")}
          messages={{
            created: t("admin.integrations.actionStatus.created"),
            email_verification_required: t(
              "auth.emailVerification.status.required"
            ),
            invalid: t("admin.integrations.actionStatus.invalid"),
            permission_denied: t("admin.roles.actionStatus.permissionDenied")
          }}
          redirectTab={tab}
        />
      )}
    </section>
  );
}

function NoChannelSelectedPanel({ t }: { t: Translator }): ReactNode {
  return (
    <section className="settingsPanel" aria-labelledby="channel-empty-title">
      <div className="sectionHeader">
        <div>
          <p className="eyebrow">{t("admin.integrations.channelSettings")}</p>
          <h2 className="sectionTitle" id="channel-empty-title">
            {t("admin.integrations.selectChannel")}
          </h2>
          <p className="metaText">
            {t("admin.integrations.selectChannelDescription")}
          </p>
        </div>
      </div>
    </section>
  );
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
  const authStepKind = isAuthChallengeStep(step.kind) ? step.kind : undefined;
  const connectionState = genericChannelConnectionState(connector);
  const problemMessage = genericChannelProblemMessage(connector, t);
  const pendingDirectQrAuth =
    connector.channelClass === "user_bridge" &&
    connector.status !== "connected" &&
    connector.status !== "disabled" &&
    connector.status !== "deleted" &&
    authStepKind === "qr_code";
  const showAuthChallenge =
    connector.status !== "connected" &&
    connector.status !== "disabled" &&
    connector.status !== "deleted" &&
    authStepKind !== undefined;

  return (
    <section className="settingsPanel" aria-labelledby="channel-detail-title">
      <div className="sectionHeader">
        <div>
          <p className="eyebrow">{t("admin.integrations.channelSettings")}</p>
          <h2 className="sectionTitle" id="channel-detail-title">
            {connector.displayName}
          </h2>
        </div>
        <GenericChannelConnectionBadge state={connectionState} t={t} />
      </div>

      {pendingDirectQrAuth ? null : (
        <div className="telegramConnectionActions">
          <GenericChannelLifecycleActions connector={connector} t={t} />
        </div>
      )}

      {!pendingDirectQrAuth && problemMessage ? (
        <p
          className="telegramConnectionNotice"
          data-variant="error"
          role="status"
        >
          {problemMessage}
        </p>
      ) : null}

      {pendingDirectQrAuth ? null : (
        <GenericChannelCompactStatus connector={connector} t={t} />
      )}

      {showAuthChallenge ? (
        <ChannelAuthChallengePanel
          autoStart={pendingDirectQrAuth && challenge === undefined}
          cancelDeletesConnector={pendingDirectQrAuth}
          channelType={connector.channelType}
          challenge={challenge}
          challengeType={resolveChallengeType({
            challenge,
            stepKind: authStepKind
          })}
          connectorId={connector.connectorId}
          locale={locale}
          stepKind={authStepKind}
          t={t}
        />
      ) : null}
    </section>
  );
}

type GenericChannelConnectionState = "ok" | "error" | "new";

function GenericChannelConnectionBadge({
  state,
  t
}: {
  state: GenericChannelConnectionState;
  t: Translator;
}): ReactNode {
  return (
    <span className="telegramConnectionBadge" data-state={state}>
      {t(`integrations.channel.connectionBadge.${state}` as I18nMessageKey)}
    </span>
  );
}

function genericChannelConnectionState(
  connector: InternalChannelConnectorSummary
): GenericChannelConnectionState {
  if (connector.activeAuthChallenge) {
    return "new";
  }

  if (
    connector.status === "failed" ||
    connector.status === "degraded" ||
    connector.status === "reauth_required" ||
    connector.healthStatus === "degraded" ||
    connector.healthStatus === "unhealthy"
  ) {
    return "error";
  }

  if (connector.status === "connected") {
    return "ok";
  }

  return "new";
}

function genericChannelProblemMessage(
  connector: InternalChannelConnectorSummary,
  t: Translator
): string | undefined {
  if (connector.status === "reauth_required") {
    return t("integrations.channel.connectionProblem.reauthRequired");
  }

  if (connector.status === "failed") {
    return t("integrations.channel.connectionProblem.failed");
  }

  if (
    connector.status === "degraded" ||
    connector.healthStatus === "degraded"
  ) {
    return t("integrations.channel.connectionProblem.degraded");
  }

  if (connector.healthStatus === "unhealthy") {
    return t("integrations.channel.connectionProblem.unhealthy");
  }

  return undefined;
}

function GenericChannelCompactStatus({
  connector,
  t
}: {
  connector: InternalChannelConnectorSummary;
  t: Translator;
}): ReactNode {
  return (
    <div className="telegramStatusCard">
      <h3 className="telegramStatusTitle">
        {t("integrations.channel.connectionStatusTitle")}
      </h3>
      <GenericChannelStatusMetric
        icon="status"
        label={t("integrations.channel.connectionMetric.status")}
        value={t(channelConnectorStatusKey(connector.status))}
      />
      <GenericChannelStatusMetric
        icon="health"
        label={t("integrations.channel.connectionMetric.health")}
        value={t(channelHealthStatusKey(connector.healthStatus))}
      />
    </div>
  );
}

function GenericChannelStatusMetric({
  icon,
  label,
  value
}: {
  icon: "health" | "status";
  label: string;
  value: string;
}): ReactNode {
  const Icon = icon === "status" ? Activity : ShieldCheck;

  return (
    <div className="telegramStatusMetric">
      <span className="telegramStatusIcon" aria-hidden="true">
        <Icon size={22} />
      </span>
      <span className="telegramStatusBody">
        <span className="telegramStatusLabel">{label}</span>
        <strong className="telegramStatusValue">{value}</strong>
      </span>
    </div>
  );
}

function GenericChannelLifecycleActions({
  connector,
  t
}: {
  connector: InternalChannelConnectorSummary;
  t: Translator;
}): ReactNode {
  return (
    <ChannelConnectorLifecycleActions
      connectorId={connector.connectorId}
      labels={{
        deleteConnector: t("integrations.channel.deleteConnector"),
        disableConnector: t("integrations.channel.disableConnector"),
        enableConnector: t("integrations.channel.enableConnector")
      }}
      messages={{
        deleted: t("admin.integrations.actionStatus.deleted"),
        disabled: t("admin.integrations.actionStatus.disabled"),
        enabled: t("admin.integrations.actionStatus.enabled"),
        invalid: t("admin.integrations.actionStatus.invalid")
      }}
      status={connector.status}
    />
  );
}

function ConnectorListItem({
  connector,
  catalog,
  current,
  locale,
  tab,
  t
}: {
  connector: InternalChannelConnectorSummary;
  catalog: readonly InternalChannelCatalogItem[];
  current: boolean;
  locale: string;
  tab: IntegrationsTab;
  t: Translator;
}): ReactNode {
  const channel = catalog.find(
    (item) => item.channelType === connector.channelType
  );
  const channelTypeTitle = channel
    ? resolveChannelTitle({
        channel,
        locale,
        t,
        fallback: connector.channelType
      })
    : connector.channelType;
  const badgeState = connectorListBadgeState(connector);

  return (
    <Link
      className="integrationListItem integrationNavLink"
      href={`/admin/integrations?tab=${tab}&connectorId=${encodeURIComponent(
        connector.connectorId
      )}`}
      aria-current={current ? "page" : undefined}
    >
      <span className="metricIcon">
        <ChannelIcon
          channel={channel}
          channelClass={connector.channelClass}
          size="large"
        />
      </span>
      <div className="integrationListText">
        <h3 className="listItemTitle" title={connector.displayName}>
          {connector.displayName}
        </h3>
        <p className="metaText integrationListType" title={channelTypeTitle}>
          {channelTypeTitle}
        </p>
      </div>
      <span className="integrationListBadges">
        <span className="channelStatusBadge" data-state={badgeState}>
          {t(connectorListBadgeKey(badgeState))}
        </span>
      </span>
    </Link>
  );
}

function CatalogListItem({
  channel,
  current,
  locale,
  tab,
  t
}: {
  channel: InternalChannelCatalogItem;
  current: boolean;
  locale: string;
  tab: IntegrationsTab;
  t: Translator;
}): ReactNode {
  return (
    <Link
      className="integrationListItem integrationNavLink"
      href={`/admin/integrations?tab=${tab}&channelType=${encodeURIComponent(
        channel.channelType
      )}`}
      aria-current={current ? "page" : undefined}
    >
      <span className="metricIcon">
        <ChannelIcon channel={channel} size="large" />
      </span>
      <div>
        <h3 className="listItemTitle">
          {resolveChannelTitle({
            channel,
            locale,
            t,
            fallback: channel.channelType
          })}
        </h3>
        <p className="metaText">
          {resolveChannelShortDescription({ channel, locale, t })}
        </p>
      </div>
    </Link>
  );
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

type ConnectorListBadgeState = "ok" | "error" | "disabled" | "new";

function connectorListBadgeState(
  connector: InternalChannelConnectorSummary
): ConnectorListBadgeState {
  if (connector.activeAuthChallenge) {
    return "new";
  }

  if (
    connector.status === "failed" ||
    connector.status === "degraded" ||
    connector.status === "reauth_required" ||
    connector.healthStatus === "degraded" ||
    connector.healthStatus === "unhealthy"
  ) {
    return "error";
  }

  if (connector.status === "connected") {
    return "ok";
  }

  if (connector.status === "disabled") {
    return "disabled";
  }

  return "new";
}

function connectorListBadgeKey(state: ConnectorListBadgeState): I18nMessageKey {
  return `admin.integrations.connectorBadge.${state}` as I18nMessageKey;
}

function selectChannelConnector(input: {
  connectors: readonly InternalChannelConnectorSummary[];
  requestedConnectorId?: string;
}): InternalChannelConnectorSummary | undefined {
  if (!input.requestedConnectorId) {
    return undefined;
  }

  return input.connectors.find(
    (connector) => connector.connectorId === input.requestedConnectorId
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
