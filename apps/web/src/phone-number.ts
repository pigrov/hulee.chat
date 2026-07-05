import {
  describePhoneNumberInput,
  formatPhoneNumber,
  formatPhoneNumberAsYouType,
  normalizeOptionalPhoneNumber,
  parsePhoneNumberInput,
  type CountryCode,
  type PhoneNumberInputDescription
} from "@hulee/contact-identity";

export function normalizePhoneNumberForStorage(
  value: string | null | undefined,
  defaultCountry?: CountryCode
): string | null {
  return normalizeOptionalPhoneNumber(value, defaultCountry);
}

export function phoneNumberDraftFromInput(value: string): string {
  const parsed = parsePhoneNumberInput(value);

  if (parsed.length === 0) {
    return "";
  }

  return parsed.startsWith("+") ? parsed : `+${parsed}`;
}

export function formatInternationalPhoneNumber(
  value: string | null | undefined
): string {
  if (value === null || value === undefined || value.trim().length === 0) {
    return "";
  }

  const draft = phoneNumberDraftFromInput(value);

  return formatPhoneNumber(draft, {
    fallback: formatPhoneNumberAsYouType(draft)
  });
}

export function formatPhoneNumberInput(
  value: string,
  defaultCountry?: CountryCode
): string {
  return formatPhoneNumberAsYouType(value, defaultCountry);
}

export function describePhoneNumberDraft(
  value: string,
  defaultCountry?: CountryCode
): PhoneNumberInputDescription {
  return describePhoneNumberInput(value, defaultCountry);
}
