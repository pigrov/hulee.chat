"use client";

import { LoaderCircle, Power, PowerOff, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useActionState, useEffect, useRef, type ReactNode } from "react";

import { updateChannelConnectorLifecycleAction } from "./actions";
import {
  initialChannelConnectorLifecycleActionState,
  type ChannelConnectorLifecycleActionCode
} from "./channel-connector-lifecycle-action-state";

export type ChannelConnectorLifecycleLabels = {
  readonly deleteConnector: string;
  readonly disableConnector: string;
  readonly enableConnector: string;
};

export type ChannelConnectorLifecycleMessages = Record<
  ChannelConnectorLifecycleActionCode,
  string
>;

export function ChannelConnectorLifecycleActions({
  connectorId,
  labels,
  messages,
  status
}: {
  readonly connectorId: string;
  readonly labels: ChannelConnectorLifecycleLabels;
  readonly messages: ChannelConnectorLifecycleMessages;
  readonly status: string | undefined;
}): ReactNode {
  const router = useRouter();
  const searchParams = useSearchParams();
  const handledSuccessRef = useRef<string | undefined>(undefined);
  const [state, formAction, isPending] = useActionState(
    updateChannelConnectorLifecycleAction,
    initialChannelConnectorLifecycleActionState
  );

  useEffect(() => {
    if (
      state.status !== "success" ||
      handledSuccessRef.current === state.submittedAt
    ) {
      return;
    }

    handledSuccessRef.current = state.submittedAt;

    if (state.code === "deleted") {
      router.push(integrationListPath(searchParams.get("tab")));
      return;
    }

    router.refresh();
  }, [router, searchParams, state]);

  return (
    <div className="channelLifecycleActionStack">
      <div className="buttonRow">
        {status === "disabled" ? (
          <form action={formAction}>
            <LifecycleFields connectorId={connectorId} intent="enable" />
            <button
              className="secondaryButton"
              disabled={isPending}
              type="submit"
            >
              {isPending ? (
                <LoaderCircle
                  className="buttonSpinner"
                  size={16}
                  aria-hidden="true"
                />
              ) : (
                <Power size={16} aria-hidden="true" />
              )}
              {labels.enableConnector}
            </button>
          </form>
        ) : (
          <form action={formAction}>
            <LifecycleFields connectorId={connectorId} intent="disable" />
            <button
              className="secondaryButton"
              disabled={isPending}
              type="submit"
            >
              {isPending ? (
                <LoaderCircle
                  className="buttonSpinner"
                  size={16}
                  aria-hidden="true"
                />
              ) : (
                <PowerOff size={16} aria-hidden="true" />
              )}
              {labels.disableConnector}
            </button>
          </form>
        )}
        <form action={formAction}>
          <LifecycleFields connectorId={connectorId} intent="delete" />
          <button className="dangerButton" disabled={isPending} type="submit">
            <Trash2 size={16} aria-hidden="true" />
            {labels.deleteConnector}
          </button>
        </form>
      </div>
      {state.status !== "idle" ? (
        <p
          className="actionStateNotice"
          data-variant={state.status === "success" ? "success" : "error"}
          role="status"
        >
          {messages[state.code]}
        </p>
      ) : null}
    </div>
  );
}

function integrationListPath(tab: string | null): string {
  return tab === "accounts" || tab === "channels"
    ? `/admin/integrations?tab=${tab}`
    : "/admin/integrations";
}

function LifecycleFields({
  connectorId,
  intent
}: {
  readonly connectorId: string;
  readonly intent: "delete" | "disable" | "enable";
}): ReactNode {
  return (
    <>
      <input type="hidden" name="connectorId" value={connectorId} />
      <input type="hidden" name="intent" value={intent} />
    </>
  );
}
