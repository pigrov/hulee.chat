"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import {
  cancelChannelAuthChallengeAction,
  startChannelAuthChallengeAction,
  submitChannelAuthChallengeAction
} from "./actions";
import {
  initialChannelAuthChallengeActionState,
  type ChannelAuthChallengeActionMessages,
  type ChannelAuthChallengeActionState
} from "./channel-auth-challenge-action-state";

export type ChannelAuthChallengeActionKind = "cancel" | "start" | "submit";

export function ChannelAuthChallengeActionForm({
  actionKind,
  children,
  className,
  messages
}: {
  readonly actionKind: ChannelAuthChallengeActionKind;
  readonly children: ReactNode;
  readonly className?: string;
  readonly messages: ChannelAuthChallengeActionMessages;
}): ReactNode {
  const router = useRouter();
  const searchParams = useSearchParams();
  const handledSuccessRef = useRef<string | undefined>(undefined);
  const [state, formAction, isPending] = useActionState(
    resolveChannelAuthChallengeAction(actionKind),
    initialChannelAuthChallengeActionState
  );

  useEffect(() => {
    if (
      state.status !== "success" ||
      handledSuccessRef.current === state.submittedAt
    ) {
      return;
    }

    handledSuccessRef.current = state.submittedAt;
    const nextPath = channelAuthChallengePath(state, searchParams.get("tab"));

    if (nextPath) {
      router.replace(nextPath);
    }

    router.refresh();
  }, [router, searchParams, state]);

  return (
    <form className={className} action={formAction}>
      <fieldset className="settingsFormFieldset" disabled={isPending}>
        {children}
      </fieldset>
      <ChannelAuthChallengeActionNotice messages={messages} state={state} />
    </form>
  );
}

export function ChannelAuthChallengeSubmitButton({
  children,
  className,
  disabled = false,
  label
}: {
  readonly children: ReactNode;
  readonly className: string;
  readonly disabled?: boolean;
  readonly label: string;
}): ReactNode {
  const { pending } = useFormStatus();

  return (
    <button className={className} disabled={disabled || pending} type="submit">
      {pending ? (
        <LoaderCircle className="buttonSpinner" size={14} aria-hidden="true" />
      ) : (
        children
      )}
      {label}
    </button>
  );
}

function ChannelAuthChallengeActionNotice({
  messages,
  state
}: {
  readonly messages: ChannelAuthChallengeActionMessages;
  readonly state: ChannelAuthChallengeActionState;
}): ReactNode {
  if (state.status === "idle") {
    return null;
  }

  return (
    <p className="actionStateNotice" data-variant={state.status} role="status">
      {messages[state.code]}
    </p>
  );
}

function resolveChannelAuthChallengeAction(
  actionKind: ChannelAuthChallengeActionKind
): (
  previousState: ChannelAuthChallengeActionState,
  formData: FormData
) => Promise<ChannelAuthChallengeActionState> {
  switch (actionKind) {
    case "cancel":
      return cancelChannelAuthChallengeAction;
    case "start":
      return startChannelAuthChallengeAction;
    case "submit":
      return submitChannelAuthChallengeAction;
  }
}

function channelAuthChallengePath(
  state: Extract<ChannelAuthChallengeActionState, { status: "success" }>,
  tab: string | null
): string {
  const params = new URLSearchParams({
    connectorId: state.connectorId
  });

  if (tab === "accounts" || tab === "channels") {
    params.set("tab", tab);
  }

  if (state.challengeId) {
    params.set("challengeId", state.challengeId);
  }

  return `/admin/integrations?${params.toString()}`;
}
