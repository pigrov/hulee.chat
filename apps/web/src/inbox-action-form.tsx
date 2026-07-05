"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { sendReplyAction, updateConversationRoutingAction } from "./actions";
import {
  initialInboxReplyActionState,
  initialInboxRoutingActionState,
  type InboxReplyActionMessages,
  type InboxReplyActionState,
  type InboxRoutingActionMessages,
  type InboxRoutingActionState
} from "./inbox-action-state";

export function InboxReplyActionForm({
  children,
  className,
  messages
}: {
  readonly children: ReactNode;
  readonly className: string;
  readonly messages: InboxReplyActionMessages;
}): ReactNode {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const handledSuccessRef = useRef<string | undefined>(undefined);
  const [state, formAction, isPending] = useActionState(
    sendReplyAction,
    initialInboxReplyActionState
  );

  useEffect(() => {
    if (
      state.status !== "success" ||
      handledSuccessRef.current === state.submittedAt
    ) {
      return;
    }

    handledSuccessRef.current = state.submittedAt;
    formRef.current?.reset();
    router.refresh();
  }, [router, state]);

  return (
    <form ref={formRef} className={className} action={formAction}>
      <fieldset className="settingsFormFieldset" disabled={isPending}>
        {children}
      </fieldset>
      <InboxActionNotice messages={messages} state={state} />
    </form>
  );
}

export function InboxRoutingActionForm({
  children,
  className,
  messages
}: {
  readonly children: ReactNode;
  readonly className: string;
  readonly messages: InboxRoutingActionMessages;
}): ReactNode {
  const router = useRouter();
  const handledSuccessRef = useRef<string | undefined>(undefined);
  const [state, formAction, isPending] = useActionState(
    updateConversationRoutingAction,
    initialInboxRoutingActionState
  );

  useEffect(() => {
    if (
      state.status !== "success" ||
      handledSuccessRef.current === state.submittedAt
    ) {
      return;
    }

    handledSuccessRef.current = state.submittedAt;
    router.refresh();
  }, [router, state]);

  return (
    <form className={className} action={formAction}>
      <fieldset className="settingsFormFieldset" disabled={isPending}>
        {children}
      </fieldset>
      <InboxActionNotice messages={messages} state={state} />
    </form>
  );
}

export function InboxActionSubmitButton({
  ariaLabel,
  children,
  className,
  disabled = false,
  label,
  labelVisible = true
}: {
  readonly ariaLabel?: string;
  readonly children: ReactNode;
  readonly className: string;
  readonly disabled?: boolean;
  readonly label: string;
  readonly labelVisible?: boolean;
}): ReactNode {
  const { pending } = useFormStatus();

  return (
    <button
      aria-label={ariaLabel}
      className={className}
      disabled={disabled || pending}
      type="submit"
    >
      {pending ? (
        <LoaderCircle className="buttonSpinner" size={14} aria-hidden="true" />
      ) : (
        children
      )}
      {labelVisible ? label : null}
    </button>
  );
}

function InboxActionNotice({
  messages,
  state
}: {
  readonly messages: Record<string, string>;
  readonly state: InboxReplyActionState | InboxRoutingActionState;
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
