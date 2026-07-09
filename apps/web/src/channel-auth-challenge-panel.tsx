import type {
  InternalChannelAuthChallenge,
  InternalChannelAuthChallengeType
} from "@hulee/contracts";
import type { createTranslator, I18nMessageKey } from "@hulee/i18n";
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  Phone,
  QrCode,
  XCircle
} from "lucide-react";
import type { ReactNode } from "react";

import { ChannelAuthChallengeAutoRefresh } from "./channel-auth-challenge-auto-refresh";
import {
  ChannelAuthChallengeActionForm,
  ChannelAuthChallengeSubmitButton
} from "./channel-auth-challenge-action-form";
import type { ChannelAuthChallengeActionMessages } from "./channel-auth-challenge-action-state";
import { DetailItem } from "./app-chrome";
import { PhoneNumberInput } from "./contact-fields";
import { formatOptionalDateTime } from "./formatting";
import { LocalDateTime } from "./local-date-time";

type Translator = ReturnType<typeof createTranslator>["t"];

export function ChannelAuthChallengePanel({
  autoStart = false,
  cancelDeletesConnector = false,
  channelType,
  challenge,
  challengeType,
  connectorId,
  locale,
  sourceName,
  stepKind,
  t
}: {
  autoStart?: boolean;
  cancelDeletesConnector?: boolean;
  channelType?: string;
  challenge?: InternalChannelAuthChallenge;
  challengeType: InternalChannelAuthChallengeType;
  connectorId: string;
  locale: string;
  sourceName?: string;
  stepKind:
    | "qr_code"
    | "phone_number"
    | "verification_code"
    | "password"
    | "waiting"
    | "complete";
  t: Translator;
}): ReactNode {
  const autoRefreshActive = isAutoRefreshChallenge(challenge);

  return (
    <div className="settingsForm setupStepPanel">
      <ChannelAuthChallengeAutoRefresh
        active={autoRefreshActive}
        label={t("integrations.channel.auth.autoRefresh")}
        refreshKey={
          challenge
            ? `${challenge.challengeId}:${challenge.status}:${challenge.updatedAt}`
            : "inactive"
        }
      />
      {challenge ? (
        <ChallengeStatus challenge={challenge} locale={locale} t={t} />
      ) : null}
      {renderChallengeStep({
        autoStart,
        cancelDeletesConnector,
        channelType,
        challenge,
        challengeType,
        connectorId,
        sourceName,
        stepKind,
        t
      })}
    </div>
  );
}

function renderChallengeStep(input: {
  autoStart: boolean;
  cancelDeletesConnector: boolean;
  channelType?: string;
  challenge?: InternalChannelAuthChallenge;
  challengeType: InternalChannelAuthChallengeType;
  connectorId: string;
  sourceName?: string;
  stepKind:
    | "qr_code"
    | "phone_number"
    | "verification_code"
    | "password"
    | "waiting"
    | "complete";
  t: Translator;
}): ReactNode {
  switch (input.stepKind) {
    case "qr_code":
      return <QrChallengeStep {...input} />;
    case "phone_number":
      return <PhoneChallengeStep {...input} />;
    case "verification_code":
      return <CodeChallengeStep {...input} />;
    case "password":
      return <PasswordChallengeStep {...input} />;
    case "waiting":
      return <WaitingChallengeStep {...input} />;
    case "complete":
      return <CompleteChallengeStep t={input.t} />;
  }
}

function QrChallengeStep({
  autoStart,
  cancelDeletesConnector,
  channelType,
  challenge,
  challengeType,
  connectorId,
  sourceName,
  t
}: {
  autoStart: boolean;
  cancelDeletesConnector: boolean;
  channelType?: string;
  challenge?: InternalChannelAuthChallenge;
  challengeType: InternalChannelAuthChallengeType;
  connectorId: string;
  sourceName?: string;
  t: Translator;
}): ReactNode {
  if (challenge && isActiveQrChallenge(challenge)) {
    return (
      <>
        <QrChallengePreview
          channelType={channelType}
          challenge={challenge}
          t={t}
        />
        <WaitingChallengeActions
          cancelDeletesConnector={cancelDeletesConnector}
          channelType={channelType}
          challenge={challenge}
          connectorId={connectorId}
          sourceName={sourceName}
          t={t}
        />
      </>
    );
  }

  const hasAlternatePhoneAuth = Boolean(alternatePhoneAuthConfig(channelType));

  return (
    <>
      {challenge?.status === "expired" ? (
        <ChallengeNotice
          icon={<AlertTriangle size={16} aria-hidden="true" />}
          message={t("integrations.channel.auth.expiredHint")}
          variant="warning"
        />
      ) : null}
      <StartChallengeForm
        autoStart={autoStart}
        challengeType={challengeType}
        connectorId={connectorId}
        icon={<QrCode size={16} aria-hidden="true" />}
        label={t(
          autoStart
            ? "integrations.channel.auth.autoStart"
            : challenge
              ? "integrations.channel.auth.restart"
              : hasAlternatePhoneAuth
                ? "integrations.channel.auth.startQr"
                : "integrations.channel.auth.start"
        )}
        t={t}
      />
      {!challenge && hasAlternatePhoneAuth ? (
        <AlternatePhoneAuthForm
          channelType={channelType}
          connectorId={connectorId}
          t={t}
        />
      ) : null}
    </>
  );
}

function AlternatePhoneAuthForm({
  channelType,
  connectorId,
  t
}: {
  channelType?: string;
  connectorId: string;
  t: Translator;
}): ReactNode {
  const config = alternatePhoneAuthConfig(channelType);

  if (!config) {
    return null;
  }

  return (
    <div className="authChallengeAlternative">
      <div className="authChallengeAlternativeText">
        <p className="sectionTitle">{t(config.titleKey)}</p>
        <p className="metaText">{t(config.hintKey)}</p>
      </div>
      <ChannelAuthChallengeActionForm
        actionKind="start"
        className="authChallengeAlternativeForm"
        messages={channelAuthChallengeActionMessages(t)}
      >
        <input type="hidden" name="connectorId" value={connectorId} />
        <input type="hidden" name="challengeType" value="phone_code" />
        <label className="fieldStack">
          <span className="detailLabel">
            {t("integrations.channel.auth.phoneNumber")}
          </span>
          <PhoneNumberInput className="textInput" name="phoneNumber" required />
        </label>
        <div className="buttonRow">
          <ChannelAuthChallengeSubmitButton
            className="secondaryButton"
            label={t(config.buttonKey)}
          >
            <Phone size={16} aria-hidden="true" />
          </ChannelAuthChallengeSubmitButton>
        </div>
      </ChannelAuthChallengeActionForm>
    </div>
  );
}

function QrChallengePreview({
  channelType,
  challenge,
  t
}: {
  channelType?: string;
  challenge: InternalChannelAuthChallenge;
  t: Translator;
}): ReactNode {
  const hasQr =
    Boolean(challenge.publicPayload.qrImageDataUrl) ||
    Boolean(challenge.publicPayload.qrPayloadRef);

  return (
    <div
      className="authChallengeQrBox"
      data-state={hasQr ? "ready" : "waiting"}
    >
      {challenge.publicPayload.qrImageDataUrl ? (
        <img
          className="authChallengeQrImage"
          src={challenge.publicPayload.qrImageDataUrl}
          alt={t("integrations.channel.auth.qrAlt")}
        />
      ) : hasQr ? (
        <QrCode size={42} aria-hidden="true" />
      ) : (
        <LoaderCircle className="buttonSpinner" size={32} aria-hidden="true" />
      )}
      <div className="authChallengeQrText">
        <p className="sectionTitle">
          {hasQr
            ? t("integrations.channel.auth.qrReady")
            : t("integrations.channel.auth.qrWaiting")}
        </p>
        <p className="metaText">
          {hasQr
            ? t(qrReadyHintKey(channelType))
            : t("integrations.channel.auth.qrWaitingHint")}
        </p>
      </div>
      {!challenge.publicPayload.qrImageDataUrl &&
      challenge.publicPayload.qrPayloadRef ? (
        <span className="authChallengePayload">
          {challenge.publicPayload.qrPayloadRef}
        </span>
      ) : null}
    </div>
  );
}

function PhoneChallengeStep({
  cancelDeletesConnector,
  channelType,
  challenge,
  challengeType,
  connectorId,
  sourceName,
  t
}: {
  cancelDeletesConnector: boolean;
  channelType?: string;
  challenge?: InternalChannelAuthChallenge;
  challengeType: InternalChannelAuthChallengeType;
  connectorId: string;
  sourceName?: string;
  t: Translator;
}): ReactNode {
  const config = primaryPhoneAuthConfig(channelType);

  if (config) {
    return (
      <div className="authChallengeAlternative authChallengePhoneBox">
        <div className="authChallengeAlternativeText">
          <p className="sectionTitle">{t(config.titleKey)}</p>
          <p className="metaText">{t(config.hintKey)}</p>
        </div>
        <ChannelAuthChallengeActionForm
          actionKind="start"
          className="authChallengeAlternativeForm"
          messages={channelAuthChallengeActionMessages(t)}
        >
          <input type="hidden" name="connectorId" value={connectorId} />
          <input type="hidden" name="challengeType" value={challengeType} />
          <label className="fieldStack">
            <span className="detailLabel">
              {t("integrations.channel.auth.phoneNumber")}
            </span>
            <PhoneNumberInput
              className="textInput"
              name="phoneNumber"
              required
            />
          </label>
          <div className="buttonRow">
            <ChannelAuthChallengeSubmitButton
              className="primaryButton"
              label={t(config.buttonKey)}
            >
              <Phone size={16} aria-hidden="true" />
            </ChannelAuthChallengeSubmitButton>
          </div>
        </ChannelAuthChallengeActionForm>
        {cancelDeletesConnector && channelType ? (
          <WaitingChallengeActions
            cancelDeletesConnector={cancelDeletesConnector}
            channelType={channelType}
            challenge={challenge}
            connectorId={connectorId}
            sourceName={sourceName}
            t={t}
          />
        ) : null}
      </div>
    );
  }

  return (
    <>
      <ChannelAuthChallengeActionForm
        actionKind="start"
        className="settingsForm"
        messages={channelAuthChallengeActionMessages(t)}
      >
        <input type="hidden" name="connectorId" value={connectorId} />
        <input type="hidden" name="challengeType" value={challengeType} />
        <label className="fieldStack">
          <span className="detailLabel">
            {t("integrations.channel.auth.phoneNumber")}
          </span>
          <PhoneNumberInput className="textInput" name="phoneNumber" required />
        </label>
        <div className="buttonRow">
          <ChannelAuthChallengeSubmitButton
            className="primaryButton"
            label={t("integrations.channel.auth.start")}
          >
            <Phone size={16} aria-hidden="true" />
          </ChannelAuthChallengeSubmitButton>
        </div>
      </ChannelAuthChallengeActionForm>
      {cancelDeletesConnector && channelType ? (
        <WaitingChallengeActions
          cancelDeletesConnector={cancelDeletesConnector}
          channelType={channelType}
          challenge={challenge}
          connectorId={connectorId}
          sourceName={sourceName}
          t={t}
        />
      ) : null}
    </>
  );
}

function CodeChallengeStep({
  challenge,
  connectorId,
  t
}: {
  challenge?: InternalChannelAuthChallenge;
  connectorId: string;
  t: Translator;
}): ReactNode {
  return (
    <ChannelAuthChallengeActionForm
      actionKind="submit"
      className="settingsForm"
      messages={channelAuthChallengeActionMessages(t)}
    >
      <ChallengeIdentityFields
        challenge={challenge}
        connectorId={connectorId}
      />
      <label className="fieldStack">
        <span className="detailLabel">
          {t("integrations.channel.auth.code")}
        </span>
        <input
          className="textInput"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
        />
      </label>
      <div className="buttonRow">
        <ChannelAuthChallengeSubmitButton
          className="primaryButton"
          disabled={!challenge?.challengeId}
          label={t("integrations.channel.auth.submitCode")}
        >
          <KeyRound size={16} aria-hidden="true" />
        </ChannelAuthChallengeSubmitButton>
      </div>
    </ChannelAuthChallengeActionForm>
  );
}

function PasswordChallengeStep({
  challenge,
  connectorId,
  t
}: {
  challenge?: InternalChannelAuthChallenge;
  connectorId: string;
  t: Translator;
}): ReactNode {
  return (
    <>
      <ChallengeNotice
        icon={<KeyRound size={16} aria-hidden="true" />}
        message={t("integrations.channel.auth.passwordHint")}
        variant="info"
      />
      <ChannelAuthChallengeActionForm
        actionKind="submit"
        className="settingsForm"
        messages={channelAuthChallengeActionMessages(t)}
      >
        <ChallengeIdentityFields
          challenge={challenge}
          connectorId={connectorId}
        />
        <label className="fieldStack">
          <span className="detailLabel">
            {t("integrations.channel.auth.password")}
          </span>
          <input
            className="textInput"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        <div className="buttonRow">
          <ChannelAuthChallengeSubmitButton
            className="primaryButton"
            disabled={!challenge?.challengeId}
            label={t("integrations.channel.auth.submitPassword")}
          >
            <KeyRound size={16} aria-hidden="true" />
          </ChannelAuthChallengeSubmitButton>
        </div>
      </ChannelAuthChallengeActionForm>
    </>
  );
}

function WaitingChallengeStep({
  cancelDeletesConnector,
  channelType,
  challenge,
  connectorId,
  sourceName,
  t
}: {
  cancelDeletesConnector: boolean;
  channelType?: string;
  challenge?: InternalChannelAuthChallenge;
  connectorId: string;
  sourceName?: string;
  t: Translator;
}): ReactNode {
  return (
    <>
      {challenge?.publicPayload.pairingCode ? (
        <PairingCodePreview challenge={challenge} t={t} />
      ) : null}
      <WaitingChallengeActions
        cancelDeletesConnector={cancelDeletesConnector}
        channelType={channelType}
        challenge={challenge}
        connectorId={connectorId}
        sourceName={sourceName}
        t={t}
      />
    </>
  );
}

function PairingCodePreview({
  challenge,
  t
}: {
  challenge: InternalChannelAuthChallenge;
  t: Translator;
}): ReactNode {
  return (
    <div className="authChallengePairingBox">
      <p className="detailLabel">
        {t("integrations.channel.auth.pairingCode")}
      </p>
      <p className="authChallengePairingCode">
        {challenge.publicPayload.pairingCode}
      </p>
      <p className="metaText">
        {t("integrations.channel.auth.pairingCodeHint.whatsapp")}
      </p>
    </div>
  );
}

function WaitingChallengeActions({
  cancelDeletesConnector,
  channelType,
  challenge,
  connectorId,
  sourceName,
  t
}: {
  cancelDeletesConnector: boolean;
  channelType?: string;
  challenge?: InternalChannelAuthChallenge;
  connectorId: string;
  sourceName?: string;
  t: Translator;
}): ReactNode {
  return (
    <div className="buttonRow">
      <ChannelAuthChallengeActionForm
        actionKind="cancel"
        messages={channelAuthChallengeActionMessages(t)}
      >
        <ChallengeIdentityFields
          challenge={challenge}
          connectorId={connectorId}
        />
        {cancelDeletesConnector && channelType ? (
          <>
            <input type="hidden" name="deleteConnectorOnCancel" value="on" />
            <input
              type="hidden"
              name="redirectChannelType"
              value={channelType}
            />
            {sourceName ? (
              <input
                type="hidden"
                name="redirectSourceName"
                value={sourceName}
              />
            ) : (
              <input type="hidden" name="redirectTab" value="accounts" />
            )}
          </>
        ) : null}
        <ChannelAuthChallengeSubmitButton
          className="secondaryButton"
          disabled={!challenge?.challengeId && !cancelDeletesConnector}
          label={t("integrations.channel.auth.cancel")}
        >
          <XCircle size={16} aria-hidden="true" />
        </ChannelAuthChallengeSubmitButton>
      </ChannelAuthChallengeActionForm>
    </div>
  );
}

function CompleteChallengeStep({ t }: { t: Translator }): ReactNode {
  return (
    <div className="badge">
      <CheckCircle2 size={14} aria-hidden="true" />
      {t("integrations.channel.auth.complete")}
    </div>
  );
}

function ChallengeStatus({
  challenge,
  locale,
  t
}: {
  challenge: InternalChannelAuthChallenge;
  locale: string;
  t: Translator;
}): ReactNode {
  const expiresAtFallback = formatOptionalDateTime(
    challenge.expiresAt,
    locale,
    t
  );

  return (
    <>
      <div className="diagnosticGrid authChallengeStatusGrid">
        <DetailItem
          label={t("integrations.channel.auth.status")}
          value={t(channelAuthChallengeStatusKey(challenge.status))}
        />
        <DetailItem
          label={t("integrations.channel.auth.expiresAt")}
          value={
            <LocalDateTime
              fallback={expiresAtFallback}
              locale={locale}
              value={challenge.expiresAt}
            />
          }
        />
      </div>
      {challenge.publicPayload.operatorHint &&
      challenge.status !== "requires_password" ? (
        <ChallengeNotice
          icon={<AlertTriangle size={16} aria-hidden="true" />}
          message={challenge.publicPayload.operatorHint}
          variant="warning"
        />
      ) : null}
      {isFailedChallenge(challenge) ? (
        <ChallengeNotice
          icon={<AlertTriangle size={16} aria-hidden="true" />}
          message={challengeFailureMessage(challenge, t)}
          variant="error"
        />
      ) : null}
    </>
  );
}

function ChallengeNotice({
  icon,
  message,
  variant
}: {
  icon: ReactNode;
  message: string;
  variant: "error" | "info" | "warning";
}): ReactNode {
  return (
    <div className="authChallengeNotice" data-variant={variant} role="status">
      {icon}
      <span>{message}</span>
    </div>
  );
}

function StartChallengeForm({
  autoStart,
  challengeType,
  connectorId,
  icon,
  label,
  t
}: {
  autoStart: boolean;
  challengeType: InternalChannelAuthChallengeType;
  connectorId: string;
  icon: ReactNode;
  label: string;
  t: Translator;
}): ReactNode {
  return (
    <ChannelAuthChallengeActionForm
      actionKind="start"
      autoSubmit={autoStart}
      messages={channelAuthChallengeActionMessages(t)}
    >
      <input type="hidden" name="connectorId" value={connectorId} />
      <input type="hidden" name="challengeType" value={challengeType} />
      <ChannelAuthChallengeSubmitButton className="primaryButton" label={label}>
        {icon}
      </ChannelAuthChallengeSubmitButton>
    </ChannelAuthChallengeActionForm>
  );
}

function ChallengeIdentityFields({
  challenge,
  connectorId
}: {
  challenge?: InternalChannelAuthChallenge;
  connectorId: string;
}): ReactNode {
  return (
    <>
      <input type="hidden" name="connectorId" value={connectorId} />
      <input
        type="hidden"
        name="challengeId"
        value={challenge?.challengeId ?? ""}
      />
    </>
  );
}

function channelAuthChallengeStatusKey(
  status: InternalChannelAuthChallenge["status"]
): I18nMessageKey {
  return `integrations.channel.auth.status.${status}` as I18nMessageKey;
}

function qrReadyHintKey(channelType: string | undefined): I18nMessageKey {
  if (channelType === "telegram_qr_bridge") {
    return "integrations.channel.auth.qrReadyHint.telegram";
  }

  if (channelType === "whatsapp_qr_bridge") {
    return "integrations.channel.auth.qrReadyHint.whatsapp";
  }

  return "integrations.channel.auth.qrReadyHint";
}

function alternatePhoneAuthConfig(channelType: string | undefined):
  | {
      titleKey: I18nMessageKey;
      hintKey: I18nMessageKey;
      buttonKey: I18nMessageKey;
    }
  | undefined {
  if (channelType === "telegram_qr_bridge") {
    return {
      titleKey: "integrations.channel.auth.telegramPhoneTitle",
      hintKey: "integrations.channel.auth.telegramPhoneHint",
      buttonKey: "integrations.channel.auth.startTelegramPhone"
    };
  }

  if (channelType === "whatsapp_qr_bridge") {
    return {
      titleKey: "integrations.channel.auth.whatsappPairingTitle",
      hintKey: "integrations.channel.auth.whatsappPairingHint",
      buttonKey: "integrations.channel.auth.startWhatsAppPairing"
    };
  }

  return undefined;
}

function primaryPhoneAuthConfig(channelType: string | undefined):
  | {
      titleKey: I18nMessageKey;
      hintKey: I18nMessageKey;
      buttonKey: I18nMessageKey;
    }
  | undefined {
  if (channelType === "max_qr_bridge") {
    return {
      titleKey: "integrations.channel.auth.maxPhoneTitle",
      hintKey: "integrations.channel.auth.maxPhoneHint",
      buttonKey: "integrations.channel.auth.startMaxPhone"
    };
  }

  return undefined;
}

function channelAuthChallengeActionMessages(
  t: Translator
): ChannelAuthChallengeActionMessages {
  return {
    cancelled: t("integrations.channel.auth.action.cancelled"),
    email_verification_required: t("auth.emailVerification.status.required"),
    invalid: t("integrations.channel.auth.action.invalid"),
    permission_denied: t("admin.roles.actionStatus.permissionDenied"),
    started: t("integrations.channel.auth.action.started"),
    submitted: t("integrations.channel.auth.action.submitted")
  };
}

function isAutoRefreshChallenge(
  challenge: InternalChannelAuthChallenge | undefined
): boolean {
  return challenge?.status === "pending" || challenge?.status === "waiting";
}

function isActiveQrChallenge(
  challenge: InternalChannelAuthChallenge | undefined
): boolean {
  return (
    Boolean(challenge) &&
    challenge?.challengeType === "qr" &&
    (challenge.status === "pending" || challenge.status === "waiting")
  );
}

function isFailedChallenge(
  challenge: InternalChannelAuthChallenge | undefined
): challenge is InternalChannelAuthChallenge {
  return challenge?.status === "failed";
}

function challengeFailureMessage(
  challenge: InternalChannelAuthChallenge,
  t: Translator
): string {
  const message = challenge.errorMessage ?? "";

  if (message.includes("TIMEOUT")) {
    return t("integrations.channel.auth.error.timeout");
  }

  if (message.includes("PASSWORD")) {
    return t("integrations.channel.auth.error.password");
  }

  if (
    message.includes("API id/hash") ||
    message.includes("not configured") ||
    message.includes("Session encryption")
  ) {
    return t("integrations.channel.auth.error.config");
  }

  return t("integrations.channel.auth.error.failed");
}
