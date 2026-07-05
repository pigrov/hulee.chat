"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import {
  setOrgUnitStatusAction,
  setWorkQueueStatusAction,
  upsertOrgUnitAction,
  upsertTeamAction,
  upsertWorkQueueAction
} from "./org-structure-actions";
import {
  initialOrgStructureActionState,
  type OrgStructureActionCode,
  type OrgStructureActionState
} from "./org-structure-action-state";

export type OrgStructureActionFormKind =
  | "setOrgUnitStatus"
  | "setWorkQueueStatus"
  | "upsertOrgUnit"
  | "upsertTeam"
  | "upsertWorkQueue";

export type OrgStructureActionMessages = Record<OrgStructureActionCode, string>;

export function OrgStructureActionForm({
  actionKind,
  children,
  className,
  messages,
  resetOnSuccess = false
}: {
  readonly actionKind: OrgStructureActionFormKind;
  readonly children: ReactNode;
  readonly className: string;
  readonly messages: OrgStructureActionMessages;
  readonly resetOnSuccess?: boolean;
}): ReactNode {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const handledSuccessRef = useRef<string | undefined>(undefined);
  const [state, formAction, isPending] = useActionState(
    resolveOrgStructureAction(actionKind),
    initialOrgStructureActionState
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
      <OrgStructureActionNotice messages={messages} state={state} />
    </form>
  );
}

export function OrgStructureSubmitButton({
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

function OrgStructureActionNotice({
  messages,
  state
}: {
  readonly messages: OrgStructureActionMessages;
  readonly state: OrgStructureActionState;
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
      {messages[state.code]}
    </p>
  );
}

function resolveOrgStructureAction(
  actionKind: OrgStructureActionFormKind
): (
  previousState: OrgStructureActionState,
  formData: FormData
) => Promise<OrgStructureActionState> {
  switch (actionKind) {
    case "setOrgUnitStatus":
      return setOrgUnitStatusAction;
    case "setWorkQueueStatus":
      return setWorkQueueStatusAction;
    case "upsertOrgUnit":
      return upsertOrgUnitAction;
    case "upsertTeam":
      return upsertTeamAction;
    case "upsertWorkQueue":
      return upsertWorkQueueAction;
  }
}
