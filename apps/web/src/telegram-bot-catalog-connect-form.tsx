"use client";

import { LoaderCircle, Plug } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { connectTelegramBotChannelAction } from "./actions";

const telegramBotTokenPattern = /^\d{6,14}:[A-Za-z0-9_-]{30,}$/;

export type TelegramBotCatalogConnectFormLabels = {
  readonly botToken: string;
  readonly botTokenPlaceholder: string;
  readonly connect: string;
  readonly connecting: string;
  readonly invalidToken: string;
};

export function TelegramBotCatalogConnectForm({
  channelType,
  labels
}: {
  readonly channelType: "telegram_bot";
  readonly labels: TelegramBotCatalogConnectFormLabels;
}): ReactNode {
  const [botToken, setBotToken] = useState("");
  const normalizedToken = botToken.trim();
  const hasToken = normalizedToken.length > 0;
  const isTokenValid = telegramBotTokenPattern.test(normalizedToken);

  return (
    <form
      className="settingsForm setupStepPanel"
      action={connectTelegramBotChannelAction}
    >
      <input type="hidden" name="channelType" value={channelType} />
      <label className="fieldStack">
        <span className="detailLabel">{labels.botToken}</span>
        <input
          className="textInput"
          type="password"
          name="botToken"
          value={botToken}
          placeholder={labels.botTokenPlaceholder}
          autoComplete="off"
          onChange={(event) => setBotToken(event.currentTarget.value)}
          required
        />
      </label>
      {hasToken && !isTokenValid ? (
        <p className="metaText" role="status">
          {labels.invalidToken}
        </p>
      ) : null}
      <TelegramBotCatalogSubmitButton
        isTokenValid={isTokenValid}
        labels={labels}
      />
    </form>
  );
}

function TelegramBotCatalogSubmitButton({
  isTokenValid,
  labels
}: {
  readonly isTokenValid: boolean;
  readonly labels: TelegramBotCatalogConnectFormLabels;
}): ReactNode {
  const { pending } = useFormStatus();

  return (
    <div className="buttonRow">
      <button
        className="primaryButton"
        disabled={!isTokenValid || pending}
        type="submit"
      >
        {pending ? (
          <LoaderCircle
            className="buttonSpinner"
            size={16}
            aria-hidden="true"
          />
        ) : (
          <Plug size={16} aria-hidden="true" />
        )}
        {pending ? labels.connecting : labels.connect}
      </button>
    </div>
  );
}
