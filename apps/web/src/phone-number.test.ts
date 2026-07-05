import { describe, expect, it } from "vitest";

import {
  formatInternationalPhoneNumber,
  normalizePhoneNumberForStorage,
  phoneNumberDraftFromInput
} from "./phone-number";

describe("phone number helpers", () => {
  it("normalizes formatted phone input into storage format", () => {
    expect(normalizePhoneNumberForStorage("+7 (916) 505 00 00")).toBe(
      "+79165050000"
    );
    expect(normalizePhoneNumberForStorage("+44 20 7946 0958")).toBe(
      "+442079460958"
    );
  });

  it("formats common international phone numbers for display", () => {
    expect(formatInternationalPhoneNumber("+79165050000")).toBe(
      "+7 916 505 00 00"
    );
    expect(formatInternationalPhoneNumber("+442079460958")).toBe(
      "+44 20 7946 0958"
    );
  });

  it("keeps a partial international draft editable", () => {
    expect(phoneNumberDraftFromInput("7 916")).toBe("+7916");
    expect(formatInternationalPhoneNumber("+7916")).toBe("+7 916");
  });

  it("rejects phone values that cannot be represented as international numbers", () => {
    expect(() => normalizePhoneNumberForStorage("123")).toThrow(
      "phone.invalid"
    );
  });
});
