import { describe, expect, it } from "vitest";

import {
  brandThemeColorPresets,
  brandThemePresets,
  buildBrandThemeTokens,
  normalizeBrandThemeTokens,
  resolveBrandThemeBasePresetId,
  resolveBrandThemeColorPresetId,
  resolveBrandThemeMode,
  resolveBrandThemePresetForMode,
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
    expect(
      buildBrandThemeTokens({
        presetId: "neutral",
        primaryColor: "#777777"
      })
    ).toMatchObject({
      "color.brand.primary": "#777777",
      "color.brand.foreground": "#000000"
    });

    for (const preset of brandThemePresets) {
      expect(resolveBrandThemePresetId(preset.tokens)).toBe(preset.id);
      expect(preset.tokens["theme.colorScheme"]).toMatch(/^(?:light|dark)$/);
    }
  });

  it("exposes color presets with paired light and dark variants", () => {
    expect(brandThemeColorPresets.map((preset) => preset.id)).toEqual([
      "hulee",
      "neutral",
      "blue",
      "green",
      "red",
      "orange",
      "amber",
      "violet",
      "rose",
      "cyan",
      "graphite",
      "high-contrast"
    ]);

    expect(resolveBrandThemePresetForMode("neutral", "dark").id).toBe(
      "neutral-dark"
    );
    expect(resolveBrandThemePresetForMode("blue-dark", "light").id).toBe(
      "blue"
    );
    expect(resolveBrandThemePresetForMode("orange", "dark").id).toBe(
      "orange-dark"
    );
    expect(resolveBrandThemePresetForMode("violet-dark", "light").id).toBe(
      "violet"
    );
    expect(
      resolveBrandThemeColorPresetId(
        resolveBrandThemePresetForMode("green", "dark").tokens
      )
    ).toBe("green");
    expect(
      resolveBrandThemeMode(
        resolveBrandThemePresetForMode("graphite", "dark").tokens
      )
    ).toBe("dark");
  });

  it("uses a lavender indigo Hulee brand palette in light and dark modes", () => {
    expect(
      resolveBrandThemePresetForMode("hulee", "light").tokens
    ).toMatchObject({
      "color.page": "#f6f7ff",
      "color.surface.muted": "#f0f1ff",
      "color.brand.primary": "#4f46e5",
      "color.accent": "#6d5dfc",
      "theme.colorScheme": "light"
    });
    expect(
      resolveBrandThemePresetForMode("hulee", "dark").tokens
    ).toMatchObject({
      "color.page": "#090d1f",
      "color.surface.muted": "#202747",
      "color.brand.primary": "#a5b4fc",
      "color.accent": "#818cf8",
      "theme.colorScheme": "dark"
    });
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
    expect(
      resolveBrandThemeColorPresetId({
        ...buildBrandThemeTokens({
          presetId: "hulee",
          mode: "dark",
          primaryColor: "#0f766e",
          accentColor: "#f59e0b"
        })
      })
    ).toBe("hulee");
  });
});
