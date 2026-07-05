"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { updatePlatformChannelProviderPolicyAction } from "./platform-channel-actions";
import {
  updatePlatformChannelCatalogOverrideAction,
  uploadPlatformChannelIconAction
} from "./platform-channel-catalog-actions";
import { updatePlatformEgressProviderPolicyAction } from "./platform-egress-actions";
import {
  initialPlatformActionState,
  type PlatformActionCode,
  type PlatformActionState
} from "./platform-action-state";

export type PlatformActionFormKind =
  | "updateChannelCatalog"
  | "updateChannelProviderPolicy"
  | "updateEgressProviderPolicy"
  | "uploadChannelIcon";

export type PlatformActionMessages = Record<PlatformActionCode, string>;

export function PlatformActionForm({
  actionKind,
  children,
  className,
  messages,
  resetOnSuccess = false
}: {
  readonly actionKind: PlatformActionFormKind;
  readonly children: ReactNode;
  readonly className: string;
  readonly messages: PlatformActionMessages;
  readonly resetOnSuccess?: boolean;
}): ReactNode {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const handledSuccessRef = useRef<string | undefined>(undefined);
  const [state, formAction, isPending] = useActionState(
    resolvePlatformAction(actionKind),
    initialPlatformActionState
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
      <PlatformActionNotice messages={messages} state={state} />
    </form>
  );
}

export function PlatformActionSubmitButton({
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

function PlatformActionNotice({
  messages,
  state
}: {
  readonly messages: PlatformActionMessages;
  readonly state: PlatformActionState;
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

function resolvePlatformAction(
  actionKind: PlatformActionFormKind
): (
  previousState: PlatformActionState,
  formData: FormData
) => Promise<PlatformActionState> {
  switch (actionKind) {
    case "updateChannelCatalog":
      return updatePlatformChannelCatalogOverrideAction;
    case "updateChannelProviderPolicy":
      return updatePlatformChannelProviderPolicyAction;
    case "updateEgressProviderPolicy":
      return updatePlatformEgressProviderPolicyAction;
    case "uploadChannelIcon":
      return uploadPlatformChannelIconAction;
  }
}
