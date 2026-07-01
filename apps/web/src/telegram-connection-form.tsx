"use client";

import { KeyRound, LoaderCircle } from "lucide-react";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

import { connectTelegramIntegrationAction } from "./actions";

type TelegramConnectionActionState = {
  status: "idle" | "queued" | "error";
  connectorId?: string;
  submittedAt?: string;
};

type TelegramConnectionDiagnosticsState = {
  checkedAt: string;
  botApiReachable?: boolean;
};

export type TelegramConnectionFormLabels = {
  botToken: string;
  botTokenAlreadySaved: string;
  botTokenPlaceholder: string;
  checking: string;
  connectBot: string;
  connecting: string;
  connectionDescription: string;
  failed: string;
  saveAndCheck: string;
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
  labels,
  lifecycleActions
}: {
  botTokenSecretRef?: string;
  channelExternalId: string;
  connectorId: string;
  defaultDisplayName: string;
  diagnostics: TelegramConnectionDiagnosticsState;
  labels: TelegramConnectionFormLabels;
  lifecycleActions: ReactNode;
}): ReactNode {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(
    connectTelegramIntegrationAction,
    initialConnectionState
  );
  const [isPolling, setIsPolling] = useState(false);
  const [pollingExpired, setPollingExpired] = useState(false);
  const pollingAttempts = useRef(0);
  const formId = useMemo(
    () =>
      `telegram-connection-form-${connectorId.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
    [connectorId]
  );
  const providerCheckUpdated = isProviderCheckUpdated({
    diagnostics,
    state
  });
  const isBusy = isPending || isPolling;
  const statusText = connectionStatusText({
    isPending,
    isPolling,
    labels,
    pollingExpired,
    providerCheckUpdated,
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
    if (!isPolling) {
      return;
    }

    if (providerCheckUpdated) {
      setIsPolling(false);
      return;
    }

    const interval = window.setInterval(() => {
      pollingAttempts.current += 1;
      router.refresh();

      if (pollingAttempts.current >= 20) {
        window.clearInterval(interval);
        setIsPolling(false);
        setPollingExpired(true);
      }
    }, 2_000);

    return () => window.clearInterval(interval);
  }, [isPolling, providerCheckUpdated, router]);

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
        <input type="hidden" name="setupStepCompleted" value="mode" />
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
            <input
              className="textInput"
              type="password"
              name="botToken"
              placeholder={labels.botTokenPlaceholder}
              required={!botTokenSecretRef}
            />
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
            <KeyRound size={16} aria-hidden="true" />
          )}
          {isBusy
            ? labels.connecting
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

function isProviderCheckUpdated(input: {
  diagnostics: TelegramConnectionDiagnosticsState;
  state: TelegramConnectionActionState;
}): boolean {
  if (input.state.status !== "queued" || !input.state.submittedAt) {
    return false;
  }

  const checkedAt = Date.parse(input.diagnostics.checkedAt);
  const submittedAt = Date.parse(input.state.submittedAt);

  return (
    Number.isFinite(checkedAt) &&
    Number.isFinite(submittedAt) &&
    checkedAt >= submittedAt - 1_000 &&
    input.diagnostics.botApiReachable !== undefined
  );
}

function connectionStatusText(input: {
  isPending: boolean;
  isPolling: boolean;
  labels: TelegramConnectionFormLabels;
  pollingExpired: boolean;
  providerCheckUpdated: boolean;
  state: TelegramConnectionActionState;
}): string | undefined {
  if (input.isPending) {
    return input.labels.connecting;
  }

  if (input.isPolling) {
    return input.labels.checking;
  }

  if (input.state.status === "error") {
    return input.labels.failed;
  }

  if (input.providerCheckUpdated) {
    return input.labels.statusUpdated;
  }

  if (input.pollingExpired) {
    return input.labels.slow;
  }

  return undefined;
}
