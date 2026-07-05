import { describe, expect, it } from "vitest";

import {
  assessEmailAddressRisk,
  ContactIdentityError,
  formatPhoneNumber,
  formatPhoneNumberAsYouType,
  describePhoneNumberInput,
  normalizeEmailAddress,
  normalizePhoneNumber,
  validateEmailAddress,
  validatePhoneNumber
} from "./index";

describe("contact identity", () => {
  it("normalizes international phone numbers to E.164", () => {
    expect(normalizePhoneNumber("+7 (916) 505 00 00")).toBe("+79165050000");
    expect(normalizePhoneNumber("+44 20 7946 0958")).toBe("+442079460958");
  });

  it("formats stored phone numbers for display and as-you-type input", () => {
    expect(formatPhoneNumber("+79165050000")).toBe("+7 916 505 00 00");
    expect(formatPhoneNumber("+442079460958")).toBe("+44 20 7946 0958");
    expect(formatPhoneNumberAsYouType("+7916505")).toBe("+7 916 505");
  });

  it("describes phone input for UI chrome", () => {
    expect(describePhoneNumberInput("+7916505")).toMatchObject({
      chars: "+7916505",
      country: "RU",
      countryCallingCode: "7",
      displayValue: "+7 916 505",
      isInternational: true,
      template: "xx xxx xxx"
    });
  });

  it("rejects impossible phone numbers", () => {
    expect(validatePhoneNumber("123")).toEqual({
      ok: false,
      code: "phone.invalid"
    });
    expect(() => normalizePhoneNumber("123")).toThrow(ContactIdentityError);
  });

  it("normalizes email addresses and reports risky domains", () => {
    expect(normalizeEmailAddress(" ADMIN@Example.COM ")).toBe(
      "admin@example.com"
    );
    expect(assessEmailAddressRisk("admin@example.com")).toEqual([
      "reserved_domain",
      "role_account"
    ]);
  });

  it("can block reserved and disposable email domains by policy", () => {
    expect(
      validateEmailAddress("person@example.test", {
        blockReservedDomains: true
      })
    ).toMatchObject({
      ok: false,
      code: "email.reserved_domain"
    });
    expect(
      validateEmailAddress("person@mailinator.com", {
        blockDisposableDomains: true
      })
    ).toMatchObject({
      ok: false,
      code: "email.disposable_domain"
    });
  });
});
