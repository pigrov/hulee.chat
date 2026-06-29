import type {
  InternalChannelAuthChallenge,
  InternalChannelAuthChallengeType
} from "@hulee/contracts";
import type { createTranslator, I18nMessageKey } from "@hulee/i18n";
import { CheckCircle2, KeyRound, Phone, QrCode, XCircle } from "lucide-react";
import type { ReactNode } from "react";

import {
  cancelChannelAuthChallengeAction,
  startChannelAuthChallengeAction,
  submitChannelAuthChallengeAction
} from "./actions";
import { DetailItem } from "./app-chrome";
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
    <form className="settingsForm" action={startChannelAuthChallengeAction}>
      <input type="hidden" name="connectorId" value={connectorId} />
      <input type="hidden" name="challengeType" value={challengeType} />
      <label className="fieldStack">
        <span className="detailLabel">
          {t("integrations.channel.auth.phoneNumber")}
        </span>
        <input className="textInput" name="phoneNumber" type="tel" required />
      </label>
      <div className="buttonRow">
        <button className="primaryButton" type="submit">
          <Phone size={16} aria-hidden="true" />
          {t("integrations.channel.auth.start")}
        </button>
      </div>
    </form>
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
    <form className="settingsForm" action={submitChannelAuthChallengeAction}>
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
        <button
          className="primaryButton"
          type="submit"
          disabled={!challenge?.challengeId}
        >
          <KeyRound size={16} aria-hidden="true" />
          {t("integrations.channel.auth.submitCode")}
        </button>
      </div>
    </form>
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
    <form className="settingsForm" action={submitChannelAuthChallengeAction}>
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
        <button
          className="primaryButton"
          type="submit"
          disabled={!challenge?.challengeId}
        >
          <KeyRound size={16} aria-hidden="true" />
          {t("integrations.channel.auth.submitPassword")}
        </button>
      </div>
    </form>
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
      <form action={cancelChannelAuthChallengeAction}>
        <ChallengeIdentityFields
          challenge={challenge}
          connectorId={connectorId}
        />
        <button
          className="secondaryButton"
          type="submit"
          disabled={!challenge?.challengeId}
        >
          <XCircle size={16} aria-hidden="true" />
          {t("integrations.channel.auth.cancel")}
        </button>
      </form>
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
  label
}: {
  challengeType: InternalChannelAuthChallengeType;
  connectorId: string;
  icon: ReactNode;
  label: string;
}): ReactNode {
  return (
    <form action={startChannelAuthChallengeAction}>
      <input type="hidden" name="connectorId" value={connectorId} />
      <input type="hidden" name="challengeType" value={challengeType} />
      <button className="primaryButton" type="submit">
        {icon}
        {label}
      </button>
    </form>
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
