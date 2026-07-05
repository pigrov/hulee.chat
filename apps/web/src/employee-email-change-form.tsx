"use client";

import { LoaderCircle, MailCheck, Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";

import {
  initialEmployeeEmailChangeActionState,
  type EmployeeEmailChangeActionCode
} from "./employee-email-change-action-state";
import { requestEmployeeEmailChangeAction } from "./employee-actions";
import { EmailInput } from "./contact-fields";

export type EmployeeEmailChangeFormLabels = {
  readonly cancel: string;
  readonly changeEmail: string;
  readonly currentEmail: string;
  readonly emailPlaceholder: string;
  readonly newEmail: string;
  readonly requestChange: string;
  readonly requestingChange: string;
};

export type EmployeeEmailChangeFormMessages = Record<
  EmployeeEmailChangeActionCode,
  string
>;

export function EmployeeEmailChangeForm({
  currentEmail,
  disabled,
  employeeId,
  labels,
  messages
}: {
  readonly currentEmail: string;
  readonly disabled: boolean;
  readonly employeeId: string;
  readonly labels: EmployeeEmailChangeFormLabels;
  readonly messages: EmployeeEmailChangeFormMessages;
}): ReactNode {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [state, formAction, isPending] = useActionState(
    requestEmployeeEmailChangeAction,
    initialEmployeeEmailChangeActionState
  );
  const formRef = useRef<HTMLFormElement | null>(null);
  const refreshedSubmissionRef = useRef<string | undefined>(undefined);
  const isBusy = disabled || isPending;
  const submittedAt = state.status === "idle" ? undefined : state.submittedAt;
  const notice =
    state.status === "idle"
      ? undefined
      : {
          message: messages[state.code],
          variant: state.status === "success" ? "success" : "error"
        };

  useEffect(() => {
    if (
      state.status !== "success" ||
      refreshedSubmissionRef.current === submittedAt ||
      submittedAt === undefined
    ) {
      return;
    }

    refreshedSubmissionRef.current = submittedAt;
    formRef.current?.reset();
    setEditing(false);
    router.refresh();
  }, [router, state.status, submittedAt]);

  return (
    <div className="employeeEmailChangeBlock">
      <div className="employeeEmailReadOnlyRow">
        <label className="fieldStack">
          <span className="detailLabel">{labels.currentEmail}</span>
          <input
            className="textInput"
            readOnly
            type="email"
            value={currentEmail}
          />
        </label>
        {!editing ? (
          <button
            className="secondaryButton"
            disabled={disabled}
            onClick={() => setEditing(true)}
            type="button"
          >
            <Pencil size={18} aria-hidden="true" />
            {labels.changeEmail}
          </button>
        ) : null}
      </div>

      {editing ? (
        <form
          action={formAction}
          className="settingsForm employeeEmailChangeForm"
          ref={formRef}
        >
          <input name="employeeId" type="hidden" value={employeeId} />
          <label className="fieldStack">
            <span className="detailLabel">{labels.newEmail}</span>
            <EmailInput
              className="textInput"
              disabled={isBusy}
              name="email"
              placeholder={labels.emailPlaceholder}
              required
            />
          </label>
          <div className="rowActions">
            <button className="primaryButton" disabled={isBusy} type="submit">
              {isPending ? (
                <LoaderCircle
                  className="buttonSpinner"
                  size={18}
                  aria-hidden="true"
                />
              ) : (
                <MailCheck size={18} aria-hidden="true" />
              )}
              {isPending ? labels.requestingChange : labels.requestChange}
            </button>
            <button
              className="secondaryButton"
              disabled={isBusy}
              onClick={() => setEditing(false)}
              type="button"
            >
              <X size={18} aria-hidden="true" />
              {labels.cancel}
            </button>
          </div>
        </form>
      ) : null}

      {notice ? (
        <p
          className="actionStateNotice"
          data-variant={notice.variant}
          role={state.status === "error" ? "alert" : "status"}
        >
          {notice.message}
        </p>
      ) : null}
    </div>
  );
}
