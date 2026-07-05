"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import {
  deactivateEmployeeAction,
  inviteEmployeeAction,
  resendEmployeeInviteAction,
  revokeEmployeeInviteAction
} from "./employee-actions";
import {
  initialEmployeeAdminActionState,
  type EmployeeAdminActionCode,
  type EmployeeAdminActionState
} from "./employee-admin-action-state";

export type EmployeeAdminActionFormKind =
  | "deactivateEmployee"
  | "inviteEmployee"
  | "resendInvite"
  | "revokeInvite";

export type EmployeeAdminActionMessages = Record<
  EmployeeAdminActionCode,
  string
>;

export function EmployeeAdminActionForm({
  actionKind,
  children,
  className,
  manualInviteLinkLabel,
  messages,
  resetOnSuccess = false
}: {
  readonly actionKind: EmployeeAdminActionFormKind;
  readonly children: ReactNode;
  readonly className: string;
  readonly manualInviteLinkLabel: string;
  readonly messages: EmployeeAdminActionMessages;
  readonly resetOnSuccess?: boolean;
}): ReactNode {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const handledResultRef = useRef<string | undefined>(undefined);
  const [state, formAction, isPending] = useActionState(
    resolveEmployeeAdminAction(actionKind),
    initialEmployeeAdminActionState
  );

  useEffect(() => {
    if (
      state.status === "idle" ||
      handledResultRef.current === state.submittedAt
    ) {
      return;
    }

    handledResultRef.current = state.submittedAt;

    if (resetOnSuccess && state.status !== "error") {
      formRef.current?.reset();
    }

    router.refresh();
  }, [resetOnSuccess, router, state]);

  return (
    <form ref={formRef} action={formAction} className={className}>
      <fieldset className="settingsFormFieldset" disabled={isPending}>
        {children}
      </fieldset>
      <EmployeeAdminActionNotice messages={messages} state={state} />
      <EmployeeAdminInviteLink label={manualInviteLinkLabel} state={state} />
    </form>
  );
}

export function EmployeeAdminSubmitButton({
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

function EmployeeAdminActionNotice({
  messages,
  state
}: {
  readonly messages: EmployeeAdminActionMessages;
  readonly state: EmployeeAdminActionState;
}): ReactNode {
  if (state.status === "idle") {
    return null;
  }

  return (
    <p
      className="actionStateNotice"
      data-variant={state.status === "info" ? "info" : state.status}
      role="status"
    >
      {messages[state.code]}
    </p>
  );
}

function EmployeeAdminInviteLink({
  label,
  state
}: {
  readonly label: string;
  readonly state: EmployeeAdminActionState;
}): ReactNode {
  if (!("manualInviteUrl" in state) || !state.manualInviteUrl) {
    return null;
  }

  return (
    <label className="fieldStack">
      <span className="detailLabel">{label}</span>
      <input
        className="textInput"
        type="url"
        readOnly
        value={state.manualInviteUrl}
      />
    </label>
  );
}

function resolveEmployeeAdminAction(
  actionKind: EmployeeAdminActionFormKind
): (
  previousState: EmployeeAdminActionState,
  formData: FormData
) => Promise<EmployeeAdminActionState> {
  switch (actionKind) {
    case "deactivateEmployee":
      return deactivateEmployeeAction;
    case "inviteEmployee":
      return inviteEmployeeAction;
    case "resendInvite":
      return resendEmployeeInviteAction;
    case "revokeInvite":
      return revokeEmployeeInviteAction;
  }
}
