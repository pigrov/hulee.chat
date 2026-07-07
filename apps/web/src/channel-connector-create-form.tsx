"use client";

import { LoaderCircle, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, type ReactNode } from "react";

import { createChannelConnectorAction } from "./actions";
import {
  initialChannelConnectorCreateActionState,
  type ChannelConnectorCreateActionCode,
  type ChannelConnectorCreateActionState
} from "./channel-connector-create-action-state";

export type ChannelConnectorCreateMessages = Record<
  ChannelConnectorCreateActionCode,
  string
>;

export function ChannelConnectorCreateForm({
  channelType,
  label,
  messages,
  redirectTab
}: {
  readonly channelType: string;
  readonly label: string;
  readonly messages: ChannelConnectorCreateMessages;
  readonly redirectTab?: "accounts" | "channels";
}): ReactNode {
  const router = useRouter();
  const handledSuccessRef = useRef<string | undefined>(undefined);
  const [state, formAction, isPending] = useActionState(
    createChannelConnectorAction,
    initialChannelConnectorCreateActionState
  );
  const isNavigating = state.status === "success";

  useEffect(() => {
    if (
      state.status !== "success" ||
      handledSuccessRef.current === state.submittedAt
    ) {
      return;
    }

    handledSuccessRef.current = state.submittedAt;
    const params = new URLSearchParams({
      connectorId: state.connectorId
    });

    if (redirectTab) {
      params.set("tab", redirectTab);
    }

    router.push(`/admin/integrations?${params.toString()}`);
  }, [redirectTab, router, state]);

  return (
    <form className="buttonRow" action={formAction}>
      <input type="hidden" name="channelType" value={channelType} />
      <button
        className="primaryButton"
        disabled={isPending || isNavigating}
        type="submit"
      >
        {isPending || isNavigating ? (
          <LoaderCircle
            className="buttonSpinner"
            size={16}
            aria-hidden="true"
          />
        ) : (
          <Plus size={16} aria-hidden="true" />
        )}
        {label}
      </button>
      <ChannelConnectorCreateNotice messages={messages} state={state} />
    </form>
  );
}

function ChannelConnectorCreateNotice({
  messages,
  state
}: {
  readonly messages: ChannelConnectorCreateMessages;
  readonly state: ChannelConnectorCreateActionState;
}): ReactNode {
  if (state.status === "idle" || state.status === "success") {
    return null;
  }

  return (
    <p className="actionStateNotice" data-variant="error" role="status">
      {messages[state.code]}
    </p>
  );
}
