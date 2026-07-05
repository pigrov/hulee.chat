"use client";

import { LoaderCircle, Plug } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";

import { connectTelegramBotChannelAction } from "./actions";
import {
  initialTelegramBotCatalogConnectActionState,
  type TelegramBotCatalogConnectActionErrorCode,
  type TelegramBotCatalogConnectActionState
} from "./telegram-bot-catalog-connect-action-state";

const telegramBotTokenPattern = /^\d{6,14}:[A-Za-z0-9_-]{30,}$/;

export type TelegramBotCatalogConnectFormLabels = {
  readonly botToken: string;
  readonly botTokenPlaceholder: string;
  readonly connect: string;
  readonly connecting: string;
  readonly invalidToken: string;
};

export type TelegramBotCatalogConnectFormNotice = {
  readonly message: string;
  readonly variant: "error" | "success" | "info";
  readonly actionHref?: string;
  readonly actionLabel?: string;
};

export type TelegramBotCatalogConnectFormMessages = Record<
  TelegramBotCatalogConnectActionErrorCode,
  string
> & {
  readonly duplicateLink: string;
};

export function TelegramBotCatalogConnectForm({
  channelType,
  labels,
  messages,
  notice
}: {
  readonly channelType: "telegram_bot";
  readonly labels: TelegramBotCatalogConnectFormLabels;
  readonly messages: TelegramBotCatalogConnectFormMessages;
  readonly notice?: TelegramBotCatalogConnectFormNotice;
}): ReactNode {
  const router = useRouter();
  const handledSuccessRef = useRef<string | undefined>(undefined);
  const [state, formAction, isPending] = useActionState(
    connectTelegramBotChannelAction,
    initialTelegramBotCatalogConnectActionState
  );
  const [botToken, setBotToken] = useState("");
  const normalizedToken = botToken.trim();
  const hasToken = normalizedToken.length > 0;
  const isTokenValid = telegramBotTokenPattern.test(normalizedToken);
  const isNavigating = state.status === "success";
  const visibleNotice =
    hasToken && !isTokenValid
      ? {
          message: labels.invalidToken,
          variant: "error" as const
        }
      : state.status === "error"
        ? telegramBotCatalogActionNotice({ messages, state })
        : notice;

  useEffect(() => {
    if (
      state.status !== "success" ||
      handledSuccessRef.current === state.submittedAt
    ) {
      return;
    }

    handledSuccessRef.current = state.submittedAt;
    router.push(
      `/admin/integrations?connectorId=${encodeURIComponent(
        state.connectorId
      )}&connectionPendingAt=${encodeURIComponent(state.submittedAt)}`
    );
  }, [router, state]);

  return (
    <form className="settingsForm setupStepPanel" action={formAction}>
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
      <TelegramBotCatalogSubmitButton
        isBusy={isPending || isNavigating}
        isTokenValid={isTokenValid}
        labels={labels}
      />
      {visibleNotice ? (
        <p
          className="telegramConnectionNotice"
          data-variant={visibleNotice.variant}
          role="status"
        >
          <span>{visibleNotice.message}</span>
          {visibleNotice.actionHref && visibleNotice.actionLabel ? (
            <Link
              className="telegramConnectionNoticeLink"
              href={visibleNotice.actionHref}
            >
              {visibleNotice.actionLabel}
            </Link>
          ) : null}
        </p>
      ) : null}
    </form>
  );
}

function TelegramBotCatalogSubmitButton({
  isBusy,
  isTokenValid,
  labels
}: {
  readonly isBusy: boolean;
  readonly isTokenValid: boolean;
  readonly labels: TelegramBotCatalogConnectFormLabels;
}): ReactNode {
  return (
    <div className="buttonRow">
      <button
        className="primaryButton"
        disabled={!isTokenValid || isBusy}
        type="submit"
      >
        {isBusy ? (
          <LoaderCircle
            className="buttonSpinner"
            size={16}
            aria-hidden="true"
          />
        ) : (
          <Plug size={16} aria-hidden="true" />
        )}
        {isBusy ? labels.connecting : labels.connect}
      </button>
    </div>
  );
}

function telegramBotCatalogActionNotice({
  messages,
  state
}: {
  readonly messages: TelegramBotCatalogConnectFormMessages;
  readonly state: TelegramBotCatalogConnectActionState;
}): TelegramBotCatalogConnectFormNotice | undefined {
  if (state.status !== "error") {
    return undefined;
  }

  return {
    message: messages[state.code],
    variant: "error",
    ...(state.code === "telegramTokenDuplicate" && state.duplicateConnectorId
      ? {
          actionHref: `/admin/integrations?connectorId=${encodeURIComponent(
            state.duplicateConnectorId
          )}`,
          actionLabel: messages.duplicateLink
        }
      : {})
  };
}
