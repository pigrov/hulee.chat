import type {
  InternalChannelAuthChallenge,
  InternalChannelAuthChallengeType
} from "@hulee/contracts";
import type { createTranslator, I18nMessageKey } from "@hulee/i18n";
import { CheckCircle2, KeyRound, Phone, QrCode, XCircle } from "lucide-react";
import type { ReactNode } from "react";

import {
  ChannelAuthChallengeActionForm,
  ChannelAuthChallengeSubmitButton
} from "./channel-auth-challenge-action-form";
import type { ChannelAuthChallengeActionMessages } from "./channel-auth-challenge-action-state";
import { DetailItem } from "./app-chrome";
import { PhoneNumberInput } from "./contact-fields";
import { formatOptionalDateTime } from "./formatting";

type Translator = ReturnType<typeof createTranslator>["t"];

export function ChannelAuthChallengePanel({
  challenge,
  challengeType,
  connectorId,
  locale,
  stepKind,
  t
}: {
  challenge?: InternalChannelAuthChallenge;
  challengeType: InternalChannelAuthChallengeType;
  connectorId: string;
  locale: string;
  stepKind:
    | "qr_code"
    | "phone_number"
    | "verification_code"
    | "password"
    | "waiting"
    | "complete";
  t: Translator;
}): ReactNode {
  return (
    <div className="settingsForm setupStepPanel">
      {challenge ? (
        <ChallengeStatus challenge={challenge} locale={locale} t={t} />
      ) : null}
      {renderChallengeStep({
        challenge,
        challengeType,
        connectorId,
        stepKind,
        t
      })}
    </div>
  );
}

function renderChallengeStep(input: {
  challenge?: InternalChannelAuthChallenge;
  challengeType: InternalChannelAuthChallengeType;
  connectorId: string;
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
  challenge,
  challengeType,
  connectorId,
  t
}: {
  challenge?: InternalChannelAuthChallenge;
  challengeType: InternalChannelAuthChallengeType;
  connectorId: string;
  t: Translator;
}): ReactNode {
  return (
    <>
      {challenge?.publicPayload.qrImageDataUrl ||
      challenge?.publicPayload.qrPayloadRef ? (
        <div className="authChallengeQrBox">
          {challenge.publicPayload.qrImageDataUrl ? (
            <img
              className="authChallengeQrImage"
              src={challenge.publicPayload.qrImageDataUrl}
              alt=""
            />
          ) : (
            <QrCode size={32} aria-hidden="true" />
          )}
          {challenge.publicPayload.qrPayloadRef ? (
            <span className="authChallengePayload">
              {challenge.publicPayload.qrPayloadRef}
            </span>
          ) : null}
        </div>
      ) : null}
      <StartChallengeForm
        challengeType={challengeType}
        connectorId={connectorId}
        icon={<QrCode size={16} aria-hidden="true" />}
        label={t("integrations.channel.auth.start")}
        t={t}
      />
    </>
  );
}

function PhoneChallengeStep({
  challengeType,
  connectorId,
  t
}: {
  challengeType: InternalChannelAuthChallengeType;
  connectorId: string;
  t: Translator;
}): ReactNode {
  return (
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
  );
}

function WaitingChallengeStep({
  challenge,
  connectorId,
  t
}: {
  challenge?: InternalChannelAuthChallenge;
  connectorId: string;
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
        <ChannelAuthChallengeSubmitButton
          className="secondaryButton"
          disabled={!challenge?.challengeId}
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
  return (
    <div className="diagnosticGrid">
      <DetailItem
        label={t("integrations.channel.auth.status")}
        value={t(channelAuthChallengeStatusKey(challenge.status))}
      />
      <DetailItem
        label={t("integrations.channel.auth.expiresAt")}
        value={formatOptionalDateTime(challenge.expiresAt, locale, t)}
      />
    </div>
  );
}

function StartChallengeForm({
  challengeType,
  connectorId,
  icon,
  label,
  t
}: {
  challengeType: InternalChannelAuthChallengeType;
  connectorId: string;
  icon: ReactNode;
  label: string;
  t: Translator;
}): ReactNode {
  return (
    <ChannelAuthChallengeActionForm
      actionKind="start"
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
