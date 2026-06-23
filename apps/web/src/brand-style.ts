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
  "radius.control": "--hulee-radius-control"
} as const;

type CssCustomProperty = `--${string}`;

type BrandProfileView = {
  productName: string;
  shortProductName?: string;
  themeTokens: Record<string, string>;
};

export function brandProfileToCssProperties(
  brand: BrandProfileView
): CSSProperties {
  const style: Record<CssCustomProperty, string> = {};

  for (const [token, value] of Object.entries(brand.themeTokens)) {
    const cssVariable = cssTokenMap[token as keyof typeof cssTokenMap];

    if (cssVariable) {
      style[cssVariable as CssCustomProperty] = value;
    }
  }

  return style as CSSProperties;
}

export function buildBrandMarkLabel(brand: BrandProfileView): string {
  const source = brand.shortProductName ?? brand.productName;
  const normalized = source.trim();

  if (normalized.length <= 2) {
    return normalized;
  }

  return normalized.slice(0, 2);
}
