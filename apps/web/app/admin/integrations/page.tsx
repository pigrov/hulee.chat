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
import {
  CheckCircle2,
  Circle,
  Plus,
  Power,
  PowerOff,
  Trash2
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../../src/access-denied";
import { DetailItem, SlotMount } from "../../../src/app-chrome";
import { loadTenantAdminViewModel } from "../../../src/admin-view-model";
import {
  createChannelConnectorAction,
  deleteChannelConnectorAction,
  disableChannelConnectorAction,
  enableChannelConnectorAction
} from "../../../src/actions";
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
import {
  TelegramBotCatalogConnectForm,
  type TelegramBotCatalogConnectFormNotice
} from "../../../src/telegram-bot-catalog-connect-form";
import { TelegramIntegrationPanel } from "../../../src/telegram-integration-panel";
import { TenantAdminShell } from "../../../src/tenant-admin-shell";
import { navigationAccessFromTenantAdminAccess } from "../../../src/tenant-admin-nav";
import { buildActionStatusToast } from "../../../src/toast-messages";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function IntegrationsAdminPage({
  searchParams
}: {
  searchParams?: Promise<{
    channelStatus?: string;
    challengeId?: string;
    connectorId?: string;
    channelType?: string;
    connectionPendingAt?: string;
    duplicateConnectorId?: string;
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
  const connectionPendingAt = normalizeOptionalSearchParam(
    resolvedSearchParams?.connectionPendingAt
  );
  const channelStatus = normalizeOptionalSearchParam(
    resolvedSearchParams?.channelStatus
  );
  const duplicateConnectorId = normalizeOptionalSearchParam(
    resolvedSearchParams?.duplicateConnectorId
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
  const channelStatusToast =
    channelStatus && !isInlineChannelStatus(channelStatus)
      ? buildActionStatusToast({
          id: `channel-status:${channelStatus}`,
          status: channelStatus,
          titleKey: "admin.integrations.actionStatus",
          descriptionKey: channelActionStatusKey(channelStatus),
          t
        })
      : undefined;
  const selectedConnector = selectChannelConnector({
    connectors: channelConnectors.connectors,
    requestedConnectorId
  });
  const selectedConnectorId = selectedConnector?.connectorId;
  const availableChannels = channelCatalog.channels.filter(
    (channel) => channel.readiness === "available"
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
        duplicateConnectorId={duplicateConnectorId}
        locale={locale}
        status={channelStatus}
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
      toasts={channelStatusToast ? [channelStatusToast] : []}
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
                    locale={locale}
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
              {availableChannels.map((channel) => (
                <CatalogListItem
                  key={channel.channelType}
                  channel={channel}
                  current={channel.channelType === requestedChannelType}
                  locale={locale}
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

function ChannelCatalogDetailPanel({
  channel,
  duplicateConnectorId,
  locale,
  status,
  t
}: {
  channel: InternalChannelCatalogItem;
  duplicateConnectorId?: string;
  locale: string;
  status?: string;
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
          notice={telegramBotCatalogNotice({
            duplicateConnectorId,
            status,
            t
          })}
        />
      ) : (
        <form className="buttonRow" action={createChannelConnectorAction}>
          <input type="hidden" name="channelType" value={channel.channelType} />
          <button className="primaryButton" type="submit">
            <Plus size={16} aria-hidden="true" />
            {t("admin.integrations.createChannel")}
          </button>
        </form>
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
          <ChannelIcon
            channel={channel}
            channelClass={connector.channelClass}
          />
          {t(channelConnectorStatusKey(connector.status))}
        </span>
      </div>

      <GenericChannelLifecycleActions connector={connector} t={t} />

      {channel ? (
        <GenericChannelStepper
          channel={channel}
          currentStepId={step.id}
          t={t}
        />
      ) : null}

      <div className="diagnosticGrid">
        <DetailItem
          label={t("integrations.telegram.lifecycleStatus")}
          value={t(channelConnectorStatusKey(connector.status))}
        />
        <DetailItem
          label={t("integrations.channel.details.type")}
          value={
            channel
              ? resolveChannelTitle({
                  channel,
                  locale,
                  t,
                  fallback: connector.channelType
                })
              : connector.channelType
          }
        />
        <DetailItem
          label={t("integrations.channel.details.health")}
          value={t(channelHealthStatusKey(connector.healthStatus))}
        />
        {connector.diagnosticsStatus ? (
          <DetailItem
            label={t("integrations.channel.details.diagnosticsStatus")}
            value={connector.diagnosticsStatus}
          />
        ) : null}
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

function GenericChannelLifecycleActions({
  connector,
  t
}: {
  connector: InternalChannelConnectorSummary;
  t: Translator;
}): ReactNode {
  return (
    <div className="buttonRow">
      {connector.status === "disabled" ? (
        <form action={enableChannelConnectorAction}>
          <input
            type="hidden"
            name="connectorId"
            value={connector.connectorId}
          />
          <button className="secondaryButton" type="submit">
            <Power size={16} aria-hidden="true" />
            {t("integrations.channel.enableConnector")}
          </button>
        </form>
      ) : (
        <form action={disableChannelConnectorAction}>
          <input
            type="hidden"
            name="connectorId"
            value={connector.connectorId}
          />
          <button className="secondaryButton" type="submit">
            <PowerOff size={16} aria-hidden="true" />
            {t("integrations.channel.disableConnector")}
          </button>
        </form>
      )}
      <form action={deleteChannelConnectorAction}>
        <input type="hidden" name="connectorId" value={connector.connectorId} />
        <button className="dangerButton" type="submit">
          <Trash2 size={16} aria-hidden="true" />
          {t("integrations.channel.deleteConnector")}
        </button>
      </form>
    </div>
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
  locale,
  t
}: {
  connector: InternalChannelConnectorSummary;
  catalog: readonly InternalChannelCatalogItem[];
  current: boolean;
  locale: string;
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
      href={`/admin/integrations?connectorId=${encodeURIComponent(
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
  t
}: {
  channel: InternalChannelCatalogItem;
  current: boolean;
  locale: string;
  t: Translator;
}): ReactNode {
  return (
    <Link
      className="integrationListItem integrationNavLink"
      href={`/admin/integrations?channelType=${encodeURIComponent(
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

function telegramBotCatalogNotice(input: {
  duplicateConnectorId?: string;
  status?: string;
  t: Translator;
}): TelegramBotCatalogConnectFormNotice | undefined {
  if (input.status === "telegramTokenInvalid") {
    return {
      message: input.t("admin.integrations.telegramTokenInvalid"),
      variant: "error"
    };
  }

  if (input.status === "telegramTokenCheckUnavailable") {
    return {
      message: input.t("admin.integrations.telegramTokenCheckUnavailable"),
      variant: "error"
    };
  }

  if (input.status === "telegramTokenDuplicate") {
    return {
      message: input.t("admin.integrations.telegramTokenDuplicate"),
      variant: "error",
      ...(input.duplicateConnectorId
        ? {
            actionHref: `/admin/integrations?connectorId=${encodeURIComponent(
              input.duplicateConnectorId
            )}`,
            actionLabel: input.t(
              "admin.integrations.telegramTokenDuplicateLink"
            )
          }
        : {})
    };
  }

  return undefined;
}

function isInlineChannelStatus(status: string): boolean {
  return (
    status === "telegramTokenInvalid" ||
    status === "telegramTokenCheckUnavailable" ||
    status === "telegramTokenDuplicate"
  );
}

type ConnectorListBadgeState = "ok" | "error" | "disabled" | "new";

function connectorListBadgeState(
  connector: InternalChannelConnectorSummary
): ConnectorListBadgeState {
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

function channelActionStatusKey(status: string): I18nMessageKey {
  switch (status) {
    case "created":
      return "admin.integrations.actionStatus.created";
    case "enabled":
      return "admin.integrations.actionStatus.enabled";
    case "disabled":
      return "admin.integrations.actionStatus.disabled";
    case "deleted":
      return "admin.integrations.actionStatus.deleted";
    case "setupQueued":
      return "admin.integrations.actionStatus.setupQueued";
    case "diagnosticsQueued":
      return "admin.integrations.actionStatus.diagnosticsQueued";
    default:
      return "admin.integrations.actionStatus.invalid";
  }
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
