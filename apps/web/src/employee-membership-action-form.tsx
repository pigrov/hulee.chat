"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import {
  setEmployeeOrgUnitMembershipsAction,
  setEmployeeTeamMembershipsAction,
  setEmployeeWorkQueueMembershipsAction
} from "./employee-membership-actions";
import {
  initialEmployeeMembershipActionState,
  type EmployeeMembershipActionCode,
  type EmployeeMembershipActionState
} from "./employee-membership-action-state";
import { ReauthLink } from "./reauth-link";

export type EmployeeMembershipActionFormKind =
  | "setOrgUnitMemberships"
  | "setTeamMemberships"
  | "setWorkQueueMemberships";

export type EmployeeMembershipActionMessages = Record<
  EmployeeMembershipActionCode,
  string
>;

export function EmployeeMembershipActionForm({
  actionKind,
  children,
  className,
  messages,
  reauthLabel
}: {
  readonly actionKind: EmployeeMembershipActionFormKind;
  readonly children: ReactNode;
  readonly className: string;
  readonly messages: EmployeeMembershipActionMessages;
  readonly reauthLabel?: string;
}): ReactNode {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const handledSuccessRef = useRef<string | undefined>(undefined);
  const [state, formAction, isPending] = useActionState(
    resolveEmployeeMembershipAction(actionKind),
    initialEmployeeMembershipActionState
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
    <form ref={formRef} action={formAction} className={className}>
      <fieldset className="settingsFormFieldset" disabled={isPending}>
        {children}
      </fieldset>
      <EmployeeMembershipActionNotice
        messages={messages}
        reauthLabel={reauthLabel}
        state={state}
      />
    </form>
  );
}

export function EmployeeMembershipSubmitButton({
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

function EmployeeMembershipActionNotice({
  messages,
  reauthLabel,
  state
}: {
  readonly messages: EmployeeMembershipActionMessages;
  readonly reauthLabel?: string;
  readonly state: EmployeeMembershipActionState;
}): ReactNode {
  if (state.status === "idle") {
    return null;
  }

  return (
    <p
      className="actionStateNotice"
      data-variant={state.status === "success" ? "success" : "error"}
      role="status"
    >
      <span>{messages[state.code]}</span>
      {state.code === "reauth_required" && reauthLabel ? (
        <ReauthLink className="actionStateNoticeLink" label={reauthLabel} />
      ) : null}
    </p>
  );
}

function resolveEmployeeMembershipAction(
  actionKind: EmployeeMembershipActionFormKind
): (
  previousState: EmployeeMembershipActionState,
  formData: FormData
) => Promise<EmployeeMembershipActionState> {
  switch (actionKind) {
    case "setOrgUnitMemberships":
      return setEmployeeOrgUnitMembershipsAction;
    case "setTeamMemberships":
      return setEmployeeTeamMembershipsAction;
    case "setWorkQueueMemberships":
      return setEmployeeWorkQueueMembershipsAction;
  }
}
