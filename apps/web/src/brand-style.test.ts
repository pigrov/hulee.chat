import { resolveBrandThemePresetForMode } from "@hulee/branding";
import { describe, expect, it } from "vitest";

import {
  brandProfileToCssProperties,
  brandProfileToThemeModeCssProperties
} from "./brand-style";

describe("brand style", () => {
  it("derives page background from the active brand preset tokens", () => {
    const style = brandProfileToCssProperties({
      productName: "Hulee",
      themeTokens: {
        "color.page": "#ffffff",
        "color.surface.muted": "#f0f0f0",
        "color.surface.raised": "#ffffff"
      }
    }) as Record<string, string>;

    expect(style["--hulee-color-page"]).toBe("#ffffff");
    expect(style["--hulee-color-page-background"]).toContain("#f0f0f0");
    expect(style["--hulee-color-page-background"]).toContain("#ffffff");
    expect(style["--hulee-color-page-background"]).not.toContain(
      "var(--hulee-color-surface-muted)"
    );
  });

  it("builds paired rail toggle styles from the current brand color preset", () => {
    const styles = brandProfileToThemeModeCssProperties({
      productName: "Hulee",
      themeTokens: resolveBrandThemePresetForMode("violet", "dark").tokens
    });

    expect(styles.dark["--hulee-color-scheme"]).toBe("dark");
    expect(styles.light["--hulee-color-scheme"]).toBe("light");
    expect(styles.dark["--hulee-color-page"]).toBe("#100d16");
    expect(styles.light["--hulee-color-page"]).toBe("#faf8fd");
    expect(styles.light["--hulee-color-brand-primary"]).toBe("#7c3aed");
  });

  it("preserves custom action colors when building rail toggle styles", () => {
    const styles = brandProfileToThemeModeCssProperties({
      productName: "Hulee",
      themeTokens: {
        ...resolveBrandThemePresetForMode("orange", "light").tokens,
        "color.brand.primary": "#0f766e",
        "color.brand.foreground": "#ffffff",
        "color.accent": "#7c3aed"
      }
    });

    expect(styles.light["--hulee-color-brand-primary"]).toBe("#0f766e");
    expect(styles.dark["--hulee-color-brand-primary"]).toBe("#0f766e");
    expect(styles.dark["--hulee-color-accent"]).toBe("#7c3aed");
    expect(styles.dark["--hulee-color-page"]).toBe("#130f0b");
  });
});
