"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import {
  archiveCustomTenantRoleAction,
  assignTenantRoleAction,
  createCustomTenantRoleAction,
  createDirectPermissionGrantAction,
  createRoleFromTemplateAction,
  restoreCustomTenantRoleAction,
  revokeDirectPermissionGrantAction,
  revokeTenantRoleBindingAction,
  updateCustomTenantRoleAction
} from "./role-actions";
import {
  initialRoleActionState,
  type RoleActionCode,
  type RoleActionState
} from "./role-action-state";
import { ReauthLink } from "./reauth-link";

export type RoleActionFormKind =
  | "archiveRole"
  | "assignRole"
  | "createDirectGrant"
  | "createRole"
  | "createRoleFromTemplate"
  | "restoreRole"
  | "revokeDirectGrant"
  | "revokeRoleBinding"
  | "updateRole";

export type RoleActionMessages = Record<RoleActionCode, string>;

export function RoleActionForm({
  actionKind,
  children,
  className,
  messages,
  reauthLabel,
  resetOnSuccess = false
}: {
  readonly actionKind: RoleActionFormKind;
  readonly children: ReactNode;
  readonly className: string;
  readonly messages: RoleActionMessages;
  readonly reauthLabel?: string;
  readonly resetOnSuccess?: boolean;
}): ReactNode {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const handledSuccessRef = useRef<string | undefined>(undefined);
  const [state, formAction, isPending] = useActionState(
    resolveRoleAction(actionKind),
    initialRoleActionState
  );

  useEffect(() => {
    if (
      state.status !== "success" ||
      handledSuccessRef.current === state.submittedAt
    ) {
      return;
    }

    handledSuccessRef.current = state.submittedAt;

    if (resetOnSuccess) {
      formRef.current?.reset();
    }

    router.refresh();
  }, [resetOnSuccess, router, state]);

  return (
    <form ref={formRef} className={className} action={formAction}>
      <fieldset className="settingsFormFieldset" disabled={isPending}>
        {children}
      </fieldset>
      <RoleActionNotice
        messages={messages}
        reauthLabel={reauthLabel}
        state={state}
      />
    </form>
  );
}

export function RoleActionSubmitButton({
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

function RoleActionNotice({
  messages,
  reauthLabel,
  state
}: {
  readonly messages: RoleActionMessages;
  readonly reauthLabel?: string;
  readonly state: RoleActionState;
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

function resolveRoleAction(
  actionKind: RoleActionFormKind
): (
  previousState: RoleActionState,
  formData: FormData
) => Promise<RoleActionState> {
  switch (actionKind) {
    case "archiveRole":
      return archiveCustomTenantRoleAction;
    case "assignRole":
      return assignTenantRoleAction;
    case "createDirectGrant":
      return createDirectPermissionGrantAction;
    case "createRole":
      return createCustomTenantRoleAction;
    case "createRoleFromTemplate":
      return createRoleFromTemplateAction;
    case "restoreRole":
      return restoreCustomTenantRoleAction;
    case "revokeDirectGrant":
      return revokeDirectPermissionGrantAction;
    case "revokeRoleBinding":
      return revokeTenantRoleBindingAction;
    case "updateRole":
      return updateCustomTenantRoleAction;
  }
}
