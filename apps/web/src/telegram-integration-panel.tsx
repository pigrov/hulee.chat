import type { createTranslator, I18nMessageKey } from "@hulee/i18n";
import { Plug, Power, PowerOff, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import {
  deleteChannelConnectorAction,
  disableChannelConnectorAction,
  enableChannelConnectorAction
} from "./actions";
import { DetailItem } from "./app-chrome";
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
import { TelegramConnectionForm } from "./telegram-connection-form";

type Translator = ReturnType<typeof createTranslator>["t"];
type TelegramConfig = NonNullable<TelegramIntegrationViewModel["config"]>;

export function TelegramIntegrationPanel({
  integration,
  locale,
  t
}: {
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
          <span className="badge">
            <Plug size={14} aria-hidden="true" />
            {t("integrations.telegram.noConnectorStatus")}
          </span>
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
          <span className="badge">
            <Plug size={14} aria-hidden="true" />
            {integration.status
              ? t(channelConnectorStatusKey(integration.status))
              : t(telegramStatusKey(integration.diagnostics.status))}
          </span>
        </div>

        <div className="buttonRow">
          <TelegramLifecycleActions integration={integration} t={t} />
        </div>

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
            {t("integrations.telegram.title")}
          </h2>
        </div>
        <span className="badge">
          <Plug size={14} aria-hidden="true" />
          {integration.status
            ? t(channelConnectorStatusKey(integration.status))
            : t(telegramStatusKey(integration.diagnostics.status))}
        </span>
      </div>

      <TelegramCredentialsStep
        config={config}
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
  integration,
  t
}: {
  config: TelegramConfig;
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
      connectorId={connectorId}
      defaultDisplayName={telegramDisplayName(integration, t)}
      diagnostics={{
        checkedAt: integration.diagnostics.checkedAt,
        botApiReachable: integration.diagnostics.checks.botApiReachable
      }}
      labels={{
        botToken: t("integrations.telegram.botToken"),
        botTokenAlreadySaved: t("integrations.telegram.botTokenAlreadySaved"),
        botTokenPlaceholder: t("integrations.telegram.botTokenPlaceholder"),
        checking: t("integrations.telegram.connectionChecking"),
        connectBot: t("integrations.telegram.connectBot"),
        connecting: t("integrations.telegram.connectionConnecting"),
        connectionDescription: t("integrations.telegram.connectionDescription"),
        failed: t("integrations.telegram.connectionFailed"),
        saveAndCheck: t("integrations.telegram.saveAndCheck"),
        slow: t("integrations.telegram.connectionSlow"),
        statusUpdated: t("integrations.telegram.connectionStatusUpdated"),
        displayName: t("integrations.telegram.displayName")
      }}
      lifecycleActions={
        <TelegramLifecycleActions integration={integration} t={t} />
      }
    />
  );
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
    <div className="diagnosticGrid">
      <DetailItem
        label={t("integrations.telegram.runtimeInboundReceivedAt")}
        value={formatOptionalDateTime(inbound?.lastReceivedAt, locale, t)}
      />
      <DetailItem
        label={t("integrations.telegram.runtimeOutboundSentAt")}
        value={formatOptionalDateTime(outbound?.lastSentAt, locale, t)}
      />
    </div>
  );
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
  return (
    <>
      {integration.status === "disabled" ? (
        <form action={enableChannelConnectorAction}>
          <ConnectorIdField integration={integration} />
          <button className="secondaryButton" type="submit">
            <Power size={16} aria-hidden="true" />
            {t("integrations.telegram.enableConnector")}
          </button>
        </form>
      ) : (
        <form action={disableChannelConnectorAction}>
          <ConnectorIdField integration={integration} />
          <button className="secondaryButton" type="submit">
            <PowerOff size={16} aria-hidden="true" />
            {t("integrations.telegram.disableConnector")}
          </button>
        </form>
      )}
      <form action={deleteChannelConnectorAction}>
        <ConnectorIdField integration={integration} />
        <button className="dangerButton" type="submit">
          <Trash2 size={16} aria-hidden="true" />
          {t("integrations.telegram.deleteConnector")}
        </button>
      </form>
    </>
  );
}

function ConnectorIdField({
  integration
}: {
  integration: TelegramIntegrationViewModel;
}): ReactNode {
  return integration.connectorId ? (
    <input type="hidden" name="connectorId" value={integration.connectorId} />
  ) : null;
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
