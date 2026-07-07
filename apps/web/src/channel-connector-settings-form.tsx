"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, type ReactNode } from "react";

import { updateChannelConnectorSettingsAction } from "./actions";
import {
  initialChannelConnectorSettingsActionState,
  type ChannelConnectorSettingsActionCode
} from "./channel-connector-settings-action-state";

export type ChannelConnectorSettingsLabels = {
  readonly displayName: string;
  readonly save: string;
  readonly saving: string;
};

export type ChannelConnectorSettingsMessages = Record<
  ChannelConnectorSettingsActionCode,
  string
>;

export function ChannelConnectorSettingsForm({
  connectorId,
  defaultDisplayName,
  labels,
  lifecycleActions,
  messages
}: {
  readonly connectorId: string;
  readonly defaultDisplayName: string;
  readonly labels: ChannelConnectorSettingsLabels;
  readonly lifecycleActions: ReactNode;
  readonly messages: ChannelConnectorSettingsMessages;
}): ReactNode {
  const router = useRouter();
  const handledSuccessRef = useRef<string | undefined>(undefined);
  const [state, formAction, isPending] = useActionState(
    updateChannelConnectorSettingsAction,
    initialChannelConnectorSettingsActionState
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

  const formId = `channel-connector-settings-${connectorId.replace(
    /[^a-zA-Z0-9_-]/g,
    "-"
  )}`;

  return (
    <>
      <form
        id={formId}
        className="settingsForm setupStepPanel"
        action={formAction}
      >
        <input type="hidden" name="connectorId" value={connectorId} />
        <fieldset className="settingsFormFieldset" disabled={isPending}>
          <label className="fieldStack">
            <span className="detailLabel">{labels.displayName}</span>
            <input
              className="textInput"
              name="displayName"
              defaultValue={defaultDisplayName}
              required
            />
          </label>
        </fieldset>
      </form>

      <div
        className="buttonRow telegramConnectionActions"
        data-busy={isPending ? "true" : "false"}
      >
        <button
          className="primaryButton"
          disabled={isPending}
          form={formId}
          type="submit"
        >
          {isPending ? (
            <LoaderCircle
              className="buttonSpinner"
              size={16}
              aria-hidden="true"
            />
          ) : (
            <Check size={16} aria-hidden="true" />
          )}
          {isPending ? labels.saving : labels.save}
        </button>
        <div className="telegramLifecycleActions" aria-disabled={isPending}>
          {lifecycleActions}
        </div>
      </div>

      {state.status !== "idle" ? (
        <p
          className="actionStateNotice"
          data-variant={state.status}
          role="status"
        >
          {messages[state.code]}
        </p>
      ) : null}
    </>
  );
}
