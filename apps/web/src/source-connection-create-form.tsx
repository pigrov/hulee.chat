"use client";

import { LoaderCircle, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, type ReactNode } from "react";

import { createSourceConnectionAction } from "./actions";
import {
  initialSourceConnectionCreateActionState,
  type SourceConnectionCreateActionCode,
  type SourceConnectionCreateActionState
} from "./source-connection-create-action-state";

export type SourceConnectionCreateMessages = Record<
  SourceConnectionCreateActionCode,
  string
> & {
  readonly displayName: string;
  readonly webhookToken: string;
};

export function SourceConnectionCreateForm({
  clientMutationId,
  defaultDisplayName,
  label,
  messages,
  sourceName
}: {
  readonly clientMutationId: string;
  readonly defaultDisplayName: string;
  readonly label: string;
  readonly messages: SourceConnectionCreateMessages;
  readonly sourceName: string;
}): ReactNode {
  const router = useRouter();
  const handledSuccessRef = useRef<string | undefined>(undefined);
  const [state, formAction, isPending] = useActionState(
    createSourceConnectionAction,
    initialSourceConnectionCreateActionState
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
    router.refresh();
  }, [router, sourceName, state]);

  return (
    <form className="adminStack" action={formAction}>
      <input type="hidden" name="sourceName" value={sourceName} />
      <input type="hidden" name="clientMutationId" value={clientMutationId} />
      <label className="field">
        <span>{messages.displayName}</span>
        <input
          className="textInput"
          name="displayName"
          defaultValue={defaultDisplayName}
        />
      </label>
      <div className="buttonRow">
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
        <SourceConnectionCreateNotice messages={messages} state={state} />
      </div>
    </form>
  );
}

function SourceConnectionCreateNotice({
  messages,
  state
}: {
  readonly messages: SourceConnectionCreateMessages;
  readonly state: SourceConnectionCreateActionState;
}): ReactNode {
  if (state.status === "idle") {
    return null;
  }

  if (state.status === "success") {
    return (
      <div className="actionStateNotice" data-variant="success" role="status">
        <p>{messages.created}</p>
        {state.webhookToken ? (
          <p>
            {messages.webhookToken}: <code>{state.webhookToken}</code>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <p className="actionStateNotice" data-variant="error" role="status">
      {messages[state.code]}
    </p>
  );
}
