import type { createTranslator, I18nMessageKey } from "@hulee/i18n";
import {
  Activity,
  CheckCircle2,
  Circle,
  KeyRound,
  LinkIcon,
  Plug,
  PowerOff,
  Save,
  Settings2,
  Trash2,
  Unlink
} from "lucide-react";
import type { ReactNode } from "react";

import {
  deleteTelegramWebhookAction,
  deleteChannelConnectorAction,
  disableChannelConnectorAction,
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
import type { TelegramIntegrationViewModel } from "./inbox-api-client";

type Translator = ReturnType<typeof createTranslator>["t"];
type TelegramConfig = NonNullable<TelegramIntegrationViewModel["config"]>;
type TelegramSetupStep = NonNullable<TelegramIntegrationViewModel["setupStep"]>;
type TelegramSetupEditableStep = "name" | "token" | "mode";

const telegramSetupSteps: readonly TelegramSetupStep[] = [
  "name",
  "token",
  "mode",
  "diagnostics",
  "webhook",
  "complete"
];

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

  if (!integration.connectorId || !config) {
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

  const setupStep = currentTelegramSetupStep(integration);

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

      <TelegramSetupStepper currentStep={setupStep} t={t} />

      <TelegramSetupStepPanel
        config={config}
        integration={integration}
        locale={locale}
        setupStep={setupStep}
        t={t}
      />

      <TelegramLifecycleActions integration={integration} t={t} />
    </section>
  );
}

function TelegramSetupStepper({
  currentStep,
  t
}: {
  currentStep: TelegramSetupStep;
  t: Translator;
}): ReactNode {
  const currentIndex = telegramSetupSteps.indexOf(currentStep);

  return (
    <ol
      className="setupStepList"
      aria-label={t("integrations.telegram.setupTitle")}
    >
      {telegramSetupSteps.map((step, index) => {
        const state =
          index < currentIndex
            ? "complete"
            : step === currentStep
              ? "current"
              : "pending";

        return (
          <li className="setupStep" data-state={state} key={step}>
            <span className="setupStepMarker" aria-hidden="true">
              {state === "complete" ? (
                <CheckCircle2 size={16} />
              ) : (
                <Circle size={16} />
              )}
            </span>
            <span className="setupStepLabel">
              {t(telegramSetupStepKey(step))}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function TelegramSetupStepPanel({
  config,
  integration,
  locale,
  setupStep,
  t
}: {
  config: TelegramConfig;
  integration: TelegramIntegrationViewModel;
  locale: string;
  setupStep: TelegramSetupStep;
  t: Translator;
}): ReactNode {
  switch (setupStep) {
    case "name":
      return (
        <TelegramNameStep config={config} integration={integration} t={t} />
      );
    case "token":
      return (
        <TelegramTokenStep config={config} integration={integration} t={t} />
      );
    case "mode":
      return (
        <TelegramModeStep config={config} integration={integration} t={t} />
      );
    case "diagnostics":
      return (
        <TelegramDiagnosticsStep
          integration={integration}
          locale={locale}
          t={t}
        />
      );
    case "webhook":
      return <TelegramWebhookStep integration={integration} t={t} />;
    case "complete":
      return (
        <TelegramCompleteStep integration={integration} locale={locale} t={t} />
      );
  }
}

function TelegramNameStep({
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
        setupStepCompleted="name"
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

      <div className="buttonRow">
        <button className="primaryButton" type="submit">
          <Save size={16} aria-hidden="true" />
          {t("integrations.telegram.continue")}
        </button>
      </div>
    </form>
  );
}

function TelegramTokenStep({
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
        includeDisplayName
        setupStepCompleted="token"
        t={t}
      />

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
          {t("integrations.telegram.saveToken")}
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

      <label className="fieldStack">
        <span className="detailLabel">{t("integrations.telegram.mode")}</span>
        <select
          className="selectInput"
          name="mode"
          defaultValue={config.mode ?? "webhook"}
        >
          <option value="webhook">
            {t("integrations.telegram.mode.webhook")}
          </option>
          <option value="polling">
            {t("integrations.telegram.mode.polling")}
          </option>
        </select>
      </label>

      <label className="toggleRow">
        <input
          type="checkbox"
          name="outboundEnabled"
          defaultChecked={config.outboundEnabled ?? false}
        />
        <span>{t("integrations.telegram.outboundEnabled")}</span>
      </label>

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
  locale,
  t
}: {
  integration: TelegramIntegrationViewModel;
  locale: string;
  t: Translator;
}): ReactNode {
  return (
    <div className="setupStepPanel">
      <TelegramDiagnosticsGrid
        integration={integration}
        locale={locale}
        t={t}
      />
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
  locale,
  t
}: {
  integration: TelegramIntegrationViewModel;
  locale: string;
  t: Translator;
}): ReactNode {
  return (
    <div className="setupStepPanel">
      <TelegramDiagnosticsGrid
        integration={integration}
        locale={locale}
        t={t}
      />
      <div className="buttonRow">
        <TelegramRefreshDiagnosticsForm integration={integration} t={t} />
        <TelegramWebhookActions integration={integration} t={t} />
      </div>
    </div>
  );
}

function TelegramDiagnosticsGrid({
  integration,
  locale,
  t
}: {
  integration: TelegramIntegrationViewModel;
  locale: string;
  t: Translator;
}): ReactNode {
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
      {integration.diagnostics.operatorHint ? (
        <DetailItem
          label={t("integrations.telegram.operatorHint")}
          value={integration.diagnostics.operatorHint}
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
      <form action={disableChannelConnectorAction}>
        <ConnectorIdField integration={integration} />
        <button
          className="secondaryButton"
          type="submit"
          disabled={integration.status === "disabled"}
        >
          <PowerOff size={16} aria-hidden="true" />
          {t("integrations.telegram.disableConnector")}
        </button>
      </form>
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
    return integration.setupStep;
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

function telegramSetupStepKey(step: TelegramSetupStep): I18nMessageKey {
  return `integrations.telegram.setup.${step}` as I18nMessageKey;
}

function channelConnectorStatusKey(
  status: NonNullable<TelegramIntegrationViewModel["status"]>
): I18nMessageKey {
  return `integrations.channel.status.${status}` as I18nMessageKey;
}
