import type { createTranslator, I18nMessageKey } from "@hulee/i18n";
import type { InternalChannelCatalogItem } from "@hulee/contracts";
import {
  Activity,
  CheckCircle2,
  Circle,
  KeyRound,
  LinkIcon,
  Plug,
  Power,
  PowerOff,
  Settings2,
  Trash2,
  Unlink
} from "lucide-react";
import type { ReactNode } from "react";

import {
  deleteTelegramWebhookAction,
  deleteChannelConnectorAction,
  disableChannelConnectorAction,
  enableChannelConnectorAction,
  refreshTelegramDiagnosticsAction,
  setTelegramWebhookAction,
  updateTelegramIntegrationAction
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

type Translator = ReturnType<typeof createTranslator>["t"];
type TelegramConfig = NonNullable<TelegramIntegrationViewModel["config"]>;
type TelegramSetupStep = NonNullable<TelegramIntegrationViewModel["setupStep"]>;
type TelegramSetupEditableStep = "name" | "token" | "mode";
type TelegramSetupStepDefinition = {
  id: TelegramSetupStep;
  titleKey: I18nMessageKey;
};

const fallbackTelegramSetupSteps: readonly TelegramSetupStepDefinition[] = [
  {
    id: "token",
    titleKey: "integrations.channel.onboarding.credentials" as I18nMessageKey
  },
  {
    id: "mode",
    titleKey: "integrations.channel.onboarding.activation" as I18nMessageKey
  },
  {
    id: "diagnostics",
    titleKey: "integrations.channel.onboarding.diagnostics" as I18nMessageKey
  },
  {
    id: "webhook",
    titleKey: "integrations.channel.onboarding.webhook" as I18nMessageKey
  },
  {
    id: "complete",
    titleKey: "integrations.channel.onboarding.complete" as I18nMessageKey
  }
];

export function TelegramIntegrationPanel({
  channel,
  integration,
  locale,
  t
}: {
  channel?: InternalChannelCatalogItem;
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

        <TelegramLifecycleActions integration={integration} t={t} />

        <TelegramConnectorCompactStatus
          integration={integration}
          locale={locale}
          t={t}
        />
      </section>
    );
  }

  const setupStep = currentTelegramSetupStep(integration);
  const setupSteps = telegramSetupStepsFromCatalog(channel);

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

      <TelegramLifecycleActions integration={integration} t={t} />

      <TelegramSetupStepper currentStep={setupStep} steps={setupSteps} t={t} />

      <TelegramConnectorCompactStatus
        integration={integration}
        locale={locale}
        t={t}
      />

      <TelegramSetupStepPanel
        config={config}
        integration={integration}
        setupStep={setupStep}
        t={t}
      />
    </section>
  );
}

function TelegramSetupStepper({
  currentStep,
  steps,
  t
}: {
  currentStep: TelegramSetupStep;
  steps: readonly TelegramSetupStepDefinition[];
  t: Translator;
}): ReactNode {
  const currentIndex = steps.findIndex((step) => step.id === currentStep);
  const normalizedCurrentIndex = currentIndex >= 0 ? currentIndex : 0;

  return (
    <ol
      className="setupStepList"
      aria-label={t("integrations.telegram.setupTitle")}
    >
      {steps.map((step, index) => {
        const state =
          index < normalizedCurrentIndex
            ? "complete"
            : step.id === currentStep
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
            <span className="setupStepLabel">{t(step.titleKey)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function TelegramSetupStepPanel({
  config,
  integration,
  setupStep,
  t
}: {
  config: TelegramConfig;
  integration: TelegramIntegrationViewModel;
  setupStep: TelegramSetupStep;
  t: Translator;
}): ReactNode {
  switch (setupStep) {
    case "name":
    case "token":
      return (
        <TelegramCredentialsStep
          config={config}
          integration={integration}
          t={t}
        />
      );
    case "mode":
      return (
        <TelegramModeStep config={config} integration={integration} t={t} />
      );
    case "diagnostics":
      return <TelegramDiagnosticsStep integration={integration} t={t} />;
    case "webhook":
      return <TelegramWebhookStep integration={integration} t={t} />;
    case "complete":
      return <TelegramCompleteStep integration={integration} t={t} />;
  }
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
  return (
    <form
      className="settingsForm setupStepPanel"
      action={updateTelegramIntegrationAction}
    >
      <TelegramStateFields
        config={config}
        integration={integration}
        setupStepCompleted="token"
      />

      <label className="fieldStack">
        <span className="detailLabel">
          {t("integrations.telegram.displayName")}
        </span>
        <input
          className="textInput"
          name="displayName"
          defaultValue={telegramDisplayName(integration, t)}
          required
        />
      </label>

      <label className="fieldStack">
        <span className="detailLabel">
          {t("integrations.telegram.botToken")}
        </span>
        <input
          className="textInput"
          type="password"
          name="botToken"
          placeholder={t("integrations.telegram.botTokenPlaceholder")}
          required={!config.botTokenSecretRef}
        />
      </label>

      <div className="buttonRow">
        <button className="primaryButton" type="submit">
          <KeyRound size={16} aria-hidden="true" />
          {t("integrations.telegram.saveCredentials")}
        </button>
      </div>
    </form>
  );
}

function TelegramModeStep({
  config,
  integration,
  t
}: {
  config: TelegramConfig;
  integration: TelegramIntegrationViewModel;
  t: Translator;
}): ReactNode {
  return (
    <form
      className="settingsForm setupStepPanel"
      action={updateTelegramIntegrationAction}
    >
      <TelegramStateFields
        config={config}
        enableConnector
        includeDisplayName
        includeMode={false}
        includeOutbound={false}
        integration={integration}
        setupStepCompleted="mode"
        t={t}
      />

      <p className="metaText">
        {t("integrations.telegram.activationDescription")}
      </p>

      <div className="buttonRow">
        <button className="primaryButton" type="submit">
          <Settings2 size={16} aria-hidden="true" />
          {t("integrations.telegram.saveAndActivate")}
        </button>
      </div>
    </form>
  );
}

function TelegramDiagnosticsStep({
  integration,
  t
}: {
  integration: TelegramIntegrationViewModel;
  t: Translator;
}): ReactNode {
  return (
    <div className="setupStepPanel">
      <div className="buttonRow">
        <TelegramRefreshDiagnosticsForm integration={integration} t={t} />
      </div>
    </div>
  );
}

function TelegramWebhookStep({
  integration,
  t
}: {
  integration: TelegramIntegrationViewModel;
  t: Translator;
}): ReactNode {
  return (
    <div className="settingsForm setupStepPanel">
      <label className="fieldStack">
        <span className="detailLabel">
          {t("integrations.telegram.webhookPath")}
        </span>
        <input
          className="textInput"
          value={integration.webhookPath ?? ""}
          readOnly
        />
      </label>

      <label className="fieldStack">
        <span className="detailLabel">
          {t("integrations.telegram.publicWebhookUrl")}
        </span>
        <input
          className="textInput"
          value={integration.publicWebhookUrl ?? ""}
          readOnly
        />
      </label>

      <div className="buttonRow">
        <TelegramWebhookActions integration={integration} t={t} />
      </div>
    </div>
  );
}

function TelegramCompleteStep({
  integration,
  t
}: {
  integration: TelegramIntegrationViewModel;
  t: Translator;
}): ReactNode {
  return (
    <div className="setupStepPanel">
      <div className="buttonRow">
        <TelegramRefreshDiagnosticsForm integration={integration} t={t} />
        <TelegramWebhookActions integration={integration} t={t} />
      </div>
    </div>
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
  const errorCode =
    integration.diagnostics.lastErrorCode ??
    inbound?.lastErrorCode ??
    outbound?.lastErrorCode ??
    integration.diagnostics.egress?.lastErrorCode;
  const operatorHint =
    integration.diagnostics.operatorHint ??
    inbound?.operatorHint ??
    outbound?.operatorHint ??
    integration.diagnostics.egress?.operatorHint;

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
        label={t("integrations.telegram.runtimeInboundReceivedAt")}
        value={formatOptionalDateTime(inbound?.lastReceivedAt, locale, t)}
      />
      <DetailItem
        label={t("integrations.telegram.runtimeOutboundSentAt")}
        value={formatOptionalDateTime(outbound?.lastSentAt, locale, t)}
      />
      {errorCode ? (
        <DetailItem
          label={t("integrations.channel.details.error")}
          value={errorCode}
        />
      ) : null}
      {operatorHint ? (
        <DetailItem
          label={t("integrations.telegram.operatorHint")}
          value={operatorHint}
        />
      ) : null}
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

function TelegramWebhookActions({
  integration,
  t
}: {
  integration: TelegramIntegrationViewModel;
  t: Translator;
}): ReactNode {
  return (
    <>
      <form action={setTelegramWebhookAction}>
        <ConnectorIdField integration={integration} />
        <button className="secondaryButton" type="submit">
          <LinkIcon size={16} aria-hidden="true" />
          {t("integrations.telegram.setWebhook")}
        </button>
      </form>
      <form action={deleteTelegramWebhookAction}>
        <ConnectorIdField integration={integration} />
        <button className="secondaryButton" type="submit">
          <Unlink size={16} aria-hidden="true" />
          {t("integrations.telegram.deleteWebhook")}
        </button>
      </form>
    </>
  );
}

function TelegramRefreshDiagnosticsForm({
  integration,
  t
}: {
  integration: TelegramIntegrationViewModel;
  t: Translator;
}): ReactNode {
  return (
    <form action={refreshTelegramDiagnosticsAction}>
      <ConnectorIdField integration={integration} />
      <button className="secondaryButton" type="submit">
        <Activity size={16} aria-hidden="true" />
        {t("integrations.telegram.refreshDiagnostics")}
      </button>
    </form>
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
    <div className="buttonRow">
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
    </div>
  );
}

function TelegramStateFields({
  config,
  enableConnector = false,
  includeDisplayName = false,
  includeMode = true,
  includeOutbound = true,
  integration,
  setupStepCompleted,
  t
}: {
  config: TelegramConfig;
  enableConnector?: boolean;
  includeDisplayName?: boolean;
  includeMode?: boolean;
  includeOutbound?: boolean;
  integration: TelegramIntegrationViewModel;
  setupStepCompleted?: TelegramSetupEditableStep;
  t?: Translator;
}): ReactNode {
  return (
    <>
      <ConnectorIdField integration={integration} />
      <input
        type="hidden"
        name="channelExternalId"
        value={config.channelExternalId}
      />
      {includeDisplayName && t ? (
        <input
          type="hidden"
          name="displayName"
          value={telegramDisplayName(integration, t)}
        />
      ) : null}
      {includeMode ? (
        <input type="hidden" name="mode" value={config.mode ?? "webhook"} />
      ) : null}
      {config.botTokenSecretRef ? (
        <input
          type="hidden"
          name="botTokenSecretRef"
          value={config.botTokenSecretRef}
        />
      ) : null}
      {includeOutbound && config.outboundEnabled ? (
        <input type="hidden" name="outboundEnabled" value="on" />
      ) : null}
      {enableConnector ? (
        <input type="hidden" name="enabled" value="on" />
      ) : null}
      {setupStepCompleted ? (
        <input
          type="hidden"
          name="setupStepCompleted"
          value={setupStepCompleted}
        />
      ) : null}
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

function currentTelegramSetupStep(
  integration: TelegramIntegrationViewModel
): TelegramSetupStep {
  if (integration.setupStep) {
    return integration.setupStep === "name" ? "token" : integration.setupStep;
  }

  if (!integration.config?.botTokenSecretRef) {
    return "token";
  }

  return integration.enabled ? "diagnostics" : "name";
}

function telegramDisplayName(
  integration: TelegramIntegrationViewModel,
  t: Translator
): string {
  return integration.displayName ?? t("integrations.telegram.title");
}

function telegramSetupStepsFromCatalog(
  channel: InternalChannelCatalogItem | undefined
): readonly TelegramSetupStepDefinition[] {
  const steps = channel?.onboarding.steps.flatMap((step) => {
    if (step.id === "name") {
      return [];
    }

    if (!isTelegramSetupStep(step.id)) {
      return [];
    }

    return [
      {
        id: step.id,
        titleKey:
          step.id === "token"
            ? ("integrations.channel.onboarding.credentials" as I18nMessageKey)
            : (step.titleKey as I18nMessageKey)
      }
    ];
  });

  return steps && steps.length > 0 ? steps : fallbackTelegramSetupSteps;
}

function isTelegramSetupStep(value: string): value is TelegramSetupStep {
  return (
    value === "name" ||
    value === "token" ||
    value === "mode" ||
    value === "diagnostics" ||
    value === "webhook" ||
    value === "complete"
  );
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
