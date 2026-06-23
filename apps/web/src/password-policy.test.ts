import { describe, expect, it } from "vitest";

import {
  requireValidPassword,
  validatePasswordPolicy
} from "./password-policy";

describe("password policy", () => {
  it("accepts strong compact passwords and longer passphrases", () => {
    expect(validatePasswordPolicy("CorrectHorse12")).toEqual({
      valid: true,
      password: "CorrectHorse12"
    });
    expect(validatePasswordPolicy("correct horse battery staple")).toEqual({
      valid: true,
      password: "correct horse battery staple"
    });
  });

  it("rejects short, oversized and low-complexity passwords", () => {
    expect(validatePasswordPolicy("Aa1!")).toMatchObject({
      valid: false,
      violations: expect.arrayContaining(["too_short"])
    });
    expect(validatePasswordPolicy("correcthorsebattery")).toMatchObject({
      valid: false,
      violations: expect.arrayContaining(["insufficient_complexity"])
    });
    expect(validatePasswordPolicy("A1!".repeat(100))).toMatchObject({
      valid: false,
      violations: expect.arrayContaining(["too_long"])
    });
  });

  it("rejects passwords with surrounding whitespace or common weak patterns", () => {
    expect(validatePasswordPolicy(" CorrectHorse12")).toMatchObject({
      valid: false,
      violations: expect.arrayContaining(["leading_or_trailing_whitespace"])
    });
    expect(validatePasswordPolicy("Password123!")).toMatchObject({
      valid: false,
      violations: expect.arrayContaining(["common_pattern"])
    });
    expect(validatePasswordPolicy("AAAAAAAAAAAA")).toMatchObject({
      valid: false,
      violations: expect.arrayContaining(["common_pattern"])
    });
  });

  it("rejects passwords containing account identifiers", () => {
    expect(
      validatePasswordPolicy("Pigrov2026!Secure", {
        email: "pigrov@example.test"
      })
    ).toMatchObject({
      valid: false,
      violations: expect.arrayContaining(["contains_identifier"])
    });
  });

  it("throws from the require helper without leaking the password", () => {
    expect(() => requireValidPassword("Password123!")).toThrow(
      /Password policy violation/
    );
    expect(() => requireValidPassword("CorrectHorse12")).not.toThrow();
  });
});
