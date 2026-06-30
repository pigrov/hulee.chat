import { describe, expect, it } from "vitest";

import {
  evaluatePasswordGuidance,
  generateStrongPassword,
  type PasswordGuidanceRequirementId
} from "./password-guidance-model";

describe("password guidance model", () => {
  it("validates the visible password checklist requirements", () => {
    const states = indexRequirements(
      evaluatePasswordGuidance("Secure2026!Value", {
        email: "admin@example.test"
      })
    );

    expect(states.minimum_length?.valid).toBe(true);
    expect(states.digit?.valid).toBe(true);
    expect(states.uppercase?.valid).toBe(true);
    expect(states.symbol?.valid).toBe(true);
    expect(states.no_cyrillic?.valid).toBe(true);
    expect(states.no_surrounding_whitespace?.valid).toBe(true);
    expect(states.not_common_pattern?.valid).toBe(true);
    expect(states.no_account_identifier?.valid).toBe(true);
  });

  it("marks unmet requirements without hiding account-specific guidance", () => {
    const states = indexRequirements(
      evaluatePasswordGuidance(" pigrov2026", {
        email: "pigrov@example.test"
      })
    );

    expect(states.minimum_length?.valid).toBe(false);
    expect(states.uppercase?.valid).toBe(false);
    expect(states.symbol?.valid).toBe(false);
    expect(states.no_surrounding_whitespace?.valid).toBe(false);
    expect(states.no_account_identifier?.visible).toBe(true);
    expect(states.no_account_identifier?.valid).toBe(false);
  });

  it("marks common weak patterns as invalid", () => {
    const states = indexRequirements(evaluatePasswordGuidance("Password2026!"));

    expect(states.not_common_pattern?.valid).toBe(false);
  });

  it("marks Cyrillic letters invalid without treating them as password symbols", () => {
    const states = indexRequirements(
      evaluatePasswordGuidance("Secure2026Пароль")
    );

    expect(states.symbol?.valid).toBe(false);
    expect(states.no_cyrillic?.valid).toBe(false);
  });

  it("generates passwords that satisfy the reusable checklist", () => {
    const generated = generateStrongPassword(() => 0);
    const states = evaluatePasswordGuidance(generated, {
      email: "admin@example.test"
    });

    expect(generated).toHaveLength(18);
    expect(states.filter((state) => state.visible)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "minimum_length", valid: true }),
        expect.objectContaining({ id: "digit", valid: true }),
        expect.objectContaining({ id: "uppercase", valid: true }),
        expect.objectContaining({ id: "symbol", valid: true }),
        expect.objectContaining({ id: "no_cyrillic", valid: true }),
        expect.objectContaining({
          id: "no_surrounding_whitespace",
          valid: true
        }),
        expect.objectContaining({ id: "not_common_pattern", valid: true }),
        expect.objectContaining({ id: "no_account_identifier", valid: true })
      ])
    );
  });
});

function indexRequirements(
  requirements: ReturnType<typeof evaluatePasswordGuidance>
): Partial<
  Record<
    PasswordGuidanceRequirementId,
    ReturnType<typeof evaluatePasswordGuidance>[number]
  >
> {
  return Object.fromEntries(
    requirements.map((requirement) => [requirement.id, requirement])
  );
}
