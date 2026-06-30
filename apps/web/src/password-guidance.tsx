"use client";

import { Check, Circle, Eye, EyeOff, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";

import {
  evaluatePasswordGuidance,
  generateStrongPassword,
  maximumPasswordLength,
  minimumPasswordLength,
  type PasswordGuidanceRequirementId
} from "./password-guidance-model";

export type PasswordGuidanceLabels = {
  password: string;
  title: string;
  generate: string;
  hidePassword: string;
  requirements: Record<PasswordGuidanceRequirementId, string>;
  showPassword: string;
};

export type PasswordGuidanceProps = {
  inputId: string;
  labels: PasswordGuidanceLabels;
  autoComplete?: string;
  email?: string;
  inputName?: string;
  required?: boolean;
};

export function PasswordGuidance({
  inputId,
  labels,
  autoComplete = "new-password",
  email,
  inputName = "password",
  required = true
}: PasswordGuidanceProps) {
  const [password, setPassword] = useState("");
  const [isPasswordVisible, setPasswordVisible] = useState(false);
  const requirements = useMemo(() => {
    return evaluatePasswordGuidance(password, { email }).filter(
      (requirement) => requirement.visible
    );
  }, [email, password]);
  const guidanceId = `${inputId}-guidance`;
  const VisibilityIcon = isPasswordVisible ? EyeOff : Eye;
  const visibilityLabel = isPasswordVisible
    ? labels.hidePassword
    : labels.showPassword;

  return (
    <div className="passwordGuidance">
      <div className="fieldStack">
        <label className="detailLabel" htmlFor={inputId}>
          {labels.password}
        </label>
        <div className="passwordInputWrap">
          <input
            aria-describedby={guidanceId}
            autoComplete={autoComplete}
            className="textInput"
            id={inputId}
            maxLength={maximumPasswordLength}
            minLength={minimumPasswordLength}
            name={inputName}
            onChange={(event) => {
              setPassword(event.currentTarget.value);
            }}
            required={required}
            type={isPasswordVisible ? "text" : "password"}
            value={password}
          />
          <button
            aria-label={visibilityLabel}
            aria-pressed={isPasswordVisible}
            className="passwordVisibilityButton"
            onClick={() => {
              setPasswordVisible((visible) => !visible);
            }}
            title={visibilityLabel}
            type="button"
          >
            <VisibilityIcon size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="passwordGuidancePanel" id={guidanceId}>
        <p className="detailLabel passwordGuidanceTitle">{labels.title}</p>
        <ul className="passwordChecklist">
          {requirements.map((requirement) => {
            const Icon = requirement.valid ? Check : Circle;

            return (
              <li
                className="passwordChecklistItem"
                data-valid={requirement.valid ? "true" : "false"}
                key={requirement.id}
              >
                <span className="passwordChecklistIcon">
                  <Icon size={16} aria-hidden="true" />
                </span>
                <span>{labels.requirements[requirement.id]}</span>
              </li>
            );
          })}
        </ul>
        <button
          className="secondaryButton passwordGenerateButton"
          onClick={() => {
            setPassword(generateStrongPassword());
          }}
          type="button"
        >
          <RefreshCw size={16} aria-hidden="true" />
          {labels.generate}
        </button>
      </div>
    </div>
  );
}
