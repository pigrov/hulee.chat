"use client";

import { LoaderCircle } from "lucide-react";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import {
  forgotPasswordAction,
  loginAction,
  registerAction,
  resetPasswordAction,
  selectTenantLoginAction
} from "./auth-actions";
import {
  initialAuthActionState,
  type AuthActionMessages,
  type AuthActionState
} from "./auth-action-state";
import { acceptEmployeeInviteAction } from "./employee-actions";

export type AuthActionFormKind =
  | "acceptInvite"
  | "forgotPassword"
  | "login"
  | "register"
  | "resetPassword"
  | "selectTenant";

export function AuthActionForm({
  actionKind,
  children,
  className,
  messages,
  resetOnSuccess = false
}: {
  readonly actionKind: AuthActionFormKind;
  readonly children: ReactNode;
  readonly className: string;
  readonly messages: AuthActionMessages;
  readonly resetOnSuccess?: boolean;
}): ReactNode {
  const formRef = useRef<HTMLFormElement | null>(null);
  const handledSuccessRef = useRef<string | undefined>(undefined);
  const [state, formAction, isPending] = useActionState(
    resolveAuthAction(actionKind),
    initialAuthActionState
  );

  useEffect(() => {
    if (
      !resetOnSuccess ||
      state.status !== "success" ||
      handledSuccessRef.current === state.submittedAt
    ) {
      return;
    }

    handledSuccessRef.current = state.submittedAt;
    formRef.current?.reset();
  }, [resetOnSuccess, state]);

  return (
    <form ref={formRef} className={className} action={formAction}>
      <fieldset className="settingsFormFieldset" disabled={isPending}>
        {children}
      </fieldset>
      <AuthActionNotice messages={messages} state={state} />
    </form>
  );
}

export function AuthSubmitButton({
  children,
  className,
  label
}: {
  readonly children: ReactNode;
  readonly className: string;
  readonly label: string;
}): ReactNode {
  const { pending } = useFormStatus();

  return (
    <button className={className} disabled={pending} type="submit">
      {pending ? (
        <LoaderCircle className="buttonSpinner" size={14} aria-hidden="true" />
      ) : (
        children
      )}
      {label}
    </button>
  );
}

function AuthActionNotice({
  messages,
  state
}: {
  readonly messages: AuthActionMessages;
  readonly state: AuthActionState;
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

function resolveAuthAction(
  actionKind: AuthActionFormKind
): (
  previousState: AuthActionState,
  formData: FormData
) => Promise<AuthActionState> {
  switch (actionKind) {
    case "acceptInvite":
      return acceptEmployeeInviteAction;
    case "forgotPassword":
      return forgotPasswordAction;
    case "login":
      return loginAction;
    case "register":
      return registerAction;
    case "resetPassword":
      return resetPasswordAction;
    case "selectTenant":
      return selectTenantLoginAction;
  }
}
