import type { createTranslator } from "@hulee/i18n";
import { Activity, LinkIcon, Plug, Save, Unlink } from "lucide-react";
import type { ReactNode } from "react";

import {
  deleteTelegramWebhookAction,
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
          {t(telegramStatusKey(integration.diagnostics.status))}
        </span>
      </div>

      <form className="settingsForm" action={updateTelegramIntegrationAction}>
        <label className="toggleRow">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={integration.enabled}
          />
          <span>{t("integrations.telegram.enabled")}</span>
        </label>

        <label className="fieldStack">
          <span className="detailLabel">
            {t("integrations.telegram.channelExternalId")}
          </span>
          <input
            className="textInput"
            name="channelExternalId"
            defaultValue={config?.channelExternalId ?? "telegram-local"}
            required
          />
        </label>

        <label className="fieldStack">
          <span className="detailLabel">{t("integrations.telegram.mode")}</span>
          <select
            className="selectInput"
            name="mode"
            defaultValue={config?.mode ?? "webhook"}
          >
            <option value="webhook">
              {t("integrations.telegram.mode.webhook")}
            </option>
            <option value="polling">
              {t("integrations.telegram.mode.polling")}
            </option>
          </select>
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
          />
        </label>

        <label className="fieldStack">
          <span className="detailLabel">
            {t("integrations.telegram.botTokenSecretRef")}
          </span>
          <input
            className="textInput"
            value={config?.botTokenSecretRef ?? ""}
            readOnly
          />
        </label>

        <label className="toggleRow">
          <input
            type="checkbox"
            name="outboundEnabled"
            defaultChecked={config?.outboundEnabled ?? false}
          />
          <span>{t("integrations.telegram.outboundEnabled")}</span>
        </label>

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

        <div className="diagnosticGrid">
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

        <div className="buttonRow">
          <button className="primaryButton" type="submit">
            <Save size={16} aria-hidden="true" />
            {t("common.save")}
          </button>
        </div>
      </form>

      <div className="buttonRow">
        <form action={refreshTelegramDiagnosticsAction}>
          <button className="secondaryButton" type="submit">
            <Activity size={16} aria-hidden="true" />
            {t("integrations.telegram.refreshDiagnostics")}
          </button>
        </form>
        <form action={setTelegramWebhookAction}>
          <button className="secondaryButton" type="submit">
            <LinkIcon size={16} aria-hidden="true" />
            {t("integrations.telegram.setWebhook")}
          </button>
        </form>
        <form action={deleteTelegramWebhookAction}>
          <button className="secondaryButton" type="submit">
            <Unlink size={16} aria-hidden="true" />
            {t("integrations.telegram.deleteWebhook")}
          </button>
        </form>
      </div>
    </section>
  );
}
