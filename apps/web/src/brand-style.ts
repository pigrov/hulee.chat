import {
  buildBrandThemeTokens,
  resolveBrandThemeColorPresetId,
  resolveBrandThemeMode,
  resolveBrandThemePresetForMode,
  type BrandThemeMode
} from "@hulee/branding";
import type { CSSProperties } from "react";

const cssTokenMap = {
  "color.brand.primary": "--hulee-color-brand-primary",
  "color.brand.foreground": "--hulee-color-brand-foreground",
  "color.accent": "--hulee-color-accent",
  "color.page": "--hulee-color-page",
  "color.surface.default": "--hulee-color-surface-default",
  "color.surface.raised": "--hulee-color-surface-raised",
  "color.surface.muted": "--hulee-color-surface-muted",
  "color.border": "--hulee-color-border",
  "color.border.strong": "--hulee-color-border-strong",
  "color.text.default": "--hulee-color-text-default",
  "color.text.muted": "--hulee-color-text-muted",
  "color.danger": "--hulee-color-danger",
  "theme.colorScheme": "--hulee-color-scheme",
  "radius.control": "--hulee-radius-control"
} as const;

type CssCustomProperty = `--${string}`;
const pageBackgroundCssVariable = "--hulee-color-page-background";
export type BrandThemeModeCssProperties = Record<CssCustomProperty, string>;

type BrandProfileView = {
  productName: string;
  shortProductName?: string;
  themeTokens: Record<string, string>;
};

export function brandProfileToCssProperties(
  brand: BrandProfileView
): CSSProperties {
  return brandThemeTokensToCssProperties(brand.themeTokens) as CSSProperties;
}

export function brandProfileToThemeModeCssProperties(
  brand: BrandProfileView
): Record<BrandThemeMode, BrandThemeModeCssProperties> {
  const currentTokens = brand.themeTokens;
  const currentThemeMode = resolveBrandThemeMode(currentTokens);
  const colorPresetId =
    resolveBrandThemeColorPresetId(currentTokens) ?? "hulee";
  const currentPresetTokens = resolveBrandThemePresetForMode(
    colorPresetId,
    currentThemeMode
  ).tokens;
  const customPrimaryColor =
    currentTokens["color.brand.primary"] !==
    currentPresetTokens["color.brand.primary"]
      ? currentTokens["color.brand.primary"]
      : undefined;
  const customAccentColor =
    currentTokens["color.accent"] !== currentPresetTokens["color.accent"]
      ? currentTokens["color.accent"]
      : undefined;

  return {
    light: brandThemeTokensToCssProperties(
      buildBrandThemeTokens({
        presetId: colorPresetId,
        mode: "light",
        primaryColor: customPrimaryColor,
        accentColor: customAccentColor
      })
    ),
    dark: brandThemeTokensToCssProperties(
      buildBrandThemeTokens({
        presetId: colorPresetId,
        mode: "dark",
        primaryColor: customPrimaryColor,
        accentColor: customAccentColor
      })
    )
  };
}

function brandThemeTokensToCssProperties(
  themeTokens: Record<string, string>
): BrandThemeModeCssProperties {
  const style: Record<CssCustomProperty, string> = {};

  for (const [token, value] of Object.entries(themeTokens)) {
    const cssVariable = cssTokenMap[token as keyof typeof cssTokenMap];

    if (cssVariable) {
      style[cssVariable as CssCustomProperty] = value;
    }
  }

  style[pageBackgroundCssVariable] = buildBrandPageBackground(themeTokens);

  return style;
}

export function buildBrandMarkLabel(brand: BrandProfileView): string {
  const source = brand.shortProductName ?? brand.productName;
  const normalized = source.trim();

  if (normalized.length <= 2) {
    return normalized;
  }

  return normalized.slice(0, 2);
}

function buildBrandPageBackground(themeTokens: Record<string, string>): string {
  const page = themeTokens["color.page"] ?? "var(--hulee-color-page)";
  const surfaceMuted =
    themeTokens["color.surface.muted"] ?? "var(--hulee-color-surface-muted)";
  const surfaceRaised =
    themeTokens["color.surface.raised"] ?? "var(--hulee-color-surface-raised)";

  return [
    "linear-gradient(135deg,",
    `color-mix(in srgb, ${surfaceMuted} 62%, ${page}) 0%,`,
    `color-mix(in srgb, ${surfaceMuted} 28%, ${page}) 46%,`,
    `color-mix(in srgb, ${surfaceRaised} 52%, ${page}) 100%)`
  ].join(" ");
}
