"use client";

import {
  formatPhoneNumber,
  normalizeEmailAddress,
  parsePhoneNumberInput
} from "@hulee/contact-identity";
import { useState, type ReactNode } from "react";

import {
  describePhoneNumberDraft,
  formatInternationalPhoneNumber,
  phoneNumberDraftFromInput
} from "./phone-number";

export function EmailInput({
  className,
  defaultValue,
  disabled,
  name,
  placeholder,
  readOnly,
  required = false
}: {
  readonly className?: string;
  readonly defaultValue?: string | null;
  readonly disabled?: boolean;
  readonly name?: string;
  readonly placeholder?: string;
  readonly readOnly?: boolean;
  readonly required?: boolean;
}) {
  const [value, setValue] = useState(defaultValue ?? "");

  return (
    <input
      autoComplete="email"
      className={className}
      disabled={disabled}
      name={name}
      onBlur={() => {
        setValue(normalizeEmailInputValue(value));
      }}
      onChange={(event) => {
        setValue(event.currentTarget.value);
      }}
      placeholder={placeholder}
      readOnly={readOnly}
      required={required}
      type="email"
      value={value}
    />
  );
}

export function EmailText({
  asLink = true,
  className,
  fallback = "",
  value
}: {
  readonly asLink?: boolean;
  readonly className?: string;
  readonly fallback?: string;
  readonly value: string | null | undefined;
}): ReactNode {
  const email = normalizeEmailInputValue(value ?? "");

  if (email.length === 0) {
    return <span className={className}>{fallback}</span>;
  }

  return asLink ? (
    <a className={className} href={`mailto:${email}`}>
      {email}
    </a>
  ) : (
    <span className={className}>{email}</span>
  );
}

export function PhoneNumberInput({
  className,
  defaultValue,
  disabled,
  name,
  placeholder,
  required = false
}: {
  readonly className?: string;
  readonly defaultValue?: string | null;
  readonly disabled?: boolean;
  readonly name: string;
  readonly placeholder?: string;
  readonly required?: boolean;
}) {
  const initialDraft = phoneNumberDraftFromInput(defaultValue ?? "");
  const [draft, setDraft] = useState(initialDraft);
  const phoneView = describePhoneNumberDraft(draft);
  const callingCodeLabel = phoneView.countryCallingCode
    ? `+${phoneView.countryCallingCode}`
    : "+";
  const displayValue = phoneInputDisplayValue({
    callingCodeLabel,
    displayValue:
      phoneView.displayValue || formatInternationalPhoneNumber(draft)
  });
  const shellClassName = className
    ? `phoneNumberInputShell ${className}`
    : "phoneNumberInputShell";

  return (
    <>
      <input name={name} type="hidden" value={draft} />
      <span
        className={shellClassName}
        data-has-country={phoneView.country ? "true" : "false"}
        data-length-status={phoneView.lengthStatus ?? "unknown"}
      >
        <span className="phoneNumberCallingCode" aria-hidden="true">
          {callingCodeLabel}
        </span>
        <input
          autoComplete="tel"
          className="phoneNumberInputControl"
          disabled={disabled}
          inputMode="tel"
          onChange={(event) => {
            const nextDraft = phoneNumberDraftFromDisplayValue({
              callingCodeLabel,
              displayValue: event.currentTarget.value,
              hasCallingCode: Boolean(phoneView.countryCallingCode)
            });

            setDraft(nextDraft);
          }}
          placeholder={placeholder}
          required={required}
          type="tel"
          value={displayValue}
        />
        {phoneView.country ? (
          <span className="phoneNumberCountryCode" aria-hidden="true">
            {phoneView.country}
          </span>
        ) : null}
      </span>
    </>
  );
}

function phoneInputDisplayValue(input: {
  callingCodeLabel: string;
  displayValue: string;
}): string {
  return input.displayValue.startsWith(input.callingCodeLabel)
    ? input.displayValue.slice(input.callingCodeLabel.length).trimStart()
    : input.displayValue;
}

function phoneNumberDraftFromDisplayValue(input: {
  callingCodeLabel: string;
  displayValue: string;
  hasCallingCode: boolean;
}): string {
  const value = input.displayValue.trim();

  if (value.length === 0) {
    return "";
  }

  return phoneNumberDraftFromInput(
    value.startsWith("+") || !input.hasCallingCode
      ? value
      : `${input.callingCodeLabel}${value}`
  );
}

export function PhoneNumberText({
  asLink = true,
  className,
  fallback = "",
  value
}: {
  readonly asLink?: boolean;
  readonly className?: string;
  readonly fallback?: string;
  readonly value: string | null | undefined;
}): ReactNode {
  const formatted = formatPhoneNumber(value, { fallback });
  const parsed = parsePhoneNumberInput(value ?? "");

  if (formatted.length === 0) {
    return <span className={className}>{fallback}</span>;
  }

  return asLink && parsed.startsWith("+") ? (
    <a className={className} href={`tel:${parsed}`}>
      {formatted}
    </a>
  ) : (
    <span className={className}>{formatted}</span>
  );
}

function normalizeEmailInputValue(value: string): string {
  try {
    return normalizeEmailAddress(value);
  } catch {
    return value.trim().toLowerCase();
  }
}
