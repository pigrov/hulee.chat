import type { createTranslator, I18nMessageKey } from "@hulee/i18n";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { ReactNode } from "react";

import { DetailItem } from "./app-chrome";
import { ChannelConnectorLifecycleActions } from "./channel-connector-lifecycle-actions";
import {
  formatBoolean,
  formatOptionalBoolean,
  formatOptionalDateTime,
  formatOptionalValue,
  formatTelegramBotIdentity,
  telegramStatusKey
} from "./formatting";
import { egressProfileKindKey, egressStatusKey } from "./egress-formatting";
import type { TelegramIntegrationViewModel } from "./inbox-api-client";
import { LocalDateTime } from "./local-date-time";
import { TelegramConnectionForm } from "./telegram-connection-form";

type Translator = ReturnType<typeof createTranslator>["t"];
type TelegramConfig = NonNullable<TelegramIntegrationViewModel["config"]>;

export function TelegramIntegrationPanel({
  initialConnectionSubmittedAt,
  integration,
  locale,
  t
}: {
  initialConnectionSubmittedAt?: string;
  integration: TelegramIntegrationViewModel;
  locale: string;
  t: Translator;
}): ReactNode {
  const config = integration.config;

  if (!integration.connectorId) {
    return (
      <section
        className="settingsPanel"
        aria-labelledby="telegram-integration-title"
      >
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">{t("admin.integrations.channelSettings")}</p>
            <h2 className="sectionTitle" id="telegram-integration-title">
              {t("integrations.telegram.title")}
            </h2>
          </div>
          <TelegramConnectionStateBadge state="new" t={t} />
        </div>
        <p className="metaText">{t("integrations.telegram.noConnector")}</p>
      </section>
    );
  }

  if (!config) {
    return (
      <section
        className="settingsPanel"
        aria-labelledby="telegram-integration-title"
      >
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">{t("admin.integrations.channelSettings")}</p>
            <h2 className="sectionTitle" id="telegram-integration-title">
              {telegramDisplayName(integration, t)}
            </h2>
          </div>
          <TelegramConnectionStateBadge
            state={telegramConnectionState(integration, t)}
            t={t}
          />
        </div>

        <div className="buttonRow">
          <TelegramLifecycleActions integration={integration} t={t} />
        </div>

        <TelegramConnectorProblemMessage integration={integration} t={t} />

        <TelegramConnectorCompactStatus
          integration={integration}
          locale={locale}
          t={t}
        />
      </section>
    );
  }

  return (
    <section
      className="settingsPanel"
      aria-labelledby="telegram-integration-title"
    >
      <div className="sectionHeader">
        <div>
          <p className="eyebrow">{t("admin.integrations.channelSettings")}</p>
          <h2 className="sectionTitle" id="telegram-integration-title">
            {telegramDisplayName(integration, t)}
          </h2>
        </div>
        <TelegramConnectionStateBadge
          state={telegramConnectionState(integration, t)}
          t={t}
        />
      </div>

      <TelegramCredentialsStep
        config={config}
        initialConnectionSubmittedAt={initialConnectionSubmittedAt}
        integration={integration}
        t={t}
      />

      <TelegramConnectorCompactStatus
        integration={integration}
        locale={locale}
        t={t}
      />
    </section>
  );
}

function TelegramCredentialsStep({
  config,
  initialConnectionSubmittedAt,
  integration,
  t
}: {
  config: TelegramConfig;
  initialConnectionSubmittedAt?: string;
  integration: TelegramIntegrationViewModel;
  t: Translator;
}): ReactNode {
  const connectorId = integration.connectorId;

  if (!connectorId) {
    return null;
  }

  return (
    <TelegramConnectionForm
      botTokenSecretRef={config.botTokenSecretRef}
      channelExternalId={config.channelExternalId}
      connectionProblemMessage={telegramProblemMessage(integration, t)}
      connectorId={connectorId}
      defaultDisplayName={telegramDisplayName(integration, t)}
      diagnostics={{
        checkedAt: integration.diagnostics.checkedAt,
        botApiReachable: integration.diagnostics.checks.botApiReachable,
        botFirstName: integration.diagnostics.bot?.firstName,
        botUsername: integration.diagnostics.bot?.username,
        status: integration.diagnostics.status
      }}
      initialSubmittedAt={initialConnectionSubmittedAt}
      labels={{
        botToken: t("integrations.telegram.botToken"),
        botTokenAlreadySaved: t("integrations.telegram.botTokenAlreadySaved"),
        botTokenPlaceholder: t("integrations.telegram.botTokenPlaceholder"),
        botTokenSavedPlaceholder: t(
          "integrations.telegram.botTokenSavedPlaceholder"
        ),
        checking: t("integrations.telegram.connectionChecking"),
        connectBot: t("integrations.telegram.connectBot"),
        connecting: t("integrations.telegram.connectionConnecting"),
        connectionDescription: t("integrations.telegram.connectionDescription"),
        failed: t("integrations.telegram.connectionFailed"),
        saveAndCheck: t("integrations.telegram.saveAndCheck"),
        saveChanges: t("integrations.telegram.saveChanges"),
        saved: t("integrations.telegram.connectionSaved"),
        slow: t("integrations.telegram.connectionSlow"),
        statusUpdated: t("integrations.telegram.connectionStatusUpdated"),
        displayName: t("integrations.telegram.displayName"),
        editToken: t("integrations.telegram.editToken")
      }}
      lifecycleActions={
        <TelegramLifecycleActions integration={integration} t={t} />
      }
      mode={config.mode}
      outboundEnabled={config.outboundEnabled}
    />
  );
}

type TelegramConnectionState = "ok" | "error" | "new";

function TelegramConnectionStateBadge({
  state,
  t
}: {
  state: TelegramConnectionState;
  t: Translator;
}): ReactNode {
  return (
    <span className="telegramConnectionBadge" data-state={state}>
      {t(`integrations.telegram.connectionBadge.${state}` as I18nMessageKey)}
    </span>
  );
}

function telegramConnectionState(
  integration: TelegramIntegrationViewModel,
  t: Translator
): TelegramConnectionState {
  if (telegramProblemMessage(integration, t)) {
    return "error";
  }

  if (integration.status === "connected") {
    return "ok";
  }

  return "new";
}

export function TelegramConnectorCompactStatus({
  integration,
  locale,
  t
}: {
  integration: TelegramIntegrationViewModel;
  locale: string;
  t: Translator;
}): ReactNode {
  const inbound = integration.diagnostics.runtime?.inbound;
  const outbound = integration.diagnostics.runtime?.outbound;

  return (
    <div className="telegramStatusCard">
      <h3 className="telegramStatusTitle">
        {t("integrations.telegram.connectionStatusTitle")}
      </h3>
      <div className="telegramStatusMetrics">
        <TelegramStatusMetric
          icon="inbound"
          label={t("integrations.telegram.runtimeInboundReceivedAt")}
          locale={locale}
          value={inbound?.lastReceivedAt}
          fallback={formatOptionalDateTime(inbound?.lastReceivedAt, locale, t)}
        />
        <TelegramStatusMetric
          icon="outbound"
          label={t("integrations.telegram.runtimeOutboundSentAt")}
          locale={locale}
          value={outbound?.lastSentAt}
          fallback={formatOptionalDateTime(outbound?.lastSentAt, locale, t)}
        />
      </div>
    </div>
  );
}

function TelegramConnectorProblemMessage({
  integration,
  t
}: {
  integration: TelegramIntegrationViewModel;
  t: Translator;
}): ReactNode {
  const problemMessage = telegramProblemMessage(integration, t);

  return problemMessage ? (
    <p className="telegramConnectionNotice" data-variant="error" role="status">
      {problemMessage}
    </p>
  ) : null;
}

function TelegramStatusMetric({
  fallback,
  icon,
  label,
  locale,
  value
}: {
  fallback: string;
  icon: "inbound" | "outbound";
  label: string;
  locale: string;
  value?: string;
}): ReactNode {
  const Icon = icon === "inbound" ? ArrowDown : ArrowUp;

  return (
    <div className="telegramStatusMetric">
      <span className="telegramStatusIcon" aria-hidden="true">
        <Icon size={22} />
      </span>
      <span className="telegramStatusBody">
        <span className="telegramStatusLabel">{label}</span>
        <strong className="telegramStatusValue">
          <LocalDateTime fallback={fallback} locale={locale} value={value} />
        </strong>
      </span>
    </div>
  );
}

function telegramProblemMessage(
  integration: TelegramIntegrationViewModel,
  t: Translator
): string | undefined {
  const diagnostics = integration.diagnostics;
  const inbound = diagnostics.runtime?.inbound;
  const outbound = diagnostics.runtime?.outbound;

  if (
    diagnostics.status === "configured" &&
    !diagnostics.lastErrorCode &&
    !hasCurrentRuntimeFailure({
      checkedAt: diagnostics.checkedAt,
      errorCode: inbound?.lastErrorCode,
      failedAt: inbound?.lastFailedAt,
      resolvedAt: [inbound?.lastReceivedAt, inbound?.lastAcceptedAt]
    }) &&
    !hasCurrentRuntimeFailure({
      checkedAt: diagnostics.checkedAt,
      errorCode: outbound?.lastErrorCode,
      failedAt: outbound?.lastFailedAt,
      resolvedAt: [outbound?.lastSentAt]
    })
  ) {
    return undefined;
  }

  if (
    diagnostics.checks.botTokenSecretRefConfigured === false ||
    diagnostics.checks.botTokenResolved === false
  ) {
    return t("integrations.telegram.problem.tokenMissing");
  }

  if (
    diagnostics.egress?.required &&
    diagnostics.egress.status !== "ready" &&
    diagnostics.egress.status !== "unknown"
  ) {
    return t("integrations.telegram.problem.egressNotReady");
  }

  if (diagnostics.status === "webhook_mismatch") {
    return t("integrations.telegram.problem.webhookMismatch");
  }

  if (diagnostics.status === "invalid_config") {
    return t("integrations.telegram.problem.invalidConfig");
  }

  if (diagnostics.lastErrorCode === "provider.permanent_failure") {
    return t("integrations.telegram.problem.providerRejected");
  }

  if (diagnostics.lastErrorCode === "provider.temporary_failure") {
    return t("integrations.telegram.problem.providerTemporary");
  }

  if (
    hasCurrentRuntimeFailure({
      checkedAt: diagnostics.checkedAt,
      errorCode: inbound?.lastErrorCode,
      failedAt: inbound?.lastFailedAt,
      resolvedAt: [inbound?.lastReceivedAt, inbound?.lastAcceptedAt]
    })
  ) {
    return t("integrations.telegram.problem.inboundFailed");
  }

  if (
    hasCurrentRuntimeFailure({
      checkedAt: diagnostics.checkedAt,
      errorCode: outbound?.lastErrorCode,
      failedAt: outbound?.lastFailedAt,
      resolvedAt: [outbound?.lastSentAt]
    })
  ) {
    return t("integrations.telegram.problem.outboundFailed");
  }

  if (diagnostics.status === "provider_unreachable") {
    return t("integrations.telegram.problem.providerUnavailable");
  }

  return undefined;
}

function hasCurrentRuntimeFailure(input: {
  checkedAt: string;
  errorCode?: string;
  failedAt?: string;
  resolvedAt: Array<string | undefined>;
}): boolean {
  if (!input.errorCode || !input.failedAt) {
    return false;
  }

  const failedAt = Date.parse(input.failedAt);
  const resolvedAt = [
    Date.parse(input.checkedAt),
    ...input.resolvedAt.map((value) => (value ? Date.parse(value) : NaN))
  ].filter(Number.isFinite);

  if (!Number.isFinite(failedAt)) {
    return false;
  }

  return failedAt > Math.max(...resolvedAt);
}

export function TelegramDiagnosticsGrid({
  integration,
  locale,
  t
}: {
  integration: TelegramIntegrationViewModel;
  locale: string;
  t: Translator;
}): ReactNode {
  const egress = integration.diagnostics.egress;
  const inbound = integration.diagnostics.runtime?.inbound;
  const outbound = integration.diagnostics.runtime?.outbound;
  const recentFailedUpdate =
    integration.diagnostics.polling?.recentFailedUpdates?.[0];

  return (
    <div className="diagnosticGrid">
      <DetailItem
        label={t("integrations.telegram.lifecycleStatus")}
        value={
          integration.status
            ? t(channelConnectorStatusKey(integration.status))
            : t("common.unknown")
        }
      />
      <DetailItem
        label={t("integrations.telegram.providerStatus")}
        value={t(telegramStatusKey(integration.diagnostics.status))}
      />
      <DetailItem
        label={t("integrations.egress.status")}
        value={egress ? t(egressStatusKey(egress.status)) : t("common.unknown")}
      />
      <DetailItem
        label={t("integrations.egress.profileKind")}
        value={
          egress?.profileKind
            ? t(egressProfileKindKey(egress.profileKind))
            : t("common.unknown")
        }
      />
      <DetailItem
        label={t("integrations.egress.profile")}
        value={formatOptionalValue(egress?.profileId, t)}
      />
      <DetailItem
        label={t("integrations.egress.checkedAt")}
        value={formatOptionalDateTime(egress?.checkedAt, locale, t)}
      />
      <DetailItem
        label={t("integrations.telegram.configValid")}
        value={formatBoolean(integration.diagnostics.checks.configValid, t)}
      />
      <DetailItem
        label={t("integrations.telegram.inboundWebhookReady")}
        value={formatBoolean(
          integration.diagnostics.checks.inboundWebhookReady,
          t
        )}
      />
      <DetailItem
        label={t("integrations.telegram.secretConfigured")}
        value={formatBoolean(
          integration.diagnostics.checks.botTokenSecretRefConfigured,
          t
        )}
      />
      <DetailItem
        label={t("integrations.telegram.tokenResolved")}
        value={formatOptionalBoolean(
          integration.diagnostics.checks.botTokenResolved,
          t
        )}
      />
      <DetailItem
        label={t("integrations.telegram.botApiReachable")}
        value={formatOptionalBoolean(
          integration.diagnostics.checks.botApiReachable,
          t
        )}
      />
      <DetailItem
        label={t("integrations.telegram.webhookMatchesConfig")}
        value={formatOptionalBoolean(
          integration.diagnostics.checks.webhookMatchesConfig,
          t
        )}
      />
      <DetailItem
        label={t("integrations.telegram.botIdentity")}
        value={formatTelegramBotIdentity(integration, t)}
      />
      <DetailItem
        label={t("integrations.telegram.actualWebhookUrl")}
        value={formatOptionalValue(
          integration.diagnostics.webhook?.actualUrl,
          t
        )}
      />
      <DetailItem
        label={t("integrations.telegram.pendingUpdates")}
        value={formatOptionalValue(
          integration.diagnostics.webhook?.pendingUpdateCount,
          t
        )}
      />
      <DetailItem
        label={t("integrations.telegram.pollingLastUpdate")}
        value={formatOptionalValue(
          integration.diagnostics.polling?.lastUpdateId,
          t
        )}
      />
      <DetailItem
        label={t("integrations.telegram.pollingLastRunAt")}
        value={formatOptionalDateTime(
          integration.diagnostics.polling?.lastRunAt,
          locale,
          t
        )}
      />
      <DetailItem
        label={t("integrations.telegram.pollingReceived")}
        value={formatOptionalValue(
          integration.diagnostics.polling?.receivedUpdateCount,
          t
        )}
      />
      <DetailItem
        label={t("integrations.telegram.pollingAccepted")}
        value={formatOptionalValue(
          integration.diagnostics.polling?.acceptedUpdateCount,
          t
        )}
      />
      <DetailItem
        label={t("integrations.telegram.pollingFailed")}
        value={formatOptionalValue(
          integration.diagnostics.polling?.failedUpdateCount,
          t
        )}
      />
      <DetailItem
        label={t("integrations.telegram.pollingRecentFailure")}
        value={formatPollingFailedUpdate(recentFailedUpdate, locale, t)}
      />
      <DetailItem
        label={t("integrations.telegram.runtimeInboundSource")}
        value={
          inbound?.lastSource
            ? t(telegramRuntimeInboundSourceKey(inbound.lastSource))
            : t("common.unknown")
        }
      />
      <DetailItem
        label={t("integrations.telegram.runtimeInboundReceivedAt")}
        value={formatOptionalDateTime(inbound?.lastReceivedAt, locale, t)}
      />
      <DetailItem
        label={t("integrations.telegram.runtimeInboundAcceptedAt")}
        value={formatOptionalDateTime(inbound?.lastAcceptedAt, locale, t)}
      />
      <DetailItem
        label={t("integrations.telegram.runtimeInboundFailedAt")}
        value={formatOptionalDateTime(inbound?.lastFailedAt, locale, t)}
      />
      <DetailItem
        label={t("integrations.telegram.runtimeInboundUpdateId")}
        value={formatOptionalValue(inbound?.lastUpdateId, t)}
      />
      <DetailItem
        label={t("integrations.telegram.runtimeInboundProviderMessageId")}
        value={formatOptionalValue(inbound?.lastProviderMessageId, t)}
      />
      <DetailItem
        label={t("integrations.telegram.runtimeInboundBatch")}
        value={formatRuntimeBatch(inbound, t)}
      />
      <DetailItem
        label={t("integrations.telegram.runtimeOutboundSentAt")}
        value={formatOptionalDateTime(outbound?.lastSentAt, locale, t)}
      />
      <DetailItem
        label={t("integrations.telegram.runtimeOutboundFailedAt")}
        value={formatOptionalDateTime(outbound?.lastFailedAt, locale, t)}
      />
      <DetailItem
        label={t("integrations.telegram.runtimeOutboundMessageId")}
        value={formatOptionalValue(outbound?.lastMessageId, t)}
      />
      <DetailItem
        label={t("integrations.telegram.runtimeOutboundProviderMessageId")}
        value={formatOptionalValue(outbound?.lastProviderMessageId, t)}
      />
      {inbound?.lastErrorCode ? (
        <DetailItem
          label={t("integrations.telegram.runtimeInboundError")}
          value={inbound.lastErrorCode}
        />
      ) : null}
      {outbound?.lastErrorCode ? (
        <DetailItem
          label={t("integrations.telegram.runtimeOutboundError")}
          value={outbound.lastErrorCode}
        />
      ) : null}
      {integration.diagnostics.operatorHint ? (
        <DetailItem
          label={t("integrations.telegram.operatorHint")}
          value={integration.diagnostics.operatorHint}
        />
      ) : null}
      {egress?.operatorHint ? (
        <DetailItem
          label={t("integrations.egress.operatorHint")}
          value={egress.operatorHint}
        />
      ) : null}
      {inbound?.operatorHint ? (
        <DetailItem
          label={t("integrations.telegram.runtimeInboundHint")}
          value={inbound.operatorHint}
        />
      ) : null}
      {outbound?.operatorHint ? (
        <DetailItem
          label={t("integrations.telegram.runtimeOutboundHint")}
          value={outbound.operatorHint}
        />
      ) : null}
    </div>
  );
}

function TelegramLifecycleActions({
  integration,
  t
}: {
  integration: TelegramIntegrationViewModel;
  t: Translator;
}): ReactNode {
  if (!integration.connectorId) {
    return null;
  }

  return (
    <ChannelConnectorLifecycleActions
      connectorId={integration.connectorId}
      labels={{
        deleteConnector: t("integrations.telegram.deleteConnector"),
        disableConnector: t("integrations.telegram.disableConnector"),
        enableConnector: t("integrations.telegram.enableConnector")
      }}
      messages={{
        deleted: t("admin.integrations.actionStatus.deleted"),
        disabled: t("admin.integrations.actionStatus.disabled"),
        enabled: t("admin.integrations.actionStatus.enabled"),
        invalid: t("admin.integrations.actionStatus.invalid")
      }}
      status={integration.status}
    />
  );
}

function telegramDisplayName(
  integration: TelegramIntegrationViewModel,
  t: Translator
): string {
  return integration.displayName ?? t("integrations.telegram.title");
}

function channelConnectorStatusKey(
  status: NonNullable<TelegramIntegrationViewModel["status"]>
): I18nMessageKey {
  return `integrations.channel.status.${status}` as I18nMessageKey;
}

function telegramRuntimeInboundSourceKey(
  source: "webhook" | "polling"
): I18nMessageKey {
  return `integrations.telegram.runtimeInboundSource.${source}` as I18nMessageKey;
}

function formatRuntimeBatch(
  inbound:
    | NonNullable<
        TelegramIntegrationViewModel["diagnostics"]["runtime"]
      >["inbound"]
    | undefined,
  t: Translator
): string {
  if (
    inbound?.lastBatchReceivedCount === undefined &&
    inbound?.lastBatchAcceptedCount === undefined &&
    inbound?.lastBatchFailedCount === undefined
  ) {
    return t("common.unknown");
  }

  return [
    inbound.lastBatchReceivedCount ?? 0,
    inbound.lastBatchAcceptedCount ?? 0,
    inbound.lastBatchFailedCount ?? 0
  ].join(" / ");
}

function formatPollingFailedUpdate(
  failedUpdate:
    | NonNullable<
        NonNullable<
          TelegramIntegrationViewModel["diagnostics"]["polling"]
        >["recentFailedUpdates"]
      >[number]
    | undefined,
  locale: string,
  t: Translator
): string {
  if (!failedUpdate) {
    return t("common.unknown");
  }

  return [
    t("integrations.telegram.pollingFailureUpdate", {
      id: failedUpdate.updateId
    }),
    failedUpdate.providerMessageId
      ? t("integrations.telegram.pollingFailureMessage", {
          id: failedUpdate.providerMessageId
        })
      : undefined,
    failedUpdate.updateType,
    failedUpdate.contentTypes?.join(", "),
    failedUpdate.errorCode,
    formatOptionalDateTime(failedUpdate.failedAt, locale, t)
  ]
    .filter(Boolean)
    .join(" / ");
}
