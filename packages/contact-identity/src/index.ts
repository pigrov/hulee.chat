import {
  AsYouType,
  parseIncompletePhoneNumber,
  parsePhoneNumberFromString
} from "libphonenumber-js/max";
import type {
  CountryCode,
  ValidatePhoneNumberLengthResult
} from "libphonenumber-js/max";

export type { CountryCode };

declare const normalizedEmailBrand: unique symbol;
declare const e164PhoneNumberBrand: unique symbol;

export type NormalizedEmailAddress = string & {
  readonly [normalizedEmailBrand]: "NormalizedEmailAddress";
};

export type E164PhoneNumber = string & {
  readonly [e164PhoneNumberBrand]: "E164PhoneNumber";
};

export type ContactIdentityErrorCode =
  | "email.disposable_domain"
  | "email.invalid"
  | "email.reserved_domain"
  | "phone.invalid";

export type EmailValidationPolicy = {
  readonly blockDisposableDomains?: boolean;
  readonly blockReservedDomains?: boolean;
  readonly disposableDomains?: readonly string[];
  readonly reservedDomains?: readonly string[];
};

export type EmailRiskFlag =
  | "disposable_domain"
  | "reserved_domain"
  | "role_account";

export type EmailValidationResult =
  | {
      readonly ok: true;
      readonly email: NormalizedEmailAddress;
      readonly localPart: string;
      readonly domain: string;
      readonly riskFlags: readonly EmailRiskFlag[];
    }
  | {
      readonly ok: false;
      readonly code: ContactIdentityErrorCode;
      readonly riskFlags: readonly EmailRiskFlag[];
    };

export type PhoneNumberValidationResult =
  | {
      readonly ok: true;
      readonly number: E164PhoneNumber;
      readonly country?: CountryCode;
      readonly countryCallingCode: string;
      readonly nationalNumber: string;
    }
  | {
      readonly ok: false;
      readonly code: ContactIdentityErrorCode;
    };

export type PhoneNumberInputDescription = {
  readonly chars: string;
  readonly country?: CountryCode;
  readonly countryCallingCode?: string;
  readonly displayValue: string;
  readonly isInternational: boolean;
  readonly lengthStatus: ValidatePhoneNumberLengthResult;
  readonly template: string;
};

export class ContactIdentityError extends Error {
  constructor(readonly code: ContactIdentityErrorCode) {
    super(code);
  }
}

const defaultDisposableDomains = [
  "10minutemail.com",
  "guerrillamail.com",
  "mailinator.com",
  "tempmail.com",
  "temp-mail.org",
  "yopmail.com"
] as const;

const defaultReservedDomains = [
  "example.com",
  "example.net",
  "example.org",
  "invalid",
  "localhost",
  "test"
] as const;

const roleLocalParts = [
  "abuse",
  "admin",
  "billing",
  "contact",
  "help",
  "info",
  "noreply",
  "no-reply",
  "postmaster",
  "sales",
  "security",
  "support"
] as const;

export function normalizeEmailAddress(
  value: string,
  policy: EmailValidationPolicy = {}
): NormalizedEmailAddress {
  const result = validateEmailAddress(value, policy);

  if (!result.ok) {
    throw new ContactIdentityError(result.code);
  }

  return result.email;
}

export function validateEmailAddress(
  value: string,
  policy: EmailValidationPolicy = {}
): EmailValidationResult {
  const normalized = value.trim().toLowerCase();
  const parts = normalized.split("@");

  if (
    normalized.length === 0 ||
    normalized.length > 254 ||
    parts.length !== 2
  ) {
    return { ok: false, code: "email.invalid", riskFlags: [] };
  }

  const [localPart, domain] = parts;
  const syntaxValid =
    localPart.length > 0 &&
    localPart.length <= 64 &&
    domain.length > 0 &&
    domain.length <= 253 &&
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(localPart) &&
    /^[a-z0-9.-]+$/.test(domain) &&
    !localPart.startsWith(".") &&
    !localPart.endsWith(".") &&
    !localPart.includes("..") &&
    !domain.startsWith(".") &&
    !domain.endsWith(".") &&
    !domain.includes("..") &&
    domain.includes(".");

  if (!syntaxValid) {
    return { ok: false, code: "email.invalid", riskFlags: [] };
  }

  const riskFlags = assessEmailAddressRisk(normalized, policy);

  if (
    policy.blockReservedDomains === true &&
    riskFlags.includes("reserved_domain")
  ) {
    return { ok: false, code: "email.reserved_domain", riskFlags };
  }

  if (
    policy.blockDisposableDomains === true &&
    riskFlags.includes("disposable_domain")
  ) {
    return { ok: false, code: "email.disposable_domain", riskFlags };
  }

  return {
    ok: true,
    email: normalized as NormalizedEmailAddress,
    localPart,
    domain,
    riskFlags
  };
}

export function assessEmailAddressRisk(
  value: string,
  policy: EmailValidationPolicy = {}
): readonly EmailRiskFlag[] {
  const normalized = value.trim().toLowerCase();
  const [localPart, domain] = normalized.split("@");
  const flags: EmailRiskFlag[] = [];

  if (domain && isReservedEmailDomain(domain, policy.reservedDomains)) {
    flags.push("reserved_domain");
  }

  if (domain && isDisposableEmailDomain(domain, policy.disposableDomains)) {
    flags.push("disposable_domain");
  }

  if (localPart && (roleLocalParts as readonly string[]).includes(localPart)) {
    flags.push("role_account");
  }

  return flags;
}

export function normalizePhoneNumber(
  value: string,
  defaultCountry?: CountryCode
): E164PhoneNumber {
  const result = validatePhoneNumber(value, defaultCountry);

  if (!result.ok) {
    throw new ContactIdentityError(result.code);
  }

  return result.number;
}

export function normalizeOptionalPhoneNumber(
  value: string | null | undefined,
  defaultCountry?: CountryCode
): E164PhoneNumber | null {
  if (value === null || value === undefined || value.trim().length === 0) {
    return null;
  }

  return normalizePhoneNumber(value, defaultCountry);
}

export function validatePhoneNumber(
  value: string,
  defaultCountry?: CountryCode
): PhoneNumberValidationResult {
  const phoneNumber = parsePhoneNumberFromString(value.trim(), defaultCountry);

  if (!phoneNumber || !phoneNumber.isPossible()) {
    return { ok: false, code: "phone.invalid" };
  }

  return {
    ok: true,
    number: phoneNumber.number as E164PhoneNumber,
    country: phoneNumber.country,
    countryCallingCode: phoneNumber.countryCallingCode,
    nationalNumber: phoneNumber.nationalNumber
  };
}

export function formatPhoneNumber(
  value: string | null | undefined,
  input: {
    readonly defaultCountry?: CountryCode;
    readonly fallback?: string;
    readonly format?: "international" | "national" | "uri";
  } = {}
): string {
  if (value === null || value === undefined || value.trim().length === 0) {
    return input.fallback ?? "";
  }

  const phoneNumber = parsePhoneNumberFromString(
    value.trim(),
    input.defaultCountry
  );

  if (!phoneNumber) {
    return input.fallback ?? value;
  }

  switch (input.format ?? "international") {
    case "national":
      return phoneNumber.formatNational();
    case "uri":
      return phoneNumber.getURI();
    case "international":
      return phoneNumber.formatInternational();
  }
}

export function formatPhoneNumberAsYouType(
  value: string,
  defaultCountry?: CountryCode
): string {
  return new AsYouType(defaultCountry).input(value);
}

export function describePhoneNumberInput(
  value: string,
  defaultCountry?: CountryCode
): PhoneNumberInputDescription {
  const formatter = new AsYouType(defaultCountry);
  const displayValue = formatter.input(value);

  return {
    chars: formatter.getChars(),
    country: formatter.getCountry(),
    countryCallingCode: formatter.getCallingCode(),
    displayValue,
    isInternational: formatter.isInternational(),
    lengthStatus: formatter.validateLength(),
    template: formatter.getTemplate()
  };
}

export function parsePhoneNumberInput(value: string): string {
  return parseIncompletePhoneNumber(value);
}

function isReservedEmailDomain(
  domain: string,
  reservedDomains: readonly string[] = defaultReservedDomains
): boolean {
  return reservedDomains.some((reservedDomain) => {
    return domain === reservedDomain || domain.endsWith(`.${reservedDomain}`);
  });
}

function isDisposableEmailDomain(
  domain: string,
  disposableDomains: readonly string[] = defaultDisposableDomains
): boolean {
  return disposableDomains.some((disposableDomain) => {
    return (
      domain === disposableDomain || domain.endsWith(`.${disposableDomain}`)
    );
  });
}
