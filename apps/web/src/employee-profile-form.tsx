"use client";

import { Camera, LoaderCircle, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode
} from "react";

import {
  initialEmployeeProfileActionState,
  type EmployeeProfileActionCode
} from "./employee-profile-action-state";
import { updateEmployeeProfileAction } from "./employee-actions";
import { PhoneNumberInput } from "./contact-fields";

export type EmployeeProfileFormLabels = {
  readonly avatar: string;
  readonly avatarCurrent: string;
  readonly avatarRecommendation: string;
  readonly displayName: string;
  readonly phoneNumber: string;
  readonly phonePlaceholder: string;
  readonly saveProfile: string;
  readonly savingProfile: string;
};

export type EmployeeProfileFormMessages = Record<
  EmployeeProfileActionCode,
  string
>;

const maxEmployeeAvatarBytes = 2 * 1024 * 1024;
const employeeAvatarMediaTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp"
]);

export function EmployeeProfileForm({
  avatarUrl,
  defaultDisplayName,
  defaultPhoneNumber,
  disabled,
  employeeId,
  labels,
  messages
}: {
  readonly avatarUrl: string | null;
  readonly defaultDisplayName: string;
  readonly defaultPhoneNumber: string | null;
  readonly disabled: boolean;
  readonly employeeId: string;
  readonly labels: EmployeeProfileFormLabels;
  readonly messages: EmployeeProfileFormMessages;
}): ReactNode {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(
    updateEmployeeProfileAction,
    initialEmployeeProfileActionState
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const avatarObjectUrlRef = useRef<string | null>(null);
  const refreshedSubmissionRef = useRef<string | undefined>(undefined);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [clientErrorCode, setClientErrorCode] =
    useState<EmployeeProfileActionCode | null>(null);
  const isBusy = disabled || isPending;
  const submittedAt = state.status === "idle" ? undefined : state.submittedAt;
  const notice =
    clientErrorCode !== null
      ? {
          message: messages[clientErrorCode],
          variant: "error"
        }
      : state.status === "idle"
        ? undefined
        : {
            message: messages[state.code],
            variant: state.status === "success" ? "success" : "error"
          };

  const clearAvatarPreview = useCallback(() => {
    if (avatarObjectUrlRef.current !== null) {
      URL.revokeObjectURL(avatarObjectUrlRef.current);
      avatarObjectUrlRef.current = null;
    }

    setAvatarPreviewUrl(null);
  }, []);

  const handleAvatarFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];

      clearAvatarPreview();
      setClientErrorCode(null);

      if (file === undefined) {
        return;
      }

      const errorCode = validateAvatarFile(file);

      if (errorCode !== null) {
        event.currentTarget.value = "";
        setClientErrorCode(errorCode);
        return;
      }

      const previewUrl = URL.createObjectURL(file);
      avatarObjectUrlRef.current = previewUrl;
      setAvatarPreviewUrl(previewUrl);
    },
    [clearAvatarPreview]
  );

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    const file = fileInputRef.current?.files?.[0];
    const errorCode = file === undefined ? null : validateAvatarFile(file);

    if (errorCode === null) {
      setClientErrorCode(null);
      return;
    }

    event.preventDefault();
    setClientErrorCode(errorCode);
  }, []);

  useEffect(() => clearAvatarPreview, [clearAvatarPreview]);

  useEffect(() => {
    if (
      state.status !== "success" ||
      refreshedSubmissionRef.current === submittedAt ||
      submittedAt === undefined
    ) {
      return;
    }

    refreshedSubmissionRef.current = submittedAt;

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    clearAvatarPreview();
    router.refresh();
  }, [clearAvatarPreview, router, state.status, submittedAt]);

  return (
    <form
      action={formAction}
      className="settingsForm employeeProfileForm"
      onSubmit={handleSubmit}
    >
      <input name="employeeId" type="hidden" value={employeeId} />
      <fieldset className="settingsFormFieldset" disabled={isBusy}>
        <div className="employeeAvatarUploadGrid">
          <div
            className="employeeAvatarPreviewSurface"
            aria-label={labels.avatarCurrent}
          >
            <EmployeeProfileAvatar
              avatarUrl={avatarPreviewUrl ?? avatarUrl}
              displayName={defaultDisplayName}
            />
          </div>
          <label className="fieldStack">
            <span className="detailLabel">{labels.avatar}</span>
            <input
              ref={fileInputRef}
              accept="image/png,image/jpeg,image/webp"
              className="fileInput"
              name="avatarFile"
              onChange={handleAvatarFileChange}
              type="file"
            />
            <span className="metaText">{labels.avatarRecommendation}</span>
          </label>
        </div>
        <label className="fieldStack">
          <span className="detailLabel">{labels.displayName}</span>
          <input
            className="textInput"
            defaultValue={defaultDisplayName}
            name="displayName"
            required
            type="text"
          />
        </label>
        <label className="fieldStack">
          <span className="detailLabel">{labels.phoneNumber}</span>
          <PhoneNumberInput
            className="textInput"
            defaultValue={defaultPhoneNumber ?? ""}
            name="phoneNumber"
            placeholder={labels.phonePlaceholder}
          />
        </label>
      </fieldset>

      <button className="primaryButton" disabled={isBusy} type="submit">
        {isPending ? (
          <LoaderCircle
            className="buttonSpinner"
            size={18}
            aria-hidden="true"
          />
        ) : (
          <Save size={18} aria-hidden="true" />
        )}
        {isPending ? labels.savingProfile : labels.saveProfile}
      </button>

      {notice ? (
        <p
          className="actionStateNotice"
          data-variant={notice.variant}
          role={notice.variant === "error" ? "alert" : "status"}
        >
          {notice.message}
        </p>
      ) : null}
    </form>
  );
}

function validateAvatarFile(
  file: File
): Extract<
  EmployeeProfileActionCode,
  "avatar_invalid_type" | "avatar_too_large"
> | null {
  if (!employeeAvatarMediaTypes.has(file.type)) {
    return "avatar_invalid_type";
  }

  if (file.size <= 0 || file.size > maxEmployeeAvatarBytes) {
    return "avatar_too_large";
  }

  return null;
}

function EmployeeProfileAvatar({
  avatarUrl,
  displayName
}: {
  readonly avatarUrl: string | null;
  readonly displayName: string;
}): ReactNode {
  if (avatarUrl) {
    return (
      <img
        alt=""
        className="employeeAvatar employeeAvatarLarge"
        src={avatarUrl}
      />
    );
  }

  const initials = employeeInitials(displayName);

  return (
    <span className="employeeAvatar employeeAvatarLarge" aria-hidden="true">
      {initials.length > 0 ? initials : <Camera size={18} aria-hidden="true" />}
    </span>
  );
}

function employeeInitials(displayName: string): string {
  return displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
