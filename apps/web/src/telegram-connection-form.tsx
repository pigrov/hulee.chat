"use client";

import { Check, LoaderCircle, Pencil } from "lucide-react";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

import { connectTelegramIntegrationAction } from "./actions";

type TelegramConnectionActionState = {
  status: "idle" | "queued" | "saved" | "error";
  connectorId?: string;
  submittedAt?: string;
};

type TelegramConnectionDiagnosticsState = {
  botFirstName?: string;
  botUsername?: string;
  status: string;
  checkedAt: string;
  botApiReachable?: boolean;
};

export type TelegramConnectionFormLabels = {
  botToken: string;
  botTokenAlreadySaved: string;
  botTokenPlaceholder: string;
  botTokenSavedPlaceholder: string;
  checking: string;
  connectBot: string;
  connecting: string;
  connectionDescription: string;
  editToken: string;
  failed: string;
  saveAndCheck: string;
  saveChanges: string;
  saved: string;
  slow: string;
  statusUpdated: string;
  displayName: string;
};

const initialConnectionState: TelegramConnectionActionState = {
  status: "idle"
};

export function TelegramConnectionForm({
  botTokenSecretRef,
  channelExternalId,
  connectorId,
  defaultDisplayName,
  diagnostics,
  initialSubmittedAt,
  labels,
  lifecycleActions,
  mode,
  outboundEnabled
}: {
  botTokenSecretRef?: string;
  channelExternalId: string;
  connectorId: string;
  defaultDisplayName: string;
  diagnostics: TelegramConnectionDiagnosticsState;
  initialSubmittedAt?: string;
  labels: TelegramConnectionFormLabels;
  lifecycleActions: ReactNode;
  mode: "webhook" | "polling";
  outboundEnabled: boolean;
}): ReactNode {
  const router = useRouter();
  const initialState = useMemo(
    (): TelegramConnectionActionState =>
      initialSubmittedAt
        ? {
            status: "queued",
            connectorId,
            submittedAt: initialSubmittedAt
          }
        : initialConnectionState,
    [connectorId, initialSubmittedAt]
  );
  const [state, formAction, isPending] = useActionState(
    connectTelegramIntegrationAction,
    initialState
  );
  const [isEditingToken, setIsEditingToken] = useState(!botTokenSecretRef);
  const [botTokenInput, setBotTokenInput] = useState("");
  const [isPolling, setIsPolling] = useState(false);
  const [pollingExpired, setPollingExpired] = useState(false);
  const pollingAttempts = useRef(0);
  const tokenInputRef = useRef<HTMLInputElement | null>(null);
  const formId = useMemo(
    () =>
      `telegram-connection-form-${connectorId.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
    [connectorId]
  );
  const providerCheck = telegramProviderCheckState({
    diagnostics,
    state
  });
  const isWaitingForProvider =
    state.status === "queued" && providerCheck === "pending" && !pollingExpired;
  const isBusy = isPending || isPolling || isWaitingForProvider;
  const isTokenEditable = !botTokenSecretRef || isEditingToken;
  const hasNewBotToken = botTokenInput.trim().length > 0;
  const shouldConnectWithToken = !botTokenSecretRef || hasNewBotToken;
  const statusText = connectionStatusText({
    isPending,
    isPolling: isPolling || isWaitingForProvider,
    labels,
    pollingExpired,
    providerCheck,
    state
  });

  useEffect(() => {
    if (state.status !== "queued" || !state.submittedAt) {
      return;
    }

    pollingAttempts.current = 0;
    setPollingExpired(false);
    setIsPolling(true);
    router.refresh();
  }, [router, state.status, state.submittedAt]);

  useEffect(() => {
    if (!isEditingToken) {
      return;
    }

    tokenInputRef.current?.focus();
  }, [isEditingToken]);

  useEffect(() => {
    if (!isPolling) {
      return;
    }

    if (providerCheck !== "pending") {
      setIsPolling(false);
      return;
    }

    const interval = window.setInterval(() => {
      pollingAttempts.current += 1;
      router.refresh();

      if (pollingAttempts.current >= 60) {
        window.clearInterval(interval);
        setIsPolling(false);
        setPollingExpired(true);
      }
    }, 2_000);

    return () => window.clearInterval(interval);
  }, [isPolling, providerCheck, router]);

  return (
    <>
      <form
        id={formId}
        className="settingsForm setupStepPanel"
        action={formAction}
      >
        <input type="hidden" name="connectorId" value={connectorId} />
        <input
          type="hidden"
          name="channelExternalId"
          value={channelExternalId}
        />
        <input type="hidden" name="enabled" value="on" />
        {shouldConnectWithToken ? (
          <input type="hidden" name="setupStepCompleted" value="mode" />
        ) : (
          <>
            <input type="hidden" name="mode" value={mode} />
            {outboundEnabled ? (
              <input type="hidden" name="outboundEnabled" value="on" />
            ) : null}
          </>
        )}
        {botTokenSecretRef ? (
          <input
            type="hidden"
            name="botTokenSecretRef"
            value={botTokenSecretRef}
          />
        ) : null}

        <p className="metaText">{labels.connectionDescription}</p>

        <fieldset className="settingsFormFieldset" disabled={isBusy}>
          <label className="fieldStack">
            <span className="detailLabel">{labels.displayName}</span>
            <input
              className="textInput"
              name="displayName"
              defaultValue={defaultDisplayName}
              required
            />
          </label>

          <label className="fieldStack">
            <span className="detailLabel">{labels.botToken}</span>
            <span className="tokenInputControl">
              <input
                ref={tokenInputRef}
                className="textInput"
                type="password"
                name="botToken"
                value={botTokenInput}
                placeholder={
                  botTokenSecretRef && !isTokenEditable
                    ? labels.botTokenSavedPlaceholder
                    : labels.botTokenPlaceholder
                }
                disabled={!isTokenEditable}
                onChange={(event) =>
                  setBotTokenInput(event.currentTarget.value)
                }
                required={!botTokenSecretRef}
              />
              {botTokenSecretRef && !isTokenEditable ? (
                <button
                  className="tokenInputEditButton"
                  type="button"
                  aria-label={labels.editToken}
                  onClick={() => setIsEditingToken(true)}
                >
                  <Pencil size={16} aria-hidden="true" />
                </button>
              ) : null}
            </span>
          </label>
        </fieldset>

        {botTokenSecretRef ? (
          <p className="metaText">{labels.botTokenAlreadySaved}</p>
        ) : null}
      </form>

      <div
        className="buttonRow telegramConnectionActions"
        data-busy={isBusy ? "true" : "false"}
      >
        <button
          className="primaryButton"
          disabled={isBusy}
          form={formId}
          type="submit"
        >
          {isBusy ? (
            <LoaderCircle
              className="buttonSpinner"
              size={16}
              aria-hidden="true"
            />
          ) : (
            <Check size={16} aria-hidden="true" />
          )}
          {isBusy
            ? labels.connecting
            : botTokenSecretRef && !hasNewBotToken
              ? labels.saveChanges
              : botTokenSecretRef
                ? labels.saveAndCheck
                : labels.connectBot}
        </button>
        <span className="telegramLifecycleActions" aria-disabled={isBusy}>
          {lifecycleActions}
        </span>
      </div>

      {statusText ? (
        <p className="metaText telegramConnectionStatus" role="status">
          {statusText}
        </p>
      ) : null}
    </>
  );
}

function telegramProviderCheckState(input: {
  diagnostics: TelegramConnectionDiagnosticsState;
  state: TelegramConnectionActionState;
}): "idle" | "pending" | "succeeded" | "failed" {
  if (input.state.status !== "queued" || !input.state.submittedAt) {
    return "idle";
  }

  const checkedAt = Date.parse(input.diagnostics.checkedAt);
  const submittedAt = Date.parse(input.state.submittedAt);

  const isFresh =
    Number.isFinite(checkedAt) &&
    Number.isFinite(submittedAt) &&
    checkedAt >= submittedAt - 1_000 &&
    input.diagnostics.botApiReachable !== undefined;

  if (!isFresh) {
    return "pending";
  }

  const hasBotIdentity = Boolean(
    input.diagnostics.botUsername ?? input.diagnostics.botFirstName
  );

  return input.diagnostics.botApiReachable === true &&
    hasBotIdentity &&
    input.diagnostics.status === "configured"
    ? "succeeded"
    : "failed";
}

function connectionStatusText(input: {
  isPending: boolean;
  isPolling: boolean;
  labels: TelegramConnectionFormLabels;
  pollingExpired: boolean;
  providerCheck: "idle" | "pending" | "succeeded" | "failed";
  state: TelegramConnectionActionState;
}): string | undefined {
  if (input.isPending) {
    return input.labels.connecting;
  }

  if (input.state.status === "error") {
    return input.labels.failed;
  }

  if (input.state.status === "saved") {
    return input.labels.saved;
  }

  if (input.providerCheck === "succeeded") {
    return input.labels.statusUpdated;
  }

  if (input.providerCheck === "failed") {
    return input.labels.failed;
  }

  if (input.isPolling) {
    return input.labels.checking;
  }

  if (input.pollingExpired) {
    return input.labels.slow;
  }

  return undefined;
}
