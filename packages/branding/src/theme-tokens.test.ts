import { describe, expect, it } from "vitest";

import {
  brandThemePresets,
  buildBrandThemeTokens,
  normalizeBrandThemeTokens,
  resolveBrandThemeBasePresetId,
  resolveBrandThemePresetId
} from "./index";

describe("brand theme tokens", () => {
  it("normalizes theme tokens and rejects unsupported values", () => {
    expect(
      normalizeBrandThemeTokens({
        "color.brand.primary": "#177F75",
        "radius.control": "10px"
      })
    ).toEqual({
      "color.brand.primary": "#177f75",
      "radius.control": "10px"
    });

    expect(() =>
      normalizeBrandThemeTokens({
        "--hulee-color-brand-primary": "#177f75"
      })
    ).toThrow(/Unsupported brand theme token/);
    expect(() =>
      normalizeBrandThemeTokens({
        "color.brand.primary": "url(https://example.test)"
      })
    ).toThrow(/Invalid brand color token/);
    expect(() =>
      normalizeBrandThemeTokens({
        "color.brand.primary": "#ffffff",
        "color.brand.foreground": "#fefefe"
      })
    ).toThrow(/low contrast/);
    expect(() =>
      normalizeBrandThemeTokens({
        "color.surface.default": "#ffffff",
        "color.text.default": "#fefefe"
      })
    ).toThrow(/low contrast/);
    expect(() =>
      normalizeBrandThemeTokens({
        "theme.colorScheme": "auto"
      })
    ).toThrow(/Invalid brand color scheme token/);
  });

  it("builds presets with safe foreground colors for custom primary colors", () => {
    expect(
      buildBrandThemeTokens({
        presetId: "green",
        primaryColor: "#16a34a",
        accentColor: "#a16207"
      })
    ).toMatchObject({
      "color.brand.primary": "#16a34a",
      "color.brand.foreground": "#111827",
      "color.accent": "#a16207"
    });

    for (const preset of brandThemePresets) {
      expect(resolveBrandThemePresetId(preset.tokens)).toBe(preset.id);
      expect(preset.tokens["theme.colorScheme"]).toMatch(/^(?:light|dark)$/);
    }
  });

  it("keeps the base preset when action colors are customized", () => {
    expect(
      resolveBrandThemeBasePresetId({
        ...buildBrandThemeTokens({
          presetId: "hulee-dark",
          primaryColor: "#0f766e",
          accentColor: "#f59e0b"
        })
      })
    ).toBe("hulee-dark");
  });
});
